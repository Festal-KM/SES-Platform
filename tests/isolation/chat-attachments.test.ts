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
//   ⑨ ストレージ: 上限を超えるなら発行しない / 送信でカウンタがちょうど大きさだけ増え、二重送信では動かない /
//      解約の削除で減る（再実行では動かない）
//   ⑩ 🔴 検査の状態は検査の関数だけが変えられ、添付のキー・種類・大きさは作った後に変えられない（DB のトリガ）
//   ⑪ 🔴 CLEAN でない添付の発言はアナウンスにできない（送った本人からでも 404）
//   ⑬ 🔴 Codex レビュー: 作るだけの書き込み（2 回目の PUT は拒まれる）/ 置かれた後に変わった実体では送れない /
//      検査中に相手が後ろまで読んでも、CLEAN になった発言は未読に数えられ after で拾われる / 送信の時点の上限で 429 にし
//      実体を消す / 放置された実体を片付ける / 検査中の他人の添付は一覧の冒頭・未読の数・検索に現れない
//   ⑫ ✅ 決定 A: 本人が発言を削除したら添付も消える（実体の削除・列を外す・カウンタを 1 度だけ減らす・URL / 一覧から消える）。
//      二重削除は何もしない。他人は削除も、削除済みの発言の添付を外すこともできない
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyFileScanResult,
  applyPurgeSpec,
  readStorageBytesUsed,
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
import { quotaDefaultsWith } from './support/quota-defaults.js';

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
const { deleteChatMessage, sendChatMessage } = await import('../../apps/web/lib/chat/service');
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
const { setChatAnnouncement } = await import('../../apps/web/lib/chat/announcement');
const { countUnread, markChatRead } = await import('../../apps/web/lib/chat/read-state');
const { readChatScreen } = await import('../../apps/web/lib/chat/read');
const { CHAT_THREAD_SORT_DEFAULT } = await import('../../apps/web/lib/chat/thread-tree');
const { cleanupAbandonedChatUploads } = await import('../../apps/worker/src/jobs/usage-storage-reconcile');
const QUOTA = quotaDefaultsWith({ storageLimitBytes: 10n * 1024n * 1024n * 1024n });

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
// ✅ 2026-10-27: 実時刻より 2 時間前から進める（CLEAN の適用は DB の実時刻〔clock_timestamp()〕で位置を決めるため、
//    送った時刻は実時刻より前でなければ「公開した時点の位置へ移る」ことを確かめられない）。
let clock = new Date(Date.now() - 2 * 60 * 60 * 1000);
const now = () => clock;

async function upload(ctx: AuthenticatedTenantCtx, threadId: string, contentType: 'application/pdf' | 'image/png' | 'text/plain' = 'application/pdf', byteSize = 1234) {
  return issueChatAttachmentUploadUrl(ctx, threadId, { contentType, byteSize }, { objectStore: store, tokens, uploadMaxBytes: 20 * 1024 * 1024, quotaDefaults: QUOTA, now });
}

async function send(ctx: AuthenticatedTenantCtx, threadId: string, token: string, body = '', quotaDefaults = QUOTA) {
  clock = new Date(clock.getTime() + 1000);
  return sendChatMessage(ctx, threadId, { body, attachmentUploadToken: token }, { now, meta: { ipAddress: META.ipAddress }, attachments: { objectStore: store, tokens, quotaDefaults } });
}

async function sendText(ctx: AuthenticatedTenantCtx, threadId: string, body: string) {
  clock = new Date(clock.getTime() + 1000);
  return sendChatMessage(ctx, threadId, { body }, { now, meta: { ipAddress: META.ipAddress } });
}

async function unreadOf(ctx: AuthenticatedTenantCtx, threadId: string): Promise<number> {
  return withTenant(ctx, async (db) => (await countUnread(ctx, db, [threadId])).get(threadId) ?? 0);
}

async function rawVisible(ctx: AuthenticatedTenantCtx, messageId: string): Promise<number> {
  return withTenant(ctx, async (db) => db.message.count({ where: { id: messageId } }));
}

async function listedIds(ctx: AuthenticatedTenantCtx, threadId: string): Promise<readonly string[]> {
  const page = await listChatMessages(ctx, threadId, { limit: 50 });
  return page.items.map((item) => item.id);
}

async function applyScan(objectKey: string, status: 'CLEAN' | 'INFECTED', occurredAt: Date = clock) {
  return applyFileScanResult(systemTenantCtx(TENANT_A, JOB), {
    objectKey,
    objectVersionId: `v-${status}`,
    status,
    rawStatus: status === 'CLEAN' ? 'NO_THREATS_FOUND' : 'THREATS_FOUND',
    occurredAt,
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

  it('⑦ 検査の結果（CLEAN）が発言に適用され、発言は公開した時点の位置へ移り、部屋の最終更新もそこまで進む', async () => {
    const applied = await applyScan(objectKey, 'CLEAN');
    expect(applied.target).toBe('APPLIED');
    expect(applied.previousStatus).toBe('SCANNING');
    expect((await admin.message.findUniqueOrThrow({ where: { id: messageId } })).attachmentScanStatus).toBe('CLEAN');
    const thread = await admin.chatThread.findUniqueOrThrow({ where: { id: roomId }, select: { lastMessageAt: true } });
    const moved = (await admin.message.findUniqueOrThrow({ where: { id: messageId } })).sentAt;
    expect(moved.getTime()).toBeGreaterThan(new Date(sentAt).getTime());
    expect(thread.lastMessageAt?.toISOString()).toBe(moved.toISOString());
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

describe('⑧ ⑨ 同じ札の二重送信とストレージの計上', () => {
  it('1 行に収束し、監査も 1 回だけ。カウンタはちょうど大きさだけ増え、二重送信では動かない', async () => {
    const before = await readStorageBytesUsed(host, clock);
    const ticket = await upload(host, roomId, 'image/png', 100);
    // 署名を出しただけでは数えない（アップロードされないことがある）。
    expect(await readStorageBytesUsed(host, clock)).toBe(before);
    const first = await send(host, roomId, ticket.uploadToken);
    expect(await readStorageBytesUsed(host, clock)).toBe(before + 100n);
    expect((await admin.message.findUniqueOrThrow({ where: { id: first.message.id } })).attachmentStorageCountedAt).not.toBeNull();
    const second = await send(host, roomId, ticket.uploadToken);
    expect(second.message.id).toBe(first.message.id);
    expect(await readStorageBytesUsed(host, clock)).toBe(before + 100n);
    expect(await admin.message.count({ where: { id: first.message.id } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD, targetId: first.message.id } })).toBe(1);
  });

  it('🔴 ストレージ上限を超えるなら署名を発行しない（429）', async () => {
    await expect(
      issueChatAttachmentUploadUrl(host, roomId, { contentType: 'application/pdf', byteSize: 10 }, {
        objectStore: store,
        tokens,
        uploadMaxBytes: 20 * 1024 * 1024,
        quotaDefaults: quotaDefaultsWith({ storageLimitBytes: 1n }),
        now,
      }),
    ).rejects.toMatchObject({ httpStatus: 429, name: 'StorageLimitExceededError' });
  });
});

describe('🔴 ⑩ 添付の列は DB で守られる', () => {
  let messageId: string;

  beforeAll(async () => {
    const ticket = await upload(host, roomId, 'application/pdf', 50);
    messageId = (await send(host, roomId, ticket.uploadToken)).message.id;
  });

  it('送った本人でも検査の状態を書き換えられない（CLEAN にして見せる経路が無い）', async () => {
    await expect(
      withTenant(host, async (db) => db.message.updateMany({ where: { id: messageId }, data: { attachmentScanStatus: 'CLEAN' } })),
    ).rejects.toThrow(/検査の状態は検査の関数だけが変えられます/);
    expect((await admin.message.findUniqueOrThrow({ where: { id: messageId } })).attachmentScanStatus).toBe('SCANNING');
  });

  it('キー・種類・大きさは作った後に変えられない', async () => {
    await expect(
      withTenant(host, async (db) => db.message.updateMany({ where: { id: messageId }, data: { attachmentContentType: 'image/png' } })),
    ).rejects.toThrow(/添付のキー・種類・大きさは後から変えられません/);
    await expect(
      withTenant(host, async (db) => db.message.updateMany({ where: { id: messageId }, data: { attachmentByteSize: 1n } })),
    ).rejects.toThrow(/添付のキー・種類・大きさは後から変えられません/);
  });

  it('🔴 ⑪ CLEAN でない添付の発言はアナウンスにできない（送った本人からでも 404）', async () => {
    await expect(
      setChatAnnouncement(host, roomId, messageId, { now, meta: { ipAddress: META.ipAddress } }),
    ).rejects.toMatchObject({ httpStatus: 404 });
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: roomId } })).toBe(0);
  });
});

describe('🔴 ⑬ Codex レビューの 4 点', () => {
  it('① 署名は作るだけの書き込み（if-none-match: *）。同じキーへの 2 回目の PUT は拒まれる', async () => {
    const ticket = await upload(host, roomId, 'application/pdf', 20);
    expect(ticket.requiredHeaders['if-none-match']).toBe('*');
    const mock = store as unknown as { simulatePut(key: string, body: Uint8Array, contentType: string, options?: { createOnly?: boolean }): void };
    expect(() => mock.simulatePut(keyOf(ticket.uploadToken), new Uint8Array(20), 'application/pdf', { createOnly: true })).toThrow(/上書きできません/);
  });

  it('① 置かれた後に実体が変わっていたら送れない（409。行は作らない）', async () => {
    const ticket = await upload(host, roomId, 'application/pdf', 40);
    const key = keyOf(ticket.uploadToken);
    await store.put(key, new Uint8Array(41), 'application/pdf');
    await expect(send(host, roomId, ticket.uploadToken)).rejects.toMatchObject({ httpStatus: 409 });
    const claims = tokens.verify(ticket.uploadToken, clock);
    expect(await admin.message.count({ where: { id: claims?.messageId ?? ABSENT_ID } })).toBe(0);
  });

  it('② 検査中に相手が後ろの発言まで読んでいても、CLEAN になった発言は未読に数えられ、after で拾われる', async () => {
    const ticket = await upload(host, roomId, 'application/pdf', 25);
    const a = (await send(host, roomId, ticket.uploadToken, '遅れて届く資料')).message;
    const b = (await sendText(host, roomId, '後ろの発言')).message;
    // 相手は、自分から見える最後の発言まで読む（前の検査で公開位置へ移った発言が B より後ろにあることがある）。
    const lastSeen = (await listChatMessages(host2, roomId, { limit: 50 })).items.at(-1);
    expect(lastSeen).toBeDefined();
    await markChatRead(host2, roomId, lastSeen?.id ?? b.id);
    expect(await unreadOf(host2, roomId)).toBe(0);
    // 🔴 検査の発生時刻は既読より前（遅れて届いた）。それでも位置は適用した実時刻で決まる。
    expect((await applyScan(keyOf(ticket.uploadToken), 'CLEAN', new Date(a.sentAt))).target).toBe('APPLIED');
    const row = await admin.message.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.sentAt.getTime()).toBeGreaterThan(new Date(b.sentAt).getTime());
    expect((await admin.chatThread.findUniqueOrThrow({ where: { id: roomId } })).lastMessageAt?.toISOString()).toBe(row.sentAt.toISOString());
    expect(await unreadOf(host2, roomId)).toBe(1);
    const after = await listChatMessages(host2, roomId, { limit: 50, after: lastSeen?.id ?? b.id });
    expect(after.items.map((item) => item.id)).toEqual([a.id]);
  });

  it('🔴 ③ 別々の札を同時に送っても、上限に 1 つ分しか余地が無ければ 1 つだけ通り、カウンタはその 1 つ分', async () => {
    const used = await readStorageBytesUsed(host, clock);
    const tight = quotaDefaultsWith({ storageLimitBytes: used + 150n });
    const t1 = await upload(host, roomId, 'application/pdf', 100);
    const t2 = await upload(host, roomId, 'application/pdf', 100);
    const results = await Promise.allSettled([send(host, roomId, t1.uploadToken, '', tight), send(host, roomId, t2.uploadToken, '', tight)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ httpStatus: 429 });
    expect(await readStorageBytesUsed(host, clock)).toBe(used + 100n);
    // 断られた側の実体だけが消えている。
    const heads = await Promise.all([store.head(keyOf(t1.uploadToken)), store.head(keyOf(t2.uploadToken))]);
    expect(heads.filter((head) => head === null)).toHaveLength(1);
  });

  it('🔴 ③ 同じ札を同時に送っても 1 行・1 回分だけ数え、実体は消さない（先に確定した側を後の側が壊さない）', async () => {
    const used = await readStorageBytesUsed(host, clock);
    // 余地はちょうど 1 つ分。2 回目が上限を数え直すと 429 になって実体を消してしまう形にしておく。
    const tight = quotaDefaultsWith({ storageLimitBytes: used + 100n });
    const ticket = await upload(host, roomId, 'application/pdf', 100);
    const results = await Promise.all([send(host, roomId, ticket.uploadToken, '', tight), send(host, roomId, ticket.uploadToken, '', tight)]);
    expect(results[0].message.id).toBe(results[1].message.id);
    expect(await admin.message.count({ where: { id: results[0].message.id } })).toBe(1);
    expect(await readStorageBytesUsed(host, clock)).toBe(used + 100n);
    expect(await store.head(keyOf(ticket.uploadToken))).not.toBeNull();
    // 確定した後にもう一度送っても同じ（上限を数え直さない・実体を消さない）。
    const again = await send(host, roomId, ticket.uploadToken, '', tight);
    expect(again.message.id).toBe(results[0].message.id);
    expect(await store.head(keyOf(ticket.uploadToken))).not.toBeNull();
    expect(await readStorageBytesUsed(host, clock)).toBe(used + 100n);
  });

  it('③ 札を何枚も先に取っても、送信の時点の上限で 429 にし、置かれた実体を消す', async () => {
    const used = await readStorageBytesUsed(host, clock);
    const tight = quotaDefaultsWith({ storageLimitBytes: used + 150n });
    const issue = (size: number) =>
      issueChatAttachmentUploadUrl(host, roomId, { contentType: 'application/pdf', byteSize: size }, {
        objectStore: store,
        tokens,
        uploadMaxBytes: 20 * 1024 * 1024,
        quotaDefaults: tight,
        now,
      });
    const first = await issue(100);
    const second = await issue(100);
    await send(host, roomId, first.uploadToken, '', tight);
    await expect(send(host, roomId, second.uploadToken, '', tight)).rejects.toMatchObject({ httpStatus: 429 });
    expect(await store.head(keyOf(second.uploadToken))).toBeNull();
    expect(await readStorageBytesUsed(host, clock)).toBe(used + 100n);
  });

  it('③ 放置された実体（送らなかったもの）は日次の片付けで消え、送ったものは残る', async () => {
    const abandoned = await upload(host, roomId, 'text/plain', 5);
    const kept = await upload(host, roomId, 'text/plain', 6);
    await send(host, roomId, kept.uploadToken);
    const deletedCount = await cleanupAbandonedChatUploads(systemTenantCtx(TENANT_A, JOB), {
      now: () => new Date(Date.now() + 3 * 60 * 60 * 1000),
      objectStore: store,
    });
    expect(deletedCount).toBeGreaterThanOrEqual(1);
    expect(await store.head(keyOf(abandoned.uploadToken))).toBeNull();
    expect(await store.head(keyOf(kept.uploadToken))).not.toBeNull();
    // 札が生きている間（新しいもの）は消さない。
    const fresh = await upload(host, roomId, 'text/plain', 7);
    await cleanupAbandonedChatUploads(systemTenantCtx(TENANT_A, JOB), { now: () => new Date(), objectStore: store });
    expect(await store.head(keyOf(fresh.uploadToken))).not.toBeNull();
  });

  it('④ 検査中の他人の添付は、一覧の冒頭（DM・グループ）と未読の数に現れない', async () => {
    // 前の検査で公開位置（実時刻）へ移った発言より後ろに送る。
    clock = new Date(Date.now() + 60_000);
    const before = await readChatScreen(host2, {
      threadId: null,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
      tree: { sort: CHAT_THREAD_SORT_DEFAULT, q: null },
    });
    const unreadBefore = await unreadOf(host2, roomId);
    const ticket = await upload(host, roomId, 'application/pdf', 15);
    await send(host, roomId, ticket.uploadToken, '検査中の本文はまだ見せない');
    const after = await readChatScreen(host2, {
      threadId: null,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
      tree: { sort: CHAT_THREAD_SORT_DEFAULT, q: null },
    });
    expect(after.people?.lastSnippets[roomId]).toBe(before.people?.lastSnippets[roomId]);
    expect(JSON.stringify(after)).not.toContain('検査中の本文はまだ見せない');
    expect(await unreadOf(host2, roomId)).toBe(unreadBefore);
    // 送った本人には冒頭に出る。
    const mine = await readChatScreen(host, {
      threadId: null,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
      tree: { sort: CHAT_THREAD_SORT_DEFAULT, q: null },
    });
    expect(mine.people?.lastSnippets[roomId]).toContain('検査中の本文はまだ見せない');
  });
});

describe('⑫ 本人が発言を削除したら添付も消える（決定 A）', () => {
  let messageId: string;
  let objectKey: string;
  const deletedKeys: string[] = [];
  const spyStore = {
    delete: async (key: string) => {
      deletedKeys.push(key);
      await store.delete(key);
    },
  };
  const deleteDeps = () => ({ now, meta: { ipAddress: META.ipAddress }, objectStore: spyStore });

  beforeAll(async () => {
    const ticket = await upload(host, roomId, 'application/pdf', 70);
    objectKey = keyOf(ticket.uploadToken);
    messageId = (await send(host, roomId, ticket.uploadToken, '消す予定')).message.id;
    expect((await applyScan(objectKey, 'CLEAN')).target).toBe('APPLIED');
  });

  it('🔴 他人（同じ部屋のメンバー）は削除できない（404）。何も動かない', async () => {
    const before = await readStorageBytesUsed(host, clock);
    await expect(deleteChatMessage(host2, roomId, messageId, deleteDeps())).rejects.toMatchObject({ httpStatus: 404 });
    expect(deletedKeys).toEqual([]);
    expect(await readStorageBytesUsed(host, clock)).toBe(before);
    expect((await admin.message.findUniqueOrThrow({ where: { id: messageId } })).attachmentKey).toBe(objectKey);
  });

  it('🔴 削除していない発言の添付は、本人でも外せない（DB のトリガ）', async () => {
    await expect(
      withTenant(host, async (db) =>
        db.message.updateMany({
          where: { id: messageId },
          data: { attachmentKey: null, attachmentScanStatus: null, attachmentContentType: null, attachmentByteSize: null, attachmentStorageCountedAt: null },
        }),
      ),
    ).rejects.toThrow(/添付のキー・種類・大きさは後から変えられません/);
  });

  it('削除すると実体を消し、列と計上の印を外し、カウンタをちょうど大きさだけ減らす。監査は「あった」と大きさだけ', async () => {
    const before = await readStorageBytesUsed(host, clock);
    const result = await deleteChatMessage(host, roomId, messageId, deleteDeps());
    expect(result.message.deleted).toBe(true);
    expect(result.message.attachment ?? null).toBeNull();
    expect(deletedKeys).toEqual([objectKey]);
    expect(await readStorageBytesUsed(host, clock)).toBe(before - 70n);
    const row = await admin.message.findUniqueOrThrow({ where: { id: messageId } });
    expect([row.attachmentKey, row.attachmentScanStatus, row.attachmentContentType, row.attachmentByteSize, row.attachmentStorageCountedAt]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'message.delete', targetId: messageId } });
    expect(audit.summary).toEqual({ threadId: roomId, bodyLength: '消す予定'.length, hadAttachment: true, byteSize: 70 });
    expect(JSON.stringify(audit)).not.toContain(objectKey);
  });

  it('削除後は共有 URL も一覧も出ない（404 / 載らない）', async () => {
    const deps = { objectStore: store, ipAddress: META.ipAddress, now };
    await expect(issueChatAttachmentDownloadUrl(host, roomId, messageId, 'inline', deps)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(issueChatAttachmentDownloadUrl(host2, roomId, messageId, 'inline', deps)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await listChatAttachments(host2, roomId, {})).items.map((item) => item.messageId)).not.toContain(messageId);
  });

  it('二重削除は何もしない（404。実体の削除もカウンタも動かない）', async () => {
    const before = await readStorageBytesUsed(host, clock);
    await expect(deleteChatMessage(host, roomId, messageId, deleteDeps())).rejects.toMatchObject({ httpStatus: 404 });
    expect(deletedKeys).toEqual([objectKey]);
    expect(await readStorageBytesUsed(host, clock)).toBe(before);
  });

  it('🔴 削除済みの発言でも、送った本人以外は添付を外せない（DB のトリガ）', async () => {
    const ticket = await upload(host, roomId, 'image/png', 30);
    const other = (await send(host, roomId, ticket.uploadToken)).message.id;
    expect((await applyScan(keyOf(ticket.uploadToken), 'CLEAN')).target).toBe('APPLIED');
    await admin.message.update({ where: { id: other }, data: { deletedAt: clock, body: null } });
    await expect(
      withTenant(host2, async (db) =>
        db.message.updateMany({
          where: { id: other },
          data: { attachmentKey: null, attachmentScanStatus: null, attachmentContentType: null, attachmentByteSize: null, attachmentStorageCountedAt: null },
        }),
      ),
    ).rejects.toThrow(/添付のキー・種類・大きさは後から変えられません|検査の状態は検査の関数だけ/);
    expect((await admin.message.findUniqueOrThrow({ where: { id: other } })).attachmentKey).not.toBeNull();
  });
});

// 🔴 最後に置く（テナント A の業務データを消す）。
describe('⑨ 解約の削除で計上を外す', () => {
  it('計上済みの添付の合計だけ減り、印が外れて列も消える。再実行では動かない', async () => {
    const counted = await admin.message.findMany({
      where: { tenantId: TENANT_A, attachmentStorageCountedAt: { not: null } },
      select: { attachmentByteSize: true },
    });
    const total = counted.reduce((sum, row) => sum + (row.attachmentByteSize ?? 0n), 0n);
    expect(total).toBeGreaterThan(0n);
    const before = await readStorageBytesUsed(host, clock);
    await applyPurgeSpec(systemTenantCtx(TENANT_A, JOB), clock);
    expect(await readStorageBytesUsed(host, clock)).toBe(before - total);
    expect(await admin.message.count({ where: { tenantId: TENANT_A, attachmentStorageCountedAt: { not: null } } })).toBe(0);
    expect(await admin.message.count({ where: { tenantId: TENANT_A, attachmentKey: { not: null } } })).toBe(0);
    await applyPurgeSpec(systemTenantCtx(TENANT_A, JOB), clock);
    expect(await readStorageBytesUsed(host, clock)).toBe(before - total);
  });
});
