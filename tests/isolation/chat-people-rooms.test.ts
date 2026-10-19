// tests/isolation/chat-people-rooms.test.ts
// ✅ 2026-10-16（#128 で紺野・宮田が合意）: 人単位の部屋（DM・グループ）の分離。
// `CLAUDE.md` §3.1 経路 3 / `docs/02` F-038 改訂 8（AC-7 / AC-8）/ `docs/05` §3.7.1・C10 MEMBER。
//
// 🔴 ここで固定すること:
//   ① 同じ会社の**メンバーでない人（管理者を含む）**は、DM・グループの存在・発言・参加会社を読めない
//   ② 取引先 A の人を、取引先 B との部屋のメンバーにできない（API でも DB の直接 INSERT でも）
//   ③ 取引先の人どうしだけの部屋は作れない
//   ④ 取引先からは、社内だけの部屋（取引先を持たない）が見えない
//   ⑤ 同じ 2 人の DM は 1 つだけ（2 回開いても同じ部屋）
//   ⑥ 取引先の人からも、自社（ホスト）の人との DM を開ける（作った直後の部屋が本人に見える）
//   ⑦ 監査ログに本文・名前が載らない（誰と誰かの ID だけ）
//   ⑧ ✅ 2026-10-19: DM の既読表示 —— 相手の既読位置（`app_dm_peer_read`）は DM のメンバーにだけ返り、
//      非メンバー・別テナント・グループ・会社グループ・案件スレッド・GUC 未設定には NULL。関数の EXECUTE は app_tenant だけ
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  readDmPeerReadMessageIds,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  MESSAGE_A_P1,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PUBLISHED,
  TENANT_A,
  TENANT_B,
  THREAD_A_P1,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.78' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const dmRoute = await import('../../apps/web/app/api/(main)/threads/dm/route');
const groupsRoute = await import('../../apps/web/app/api/(main)/threads/groups/route');
const { CHAT_ROOM_AUDIT_ACTION_CREATE } = await import('../../apps/web/lib/chat/rooms');

/** 本テストが足す利用者（ホストの 2 人目・3 人目と、取引先 A1 の 2 人目）。 */
const USER_A_HOST2 = '01930000-0000-7000-8000-0000000009d1';
const USER_A_HOST_ADMIN = '01930000-0000-7000-8000-0000000009d2';
const USER_A_PARTNER_B = '01930000-0000-7000-8000-0000000009d3';
const BODY_DM = 'DM の本文（メンバー以外に出てはならない）';

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let host2: AuthenticatedTenantCtx;
let hostAdmin: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA1b: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;

async function post(route: { POST: (request: Request) => Promise<Response> }, ctx: AuthenticatedTenantCtx, path: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return route.POST(
    new Request(`https://app.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function openDm(ctx: AuthenticatedTenantCtx, userId: string): Promise<Response> {
  return post(dmRoute, ctx, '/api/threads/dm', { userId });
}

async function idOf(response: Response, status: number): Promise<string> {
  expect(response.status, await response.clone().text()).toBe(status);
  return ((await response.json()) as { id: string }).id;
}

/** その文脈から見える部屋・発言・参加会社の件数（RLS の結果そのもの）。 */
async function visibleCounts(ctx: AuthenticatedTenantCtx, threadId: string) {
  return withTenant(ctx, async (db) => ({
    threads: await db.chatThread.count({ where: { id: threadId } }),
    messages: await db.message.count({ where: { threadId } }),
    participants: await db.threadParticipant.count({ where: { threadId } }),
  }));
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const extra = [
    { id: USER_A_HOST2, ownerPartnerCompanyId: null, email: 'host2@people-rooms.test', displayName: 'ホスト二人目' },
    { id: USER_A_HOST_ADMIN, ownerPartnerCompanyId: null, email: 'admin@people-rooms.test', displayName: 'ホスト管理者' },
    { id: USER_A_PARTNER_B, ownerPartnerCompanyId: PARTNER_A1, email: 'p1b@people-rooms.test', displayName: '取引先A1二人目' },
  ];
  for (const user of extra) {
    await admin.user.create({ data: { ...user, tenantId: TENANT_A, passwordHash: 'x' } });
  }

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  host2 = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST2, role: 'SALES' }, DEVICE);
  hostAdmin = await resolveTenantCtx({ ...base, twoFactor: 'VERIFIED', partnerCompanyId: null, userId: USER_A_HOST_ADMIN, role: 'ADMIN' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA1b = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER_B, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin.auditLog.deleteMany({ where: { action: CHAT_ROOM_AUDIT_ACTION_CREATE } });
  await admin.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin.user.deleteMany({ where: { id: { in: [USER_A_HOST2, USER_A_HOST_ADMIN, USER_A_PARTNER_B] } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 ① メンバーでない人（管理者を含む）は DM の存在・発言・参加会社を読めない', () => {
  it('ホスト ↔ 取引先 A1 の DM に発言があっても、同じ会社の別の人・管理者・別の取引先には 0 件', async () => {
    const threadId = await idOf(await openDm(host, USER_A_PARTNER), 201);
    await withTenant(host, async (db) => {
      await db.message.create({
        data: { tenantId: TENANT_A, threadId, ownerPartnerCompanyId: PARTNER_A1, senderUserId: USER_A_HOST, senderPartnerCompanyId: null, body: BODY_DM },
      });
    });

    // メンバー（ホストの本人・取引先 A1 の本人）は読める。
    expect(await visibleCounts(host, threadId)).toEqual({ threads: 1, messages: 1, participants: 2 });
    expect((await visibleCounts(partnerA1, threadId)).threads).toBe(1);
    expect((await visibleCounts(partnerA1, threadId)).messages).toBe(1);

    // 🔴 メンバーでない人は、存在・発言・参加会社のいずれも 0。
    for (const [label, ctx] of [
      ['ホストの別の営業', host2],
      ['ホストの管理者', hostAdmin],
      ['同じ取引先 A1 の別の人', partnerA1b],
      ['別の取引先 A2', partnerA2],
    ] as const) {
      expect(await visibleCounts(ctx, threadId), label).toEqual({ threads: 0, messages: 0, participants: 0 });
    }
  });
});

describe('🔴 ② 別の取引先の人を部屋に入れられない', () => {
  it('取引先 A1 の人が、取引先 A2 の人と DM を開こうとすると 404（存在を探らせない）', async () => {
    const response = await openDm(partnerA1, USER_A_PARTNER2);
    expect(response.status).toBe(404);
  });

  it('ホストが A1 と A2 の人を同じグループに入れようとすると 400', async () => {
    const response = await post(groupsRoute, host, '/api/threads/groups', { title: '混在', userIds: [USER_A_PARTNER, USER_A_PARTNER2] });
    expect(response.status).toBe(400);
  });

  it('🔴 DB に直接 INSERT しても、メンバーの所属が部屋の取引先と違えばトリガが拒否する', async () => {
    await expect(
      withTenant(host, async (db) =>
        db.chatThread.create({
          data: {
            tenantId: TENANT_A,
            kind: 'GROUP',
            partnerCompanyId: PARTNER_A1,
            memberUserIds: [USER_A_HOST, USER_A_PARTNER2],
            title: '不正',
            createdByUserId: USER_A_HOST,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('🔴 ③ 取引先の人どうしだけの部屋は作れない', () => {
  it('同じ取引先 A1 の 2 人の DM は 400', async () => {
    const response = await openDm(partnerA1, USER_A_PARTNER_B);
    expect(response.status).toBe(400);
  });
});

describe('🔴 ④ 取引先からは社内だけの部屋が見えない', () => {
  it('ホストどうしの DM は取引先を持たず、取引先の文脈からは 0 件', async () => {
    const threadId = await idOf(await openDm(host, USER_A_HOST2), 201);
    const row = await admin.chatThread.findUnique({ where: { id: threadId }, select: { partnerCompanyId: true, kind: true } });
    expect(row).toEqual({ partnerCompanyId: null, kind: 'DM' });
    expect((await visibleCounts(host2, threadId)).threads).toBe(1);
    expect((await visibleCounts(partnerA1, threadId)).threads).toBe(0);
    expect((await visibleCounts(hostAdmin, threadId)).threads).toBe(0);
  });
});

describe('⑤ 同じ 2 人の DM は 1 つだけ', () => {
  it('同じ相手との DM を 2 回開くと、2 回目は同じ部屋（200）', async () => {
    const first = await idOf(await openDm(host2, USER_A_HOST_ADMIN), 201);
    const second = await idOf(await openDm(hostAdmin, USER_A_HOST2), 200);
    expect(second).toBe(first);
  });
});

describe('⑥ 取引先の人からも、ホストの人との DM を開ける', () => {
  it('取引先 A1 の 2 人目がホストの 2 人目と DM を開き、作った直後から本人に見える', async () => {
    const threadId = await idOf(await openDm(partnerA1b, USER_A_HOST2), 201);
    expect((await visibleCounts(partnerA1b, threadId)).threads).toBe(1);
    expect((await visibleCounts(host2, threadId)).threads).toBe(1);
    const row = await admin.chatThread.findUnique({ where: { id: threadId }, select: { partnerCompanyId: true } });
    expect(row?.partnerCompanyId).toBe(PARTNER_A1);
  });
});

describe('⑦ 監査ログには誰と誰かだけ', () => {
  it('thread.create の summary に本文・名前が無い', async () => {
    const rows = await admin.$queryRawUnsafe<Array<{ summary: unknown }>>(
      `SELECT summary FROM audit_logs WHERE action = '${CHAT_ROOM_AUDIT_ACTION_CREATE}'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(BODY_DM);
    expect(text).not.toContain('ホスト二人目');
    expect(text).not.toContain('取引先A1二人目');
  });
});

// ---------------------------------------------------------------------------
// ✅ 2026-10-16（#129 レビューの指摘 4）: 書き込み・生 SQL・GROUP・参加会社の行・部屋の形の凍結
// ---------------------------------------------------------------------------

/**
 * 🔴 アプリの経路（Prisma 拡張）を通さず、app_tenant の接続で GUC だけを立てて生 SQL を打つ。
 *    RLS（第 1 防御）だけで止まることを確かめるため。
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

const AS_HOST2 = { partnerCompanyId: null, userId: USER_A_HOST2 } as const;
const AS_HOST_ADMIN = { partnerCompanyId: null, userId: USER_A_HOST_ADMIN } as const;
const AS_A1 = { partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER } as const;
const AS_A1B = { partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER_B } as const;
const AS_A2 = { partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2 } as const;

/** ホスト ↔ 取引先 A1 の DM（①で作ったもの）。 */
async function hostA1Dm(): Promise<string> {
  return idOf(await openDm(host, USER_A_PARTNER), 200);
}

describe('🔴 (a)(b) 非メンバーは DM に書けず、生 SQL でも読めない', () => {
  it('非メンバーの発言の INSERT は拒否され、UPDATE / DELETE は 0 行', async () => {
    const threadId = await hostA1Dm();
    for (const [label, who] of [
      ['ホストの別の営業', AS_HOST2],
      ['ホストの管理者', AS_HOST_ADMIN],
      ['同じ取引先 A1 の別の人', AS_A1B],
      ['別の取引先 A2', AS_A2],
    ] as const) {
      await expect(
        rawAs(who, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO messages (id, tenant_id, owner_partner_company_id, thread_id, sender_user_id, sender_partner_company_id, body)
             VALUES (gen_random_uuid(), '${TENANT_A}', ${who.partnerCompanyId === null ? `'${PARTNER_A1}'` : `'${who.partnerCompanyId}'`}, '${threadId}', '${who.userId}', ${who.partnerCompanyId === null ? 'NULL' : `'${who.partnerCompanyId}'`}, 'x')`,
          ),
        ),
        label,
      ).rejects.toThrow();
      const updated = await rawAs(who, (tx) => tx.$executeRawUnsafe(`UPDATE messages SET body = 'x' WHERE thread_id = '${threadId}'`));
      const deleted = await rawAs(who, (tx) => tx.$executeRawUnsafe(`DELETE FROM messages WHERE thread_id = '${threadId}'`));
      expect([updated, deleted], label).toEqual([0, 0]);
      const read = await rawAs(who, (tx) =>
        tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM messages WHERE thread_id = '${threadId}'`),
      );
      expect(Number(read[0]?.n), label).toBe(0);
      const rooms = await rawAs(who, (tx) =>
        tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM chat_threads WHERE id = '${threadId}'`),
      );
      expect(Number(rooms[0]?.n), label).toBe(0);
    }
    // 対照: メンバーは生 SQL でも読める（検査の空振りでない）。
    const own = await rawAs(AS_A1, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM messages WHERE thread_id = '${threadId}'`),
    );
    expect(Number(own[0]?.n)).toBeGreaterThan(0);
  });
});

describe('🔴 (c) GROUP でも非メンバーは読めない', () => {
  it('ホスト + 取引先 A1 のグループは、メンバー以外（管理者・A1 の別の人）に 0 件', async () => {
    const threadId = await idOf(
      await post(groupsRoute, host, '/api/threads/groups', { title: '案件の相談', userIds: [USER_A_PARTNER] }),
      201,
    );
    await withTenant(host, async (db) => {
      await db.message.create({
        data: { tenantId: TENANT_A, threadId, ownerPartnerCompanyId: PARTNER_A1, senderUserId: USER_A_HOST, senderPartnerCompanyId: null, body: BODY_DM },
      });
    });
    expect((await visibleCounts(partnerA1, threadId)).messages).toBe(1);
    for (const [label, ctx] of [
      ['ホストの別の営業', host2],
      ['ホストの管理者', hostAdmin],
      ['同じ取引先 A1 の別の人', partnerA1b],
      ['別の取引先 A2', partnerA2],
    ] as const) {
      expect(await visibleCounts(ctx, threadId), label).toEqual({ threads: 0, messages: 0, participants: 0 });
    }
  });
});

describe('🔴 (d)(e) 参加会社の行を勝手に作れない', () => {
  it('A1 のメンバーが自分の DM に A2 の行を作ろうとすると拒否', async () => {
    const threadId = await hostA1Dm();
    await expect(
      rawAs(AS_A1, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO thread_participants (id, tenant_id, thread_id, partner_company_id, joined_at) VALUES (gen_random_uuid(), '${TENANT_A}', '${threadId}', '${PARTNER_A2}', now())`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('A1 の非メンバーが他人の DM にホストの行（NULL）を作ろうとすると拒否', async () => {
    const threadId = await hostA1Dm();
    await expect(
      rawAs(AS_A1B, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO thread_participants (id, tenant_id, thread_id, partner_company_id, joined_at) VALUES (gen_random_uuid(), '${TENANT_A}', '${threadId}', NULL, now())`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('A2 が A1 の DM に自社の行を作ろうとすると拒否', async () => {
    const threadId = await hostA1Dm();
    await expect(
      rawAs(AS_A2, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO thread_participants (id, tenant_id, thread_id, partner_company_id, joined_at) VALUES (gen_random_uuid(), '${TENANT_A}', '${threadId}', '${PARTNER_A2}', now())`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('🔴 (f) 部屋の形は後から変えられない（レビュー NG-2）', () => {
  it('取引先 A1 のメンバーが DM を COMPANY に書き換えようとすると拒否され、部屋は DM のまま', async () => {
    const threadId = await hostA1Dm();
    await expect(
      rawAs(AS_A1, (tx) =>
        tx.$executeRawUnsafe(`UPDATE chat_threads SET kind = 'COMPANY', member_user_ids = '{}', dm_key = NULL WHERE id = '${threadId}'`),
      ),
    ).rejects.toThrow();
    await expect(
      rawAs(AS_A1, (tx) =>
        tx.$executeRawUnsafe(`UPDATE chat_threads SET member_user_ids = ARRAY['${USER_A_HOST}'::uuid, '${USER_A_PARTNER_B}'::uuid] WHERE id = '${threadId}'`),
      ),
    ).rejects.toThrow();
    const row = await admin.chatThread.findUnique({ where: { id: threadId }, select: { kind: true } });
    expect(row?.kind).toBe('DM');
    // 対照: 部屋の形以外（最終更新）は変えられる。
    const touched = await rawAs(AS_A1, (tx) => tx.$executeRawUnsafe(`UPDATE chat_threads SET last_message_at = now() WHERE id = '${threadId}'`));
    expect(touched).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ✅ 2026-10-19（画面の段）: 連絡先と部屋の一覧・詳細の境界（`lib/chat/people.ts`）
// ---------------------------------------------------------------------------
describe('🔴 連絡先・部屋の一覧・詳細（画面の読み出し）', () => {
  it('取引先の人の連絡先には自社（ホスト）の人だけが出る。同じ取引先の同僚・別の取引先の人は出ない', async () => {
    const { readPeople } = await import('../../apps/web/lib/chat/people');
    const people = await withTenant(partnerA1, (db) => readPeople(partnerA1, db));
    const all = people.contacts.companies.flatMap((company) => company.people);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((contact) => contact.isHost)).toBe(true);
    const ids = all.map((contact) => contact.userId);
    expect(ids).not.toContain(USER_A_PARTNER_B);
    expect(ids).not.toContain(USER_A_PARTNER2);
    expect(JSON.stringify(people)).not.toContain('Partner A2');
  });

  it('ホストの連絡先には取引先の人も出る（自分は出ない）', async () => {
    const { readPeople } = await import('../../apps/web/lib/chat/people');
    const people = await withTenant(host, (db) => readPeople(host, db));
    const ids = people.contacts.companies.flatMap((company) => company.people.map((contact) => contact.userId));
    expect(ids).toContain(USER_A_PARTNER);
    expect(ids).not.toContain(USER_A_HOST);
  });

  it('部屋の一覧はメンバーの部屋だけ。メンバーでない人には詳細が null（管理者も）', async () => {
    const { readPeople, readRoomDetail } = await import('../../apps/web/lib/chat/people');
    const threadId = await hostA1Dm();
    const mine = await withTenant(partnerA1, (db) => readPeople(partnerA1, db));
    expect(mine.rooms.map((room) => room.id)).toContain(threadId);
    for (const ctx of [hostAdmin, host2, partnerA1b, partnerA2]) {
      const others = await withTenant(ctx, (db) => readPeople(ctx, db));
      expect(others.rooms.map((room) => room.id)).not.toContain(threadId);
      expect(await withTenant(ctx, (db) => readRoomDetail(ctx, db, threadId))).toBeNull();
    }
    const detail = await withTenant(host, (db) => readRoomDetail(host, db, threadId));
    expect(detail?.members?.map((member) => member.userId).sort()).toEqual([USER_A_HOST, USER_A_PARTNER].sort());
  });
});

// ---------------------------------------------------------------------------
// ✅ 2026-10-19（#137 レビュー）: 広げた `findChatThreadRow` を通る 9 つの操作と、画面データ全体の禁止キー
// ---------------------------------------------------------------------------
const DEPS = { now: () => new Date(), meta: { ipAddress: null } } as const;

/** 9 つの操作。非メンバーはすべて 404、メンバーはすべて成功する。 */
async function runNine(ctx: AuthenticatedTenantCtx, threadId: string, messageId: string) {
  const service = await import('../../apps/web/lib/chat/service');
  const readState = await import('../../apps/web/lib/chat/read-state');
  const read = await import('../../apps/web/lib/chat/read');
  return {
    send: () => service.sendChatMessage(ctx, threadId, { body: '九つの確認' }, DEPS),
    list: () => read.listChatMessages(ctx, threadId, { limit: 20 } as never),
    read: () => readState.markChatRead(ctx, threadId, messageId),
    unread: () => readState.markChatUnread(ctx, threadId, messageId),
    prefs: () => readState.setChatThreadPrefs(ctx, threadId, { pinned: true }),
    reaction: () => service.toggleChatReaction(ctx, threadId, messageId, 'OK'),
    edit: () => service.editChatMessage(ctx, threadId, messageId, { body: '編集' }, DEPS),
    remove: () => service.deleteChatMessage(ctx, threadId, messageId, DEPS),
    exportCsv: () => service.readChatThreadForExport(ctx, threadId, DEPS),
  };
}

/** 部屋に 1 件発言を置き、その ID を返す（メンバーの文脈で）。 */
async function seedMessage(ctx: AuthenticatedTenantCtx, threadId: string): Promise<string> {
  const service = await import('../../apps/web/lib/chat/service');
  return (await service.sendChatMessage(ctx, threadId, { body: '準備の発言' }, DEPS)).message.id;
}

describe('🔴 広げた findChatThreadRow: 非メンバーは 9 つすべて 404、メンバーはすべて成功', () => {
  it('ホスト ↔ 取引先 A1 の DM（非メンバー = ホストの管理者・A1 の別の人・A2）', async () => {
    const threadId = await hostA1Dm();
    const messageId = await seedMessage(host, threadId);
    for (const [label, ctx] of [['ホストの管理者', hostAdmin], ['A1 の別の人', partnerA1b], ['A2', partnerA2]] as const) {
      for (const [name, run] of Object.entries(await runNine(ctx, threadId, messageId))) {
        await expect(run(), `${label}: ${name}`).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
    }
  });

  it('社内だけの DM（非メンバー = ホストの管理者・取引先 A1）', async () => {
    const threadId = await idOf(await openDm(host, USER_A_HOST2), 200);
    const messageId = await seedMessage(host2, threadId);
    for (const [label, ctx] of [['ホストの管理者', hostAdmin], ['取引先 A1', partnerA1]] as const) {
      for (const [name, run] of Object.entries(await runNine(ctx, threadId, messageId))) {
        await expect(run(), `${label}: ${name}`).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
    }
  });

  it('メンバーは 9 つすべて成功する（取引先の文脈・社内 DM の投稿を含む）。書き出しは監査が 1 件増える', async () => {
    const audits = async () => admin.auditLog.count({ where: { action: 'thread.export' } });
    for (const [label, ctx, threadId] of [
      ['取引先 A1（ホストとの DM）', partnerA1, await hostA1Dm()],
      ['ホスト（社内 DM）', host, await idOf(await openDm(host, USER_A_HOST2), 200)],
    ] as const) {
      // 編集・削除は自分の発言にだけできる。
      const messageId = await seedMessage(ctx, threadId);
      const nine = await runNine(ctx, threadId, messageId);
      const before = await audits();
      for (const name of ['send', 'list', 'read', 'unread', 'prefs', 'reaction', 'edit', 'exportCsv', 'remove'] as const) {
        await expect(nine[name](), `${label}: ${name}`).resolves.toBeDefined();
      }
      expect(await audits(), label).toBe(before + 1);
    }
    // 社内 DM の発言は取引先を持たない（継承トリガが NULL を通す）。
    const internal = await admin.message.findFirst({
      where: { body: '九つの確認', thread: { kind: 'DM', partnerCompanyId: null } },
      select: { ownerPartnerCompanyId: true },
    });
    expect(internal?.ownerPartnerCompanyId).toBeNull();
  });
});

describe('🔴 画面データ全体（readChatScreen）', () => {
  /** 応答 JSON を深さ優先で走査してキーを集める（`chat-threads.test.ts` と同じ）。 */
  function collectKeys(value: unknown, into: Set<string>): void {
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, into);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        into.add(key);
        collectKeys(nested, into);
      }
    }
  }

  it('DM を開いた画面データに禁止キーが 1 つも無く、詳細のキーは CHAT_ROOM_DETAIL_VIEW_KEYS', async () => {
    const { readChatScreen } = await import('../../apps/web/lib/chat/read');
    const { CHAT_FORBIDDEN_RESPONSE_KEYS, CHAT_ROOM_DETAIL_VIEW_KEYS } = await import('../../apps/web/lib/chat/views');
    const threadId = await hostA1Dm();
    for (const ctx of [partnerA1, host]) {
      const screen = await readChatScreen(ctx, {
        threadId,
        threadsQuery: { limit: 20 } as never,
        messagesQuery: { limit: 20 } as never,
        tree: { sort: 'recent', q: null },
      });
      expect(screen.thread?.id).toBe(threadId);
      expect(Object.keys(screen.thread ?? {}).sort()).toEqual([...CHAT_ROOM_DETAIL_VIEW_KEYS].sort());
      for (const member of screen.thread?.members ?? []) {
        // ✅ 2026-10-19（#128 §7.1 ①）: `status`（ひとこと状態。RLS で読めた人の分だけ）を足した。
        expect(Object.keys(member).sort()).toEqual(['companyName', 'isHost', 'name', 'self', 'status', 'userId']);
      }
      const keys = new Set<string>();
      collectKeys(screen, keys);
      for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) {
        expect([...keys], forbidden).not.toContain(forbidden);
      }
    }
  });

  it('メンバーでない管理者は、左端でも右に並べても読めない（requestedThreadMissing・一覧にも出ない）', async () => {
    const { readChatScreen } = await import('../../apps/web/lib/chat/read');
    const threadId = await hostA1Dm();
    const screen = await readChatScreen(hostAdmin, {
      threadId,
      threadsQuery: { limit: 20 } as never,
      messagesQuery: { limit: 20 } as never,
      paneIds: [threadId],
      tree: { sort: 'recent', q: null },
    });
    expect(screen.requestedThreadMissing).toBe(true);
    expect(screen.thread).toBeNull();
    expect(screen.panes).toEqual([]);
    expect(screen.people?.rooms.map((room) => room.id)).not.toContain(threadId);
    expect(JSON.stringify(screen)).not.toContain(BODY_DM);
  });
});

// ---------------------------------------------------------------------------
// ✅ 2026-10-19（#128）: DM の既読表示（`app_dm_peer_read`。migration 20261019010000）
// ---------------------------------------------------------------------------
describe('🔴 DM の既読表示: 相手の既読位置は DM のメンバーにだけ、1 つの値で返る', () => {
  /** 生 SQL で関数を呼ぶ（アプリの経路を通さず、RLS と関数だけで止まることを確かめる）。 */
  async function peerReadAs(who: { readonly partnerCompanyId: string | null; readonly userId: string }, threadId: string) {
    const rows = await rawAs(who, (tx) =>
      tx.$queryRawUnsafe<Array<{ peer: string | null }>>(`SELECT app_dm_peer_read('${threadId}'::uuid)::text AS peer`),
    );
    return rows[0]?.peer ?? null;
  }

  async function markRead(ctx: AuthenticatedTenantCtx, threadId: string, messageId: string): Promise<void> {
    const readState = await import('../../apps/web/lib/chat/read-state');
    await readState.markChatRead(ctx, threadId, messageId);
  }

  const AS_HOST = { partnerCompanyId: null, userId: USER_A_HOST } as const;

  it('① ホスト ↔ 取引先 A1 の DM: 互いに相手の既読位置が返る（アプリの経路と生 SQL の両方）', async () => {
    const threadId = await hostA1Dm();
    const first = await seedMessage(host, threadId);
    const second = await seedMessage(host, threadId);
    await markRead(partnerA1, threadId, first);
    await markRead(host, threadId, second);

    expect(await readDmPeerReadMessageIds(host, [threadId])).toEqual({ [threadId]: first });
    expect(await readDmPeerReadMessageIds(partnerA1, [threadId])).toEqual({ [threadId]: second });
    expect(await peerReadAs(AS_HOST, threadId)).toBe(first);
    expect(await peerReadAs(AS_A1, threadId)).toBe(second);

    // 相手が読み進めれば、その位置に動く。
    await markRead(partnerA1, threadId, second);
    expect(await peerReadAs(AS_HOST, threadId)).toBe(second);
  });

  it('🔴 chat_read_states の RLS（C7 SELF）は変わっていない: メンバーでも相手の行は直接読めない', async () => {
    const threadId = await hostA1Dm();
    const rows = await rawAs(AS_HOST, (tx) =>
      tx.$queryRawUnsafe<Array<{ user_id: string }>>(`SELECT user_id::text AS user_id FROM chat_read_states WHERE thread_id = '${threadId}'`),
    );
    expect(rows.map((row) => row.user_id)).toEqual([USER_A_HOST]);
  });

  it('② 非メンバー（ホストの管理者・ホストの別の営業・A1 の別の人・別の取引先 A2）には NULL', async () => {
    const threadId = await hostA1Dm();
    expect(await peerReadAs(AS_HOST, threadId), '対照: メンバーには値がある').not.toBeNull();
    for (const [label, who] of [
      ['ホストの管理者', AS_HOST_ADMIN],
      ['ホストの別の営業', AS_HOST2],
      ['同じ取引先 A1 の別の人', AS_A1B],
      ['別の取引先 A2', AS_A2],
    ] as const) {
      expect(await peerReadAs(who, threadId), label).toBeNull();
    }
    for (const ctx of [hostAdmin, host2, partnerA1b, partnerA2]) {
      expect(await readDmPeerReadMessageIds(ctx, [threadId])).toEqual({ [threadId]: null });
    }
  });

  it('③ グループ・会社グループでは、メンバー・参加会社の人にも NULL', async () => {
    // グループ（ホスト + 取引先 A1）。2 人とも既読位置を持っていても返さない。
    const groupId = await idOf(
      await post(groupsRoute, host, '/api/threads/groups', { title: '既読の確認', userIds: [USER_A_PARTNER] }),
      201,
    );
    const groupMessage = await seedMessage(host, groupId);
    await markRead(host, groupId, groupMessage);
    await markRead(partnerA1, groupId, groupMessage);
    expect(await peerReadAs(AS_HOST, groupId)).toBeNull();
    expect(await peerReadAs(AS_A1, groupId)).toBeNull();

    // 会社グループ（fixtures の COMPANY スレッド。ホストと取引先 A1 が参加）。
    await markRead(host, THREAD_A_P1, MESSAGE_A_P1);
    await markRead(partnerA1, THREAD_A_P1, MESSAGE_A_P1);
    expect(await peerReadAs(AS_HOST, THREAD_A_P1)).toBeNull();
    expect(await peerReadAs(AS_A1, THREAD_A_P1)).toBeNull();

    expect(await readDmPeerReadMessageIds(host, [groupId, THREAD_A_P1])).toEqual({ [groupId]: null, [THREAD_A_P1]: null });
  });

  it('画面データ（readChatScreen）: DM を開けば peerReadMessageIds に相手の位置、グループ・会社グループではキーが無い', async () => {
    const { readChatScreen } = await import('../../apps/web/lib/chat/read');
    const query = { threadsQuery: { limit: 20 } as never, messagesQuery: { limit: 20 } as never, tree: { sort: 'recent' as const, q: null } };
    const dmId = await hostA1Dm();
    const dm = await readChatScreen(host, { ...query, threadId: dmId });
    expect(Object.keys(dm.peerReadMessageIds)).toEqual([dmId]);
    expect(dm.peerReadMessageIds[dmId]).toBe(await peerReadAs(AS_HOST, dmId));

    const company = await readChatScreen(host, { ...query, threadId: THREAD_A_P1 });
    expect(company.thread?.id).toBe(THREAD_A_P1);
    expect(company.peerReadMessageIds).toEqual({});

    const groups = await admin.chatThread.findMany({ where: { kind: 'GROUP', memberUserIds: { has: USER_A_HOST } }, select: { id: true } });
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const screen = await readChatScreen(host, { ...query, threadId: group.id });
      expect(screen.thread?.id).toBe(group.id);
      expect(screen.peerReadMessageIds).toEqual({});
    }
  });

  /** GUC を任意の値で立てて（空文字 = 未設定）、app_tenant の接続で関数を生 SQL で呼ぶ。 */
  async function peerReadWithGuc(guc: { readonly tenantId: string; readonly partnerCompanyId: string; readonly userId: string }, threadId: string) {
    const client = createUnextendedClient(database.tenantUrl);
    try {
      return await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${guc.tenantId}', true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.partner_company_id', '${guc.partnerCompanyId}', true)`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.actor_user_id', '${guc.userId}', true)`);
        const rows = await tx.$queryRawUnsafe<Array<{ peer: string | null }>>(
          `SELECT app_dm_peer_read('${threadId}'::uuid)::text AS peer`,
        );
        return rows[0]?.peer ?? null;
      });
    } finally {
      await client.$disconnect();
    }
  }

  it('🔴 別テナント（テナント B）の文脈から、テナント A の DM の ID を指定しても NULL（生 SQL・アプリの経路とも）', async () => {
    const threadId = await hostA1Dm();
    expect(await peerReadAs(AS_HOST, threadId), '対照: テナント A のメンバーには値がある').not.toBeNull();
    expect(await peerReadWithGuc({ tenantId: TENANT_B, partnerCompanyId: '', userId: USER_B_HOST }, threadId)).toBeNull();
    // 🔴 テナント B の利用者がテナント A のメンバー ID を名乗っても、テナントが違えば NULL。
    expect(await peerReadWithGuc({ tenantId: TENANT_B, partnerCompanyId: '', userId: USER_A_HOST }, threadId)).toBeNull();
    const hostB = await resolveTenantCtx(
      { tenantId: TENANT_B, lifecycleState: 'ACTIVE', partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED', partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' },
      DEVICE,
    );
    expect(await readDmPeerReadMessageIds(hostB, [threadId])).toEqual({ [threadId]: null });
  });

  it('🔴 GUC 未設定（app.tenant_id / app.actor_user_id が空）の呼び出しは NULL（fail-closed）', async () => {
    const threadId = await hostA1Dm();
    expect(await peerReadAs(AS_HOST, threadId), '対照: GUC を立てれば値がある').not.toBeNull();
    expect(await peerReadWithGuc({ tenantId: '', partnerCompanyId: '', userId: '' }, threadId)).toBeNull();
    expect(await peerReadWithGuc({ tenantId: TENANT_A, partnerCompanyId: '', userId: '' }, threadId), '利用者だけ空').toBeNull();
    expect(await peerReadWithGuc({ tenantId: '', partnerCompanyId: '', userId: USER_A_HOST }, threadId), 'テナントだけ空').toBeNull();
    // GUC を 1 つも立てない接続でも NULL。
    const client = createUnextendedClient(database.tenantUrl);
    try {
      const rows = await client.$queryRawUnsafe<Array<{ peer: string | null }>>(`SELECT app_dm_peer_read('${threadId}'::uuid)::text AS peer`);
      expect(rows[0]?.peer ?? null).toBeNull();
    } finally {
      await client.$disconnect();
    }
  });

  it('🔴 案件スレッド（kind = PROJECT）では、参加会社の人にも NULL', async () => {
    const thread = await admin.chatThread.create({
      data: { tenantId: TENANT_A, kind: 'PROJECT', projectId: PROJECT_A_PUBLISHED, partnerCompanyId: PARTNER_A1 },
      select: { id: true },
    });
    await admin.threadParticipant.createMany({
      data: [
        { tenantId: TENANT_A, threadId: thread.id, partnerCompanyId: null, joinedAt: new Date() },
        { tenantId: TENANT_A, threadId: thread.id, partnerCompanyId: PARTNER_A1, joinedAt: new Date() },
      ],
    });
    const messageId = await seedMessage(host, thread.id);
    await markRead(host, thread.id, messageId);
    await markRead(partnerA1, thread.id, messageId);
    // 対照: 2 人とも既読位置を持っている（行が在るのに返さない、を確かめる）。
    expect(await admin.chatReadState.count({ where: { threadId: thread.id } })).toBe(2);
    expect(await peerReadAs(AS_HOST, thread.id)).toBeNull();
    expect(await peerReadAs(AS_A1, thread.id)).toBeNull();
    expect(await readDmPeerReadMessageIds(host, [thread.id])).toEqual({ [thread.id]: null });
    expect(await readDmPeerReadMessageIds(partnerA1, [thread.id])).toEqual({ [thread.id]: null });
  });

  it('④ 関数の EXECUTE は app_tenant だけ。所有者は app_thread_probe・SECURITY DEFINER・search_path 固定', async () => {
    const rows = await admin.$queryRawUnsafe<
      Array<{ prosecdef: boolean; owner: string; proconfig: string[] | null; tenant: boolean; platform: boolean; platform_write: boolean; public_exec: boolean }>
    >(`
      SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig,
             has_function_privilege('app_tenant', p.oid, 'EXECUTE') AS tenant,
             has_function_privilege('app_platform', p.oid, 'EXECUTE') AS platform,
             has_function_privilege('app_platform_write', p.oid, 'EXECUTE') AS platform_write,
             EXISTS (
               SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
             ) AS public_exec
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_dm_peer_read'`);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.prosecdef).toBe(true);
    expect(row?.owner).toBe('app_thread_probe');
    expect(row?.proconfig).toContain('search_path=public, pg_temp');
    expect({ tenant: row?.tenant, platform: row?.platform, platformWrite: row?.platform_write, public: row?.public_exec }).toEqual({
      tenant: true,
      platform: false,
      platformWrite: false,
      public: false,
    });
    // EXECUTE を持つロール（所有者を除く）は app_tenant だけ。
    const grantees = await admin.$queryRawUnsafe<Array<{ grantee: string }>>(`
      SELECT DISTINCT pg_get_userbyid(a.grantee) AS grantee
        FROM pg_proc p, aclexplode(p.proacl) AS a
       WHERE p.proname = 'app_dm_peer_read' AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner`);
    expect(grantees.map((entry) => entry.grantee)).toEqual(['app_tenant']);
  });

  it('④ app_thread_probe が chat_read_states で読めるのは 4 列だけ（日時・ピン留め・ミュートは読めない）', async () => {
    const columns = await admin.$queryRawUnsafe<Array<{ column_name: string; privilege_type: string }>>(`
      SELECT column_name, privilege_type FROM information_schema.column_privileges
       WHERE grantee = 'app_thread_probe' AND table_name = 'chat_read_states'
       ORDER BY column_name`);
    expect(columns).toEqual([
      { column_name: 'last_read_message_id', privilege_type: 'SELECT' },
      { column_name: 'tenant_id', privilege_type: 'SELECT' },
      { column_name: 'thread_id', privilege_type: 'SELECT' },
      { column_name: 'user_id', privilege_type: 'SELECT' },
    ]);
  });
});
