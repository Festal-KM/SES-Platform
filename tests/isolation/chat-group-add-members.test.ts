// tests/isolation/chat-group-add-members.test.ts
// ✅ 2026-11-01（紺野の決定）: グループに後から人を足す（`docs/02` F-038 改訂 17 / `docs/05` §3.7.1・#51h /
// migration 20261101100000_chat_group_add_members）。
//
// 🔴 ここで固定すること:
//   ① グループのメンバーが足した人は、選んだ範囲の過去の発言を読める（すべて / 追加した時から / 指定した日から）。
//      範囲の外の発言は、発言・検索・ファイル・アナウンス・リアクション・書き出しのどれからも見えない（RLS）。
//   ② 足した人の未読は 0 から始まる（足した人の既読位置の行は書かない）。ほかのメンバーは変わらない。
//   ③ メンバーでない人は足せない（API 404 / 生 SQL でも 0 行・拒否）。閲覧専用は 403。
//   ④ 部屋の取引先は変わらない: 社内だけのグループに取引先の人は入らない / 取引先とのグループに別の取引先の人は入らない
//      （API 400 と DB のトリガの二重）。DM は変えられない。外す・種類や取引先の書き換えは拒否。上限 50 人。
//   ⑤ 範囲の行は「まだいない人」についてだけ作れる・行だけ作って入れないことはできない・本人しか読めない。
//   ⑥ 同時に足しても両方残る。監査ログは ID だけ（名前・本文なし）。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyFileScanResult,
  systemTenantCtx,
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  TENANT_A,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.79' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const groupsRoute = await import('../../apps/web/app/api/(main)/threads/groups/route');
const membersRoute = await import('../../apps/web/app/api/(main)/threads/[id]/members/route');
const dmRoute = await import('../../apps/web/app/api/(main)/threads/dm/route');
const { CHAT_ROOM_AUDIT_ACTION_MEMBER_ADD } = await import('../../apps/web/lib/chat/rooms');
const { countUnread, effectiveLastReadMessageIds } = await import('../../apps/web/lib/chat/read-state');
const { searchChatMessages } = await import('../../apps/web/lib/chat/search');
const { listChatAttachments } = await import('../../apps/web/lib/chat/attachments');
const { readChatThreadForExport } = await import('../../apps/web/lib/chat/service');
const { readThreadAnnouncements } = await import('../../apps/web/lib/chat/announcement-read');
const { setChatAnnouncement, clearChatAnnouncement } = await import('../../apps/web/lib/chat/announcement');
const { readPeople } = await import('../../apps/web/lib/chat/people');

/** 本テストが足す利用者（ホスト 6 人・取引先 A1 の 2 人目・閲覧専用）。 */
const H2 = '01930000-0000-7000-8000-000000000ad1';
const H3 = '01930000-0000-7000-8000-000000000ad2';
const H4 = '01930000-0000-7000-8000-000000000ad3';
const H5 = '01930000-0000-7000-8000-000000000ad4';
const H6 = '01930000-0000-7000-8000-000000000ad5';
const H7 = '01930000-0000-7000-8000-000000000ad6';
const OUTSIDER = '01930000-0000-7000-8000-000000000ad7';
const VIEWER = '01930000-0000-7000-8000-000000000ad8';
const H8 = '01930000-0000-7000-8000-000000000ada';
const H9 = '01930000-0000-7000-8000-000000000adb';
const H10 = '01930000-0000-7000-8000-000000000adc';
const A1B = '01930000-0000-7000-8000-000000000ad9';
/** 上限の検査用のホスト（48 人）。 */
const BULK = Array.from({ length: 48 }, (_, i) => `01930000-0000-7000-8000-000000000b${String(i).padStart(2, '0')}`);

const WORD = 'まどのしらべZ7';
const OLD_BODY = `古い発言（${WORD}）— 範囲の外に出てはならない`;
const LATE_JAN_BODY = `1 月 31 日 23:59 の発言（${WORD}）`;
const EARLY_FEB_BODY = `2 月 1 日 0:30 の発言（${WORD}）`;
const OLD_SENT = new Date('2026-01-10T03:00:00Z');
const LATE_JAN_SENT = new Date('2026-01-31T14:59:00Z'); // 日本時間 1/31 23:59
const EARLY_FEB_SENT = new Date('2026-01-31T15:30:00Z'); // 日本時間 2/1 0:30
const OLD_MESSAGE = '01930000-0000-7000-8000-000000000ae1';
const OLD_FILE_MESSAGE = '01930000-0000-7000-8000-000000000ae2';
const LATE_JAN_MESSAGE = '01930000-0000-7000-8000-000000000ae3';
const EARLY_FEB_MESSAGE = '01930000-0000-7000-8000-000000000ae4';

let database: IsolationDatabase;
let admin: UnextendedClient;
const ctxs = new Map<string, AuthenticatedTenantCtx>();
let groupId: string;

function ctxOf(userId: string): AuthenticatedTenantCtx {
  const ctx = ctxs.get(userId);
  if (ctx === undefined) throw new Error(`ctx missing: ${userId}`);
  return ctx;
}

async function post(route: { POST: (request: Request) => Promise<Response> }, ctx: AuthenticatedTenantCtx, path: string, body: unknown, params?: Record<string, string>): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const request = new Request(`https://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const handler = route.POST as unknown as (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>;
  return params === undefined ? handler(request) : handler(request, { params: Promise.resolve(params) });
}

async function createGroup(ctx: AuthenticatedTenantCtx, title: string, userIds: readonly string[]): Promise<string> {
  const response = await post(groupsRoute, ctx, '/api/threads/groups', { title, userIds });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function addMembers(ctx: AuthenticatedTenantCtx, threadId: string, body: Record<string, unknown>): Promise<Response> {
  return post(membersRoute, ctx, `/api/threads/${threadId}/members`, body, { id: threadId });
}

async function visibleMessageIds(ctx: AuthenticatedTenantCtx, threadId: string): Promise<readonly string[]> {
  return withTenant(ctx, async (db) =>
    (await db.message.findMany({ where: { threadId }, select: { id: true }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }] })).map((row) => row.id),
  );
}

/**
 * 🔴 アプリの経路を通さず、app_tenant の接続で GUC だけを立てて生 SQL を打つ（RLS とトリガだけで止まることを確かめる）。
 */
async function rawAs<T>(
  who: { readonly partnerCompanyId: string | null; readonly userId: string },
  run: (tx: UnextendedClient) => Promise<T>,
): Promise<T> {
  const client = createUnextendedClient(database.tenantUrl);
  try {
    return await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${TENANT_A}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.partner_company_id', '${who.partnerCompanyId ?? ''}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.actor_user_id', '${who.userId}', true)`);
      return run(tx as unknown as UnextendedClient);
    });
  } finally {
    await client.$disconnect();
  }
}
const AS_HOST = { partnerCompanyId: null, userId: USER_A_HOST } as const;
const AS_OUTSIDER = { partnerCompanyId: null, userId: OUTSIDER } as const;

/** 生 SQL で「範囲の行を作って配列に足す」（アプリと同じ 2 手）。 */
function rawAdd(threadId: string, userId: string): (tx: UnextendedClient) => Promise<unknown> {
  return async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO chat_thread_member_windows (id, tenant_id, thread_id, user_id, added_by_user_id)
       VALUES (gen_random_uuid(), '${TENANT_A}', '${threadId}', '${userId}', app_actor_user_id())`,
    );
    return tx.$executeRawUnsafe(`UPDATE chat_threads SET member_user_ids = array_append(member_user_ids, '${userId}'::uuid) WHERE id = '${threadId}'`);
  };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const hosts = [H2, H3, H4, H5, H6, H7, OUTSIDER, VIEWER, H8, H9, H10, ...BULK];
  await admin.user.createMany({
    data: [
      ...hosts.map((id, index) => ({ id, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: `h${String(index)}@add-members.test`, displayName: `ホスト${String(index)}`, passwordHash: 'x' })),
      { id: A1B, tenantId: TENANT_A, ownerPartnerCompanyId: PARTNER_A1, email: 'a1b@add-members.test', displayName: '取引先A1二人目', passwordHash: 'x' },
    ],
  });
  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  for (const id of [USER_A_HOST, H2, H3, H4, H5, H6, H7, OUTSIDER, H8, H9, H10]) {
    ctxs.set(id, await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: id, role: 'SALES' }, DEVICE));
  }
  ctxs.set(VIEWER, await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: VIEWER, role: 'VIEWER' }, DEVICE));
  ctxs.set(USER_A_PARTNER, await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE));
  ctxs.set(A1B, await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: A1B, role: 'PARTNER_SALES' }, DEVICE));

  // 社内だけのグループ（ホスト + H2）と、その中の過去の発言。
  groupId = await createGroup(ctxOf(USER_A_HOST), '窓の検査', [H2]);
  const common = { tenantId: TENANT_A, threadId: groupId, ownerPartnerCompanyId: null, senderUserId: USER_A_HOST, senderPartnerCompanyId: null };
  await admin.message.createMany({
    data: [
      { ...common, id: OLD_MESSAGE, body: OLD_BODY, sentAt: OLD_SENT },
      {
        ...common,
        id: OLD_FILE_MESSAGE,
        body: `ファイル（${WORD}）`,
        sentAt: new Date(OLD_SENT.getTime() + 1000),
        attachmentKey: `t/${TENANT_A}/chat/${groupId}/${OLD_FILE_MESSAGE}/01930000-0000-7000-8000-000000000ae9.pdf`,
        attachmentScanStatus: 'CLEAN',
        attachmentContentType: 'application/pdf',
        attachmentByteSize: 10n,
      },
      { ...common, id: LATE_JAN_MESSAGE, body: LATE_JAN_BODY, sentAt: LATE_JAN_SENT },
      { ...common, id: EARLY_FEB_MESSAGE, body: EARLY_FEB_BODY, sentAt: EARLY_FEB_SENT },
    ],
  });
  // 古い発言へのアナウンスとリアクション（ホストが付ける）。
  await withTenant(ctxOf(USER_A_HOST), async (db) => {
    await db.chatThreadAnnouncement.create({ data: { tenantId: TENANT_A, threadId: groupId, messageId: OLD_MESSAGE, setByUserId: USER_A_HOST } });
    await db.chatMessageReaction.create({ data: { tenantId: TENANT_A, messageId: OLD_MESSAGE, userId: USER_A_HOST, reaction: 'OK' } });
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { action: { in: [CHAT_ROOM_AUDIT_ACTION_MEMBER_ADD, 'thread.create'] } } });
  await admin?.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin?.user.deleteMany({ where: { tenantId: TENANT_A, email: { endsWith: '@add-members.test' } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 読める範囲', () => {
  it('「これまでの発言をすべて」: 足した人はすべての発言を読め、未読は 0 から始まる', async () => {
    const response = await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H3], history: 'ALL' });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ addedCount: 1, memberCount: 3 });
    expect(await visibleMessageIds(ctxOf(H3), groupId)).toEqual([OLD_MESSAGE, OLD_FILE_MESSAGE, LATE_JAN_MESSAGE, EARLY_FEB_MESSAGE]);
    // ② 未読は 0（入った時刻までを読んだのと同じ）。既読位置の行は書いていない。
    const unread = await withTenant(ctxOf(H3), (db) => countUnread(ctxOf(H3), db, [groupId]));
    expect(unread.get(groupId) ?? 0).toBe(0);
    expect(await admin.chatReadState.count({ where: { threadId: groupId, userId: H3 } })).toBe(0);
    // 「ここから未読」の線は、入った時刻までの最後の発言の後ろ。
    const marker = await withTenant(ctxOf(H3), (db) => effectiveLastReadMessageIds(db, H3, [groupId]));
    expect(marker[groupId]).toBe(EARLY_FEB_MESSAGE);
    // 🔴 ほかのメンバー（H2。まだ何も読んでいない）は変わらない: 4 件とも未読。
    const other = await withTenant(ctxOf(H2), (db) => countUnread(ctxOf(H2), db, [groupId]));
    expect(other.get(groupId)).toBe(4);
  });

  it('🔴「追加した時から」: 過去の発言・検索・ファイル・アナウンス・リアクション・書き出しのどれにも出ない', async () => {
    const response = await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H4], history: 'JOINED' });
    expect(response.status, await response.clone().text()).toBe(200);
    const h4 = ctxOf(H4);
    // 部屋は見える（メンバー）が、発言は 0 件。
    expect(await withTenant(h4, (db) => db.chatThread.count({ where: { id: groupId } }))).toBe(1);
    expect(await visibleMessageIds(h4, groupId)).toEqual([]);
    expect(await searchChatMessages(h4, groupId, WORD)).toEqual([]);
    expect((await listChatAttachments(h4, groupId, {})).items).toEqual([]);
    expect((await withTenant(h4, (db) => readThreadAnnouncements(db, [groupId]))).size).toBe(0);
    expect(await withTenant(h4, (db) => db.chatMessageReaction.count({ where: { messageId: OLD_MESSAGE } }))).toBe(0);
    const exported = await readChatThreadForExport(h4, groupId, { now: () => new Date(), meta: { ipAddress: null } });
    expect(JSON.stringify(exported)).not.toContain(WORD);
    // 🔴 生 SQL でも 0 件（第 1 防御だけで止まる）。
    const raw = await rawAs({ partnerCompanyId: null, userId: H4 }, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM messages WHERE thread_id = '${groupId}'`),
    );
    expect(Number(raw[0]?.n)).toBe(0);
    // 古い発言は保存できない（見えない発言）。
    await expect(
      withTenant(h4, (db) => db.chatSavedMessage.create({ data: { tenantId: TENANT_A, userId: H4, messageId: OLD_MESSAGE } })),
    ).rejects.toThrow();
    // 対照: ほかのメンバー（ホスト）からは今までどおり全部見える。
    expect((await withTenant(ctxOf(USER_A_HOST), (db) => readThreadAnnouncements(db, [groupId]))).size).toBe(1);
    expect((await visibleMessageIds(ctxOf(USER_A_HOST), groupId)).length).toBe(4);
    // 入った後の新しい発言は読め、未読に数える。
    await withTenant(ctxOf(USER_A_HOST), (db) =>
      db.message.create({ data: { tenantId: TENANT_A, threadId: groupId, ownerPartnerCompanyId: null, senderUserId: USER_A_HOST, senderPartnerCompanyId: null, body: '入った後の発言' } }),
    );
    expect((await visibleMessageIds(h4, groupId)).length).toBe(1);
    const unread = await withTenant(h4, (db) => countUnread(h4, db, [groupId]));
    expect(unread.get(groupId)).toBe(1);
  });

  it('🔴「日付を指定」: 日本時間のその日の 0 時より前の発言は読めない', async () => {
    const response = await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H5], history: 'DATE', historyDate: '2026-02-01' });
    expect(response.status, await response.clone().text()).toBe(200);
    const ids = await visibleMessageIds(ctxOf(H5), groupId);
    expect(ids).toContain(EARLY_FEB_MESSAGE);
    expect(ids).not.toContain(LATE_JAN_MESSAGE);
    expect(ids).not.toContain(OLD_MESSAGE);
    const hits = await searchChatMessages(ctxOf(H5), groupId, WORD);
    expect(hits.map((hit) => hit.messageId)).toEqual([EARLY_FEB_MESSAGE]);
    // 未読は入った時刻から（2/1 の発言も入る前のものなので数えない。入った後の 1 件も入る前なので 0）。
    const unread = await withTenant(ctxOf(H5), (db) => countUnread(ctxOf(H5), db, [groupId]));
    expect(unread.get(groupId) ?? 0).toBe(0);
  });

  it('未来の日付・存在しない日付は 400', async () => {
    expect((await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H6], history: 'DATE', historyDate: '2999-01-01' })).status).toBe(400);
    expect((await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H6], history: 'DATE', historyDate: '2026-02-30' })).status).toBe(400);
    expect((await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H6], history: 'DATE' })).status).toBe(400);
  });
});

describe('⑤ 範囲の行', () => {
  it('🔴 本人の行しか読めない（ほかのメンバーには、いつ入りどこから読めるかを見せない）', async () => {
    expect(await withTenant(ctxOf(USER_A_HOST), (db) => db.chatThreadMemberWindow.count({ where: { threadId: groupId } }))).toBe(0);
    expect(await withTenant(ctxOf(H4), (db) => db.chatThreadMemberWindow.count({ where: { threadId: groupId } }))).toBe(1);
  });

  it('🔴 既にいるメンバーの範囲を後から狭められない（行は「まだいない人」についてだけ）', async () => {
    await expect(
      rawAs(AS_HOST, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO chat_thread_member_windows (id, tenant_id, thread_id, user_id, history_from, added_by_user_id)
           VALUES (gen_random_uuid(), '${TENANT_A}', '${groupId}', '${H2}', now(), app_actor_user_id())`,
        ),
      ),
    ).rejects.toThrow();
    expect((await visibleMessageIds(ctxOf(H2), groupId)).length).toBeGreaterThanOrEqual(4);
  });

  it('🔴 行は書き換え・削除できない', async () => {
    const updated = await rawAs({ partnerCompanyId: null, userId: H4 }, (tx) =>
      tx.$executeRawUnsafe(`UPDATE chat_thread_member_windows SET history_from = NULL WHERE thread_id = '${groupId}'`),
    ).catch(() => 'denied');
    expect(updated).toBe('denied');
    const deleted = await rawAs({ partnerCompanyId: null, userId: H4 }, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM chat_thread_member_windows WHERE thread_id = '${groupId}'`),
    ).catch(() => 'denied');
    expect(deleted).toBe('denied');
  });

  it('🔴 行だけ作って部屋に入れない（孤児の行）は確定時に拒否 / 行なしで配列に足すのも拒否', async () => {
    await expect(
      rawAs(AS_HOST, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO chat_thread_member_windows (id, tenant_id, thread_id, user_id, added_by_user_id)
           VALUES (gen_random_uuid(), '${TENANT_A}', '${groupId}', '${H7}', app_actor_user_id())`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      rawAs(AS_HOST, (tx) =>
        tx.$executeRawUnsafe(`UPDATE chat_threads SET member_user_ids = array_append(member_user_ids, '${H7}'::uuid) WHERE id = '${groupId}'`),
      ),
    ).rejects.toThrow();
    expect(await admin.chatThreadMemberWindow.count({ where: { threadId: groupId, userId: H7 } })).toBe(0);
  });

  it('対照: 同じ生 SQL（行を作って配列に足す）は、メンバーが社内の人を足すなら通る（上の拒否は空振りでない）', async () => {
    const room = await createGroup(ctxOf(USER_A_HOST), '対照の部屋', [H2]);
    expect(await rawAs(AS_HOST, rawAdd(room, H7))).toBe(1);
    expect((await admin.chatThread.findUniqueOrThrow({ where: { id: room } })).memberUserIds).toEqual([USER_A_HOST, H2, H7]);
    // 生 SQL で joined_at を過去にしても、DB の時刻で上書きされる。
    await rawAs(AS_HOST, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO chat_thread_member_windows (id, tenant_id, thread_id, user_id, joined_at, history_from, added_by_user_id)
         VALUES (gen_random_uuid(), '${TENANT_A}', '${room}', '${H6}', '2000-01-01', '2999-01-01', app_actor_user_id())`,
      );
      return tx.$executeRawUnsafe(`UPDATE chat_threads SET member_user_ids = array_append(member_user_ids, '${H6}'::uuid) WHERE id = '${room}'`);
    });
    const row = await admin.chatThreadMemberWindow.findFirstOrThrow({ where: { threadId: room, userId: H6 } });
    expect(row.joinedAt.getFullYear()).toBeGreaterThan(2000);
    expect(row.historyFrom!.getTime()).toBe(row.joinedAt.getTime());
  });

  it('入った時刻は DB の時刻。「追加した時から」の範囲の始まりは入った時刻そのもの（アプリの時計を使わない）', async () => {
    // 🔴 アプリの時計（Date.now()）とは比べない（時計がずれると揺れる）。DB の now() と比べる。
    const [{ db_now: dbNow }] = await admin.$queryRawUnsafe<Array<{ db_now: Date }>>('SELECT now() AS db_now');
    const row = await admin.chatThreadMemberWindow.findFirstOrThrow({ where: { threadId: groupId, userId: H4 } });
    expect(row.joinedAt.getTime()).toBeLessThanOrEqual(dbNow!.getTime());
    expect(row.historyFrom?.getTime()).toBe(row.joinedAt.getTime());
  });
});

describe('③ 足せる人', () => {
  it('🔴 メンバーでない人は足せない（API 404・生 SQL は拒否）', async () => {
    expect((await addMembers(ctxOf(OUTSIDER), groupId, { userIds: [H6] })).status).toBe(404);
    await expect(rawAs(AS_OUTSIDER, rawAdd(groupId, H6))).rejects.toThrow();
    const touched = await rawAs(AS_OUTSIDER, (tx) =>
      tx.$executeRawUnsafe(`UPDATE chat_threads SET last_message_at = now() WHERE id = '${groupId}'`),
    );
    expect(touched).toBe(0);
  });

  it('閲覧専用は 403', async () => {
    expect((await addMembers(ctxOf(VIEWER), groupId, { userIds: [H6] })).status).toBe(403);
  });

  it('既にメンバーの人だけなら何もしない（監査も書かない）', async () => {
    const before = await admin.auditLog.count({ where: { action: CHAT_ROOM_AUDIT_ACTION_MEMBER_ADD } });
    const response = await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [H2] });
    expect(await response.json()).toEqual({ addedCount: 0, memberCount: 5 });
    expect(await admin.auditLog.count({ where: { action: CHAT_ROOM_AUDIT_ACTION_MEMBER_ADD } })).toBe(before);
  });
});

describe('④ 部屋の取引先・種類は変わらない', () => {
  it('🔴 社内だけのグループに取引先の人は入らない（API 400・DB のトリガも拒否）', async () => {
    expect((await addMembers(ctxOf(USER_A_HOST), groupId, { userIds: [USER_A_PARTNER] })).status).toBe(400);
    await expect(rawAs(AS_HOST, rawAdd(groupId, USER_A_PARTNER))).rejects.toThrow();
    expect((await visibleMessageIds(ctxOf(USER_A_PARTNER), groupId)).length).toBe(0);
  });

  it('🔴 取引先とのグループには、ホストの人かその取引先の人だけ（別の取引先の人は 400・DB も拒否）', async () => {
    const partnerGroup = await createGroup(ctxOf(USER_A_HOST), '取引先との部屋', [USER_A_PARTNER]);
    expect((await addMembers(ctxOf(USER_A_HOST), partnerGroup, { userIds: [USER_A_PARTNER2] })).status).toBe(400);
    await expect(rawAs(AS_HOST, rawAdd(partnerGroup, USER_A_PARTNER2))).rejects.toThrow();
    // 取引先の人も、ホストの人と同じ取引先の同僚を足せる。
    const byPartner = await addMembers(ctxOf(USER_A_PARTNER), partnerGroup, { userIds: [H6, A1B] });
    expect(byPartner.status, await byPartner.clone().text()).toBe(200);
    // 取引先の人からは、別の取引先の人は見えない（404。存在を探らせない）。
    expect((await addMembers(ctxOf(USER_A_PARTNER), partnerGroup, { userIds: [USER_A_PARTNER2] })).status).toBe(404);
    const row = await admin.chatThread.findUniqueOrThrow({ where: { id: partnerGroup }, select: { partnerCompanyId: true, memberUserIds: true } });
    expect(row.partnerCompanyId).toBe(PARTNER_A1);
    expect(row.memberUserIds).toEqual([USER_A_HOST, USER_A_PARTNER, H6, A1B]);
  });

  it('🔴 DM には足せない（API 400・生 SQL は拒否）', async () => {
    const dm = await post(dmRoute, ctxOf(USER_A_HOST), '/api/threads/dm', { userId: H2 });
    const dmId = ((await dm.json()) as { id: string }).id;
    expect((await addMembers(ctxOf(USER_A_HOST), dmId, { userIds: [H6] })).status).toBe(400);
    await expect(rawAs(AS_HOST, rawAdd(dmId, H6))).rejects.toThrow();
  });

  it('🔴 外す・種類・取引先の書き換えは拒否', async () => {
    await expect(
      rawAs(AS_HOST, (tx) =>
        tx.$executeRawUnsafe(`UPDATE chat_threads SET member_user_ids = ARRAY['${USER_A_HOST}'::uuid, '${H2}'::uuid] WHERE id = '${groupId}'`),
      ),
    ).rejects.toThrow();
    await expect(rawAs(AS_HOST, (tx) => tx.$executeRawUnsafe(`UPDATE chat_threads SET kind = 'COMPANY' WHERE id = '${groupId}'`))).rejects.toThrow();
    await expect(
      rawAs(AS_HOST, (tx) => tx.$executeRawUnsafe(`UPDATE chat_threads SET partner_company_id = '${PARTNER_A1}' WHERE id = '${groupId}'`)),
    ).rejects.toThrow();
    const row = await admin.chatThread.findUniqueOrThrow({ where: { id: groupId }, select: { kind: true, memberUserIds: true } });
    expect(row.kind).toBe('GROUP');
    expect(row.memberUserIds).toHaveLength(5);
  });

  it('🔴 上限 50 人（API 400・DB のトリガも拒否）', async () => {
    const big = await createGroup(ctxOf(USER_A_HOST), '大きな部屋', [...BULK, H2]);
    expect((await admin.chatThread.findUniqueOrThrow({ where: { id: big } })).memberUserIds).toHaveLength(50);
    expect((await addMembers(ctxOf(USER_A_HOST), big, { userIds: [H6] })).status).toBe(400);
    await expect(rawAs(AS_HOST, rawAdd(big, H6))).rejects.toThrow();
  });
});

describe('⑥ 同時に足す・監査ログ', () => {
  it('2 人のメンバーが同時に別の人を足しても、同じ人を足しても、両方残り重複しない', async () => {
    const room = await createGroup(ctxOf(USER_A_HOST), '同時の部屋', [H2]);
    const [a, b] = await Promise.all([
      addMembers(ctxOf(USER_A_HOST), room, { userIds: [H6, H7] }),
      addMembers(ctxOf(H2), room, { userIds: [H7, OUTSIDER] }),
    ]);
    expect([a.status, b.status], `${await a.clone().text()} / ${await b.clone().text()}`).toEqual([200, 200]);
    const row = await admin.chatThread.findUniqueOrThrow({ where: { id: room }, select: { memberUserIds: true } });
    expect([...row.memberUserIds].sort()).toEqual([USER_A_HOST, H2, H6, H7, OUTSIDER].sort());
    expect(await admin.chatThreadMemberWindow.count({ where: { threadId: room } })).toBe(3);
    // 🔴 監査には「その要求が実際に足した人」だけ（同時に同じ人〔H7〕を足しても、H7 が載るのは 1 行だけ）。
    const audits = await admin.auditLog.findMany({ where: { action: CHAT_ROOM_AUDIT_ACTION_MEMBER_ADD, targetId: room } });
    expect(audits).toHaveLength(2);
    expect(audits.filter((row) => JSON.stringify(row.summary).includes(H7))).toHaveLength(1);
    const addedTotal = audits.reduce((sum, row) => sum + Number((row.summary as { addedCount: number }).addedCount), 0);
    expect(addedTotal).toBe(3);
  });

  it('監査ログは誰が誰を足したかの ID だけ（名前・本文なし）', async () => {
    const rows = await admin.auditLog.findMany({ where: { action: CHAT_ROOM_AUDIT_ACTION_MEMBER_ADD, targetId: groupId } });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(rows);
    expect(text).toContain(H4);
    expect(text).not.toContain(WORD);
    expect(text).not.toContain('ホスト');
    expect(text).not.toContain('窓の検査');
  });
});

// ---------------------------------------------------------------------------
// ✅ 2026-11-01（レビュー NG-1〜NG-4 と指摘）: 時計・検査の CLEAN・関数の答え・アナウンスの 409・一覧の時刻
// ---------------------------------------------------------------------------
describe('🔴 NG-1 時計のずれ: 範囲と未読は DB の時計の投稿時刻（posted_at）で決まる', () => {
  it('アプリの時計が進んでいて sent_at が未来でも、入る前に投稿された発言は「追加した時から」の人に見えず、未読にもならない', async () => {
    const room = await createGroup(ctxOf(USER_A_HOST), '時計の部屋', [H2]);
    const ahead = new Date(Date.now() + 60 * 60 * 1000);
    const early = await withTenant(ctxOf(USER_A_HOST), (db) =>
      db.message.create({
        data: { tenantId: TENANT_A, threadId: room, ownerPartnerCompanyId: null, senderUserId: USER_A_HOST, senderPartnerCompanyId: null, body: '時計が進んだ発言', sentAt: ahead },
        select: { id: true },
      }),
    );
    // 投稿時刻は DB が決める（アプリの sent_at ではない）。
    const row = await admin.message.findUniqueOrThrow({ where: { id: early.id } });
    expect(row.postedAt).not.toBeNull();
    expect(row.postedAt!.getTime()).toBeLessThan(ahead.getTime());
    expect((await addMembers(ctxOf(USER_A_HOST), room, { userIds: [H9], history: 'JOINED' })).status).toBe(200);
    expect(await visibleMessageIds(ctxOf(H9), room)).toEqual([]);
    const unread = await withTenant(ctxOf(H9), (db) => countUnread(ctxOf(H9), db, [room]));
    expect(unread.get(room) ?? 0).toBe(0);
    // 入った後の発言は（アプリの時計が遅れていて sent_at が過去でも）読め、未読に数える。
    const behind = new Date(Date.now() - 60 * 60 * 1000);
    await withTenant(ctxOf(USER_A_HOST), (db) =>
      db.message.create({
        data: { tenantId: TENANT_A, threadId: room, ownerPartnerCompanyId: null, senderUserId: USER_A_HOST, senderPartnerCompanyId: null, body: '時計が遅れた発言', sentAt: behind },
      }),
    );
    expect((await visibleMessageIds(ctxOf(H9), room)).length).toBe(1);
    const after = await withTenant(ctxOf(H9), (db) => countUnread(ctxOf(H9), db, [room]));
    expect(after.get(room)).toBe(1);
  });

  it('🔴 投稿時刻は UPDATE で変えられない（生 SQL でも）', async () => {
    const before = await admin.message.findUniqueOrThrow({ where: { id: OLD_MESSAGE } });
    // superuser でも変えられない（トリガは誰の UPDATE にも効く）。
    expect(await admin.$executeRawUnsafe(`UPDATE messages SET posted_at = now() WHERE id = '${OLD_MESSAGE}'`)).toBe(1);
    const after = await admin.message.findUniqueOrThrow({ where: { id: OLD_MESSAGE } });
    expect(after.postedAt?.getTime()).toBe((before.postedAt ?? before.sentAt).getTime());
  });
});

describe('🔴 NG-2 検査の CLEAN で sent_at が進んでも、入る前の添付の発言は範囲の内側へ移らない', () => {
  it('検査中に送られ、「追加した時から」で足した後に CLEAN になった発言は、足した人に見えない（一覧の時刻にも出ない）', async () => {
    const room = await createGroup(ctxOf(USER_A_HOST), '検査の部屋', [H2]);
    const messageId = '01930000-0000-7000-8000-000000000ae5';
    const objectKey = `t/${TENANT_A}/chat/${room}/${messageId}/01930000-0000-7000-8000-000000000ae6.pdf`;
    await admin.message.create({
      data: {
        id: messageId,
        tenantId: TENANT_A,
        threadId: room,
        ownerPartnerCompanyId: null,
        senderUserId: USER_A_HOST,
        senderPartnerCompanyId: null,
        body: `検査中の添付（${WORD}）`,
        sentAt: new Date(Date.now() - 60 * 1000),
        attachmentKey: objectKey,
        attachmentScanStatus: 'SCANNING',
        attachmentContentType: 'application/pdf',
        attachmentByteSize: 10n,
      },
    });
    expect((await addMembers(ctxOf(USER_A_HOST), room, { userIds: [H8], history: 'JOINED' })).status).toBe(200);
    const applied = await applyFileScanResult(systemTenantCtx(TENANT_A, { queue: 'scan.apply-result', jobId: 'job-add-members' }), {
      objectKey,
      objectVersionId: 'v-clean',
      status: 'CLEAN',
      rawStatus: 'NO_THREATS_FOUND',
      occurredAt: new Date(),
      receivedAt: new Date(),
    });
    expect(applied.target).toBe('APPLIED');
    const row = await admin.message.findUniqueOrThrow({ where: { id: messageId } });
    const window = await admin.chatThreadMemberWindow.findFirstOrThrow({ where: { threadId: room, userId: H8 } });
    // 前提: sent_at は入った時刻より後ろへ進んだが、posted_at は動かない。
    expect(row.sentAt.getTime()).toBeGreaterThan(window.joinedAt.getTime());
    expect(row.postedAt!.getTime()).toBeLessThan(window.joinedAt.getTime());
    expect(await visibleMessageIds(ctxOf(H8), room)).toEqual([]);
    expect((await listChatAttachments(ctxOf(H8), room, {})).items).toEqual([]);
    expect(await searchChatMessages(ctxOf(H8), room, WORD)).toEqual([]);
    // 対照: 最初からのメンバーには見える。
    expect(await visibleMessageIds(ctxOf(H2), room)).toEqual([messageId]);
    // 一覧に出す「最後の発言の時刻」は、読める発言が無いので出さない（部屋の最終更新は進んでいる）。
    expect((await admin.chatThread.findUniqueOrThrow({ where: { id: room } })).lastMessageAt).not.toBeNull();
    const people = await withTenant(ctxOf(H8), (db) => readPeople(ctxOf(H8), db));
    expect(people.rooms.find((item) => item.id === room)?.lastMessageAt).toBeNull();
    const own = await withTenant(ctxOf(H2), (db) => readPeople(ctxOf(H2), db));
    expect(own.rooms.find((item) => item.id === room)?.lastMessageAt).not.toBeNull();
  });
});

describe('🔴 NG-3 SECURITY DEFINER の関数は、そのグループのメンバーにだけ、まだいない人についてだけ答える', () => {
  const ask = (who: { partnerCompanyId: string | null; userId: string }, sql: string) =>
    rawAs(who, async (tx) => (await tx.$queryRawUnsafe<Array<{ v: boolean }>>(`SELECT (${sql}) AS v`))[0]?.v);

  it('メンバーでない人には、メンバーかどうか・窓の行があるかを答えない（false）', async () => {
    expect(await ask(AS_OUTSIDER, `app_thread_has_member('${groupId}', '${H2}')`)).toBe(false);
    expect(await ask(AS_OUTSIDER, `app_thread_windows_ready('${groupId}', ARRAY['${H4}'::uuid])`)).toBe(false);
    expect(await ask(AS_OUTSIDER, `app_thread_announcement_outside_window('${groupId}')`)).toBe(false);
    // 対照: メンバーには答える。
    expect(await ask(AS_HOST, `app_thread_has_member('${groupId}', '${H2}')`)).toBe(true);
  });

  it('既にいるメンバーを問うても、後から足された人かどうかは分からない（どちらも同じ答え）', async () => {
    const asH2 = { partnerCompanyId: null, userId: H2 } as const;
    const later = await ask(asH2, `app_thread_windows_ready('${groupId}', ARRAY['${H4}'::uuid])`);
    const original = await ask(asH2, `app_thread_windows_ready('${groupId}', ARRAY['${USER_A_HOST}'::uuid])`);
    expect(later).toBe(original);
    // 対照: まだいない人で、窓の行が無ければ false（関数が空振りしていない）。
    expect(await ask(asH2, `app_thread_windows_ready('${groupId}', ARRAY['${H10}'::uuid])`)).toBe(false);
  });

  it('DM・会社グループでは答えない（false）', async () => {
    const dm = await post(dmRoute, ctxOf(USER_A_HOST), '/api/threads/dm', { userId: H3 });
    const dmId = ((await dm.json()) as { id: string }).id;
    expect(await ask(AS_HOST, `app_thread_has_member('${dmId}', '${H3}')`)).toBe(false);
  });
});

describe('🔴 NG-4 参加前の発言を指すアナウンスは、足された人から変えられない（500 ではなく 409）', () => {
  it('「追加した時から」の人が設定・外すと 409。範囲の内側の発言に置き換わった後は変えられる', async () => {
    const h4 = ctxOf(H4);
    const deps = { now: () => new Date(), meta: { ipAddress: null } };
    const [visible] = await visibleMessageIds(h4, groupId);
    expect(visible).toBeDefined();
    await expect(setChatAnnouncement(h4, groupId, visible!, deps)).rejects.toMatchObject({ httpStatus: 409, code: 'CHAT_ANNOUNCEMENT_OUTSIDE_WINDOW' });
    await expect(clearChatAnnouncement(h4, groupId, OLD_MESSAGE, deps)).rejects.toMatchObject({ httpStatus: 409 });
    // アナウンスは変わっていない。
    expect((await admin.chatThreadAnnouncement.findFirstOrThrow({ where: { threadId: groupId } })).messageId).toBe(OLD_MESSAGE);
    // 対照: 最初からのメンバーは置き換えられ、置き換わった後は足された人も変えられる。
    await setChatAnnouncement(ctxOf(USER_A_HOST), groupId, visible!, deps);
    expect(await withTenant(h4, (db) => readThreadAnnouncements(db, [groupId]))).toHaveProperty('size', 1);
    const cleared = await clearChatAnnouncement(h4, groupId, visible!, deps);
    expect(cleared.announcement).toBeNull();
  });
});
