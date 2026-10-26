// tests/isolation/chat-announcement.test.ts
// ✅ 2026-10-26（チャットレーン・紺野の決定 2026-10-22）: 部屋のアナウンス（`chat_thread_announcements`）の分離。
// `docs/05` §3.7.1 / §6.5 #51n。migration 20261026010000。
//
// 🔴 ここで固定すること:
//   ① 部屋のメンバー（ホスト・その取引先）が設定でき、同じ部屋の人には見える。会話を開く読み出し（readChatScreen）にも載る
//   ② 🔴 別の取引先・別のテナントからは、存在も件数も見えない（API は 404・RLS の行は 0 件）
//   ③ 🔴 別の部屋の発言 ID は指せない（API は 404・RLS の INSERT / UPDATE も拒否）。他人の名前で設定できない
//   ④ 閲覧専用は設定も外すもできない（403）。読むことはできる
//   ⑤ 置き換えても 1 部屋 1 件のまま。外せる。今のアナウンスと違う発言を指した「外す」は何もしない
//   ⑥ 消えた発言はアナウンスにできない。アナウンス中の発言が消えたら本文を出さない
//   ⑦ 🔴 DM: メンバーでない人（同じ会社の管理者を含む）からは見えない・設定できない
//   ⑧ 🔴 部屋から外れたら（参加会社の行に left_at が立ったら）見えない
//   ⑨ 設定・外すのたびに監査ログが 1 行（本文を含まない。部屋 ID と発言 ID だけ）
//   PURGE（解約時の削除）は `tests/isolation/tenant-purge.test.ts`。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  MESSAGE_A_P1,
  MESSAGE_A_P2,
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

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.82' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
/** fixtures の参加会社の行（`THREAD_A_P1` × 取引先 A1）。⑧ で left_at を立てて戻す。 */
const PARTICIPANT_A_P1_PARTNER = '01930000-0000-7000-8000-000000000126';
const ABSENT_ID = '01930000-0000-7000-8000-0000000009ff';
const USER_A_HOST_ADMIN = '01930000-0000-7000-8000-0000000009e1';
const PINNED_BODY = 'アナウンスの本文（監査ログに出てはならない）';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const announcementRoute = await import('../../apps/web/app/api/(main)/threads/[id]/announcement/route');
const messagesRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/route');
const messageRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/[messageId]/route');
const dmRoute = await import('../../apps/web/app/api/(main)/threads/dm/route');
const { readChatScreen } = await import('../../apps/web/lib/chat/read');
const { CHAT_ANNOUNCEMENT_AUDIT_ACTION_SET, CHAT_ANNOUNCEMENT_AUDIT_ACTION_CLEAR } = await import(
  '../../apps/web/lib/chat/announcement'
);
const { CHAT_ANNOUNCEMENT_VIEW_KEYS, CHAT_FORBIDDEN_RESPONSE_KEYS } = await import('../../apps/web/lib/chat/views');

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let hostAdmin: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;
/** ⑤ で THREAD_A_P1 に足す 2 件目の発言（ホストが送る）。 */
let secondMessageId: string;

type AnnouncementBody = { readonly announcement: Record<string, unknown> | null };

async function call(
  ctx: AuthenticatedTenantCtx,
  method: 'GET' | 'PUT' | 'DELETE',
  threadId: string,
  body?: unknown,
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const request = new Request(`https://app.test/api/threads/${threadId}/announcement`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const segment = { params: Promise.resolve({ id: threadId }) };
  if (method === 'GET') return announcementRoute.GET(request, segment);
  return method === 'PUT' ? announcementRoute.PUT(request, segment) : announcementRoute.DELETE(request, segment);
}

async function announced(ctx: AuthenticatedTenantCtx, threadId: string): Promise<string | null> {
  const response = await call(ctx, 'GET', threadId);
  expect(response.status, await response.clone().text()).toBe(200);
  const payload = (await response.json()) as AnnouncementBody;
  return (payload.announcement?.['messageId'] as string | undefined) ?? null;
}

/** RLS 越しに見える行の数（アプリの `where` を通さない）。 */
async function rawCount(ctx: AuthenticatedTenantCtx, threadId?: string): Promise<number> {
  return withTenant(ctx, async (db) => db.chatThreadAnnouncement.count(threadId === undefined ? {} : { where: { threadId } }));
}

async function postMessage(ctx: AuthenticatedTenantCtx, threadId: string, body: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await messagesRoute.POST(
    new Request(`https://app.test/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    }),
    { params: Promise.resolve({ id: threadId }) },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function auditRows() {
  return admin.auditLog.findMany({
    where: { action: { in: [CHAT_ANNOUNCEMENT_AUDIT_ACTION_SET, CHAT_ANNOUNCEMENT_AUDIT_ACTION_CLEAR] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  await admin.user.create({
    data: { id: USER_A_HOST_ADMIN, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'admin@announcement.test', displayName: 'ホスト管理者', passwordHash: 'x' },
  });

  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  hostAdmin = await resolveTenantCtx(
    { ...base, twoFactor: 'VERIFIED', tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST_ADMIN, role: 'ADMIN' },
    DEVICE,
  );
  partnerA1 = await resolveTenantCtx(
    { ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' },
    DEVICE,
  );
  partnerA2 = await resolveTenantCtx(
    { ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' },
    DEVICE,
  );
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({
    where: { action: { in: [CHAT_ANNOUNCEMENT_AUDIT_ACTION_SET, CHAT_ANNOUNCEMENT_AUDIT_ACTION_CLEAR] } },
  });
  await admin?.chatThreadAnnouncement.deleteMany({});
  await admin?.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin?.user.deleteMany({ where: { id: USER_A_HOST_ADMIN } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 部屋のメンバーが設定でき、同じ部屋の人に見える', () => {
  it('取引先 A1 が設定 → ホストにも見え、応答のキー集合は凍結どおり（禁止キーなし）', async () => {
    const response = await call(partnerA1, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = (await response.json()) as AnnouncementBody;
    expect(Object.keys(payload)).toEqual(['announcement']);
    const view = payload.announcement as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([...CHAT_ANNOUNCEMENT_VIEW_KEYS].sort());
    for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) expect(Object.keys(view), forbidden).not.toContain(forbidden);
    expect(view['messageId']).toBe(MESSAGE_A_P1);
    expect(view['snippet']).toBe('partner1 からの本文');
    expect(JSON.stringify(view)).not.toContain(USER_A_PARTNER);
    expect(await announced(host, THREAD_A_P1)).toBe(MESSAGE_A_P1);
    expect(await announced(partnerA1, THREAD_A_P1)).toBe(MESSAGE_A_P1);
  });

  it('会話を開く読み出し（readChatScreen）にも、開いた部屋の分だけ載る', async () => {
    const screen = await readChatScreen(host, {
      threadId: THREAD_A_P1,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
    });
    expect(Object.keys(screen.announcements)).toEqual([THREAD_A_P1]);
    expect(screen.announcements[THREAD_A_P1]?.messageId).toBe(MESSAGE_A_P1);
  });
});

describe('🔴 ② 別の取引先・別のテナントからは存在も件数も見えない', () => {
  it('取引先 A2: 部屋は 404、行は 0 件', async () => {
    expect((await call(partnerA2, 'GET', THREAD_A_P1)).status).toBe(404);
    expect(await rawCount(partnerA2)).toBe(0);
    // 「無い部屋」と同じ応答。
    expect((await call(partnerA2, 'GET', ABSENT_ID)).status).toBe(404);
  });

  it('取引先 A2 は A1 の部屋のアナウンスを設定・外すこともできない（404。行は変わらない）', async () => {
    expect((await call(partnerA2, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(404);
    expect((await call(partnerA2, 'DELETE', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(404);
    const deleted = await withTenant(partnerA2, async (db) => db.chatThreadAnnouncement.deleteMany({}));
    expect(deleted.count).toBe(0);
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: THREAD_A_P1 } })).toBe(1);
  });

  it('他テナント: 404・0 件', async () => {
    expect((await call(tenantB, 'GET', THREAD_A_P1)).status).toBe(404);
    expect((await call(tenantB, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(404);
    expect(await rawCount(tenantB)).toBe(0);
  });
});

describe('🔴 ③ 別の部屋の発言は指せない・他人の名前で設定できない', () => {
  it('API: 自分の部屋に別の部屋の発言 ID を組み合わせると 404（ホストは両方の発言を読めても通らない）', async () => {
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P2 })).status).toBe(404);
    expect((await call(partnerA1, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P2 })).status).toBe(404);
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: ABSENT_ID })).status).toBe(404);
    expect(await announced(host, THREAD_A_P1)).toBe(MESSAGE_A_P1);
  });

  it('RLS: 別の部屋の発言を指す INSERT / UPDATE を拒む', async () => {
    await expect(
      withTenant(host, async (db) =>
        db.chatThreadAnnouncement.create({
          data: { tenantId: TENANT_A, threadId: THREAD_A_P2, messageId: MESSAGE_A_P1, setByUserId: USER_A_HOST },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(host, async (db) =>
        db.chatThreadAnnouncement.updateMany({ where: { threadId: THREAD_A_P1 }, data: { messageId: MESSAGE_A_P2 } }),
      ),
    ).rejects.toThrow();
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: THREAD_A_P2 } })).toBe(0);
  });

  it('RLS: 設定した人を他人にする書き込みを拒む', async () => {
    await expect(
      withTenant(host, async (db) =>
        db.chatThreadAnnouncement.updateMany({ where: { threadId: THREAD_A_P1 }, data: { setByUserId: USER_A_PARTNER2 } }),
      ),
    ).rejects.toThrow();
  });

  it('入力の検査: 発言 ID 以外のキー（分離キーを含む）・UUID でない値は 400', async () => {
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: 'x' })).status).toBe(400);
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1, partnerCompanyId: PARTNER_A2 })).status).toBe(400);
    expect((await call(host, 'PUT', THREAD_A_P1, {})).status).toBe(400);
  });
});

describe('④ 閲覧専用', () => {
  it('設定・外すは 403、読むことはできる', async () => {
    expect((await call(hostViewer, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(403);
    expect((await call(hostViewer, 'DELETE', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(403);
    expect(await announced(hostViewer, THREAD_A_P1)).toBe(MESSAGE_A_P1);
  });
});

describe('⑤ 置き換え・外す', () => {
  beforeAll(async () => {
    secondMessageId = await postMessage(host, THREAD_A_P1, PINNED_BODY);
  });

  it('置き換えても 1 部屋 1 件のまま。同じ発言をもう一度設定しても何も変わらない（冪等）', async () => {
    const before = (await auditRows()).length;
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: secondMessageId })).status).toBe(200);
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: secondMessageId })).status).toBe(200);
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: THREAD_A_P1 } })).toBe(1);
    expect(await announced(partnerA1, THREAD_A_P1)).toBe(secondMessageId);
    // 冪等な 2 回目は監査ログを増やさない。
    expect((await auditRows()).length).toBe(before + 1);
  });

  it('今のアナウンスと違う発言を指した「外す」は何もせず、今のアナウンスを返す', async () => {
    const response = await call(partnerA1, 'DELETE', THREAD_A_P1, { messageId: MESSAGE_A_P1 });
    expect(response.status).toBe(200);
    expect(((await response.json()) as AnnouncementBody).announcement?.['messageId']).toBe(secondMessageId);
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: THREAD_A_P1 } })).toBe(1);
  });

  it('外すと 0 件になり、応答は null', async () => {
    const response = await call(partnerA1, 'DELETE', THREAD_A_P1, { messageId: secondMessageId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ announcement: null });
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: THREAD_A_P1 } })).toBe(0);
    // 外してあるときの「外す」も 200（冪等）。
    expect((await call(partnerA1, 'DELETE', THREAD_A_P1, { messageId: secondMessageId })).status).toBe(200);
  });
});

describe('⑥ 消えた発言', () => {
  it('アナウンス中の発言を送った本人が消すと、本文を出さない。消えた発言は新しくアナウンスにできない', async () => {
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: secondMessageId })).status).toBe(200);
    requireTenantCtxMock.mockResolvedValue(host);
    const removed = await messageRoute.DELETE(new Request(`https://app.test/api/threads/${THREAD_A_P1}/messages/${secondMessageId}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: THREAD_A_P1, messageId: secondMessageId }),
    });
    expect(removed.status).toBe(200);
    const response = await call(partnerA1, 'GET', THREAD_A_P1);
    const view = ((await response.json()) as AnnouncementBody).announcement as Record<string, unknown>;
    expect(view['messageId']).toBe(secondMessageId);
    expect(view['snippet']).toBeNull();
    expect(JSON.stringify(view)).not.toContain(PINNED_BODY);
    // 消えた発言を指し直しても 404（RLS の WITH CHECK も同じ条件）。
    expect((await call(host, 'DELETE', THREAD_A_P1, { messageId: secondMessageId })).status).toBe(200);
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: secondMessageId })).status).toBe(404);
    await expect(
      withTenant(host, async (db) =>
        db.chatThreadAnnouncement.create({
          data: { tenantId: TENANT_A, threadId: THREAD_A_P1, messageId: secondMessageId, setByUserId: USER_A_HOST },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('🔴 ⑦ DM のアナウンスはメンバーにしか見えない', () => {
  let dmId: string;

  beforeAll(async () => {
    requireTenantCtxMock.mockResolvedValue(host);
    const opened = await dmRoute.POST(
      new Request('https://app.test/api/threads/dm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: USER_A_PARTNER }),
      }),
    );
    expect([200, 201]).toContain(opened.status);
    dmId = ((await opened.json()) as { id: string }).id;
    const messageId = await postMessage(partnerA1, dmId, 'DM の大事な連絡');
    expect((await call(partnerA1, 'PUT', dmId, { messageId })).status).toBe(200);
  });

  it('メンバー（ホストの本人・取引先 A1）には見える', async () => {
    expect(await announced(host, dmId)).not.toBeNull();
    expect(await announced(partnerA1, dmId)).not.toBeNull();
  });

  it('🔴 同じ会社の管理者でもメンバーでなければ 404・行は 0 件。取引先 A2 も同じ', async () => {
    expect((await call(hostAdmin, 'GET', dmId)).status).toBe(404);
    expect(await rawCount(hostAdmin, dmId)).toBe(0);
    expect((await call(hostAdmin, 'DELETE', dmId, { messageId: ABSENT_ID })).status).toBe(404);
    expect((await call(partnerA2, 'GET', dmId)).status).toBe(404);
    expect(await rawCount(partnerA2, dmId)).toBe(0);
    expect(await admin.chatThreadAnnouncement.count({ where: { threadId: dmId } })).toBe(1);
  });
});

describe('🔴 ⑧ 部屋から外れたら見えない', () => {
  it('取引先 A1 の参加会社の行に left_at が立つと 404・0 件。戻ればまた見える', async () => {
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(200);
    await admin.threadParticipant.update({ where: { id: PARTICIPANT_A_P1_PARTNER }, data: { leftAt: new Date() } });
    try {
      expect((await call(partnerA1, 'GET', THREAD_A_P1)).status).toBe(404);
      expect(await rawCount(partnerA1, THREAD_A_P1)).toBe(0);
      expect((await call(partnerA1, 'DELETE', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(404);
    } finally {
      await admin.threadParticipant.update({ where: { id: PARTICIPANT_A_P1_PARTNER }, data: { leftAt: null } });
    }
    expect(await announced(partnerA1, THREAD_A_P1)).toBe(MESSAGE_A_P1);
  });
});

describe('🔴 ⑨ 監査ログ', () => {
  it('設定・外すのたびに 1 行。部屋 ID と発言 ID だけで、本文を含まない', async () => {
    const rows = await auditRows();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.targetType).toBe('ChatThread');
      expect(JSON.stringify(row)).not.toContain(PINNED_BODY);
      expect(JSON.stringify(row)).not.toContain('partner1 からの本文');
      const keys = Object.keys(row.summary as Record<string, unknown>).sort();
      expect(['messageId', 'replacedMessageId']).toEqual(expect.arrayContaining(keys));
    }
    const replaced = rows.find(
      (row) => row.action === CHAT_ANNOUNCEMENT_AUDIT_ACTION_SET && (row.summary as Record<string, unknown>)['replacedMessageId'] !== undefined,
    );
    expect(replaced?.targetId).toBe(THREAD_A_P1);
    expect(rows.some((row) => row.action === CHAT_ANNOUNCEMENT_AUDIT_ACTION_CLEAR)).toBe(true);
  });

  it('失敗した書き込み（403 / 404 / 400）では増えない', async () => {
    const before = (await auditRows()).length;
    expect((await call(hostViewer, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(403);
    expect((await call(partnerA2, 'PUT', THREAD_A_P1, { messageId: MESSAGE_A_P1 })).status).toBe(404);
    expect((await call(host, 'PUT', THREAD_A_P1, { messageId: 'x' })).status).toBe(400);
    expect((await auditRows()).length).toBe(before);
  });
});
