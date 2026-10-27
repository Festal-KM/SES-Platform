// tests/isolation/chat-attachments.test.ts
// ✅ 2026-10-27（チャットレーン・紺野の決定）: ファイル（社内だけの部屋から）の分離。`docs/02` `F-038` 改訂 12 ⑫ / AC-14 /
// `docs/05` §3.7.1「ファイル（社内だけの部屋）」/ §6.5 #51 #51p #51q #51r。migration 20261027010000。
//
// 🔴 ここで固定すること:
//   ① キーはサーバが組む（札に焼き込む）。札を別の部屋・別の人で使えない。キーを入力で渡しても使われない
//   ② 🔴 CLEAN でない添付の発言は、送った本人以外に**行ごと**見えない（API の一覧・RLS の行・一覧 #51r）。本人には見える
//   ③ 🔴 送った時点では部屋の最終更新が動かない（相手の一覧の並びで分からない）。CLEAN になったら動く
//   ④ 共有 URL は CLEAN になってから・部屋を読める人だけ。発行のたびに監査ログが 1 行（種類と大きさだけ）
//   ⑤ 🔴 他テナント・別の取引先・メンバーでない人（同じ会社の管理者を含む）は、一覧も URL も 404（無い ID と同じ）
//   ⑥ 🔴 取引先がいる部屋には添えられない（アプリの 400 と DB のトリガ）
//   ⑦ 検査の結果は messages.attachment_key にも適用される（ジョブのホスト文脈から。滞留の照会・隔離の周知先も）
//   ⑧ 同じ札の二重送信は 1 行に収束する
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyFileScanResult,
  configureTenantDb,
  disconnectTenantDb,
  listStalledScanTargets,
  readScanQuarantineNotice,
  resolveTenantCtx,
  systemTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createObjectStore, type ObjectStore } from '@ses/connectors';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  TENANT_A,
  TENANT_B,
  THREAD_A_P1,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.91' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const USER_A_HOST2 = '01930000-0000-7000-8000-0000000009c1';
const USER_A_HOST3 = '01930000-0000-7000-8000-0000000009c2';
const ABSENT_ID = '01930000-0000-7000-8000-0000000009cf';
const SECRET = Buffer.alloc(32, 3).toString('base64');
const JOB = { queue: 'scan.apply-result', jobId: 'job-chat-attachments' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const groupsRoute = await import('../../apps/web/app/api/(main)/threads/groups/route');
const { listChatMessages } = await import('../../apps/web/lib/chat/read');
const { sendChatMessage } = await import('../../apps/web/lib/chat/service');
const {
  CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD,
  CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD,
  issueChatAttachmentDownloadUrl,
  issueChatAttachmentUploadUrl,
  listChatAttachments,
} = await import('../../apps/web/lib/chat/attachments');
const { createChatAttachmentTokenCodec } = await import('../../apps/web/lib/chat/attachment-token');
const { CHAT_ATTACHMENT_LIST_ITEM_KEYS, CHAT_ATTACHMENT_VIEW_KEYS, CHAT_FORBIDDEN_RESPONSE_KEYS, CHAT_MESSAGE_VIEW_KEYS } = await import(
  '../../apps/web/lib/chat/views'
);
const { chatMessagePostBodySchema } = await import('../../apps/web/lib/chat/schemas');

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let host2: AuthenticatedTenantCtx;
let host3Admin: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;
let roomId: string;
let store: ObjectStore;
const tokens = createChatAttachmentTokenCodec(SECRET);
let clock = new Date('2026-10-27T01:00:00.000Z');
const now = () => clock;

async function upload(ctx: AuthenticatedTenantCtx, threadId: string, contentType: 'application/pdf' | 'image/png' | 'text/plain' = 'application/pdf', byteSize = 1234) {
  return issueChatAttachmentUploadUrl(ctx, threadId, { contentType, byteSize }, { objectStore: store, tokens, uploadMaxBytes: 20 * 1024 * 1024, now });
}

async function send(ctx: AuthenticatedTenantCtx, threadId: string, token: string, body = '') {
  clock = new Date(clock.getTime() + 1000);
  return sendChatMessage(ctx, threadId, { body, attachmentUploadToken: token }, { now, meta: { ipAddress: META.ipAddress }, attachments: { objectStore: store, tokens } });
}

async function rawVisible(ctx: AuthenticatedTenantCtx, messageId: string): Promise<number> {
  return withTenant(ctx, async (db) => db.message.count({ where: { id: messageId } }));
}

async function listedIds(ctx: AuthenticatedTenantCtx, threadId: string): Promise<readonly string[]> {
  const page = await listChatMessages(ctx, threadId, { limit: 50 });
  return page.items.map((item) => item.id);
}

async function applyScan(objectKey: string, status: 'CLEAN' | 'INFECTED') {
  return applyFileScanResult(systemTenantCtx(TENANT_A, JOB), {
    objectKey,
    objectVersionId: `v-${status}`,
    status,
    rawStatus: status === 'CLEAN' ? 'NO_THREATS_FOUND' : 'THREATS_FOUND',
    occurredAt: clock,
    receivedAt: clock,
  });
}

function keyOf(token: string): string {
  const claims = tokens.verify(token, clock);
  if (claims === null) throw new Error('札が確かめられない');
  return claims.objectKey;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  store = createObjectStore('mock');
  await admin.user.createMany({
    data: [
      { id: USER_A_HOST2, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host2@attach.test', displayName: '社内 二郎', passwordHash: 'x' },
      { id: USER_A_HOST3, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host3@attach.test', displayName: '管理 三郎', passwordHash: 'x' },
    ],
  });
  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  host2 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST2, role: 'SALES' }, DEVICE);
  host3Admin = await resolveTenantCtx(
    { ...base, twoFactor: 'VERIFIED', tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST3, role: 'ADMIN' },
    DEVICE,
  );
  partnerA1 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  // 社内だけのグループ（ホストの本人 + 社内 二郎）。
  requireTenantCtxMock.mockResolvedValue(host);
  const created = await groupsRoute.POST(
    new Request('https://app.test/api/threads/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ファイルの確認', userIds: [USER_A_HOST2] }),
    }),
  );
  expect([200, 201], await created.clone().text()).toContain(created.status);
  roomId = ((await created.json()) as { id: string }).id;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { action: { in: [CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD, CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD] } } });
  await admin?.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin?.fileScanResult.deleteMany({ where: { tenantId: TENANT_A, objectVersionId: { in: ['v-CLEAN', 'v-INFECTED'] } } });
  await admin?.user.deleteMany({ where: { id: { in: [USER_A_HOST2, USER_A_HOST3] } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① キーはサーバが組み、札は部屋と送る人に縛られる', () => {
  it('キーは t/{テナント}/chat/{部屋}/{発言}/{uuid}.pdf（ファイル名を含まない）', async () => {
    const ticket = await upload(host, roomId);
    expect(keyOf(ticket.uploadToken)).toMatch(new RegExp(`^t/${TENANT_A}/chat/${roomId}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.pdf$`));
    expect(Object.keys(ticket).sort()).toEqual(['expiresAt', 'requiredHeaders', 'uploadToken', 'uploadUrl']);
  });

  it('🔴 キーを入力で渡しても検証後の値に残らない（札だけを受ける）', () => {
    const parsed = chatMessagePostBodySchema.safeParse({ body: 'x', attachmentKey: `t/${TENANT_A}/chat/${roomId}/a/b.pdf` });
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual(['body']);
  });

  it('🔴 札を別の人・別の部屋で使うと 400（発言は作られない）', async () => {
    const ticket = await upload(host, roomId);
    await expect(send(host2, roomId, ticket.uploadToken)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(send(host, THREAD_A_P1, ticket.uploadToken)).rejects.toMatchObject({ httpStatus: 400 });
    const claims = tokens.verify(ticket.uploadToken, clock);
    expect(await admin.message.count({ where: { id: claims?.messageId ?? ABSENT_ID } })).toBe(0);
  });

  it('🔴 署名の合わない札・実体が置かれていない札は受け付けない', async () => {
    await expect(send(host, roomId, 'v1.e30.AAAA')).rejects.toMatchObject({ httpStatus: 400 });
    const notUploaded = tokens.sign({
      tenantId: TENANT_A,
      threadId: roomId,
      userId: USER_A_HOST,
      messageId: '01930000-0000-7000-8000-0000000009d1',
      objectKey: `t/${TENANT_A}/chat/${roomId}/01930000-0000-7000-8000-0000000009d1/01930000-0000-7000-8000-0000000009d2.pdf`,
      contentType: 'application/pdf',
      byteSize: 10,
      expiresAt: clock.getTime() + 60_000,
    });
    await expect(send(host, roomId, notUploaded)).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('② ③ ④ 検査中は本人だけ → CLEAN で全員に', () => {
  let messageId: string;
  let objectKey: string;
  let sentAt: string;

  beforeAll(async () => {
    const ticket = await upload(host, roomId);
    objectKey = keyOf(ticket.uploadToken);
    const before = await admin.chatThread.findUniqueOrThrow({ where: { id: roomId }, select: { lastMessageAt: true } });
    const result = await send(host, roomId, ticket.uploadToken, '資料です');
    messageId = result.message.id;
    sentAt = result.message.sentAt;
    // ③ 送った時点では最終更新が動かない。
    const after = await admin.chatThread.findUniqueOrThrow({ where: { id: roomId }, select: { lastMessageAt: true } });
    expect(after.lastMessageAt?.toISOString() ?? null).toBe(before.lastMessageAt?.toISOString() ?? null);
  });

  it('行は SCANNING で 4 列そろって作られ、監査 chat_attachment.upload は種類と大きさだけ', async () => {
    const row = await admin.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(row.attachmentKey).toBe(objectKey);
    expect(row.attachmentScanStatus).toBe('SCANNING');
    expect(row.attachmentContentType).toBe('application/pdf');
    expect(row.attachmentByteSize).toBe(1234n);
    const audits = await admin.auditLog.findMany({ where: { action: CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD, targetId: messageId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.summary).toEqual({ contentType: 'application/pdf', byteSize: 1234 });
    expect(JSON.stringify(audits[0])).not.toContain(objectKey);
  });

  it('送った本人には「検査中」として届く（キーやファイル名を含まない）', async () => {
    const page = await listChatMessages(host, roomId, { limit: 50 });
    const mine = page.items.find((item) => item.id === messageId);
    expect(mine?.attachment).toEqual({ kind: 'pdf', contentType: 'application/pdf', byteSize: 1234, scanStatus: 'SCANNING' });
    expect(Object.keys(mine ?? {}).sort()).toEqual([...CHAT_MESSAGE_VIEW_KEYS].sort());
    expect(Object.keys(mine?.attachment ?? {}).sort()).toEqual([...CHAT_ATTACHMENT_VIEW_KEYS].sort());
    for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) expect(JSON.stringify(page)).not.toContain(`"${forbidden}"`);
    expect(JSON.stringify(page)).not.toContain(objectKey);
  });

  it('🔴 同じ部屋のメンバーでも、本人以外には行ごと見えない（API・RLS の行・ファイルの一覧）', async () => {
    expect(await listedIds(host2, roomId)).not.toContain(messageId);
    expect(await rawVisible(host2, messageId)).toBe(0);
    expect((await listChatAttachments(host2, roomId, {})).items).toEqual([]);
    expect(await rawVisible(host, messageId)).toBe(1);
  });

  it('🔴 CLEAN でなければ共有 URL は出ない（本人 409 / 他人 404）。監査も残らない', async () => {
    const deps = { objectStore: store, ipAddress: META.ipAddress, now };
    await expect(issueChatAttachmentDownloadUrl(host, roomId, messageId, 'inline', deps)).rejects.toMatchObject({ httpStatus: 409 });
    await expect(issueChatAttachmentDownloadUrl(host2, roomId, messageId, 'inline', deps)).rejects.toMatchObject({ httpStatus: 404 });
    expect(await admin.auditLog.count({ where: { action: CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD, targetId: messageId } })).toBe(0);
  });

  it('⑦ 滞留の照会に添付のキーが出る（ジョブのホスト文脈から、DM / グループでも）', async () => {
    const stalled = await listStalledScanTargets(systemTenantCtx(TENANT_A, JOB), { before: new Date(clock.getTime() + 60_000), limit: 500 });
    expect(stalled.map((target) => target.objectKey)).toContain(objectKey);
  });

  it('⑦ 検査の結果（CLEAN）が発言に適用され、部屋の最終更新が送った時刻まで進む', async () => {
    const applied = await applyScan(objectKey, 'CLEAN');
    expect(applied.target).toBe('APPLIED');
    expect(applied.previousStatus).toBe('SCANNING');
    expect((await admin.message.findUniqueOrThrow({ where: { id: messageId } })).attachmentScanStatus).toBe('CLEAN');
    const thread = await admin.chatThread.findUniqueOrThrow({ where: { id: roomId }, select: { lastMessageAt: true } });
    expect(thread.lastMessageAt?.toISOString()).toBe(sentAt);
    // 🔴 CLEAN から戻さない（2 回目は KEPT）。
    expect((await applyScan(objectKey, 'CLEAN')).target).toBe('KEPT');
  });

  it('CLEAN になったらメンバーに見え、一覧（#51r）にも載る', async () => {
    expect(await listedIds(host2, roomId)).toContain(messageId);
    const files = await listChatAttachments(host2, roomId, {});
    expect(files.items.map((item) => item.messageId)).toEqual([messageId]);
    expect(Object.keys(files.items[0] ?? {}).sort()).toEqual([...CHAT_ATTACHMENT_LIST_ITEM_KEYS].sort());
    expect(Object.keys(files).sort()).toEqual(['items', 'nextCursor']);
  });

  it('④ メンバーは共有 URL を受け取れ、発行のたびに監査が 1 行（種類と大きさだけ）', async () => {
    const deps = { objectStore: store, ipAddress: META.ipAddress, now };
    const first = await issueChatAttachmentDownloadUrl(host2, roomId, messageId, 'inline', deps);
    expect(first.url).toContain(encodeURIComponent(objectKey));
    expect(first.url).not.toContain('response-content-disposition');
    const second = await issueChatAttachmentDownloadUrl(host2, roomId, messageId, 'attachment', deps);
    expect(decodeURIComponent(second.url)).toContain('attachment; filename="chat-file.pdf"');
    const audits = await admin.auditLog.findMany({ where: { action: CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD, targetId: messageId } });
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.actorId === USER_A_HOST2 && row.targetType === 'Message')).toBe(true);
    expect(audits[0]?.summary).toEqual({ contentType: 'application/pdf', byteSize: 1234 });
  });

  it('🔴 ⑤ メンバーでない管理者・取引先・他テナントは、一覧も URL も 404（無い部屋・無い発言と同じ）', async () => {
    const deps = { objectStore: store, ipAddress: META.ipAddress, now };
    for (const outsider of [host3Admin, partnerA1, tenantB]) {
      await expect(issueChatAttachmentDownloadUrl(outsider, roomId, messageId, 'inline', deps)).rejects.toMatchObject({ httpStatus: 404 });
      await expect(listChatAttachments(outsider, roomId, {})).rejects.toMatchObject({ httpStatus: 404 });
      expect(await rawVisible(outsider, messageId)).toBe(0);
    }
    await expect(issueChatAttachmentDownloadUrl(host2, roomId, ABSENT_ID, 'inline', deps)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(listChatAttachments(host2, ABSENT_ID, {})).rejects.toMatchObject({ httpStatus: 404 });
    // 🔴 別の部屋の ID と組み合わせても出ない。
    await expect(issueChatAttachmentDownloadUrl(host, THREAD_A_P1, messageId, 'inline', deps)).rejects.toMatchObject({ httpStatus: 404 });
    expect(await admin.auditLog.count({ where: { action: CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD, actorId: { in: [USER_A_HOST3, USER_A_PARTNER, USER_B_HOST] } } })).toBe(0);
  });
});

describe('⑦ 問題が見つかったファイル', () => {
  let messageId: string;
  let objectKey: string;

  beforeAll(async () => {
    const ticket = await upload(host, roomId, 'text/plain', 10);
    objectKey = keyOf(ticket.uploadToken);
    messageId = (await send(host, roomId, ticket.uploadToken)).message.id;
    expect((await applyScan(objectKey, 'INFECTED')).target).toBe('APPLIED');
  });

  it('🔴 本人にだけ INFECTED として届き、ほかのメンバーには行ごと見えない。URL は出ない', async () => {
    const mine = (await listChatMessages(host, roomId, { limit: 50 })).items.find((item) => item.id === messageId);
    expect(mine?.attachment?.scanStatus).toBe('INFECTED');
    expect(await rawVisible(host2, messageId)).toBe(0);
    await expect(
      issueChatAttachmentDownloadUrl(host, roomId, messageId, 'inline', { objectStore: store, ipAddress: null, now }),
    ).rejects.toMatchObject({ httpStatus: 409 });
  });

  it('隔離の周知はメールを送らない（宛先 0。本人の画面だけで知らせる）', async () => {
    const notice = await readScanQuarantineNotice(systemTenantCtx(TENANT_A, JOB), { objectKey });
    expect(notice?.target.scanStatus).toBe('INFECTED');
    expect(notice?.recipients).toEqual([]);
  });
});

describe('🔴 ⑥ 取引先がいる部屋には添えられない', () => {
  it('アプリは 400（発行しない）', async () => {
    await expect(upload(host, THREAD_A_P1)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(upload(partnerA1, THREAD_A_P1)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('DB のトリガも拒む（アプリを迂回して添付の列を書いても入らない）', async () => {
    const id = '01930000-0000-7000-8000-0000000009e5';
    await expect(
      withTenant(host, async (db) =>
        db.message.create({
          data: {
            id,
            tenantId: TENANT_A,
            threadId: THREAD_A_P1,
            ownerPartnerCompanyId: PARTNER_A1,
            senderUserId: USER_A_HOST,
            senderPartnerCompanyId: null,
            body: 'x',
            attachmentKey: `t/${TENANT_A}/chat/${THREAD_A_P1}/${id}/01930000-0000-7000-8000-0000000009e6.pdf`,
            attachmentScanStatus: 'CLEAN',
            attachmentContentType: 'application/pdf',
            attachmentByteSize: 10n,
          },
        }),
      ),
    ).rejects.toThrow(/取引先がいる部屋には添付を書けません/);
    expect(await admin.message.count({ where: { id } })).toBe(0);
  });

  it('社内だけの部屋でも、4 列の一部だけ・許可していない種類・上限を超える大きさは DB が拒む', async () => {
    const id = '01930000-0000-7000-8000-0000000009e7';
    const base = { id, tenantId: TENANT_A, threadId: roomId, ownerPartnerCompanyId: null, senderUserId: USER_A_HOST, senderPartnerCompanyId: null, body: 'x' };
    const key = `t/${TENANT_A}/chat/${roomId}/${id}/01930000-0000-7000-8000-0000000009e8.pdf`;
    await expect(admin.message.create({ data: { ...base, attachmentKey: key, attachmentScanStatus: 'CLEAN' } })).rejects.toThrow(/messages_attachment_set_check/);
    await expect(
      admin.message.create({ data: { ...base, attachmentKey: key, attachmentScanStatus: 'CLEAN', attachmentContentType: 'text/html', attachmentByteSize: 10n } }),
    ).rejects.toThrow(/messages_attachment_content_type_check/);
    await expect(
      admin.message.create({
        data: { ...base, attachmentKey: key, attachmentScanStatus: 'CLEAN', attachmentContentType: 'application/pdf', attachmentByteSize: BigInt(20 * 1024 * 1024 + 1) },
      }),
    ).rejects.toThrow(/messages_attachment_byte_size_check/);
  });
});

describe('⑧ 同じ札の二重送信', () => {
  it('1 行に収束し、監査も 1 回だけ', async () => {
    const ticket = await upload(host, roomId, 'image/png', 100);
    const first = await send(host, roomId, ticket.uploadToken);
    const second = await send(host, roomId, ticket.uploadToken);
    expect(second.message.id).toBe(first.message.id);
    expect(await admin.message.count({ where: { id: first.message.id } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD, targetId: first.message.id } })).toBe(1);
  });
});
