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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { PARTNER_A1, PARTNER_A2, TENANT_A, USER_A_HOST, USER_A_PARTNER, USER_A_PARTNER2 } from './support/fixtures.js';
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
