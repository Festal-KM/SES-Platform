// tests/isolation/chat-mentions.test.ts
// ✅ 2026-10-27（チャットレーン・紺野の決定「軽い版・DB を変えない」）: 一覧の「@」の印（自分宛てのメンションが未読にある）の分離。
// `docs/02` `F-038` 改訂 13 ⑭ / AC-16 / `docs/05` §3.7.1「引用して返信・自分宛ての @ の印」。
//
// 🔴 ここで固定すること:
//   ① 印は、読み手が読める部屋の、自分以外の・消えていない・既読位置より後ろの発言に `@<自分の表示名>` があるときだけ付く
//   ② 🔴 別の取引先・他テナント・メンバーでない人の部屋で「@名前」と書かれても、読み手の印は 1 つも付かない
//      （一覧に出ない部屋の ID を直接渡しても、RLS が発言を返さないので付かない）
//   ③ 🔴 検査中（CLEAN でない）の他人の添付の発言は、CLEAN になるまで印にしない
//   ④ 応答は「ある / ない」だけ（一覧の部屋の ID の部分集合。件数・発言の ID を含まない）
//   ⑤ ミュートしても印は付く・自分の発言・消した発言・大文字小文字違い・引用の写しの @ では付かない
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyFileScanResult,
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  systemTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createObjectStore, type ObjectStore } from '@ses/connectors';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  PARTNER_A2,
  TENANT_A,
  TENANT_B,
  THREAD_A_P1,
  THREAD_A_P2,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { quotaDefaultsWith } from './support/quota-defaults.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.92' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const USER_A_HOST2 = '01930000-0000-7000-8000-0000000009e1';
/** 自社の管理者（グループのメンバーではない）。 */
const USER_A_HOST3 = '01930000-0000-7000-8000-0000000009e2';
const USER_B_HOST2 = '01930000-0000-7000-8000-0000000009e3';
const HOST2_NAME = '社内 二郎';
const HOST3_NAME = '管理 三郎';
const SECRET = Buffer.alloc(32, 5).toString('base64');
const JOB = { queue: 'scan.apply-result', jobId: 'job-chat-mentions' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const groupsRoute = await import('../../apps/web/app/api/(main)/threads/groups/route');
const { readChatScreen } = await import('../../apps/web/lib/chat/read');
const { deleteChatMessage, sendChatMessage } = await import('../../apps/web/lib/chat/service');
const { markChatRead, readMentionUnreadThreadIds, setChatThreadPrefs } = await import('../../apps/web/lib/chat/read-state');
const { issueChatAttachmentUploadUrl } = await import('../../apps/web/lib/chat/attachments');
const { createChatAttachmentTokenCodec } = await import('../../apps/web/lib/chat/attachment-token');
const { CHAT_THREAD_SORT_DEFAULT } = await import('../../apps/web/lib/chat/thread-tree');
const { buildQuotedBody } = await import('../../apps/web/lib/chat/quote');
const QUOTA = quotaDefaultsWith({ storageLimitBytes: 10n * 1024n * 1024n * 1024n });

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let host2: AuthenticatedTenantCtx;
let host3: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;
let tenantB2: AuthenticatedTenantCtx;
let groupA: string;
let groupB: string;
let store: ObjectStore;
const tokens = createChatAttachmentTokenCodec(SECRET);
// 🔴 実時刻で送る（シードの発言は DB の now() で入っており、CLEAN の適用も DB の実時刻で位置を決めるため。
//    過去の時刻で送ると、既読位置より前に並んで「未読」にならない）。
const now = () => new Date();

async function say(ctx: AuthenticatedTenantCtx, threadId: string, body: string) {
  return (await sendChatMessage(ctx, threadId, { body }, { now, meta: { ipAddress: META.ipAddress } })).message;
}

async function screen(ctx: AuthenticatedTenantCtx) {
  return readChatScreen(ctx, {
    threadId: null,
    threadsQuery: { limit: 50 },
    messagesQuery: { limit: 50 },
    tree: { sort: CHAT_THREAD_SORT_DEFAULT, q: null },
  });
}

async function mentioned(ctx: AuthenticatedTenantCtx): Promise<readonly string[]> {
  return (await screen(ctx)).mentionUnreadIds;
}

/** 一覧を通さずに部屋の ID を直接渡す（🔴 一覧に出ない部屋でも RLS が止めることを見る）。 */
async function mentionedDirect(ctx: AuthenticatedTenantCtx, threadIds: readonly string[], name: string): Promise<readonly string[]> {
  return withTenant(ctx, async (db) => [...(await readMentionUnreadThreadIds(ctx, db, threadIds, name))]);
}

/** 部屋の最新の発言まで読んだことにする（読み手が読める最後の発言）。 */
async function readAll(ctx: AuthenticatedTenantCtx, threadId: string): Promise<void> {
  const latest = await withTenant(ctx, async (db) =>
    db.message.findFirst({ where: { threadId }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], select: { id: true } }),
  );
  if (latest !== null) await markChatRead(ctx, threadId, latest.id);
}

async function createGroup(ctx: AuthenticatedTenantCtx, title: string, userIds: readonly string[]): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const created = await groupsRoute.POST(
    new Request('https://app.test/api/threads/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, userIds }),
    }),
  );
  expect([200, 201], await created.clone().text()).toContain(created.status);
  return ((await created.json()) as { id: string }).id;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  store = createObjectStore('mock');
  await admin.user.createMany({
    data: [
      { id: USER_A_HOST2, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host2@mention.test', displayName: HOST2_NAME, passwordHash: 'x' },
      { id: USER_A_HOST3, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host3@mention.test', displayName: HOST3_NAME, passwordHash: 'x' },
      { id: USER_B_HOST2, tenantId: TENANT_B, ownerPartnerCompanyId: null, email: 'host-b2@mention.test', displayName: 'Host B2', passwordHash: 'x' },
    ],
  });
  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  host2 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST2, role: 'SALES' }, DEVICE);
  host3 = await resolveTenantCtx({ ...base, twoFactor: 'VERIFIED', tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST3, role: 'ADMIN' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
  tenantB2 = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST2, role: 'SALES' }, DEVICE);
  // 社内だけのグループ（Host A + 社内 二郎。管理 三郎はメンバーではない）と、他テナントのグループ。
  groupA = await createGroup(host, '面談の段取り', [USER_A_HOST2]);
  groupB = await createGroup(tenantB, '他社の相談', [USER_B_HOST2]);
  // 始める前に、全員が全部の部屋を読み終えた状態にする（既存の発言で印が付かないように）。
  for (const [ctx, ids] of [
    [host, [THREAD_A_P1, THREAD_A_P2, groupA]],
    [host2, [groupA]],
    [partnerA1, [THREAD_A_P1]],
    [partnerA2, [THREAD_A_P2]],
    [tenantB, [groupB]],
  ] as const) {
    for (const id of ids) await readAll(ctx, id);
  }
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { action: { startsWith: 'chat_attachment.' } } });
  await admin?.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin?.fileScanResult.deleteMany({ where: { objectVersionId: 'v-mention-CLEAN' } });
  await admin?.chatReadState.deleteMany({});
  await admin?.user.deleteMany({ where: { id: { in: [USER_A_HOST2, USER_A_HOST3, USER_B_HOST2] } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 読める部屋の未読に自分宛ての @ があるときだけ', () => {
  it('取引先が会社グループで「@Host A」→ ホストの一覧に印。読んだら消える', async () => {
    expect(await mentioned(host)).not.toContain(THREAD_A_P1);
    await say(partnerA1, THREAD_A_P1, '@Host A 来週の面談の件、確認をお願いします');
    expect(await mentioned(host)).toContain(THREAD_A_P1);
    await readAll(host, THREAD_A_P1);
    expect(await mentioned(host)).not.toContain(THREAD_A_P1);
  });

  it('社内のグループでも同じ（メンバーの発言）', async () => {
    await say(host2, groupA, `@Host A 段取りを見てください`);
    expect(await mentioned(host)).toContain(groupA);
    await readAll(host, groupA);
    expect(await mentioned(host)).not.toContain(groupA);
  });
});

describe('② 🔴 ほかの境界の「@名前」で印は付かない', () => {
  it('別の取引先（A2）が自分の部屋で「@Partner A1」と書いても、A1 の印は付かない（ID を直接渡しても）', async () => {
    await say(partnerA2, THREAD_A_P2, '@Partner A1 こちらの件');
    expect(await mentioned(partnerA1)).toEqual([]);
    expect(await mentionedDirect(partnerA1, [THREAD_A_P2], 'Partner A1')).toEqual([]);
    // 対照: 読める人（ホスト）には同じ方法で見える（検査が空振りしていない）。
    expect(await mentionedDirect(host, [THREAD_A_P2], 'Partner A1')).toEqual([THREAD_A_P2]);
  });

  it('他テナントの部屋で「@Host A」と書かれても、Host A の印は付かない', async () => {
    await say(tenantB2, groupB, '@Host A 同じ名前の人へ');
    expect(await mentioned(host)).not.toContain(groupB);
    expect(await mentionedDirect(host, [groupB], 'Host A')).toEqual([]);
    // 対照: そのテナントの読める人には同じ方法で見える。
    expect(await mentionedDirect(tenantB, [groupB], 'Host A')).toEqual([groupB]);
  });

  it('🔴 メンバーでない人（同じ会社の管理者）は、そのグループで自分の名前を書かれても印が付かない', async () => {
    await say(host2, groupA, `@${HOST3_NAME} にも共有したい`);
    expect(await mentioned(host3)).toEqual([]);
    expect(await mentionedDirect(host3, [groupA], HOST3_NAME)).toEqual([]);
  });
});

describe('③ 🔴 検査中の添付の発言は CLEAN まで印にしない', () => {
  it('他人が添付つきで「@Host A」→ 検査中は付かず、CLEAN で付く', async () => {
    await readAll(host, groupA);
    const ticket = await issueChatAttachmentUploadUrl(
      host2,
      groupA,
      { contentType: 'application/pdf', byteSize: 321 },
      { objectStore: store, tokens, uploadMaxBytes: 20 * 1024 * 1024, quotaDefaults: QUOTA, now },
    );
    await sendChatMessage(
      host2,
      groupA,
      { body: '@Host A 資料を添えます', attachmentUploadToken: ticket.uploadToken },
      { now, meta: { ipAddress: META.ipAddress }, attachments: { objectStore: store, tokens, quotaDefaults: QUOTA } },
    );
    expect(await mentioned(host)).not.toContain(groupA);
    const claims = tokens.verify(ticket.uploadToken, new Date());
    if (claims === null) throw new Error('札が確かめられない');
    await applyFileScanResult(systemTenantCtx(TENANT_A, JOB), {
      objectKey: claims.objectKey,
      objectVersionId: 'v-mention-CLEAN',
      status: 'CLEAN',
      rawStatus: 'NO_THREATS_FOUND',
      occurredAt: new Date(),
      receivedAt: new Date(),
    });
    expect(await mentioned(host)).toContain(groupA);
    await readAll(host, groupA);
  });
});

describe('④ 応答は「ある / ない」だけ', () => {
  it('一覧の部屋の ID の部分集合で、件数・発言の ID を含まない', async () => {
    const sent = await say(partnerA1, THREAD_A_P1, '@Host A もう一件');
    const data = await screen(host);
    const listed = new Set([
      ...(data.tree?.groups ?? []).flatMap((group) => [...(group.chat === null ? [] : [group.chat.id]), ...group.threads.map((item) => item.id)]),
      ...(data.people?.rooms ?? []).map((room) => room.id),
    ]);
    expect(data.mentionUnreadIds).toEqual([THREAD_A_P1]);
    for (const id of data.mentionUnreadIds) expect(listed.has(id)).toBe(true);
    expect(data.mentionUnreadIds.every((id) => typeof id === 'string')).toBe(true);
    expect(JSON.stringify(data.mentionUnreadIds)).not.toContain(sent.id);
    await readAll(host, THREAD_A_P1);
  });
});

describe('⑤ 付く・付かないの細部', () => {
  it('ミュートしても印は付く', async () => {
    await setChatThreadPrefs(host, THREAD_A_P1, { muted: true });
    await say(partnerA1, THREAD_A_P1, '@Host A ミュート中でも');
    expect(await mentioned(host)).toContain(THREAD_A_P1);
    await setChatThreadPrefs(host, THREAD_A_P1, { muted: false });
    await readAll(host, THREAD_A_P1);
  });

  it('自分の発言・大文字小文字の違い・引用の写しの @ では付かない', async () => {
    await say(host, groupA, '@Host A 自分で書いた');
    await say(host2, groupA, '@host a 小文字');
    await say(host2, groupA, buildQuotedBody({ messageId: THREAD_A_P1, name: 'X', snippet: '@Host A 引用の写し' }, '補足です'));
    expect(await mentioned(host)).not.toContain(groupA);
    await readAll(host, groupA);
  });

  it('消した発言では付かない', async () => {
    const sent = await say(host2, groupA, '@Host A 消します');
    expect(await mentioned(host)).toContain(groupA);
    await deleteChatMessage(host2, groupA, sent.id, { now, meta: { ipAddress: null } });
    expect(await mentioned(host)).not.toContain(groupA);
  });
});
