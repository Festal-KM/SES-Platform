// tests/isolation/chat-user-status.test.ts
// ✅ 2026-10-19（#128 §7.1 ① で合意）: チャットのひとこと状態（`chat_user_statuses`）の分離。
// `docs/05` §3.7.1 / §4.4 / §6.5 #51j。migration 20261019020000。
//
// 🔴 ここで固定すること:
//   ① 本人しか書けない —— 他人の行の INSERT / UPDATE / DELETE は RLS が拒否する（API も本人の行しか書かない）
//   ② 取引先 A1 の人から、取引先 A2 の人の状態は 0 件（存在も件数も分からない）
//   ③ ホストからは取引先の人の状態が見える / 取引先からはホストの人の状態が見える
//   ④ 他テナントから 0 件
//   ⑤ 閲覧専用（VIEWER）は API で書けない / 空で消える / 61 文字・改行・分離キーは 400
//   ⑥ 設定・消去のたびに監査ログが 1 行（本文を含まない。文字数だけ）
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
  PARTNER_A1,
  PARTNER_A2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
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

const statusRoute = await import('../../apps/web/app/api/(main)/chat/status/route');
const { readChatUserStatuses, CHAT_STATUS_AUDIT_ACTION_UPDATE, CHAT_STATUS_AUDIT_ACTION_CLEAR } = await import(
  '../../apps/web/lib/chat/user-status'
);

const STATUS_HOST = '商談中';
const STATUS_A1 = '移動中・16 時以降に返信';
const STATUS_A2 = '取引先 A2 の状態（A1 に出てはならない）';
const STATUS_B = '他テナントの状態（テナント A に出てはならない）';
const ALL_USERS = [USER_A_HOST, USER_A_PARTNER, USER_A_PARTNER2, USER_B_HOST];

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;

async function putStatus(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return statusRoute.PUT(
    new Request('https://app.test/api/chat/status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** その文脈から見える状態（RLS の結果そのもの。`where` は利用者 ID だけ）。 */
async function visibleStatuses(ctx: AuthenticatedTenantCtx): Promise<Record<string, string>> {
  return withTenant(ctx, async (db) => Object.fromEntries(await readChatUserStatuses(db, ALL_USERS)));
}

async function rawCount(ctx: AuthenticatedTenantCtx): Promise<number> {
  return withTenant(ctx, async (db) => db.chatUserStatus.count());
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  partnerA1 = await resolveTenantCtx(
    { ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' },
    DEVICE,
  );
  partnerA2 = await resolveTenantCtx(
    { ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' },
    DEVICE,
  );
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  for (const [ctx, text] of [
    [host, STATUS_HOST],
    [partnerA1, STATUS_A1],
    [partnerA2, STATUS_A2],
    [tenantB, STATUS_B],
  ] as const) {
    const response = await putStatus(ctx, { text });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ text });
  }
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { action: { in: [CHAT_STATUS_AUDIT_ACTION_UPDATE, CHAT_STATUS_AUDIT_ACTION_CLEAR] } } });
  await admin?.chatUserStatus.deleteMany({});
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 ① 本人しか書けない', () => {
  it('他人の user_id での INSERT は RLS が拒否する（取引先から自社の人・ホストから取引先の人）', async () => {
    await expect(
      withTenant(partnerA1, async (db) => db.chatUserStatus.create({ data: { tenantId: TENANT_A, userId: USER_A_HOST, text: '書き換え' } })),
    ).rejects.toThrow();
    await expect(
      withTenant(host, async (db) => db.chatUserStatus.create({ data: { tenantId: TENANT_A, userId: USER_A_PARTNER2, text: '書き換え' } })),
    ).rejects.toThrow();
  });

  it('他人の行の UPDATE / DELETE は 0 件（見えていても書けない）', async () => {
    const updated = await withTenant(host, async (db) =>
      db.chatUserStatus.updateMany({ where: { userId: USER_A_PARTNER }, data: { text: '書き換え' } }),
    );
    expect(updated.count).toBe(0);
    const deleted = await withTenant(host, async (db) => db.chatUserStatus.deleteMany({ where: { userId: USER_A_PARTNER } }));
    expect(deleted.count).toBe(0);
    const rows = await admin.chatUserStatus.findMany({ where: { userId: USER_A_PARTNER } });
    expect(rows.map((row) => row.text)).toEqual([STATUS_A1]);
  });

  it('API は body に誰の状態かを受け取らない（userId / tenantId / partnerCompanyId は 400）', async () => {
    for (const extra of [{ userId: USER_A_PARTNER }, { tenantId: TENANT_B }, { partnerCompanyId: PARTNER_A2 }]) {
      const response = await putStatus(host, { text: '乗っ取り', ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await admin.chatUserStatus.findMany({ where: { userId: USER_A_PARTNER } })).map((row) => row.text)).toEqual([STATUS_A1]);
  });
});

describe('🔴 ② / ③ / ④ 読めるのは「その人が自分から見えるとき」だけ', () => {
  it('ホストからは自社と取引先 A1 / A2 の人の状態が見える。他テナントは見えない', async () => {
    expect(await visibleStatuses(host)).toEqual({
      [USER_A_HOST]: STATUS_HOST,
      [USER_A_PARTNER]: STATUS_A1,
      [USER_A_PARTNER2]: STATUS_A2,
    });
  });

  it('🔴 取引先 A1 からは自分とホストの人だけ。取引先 A2 の人の状態は 0 件（件数でも見えない）', async () => {
    expect(await visibleStatuses(partnerA1)).toEqual({ [USER_A_HOST]: STATUS_HOST, [USER_A_PARTNER]: STATUS_A1 });
    expect(await rawCount(partnerA1)).toBe(2);
    expect(await visibleStatuses(partnerA2)).toEqual({ [USER_A_HOST]: STATUS_HOST, [USER_A_PARTNER2]: STATUS_A2 });
    expect(await rawCount(partnerA2)).toBe(2);
  });

  it('🔴 他テナントからは 0 件 / テナント B からはテナント A の状態が 0 件', async () => {
    expect(await visibleStatuses(tenantB)).toEqual({ [USER_B_HOST]: STATUS_B });
    expect(await rawCount(tenantB)).toBe(1);
    expect(Object.values(await visibleStatuses(host))).not.toContain(STATUS_B);
  });
});

describe('⑤ API の入口', () => {
  it('閲覧専用（VIEWER）は 403 で、行は変わらない', async () => {
    const response = await putStatus(hostViewer, { text: '閲覧専用の書き込み' });
    expect(response.status).toBe(403);
    expect((await admin.chatUserStatus.findMany({ where: { userId: USER_A_HOST } })).map((row) => row.text)).toEqual([STATUS_HOST]);
  });

  it('61 文字・改行は 400。60 文字は通る', async () => {
    expect((await putStatus(partnerA2, { text: 'あ'.repeat(61) })).status).toBe(400);
    expect((await putStatus(partnerA2, { text: '1 行目\n2 行目' })).status).toBe(400);
    const ok = await putStatus(partnerA2, { text: 'い'.repeat(60) });
    expect(ok.status).toBe(200);
    expect((await putStatus(partnerA2, { text: STATUS_A2 })).status).toBe(200);
  });

  it('空で送ると消える（行が無くなる）', async () => {
    const response = await putStatus(tenantB, { text: '   ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '' });
    expect(await admin.chatUserStatus.count({ where: { userId: USER_B_HOST } })).toBe(0);
  });
});

describe('🔴 ⑥ 監査ログ', () => {
  async function auditRows(userId: string) {
    return admin.auditLog.findMany({
      where: { actorId: userId, action: { in: [CHAT_STATUS_AUDIT_ACTION_UPDATE, CHAT_STATUS_AUDIT_ACTION_CLEAR] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  it('設定・消去のたびに 1 行ずつ増え、本文を含まない（文字数だけ）。失敗した書き込み（400 / 403）では増えない', async () => {
    const text = '監査に本文が出てはならない状態';
    const before = (await auditRows(USER_A_PARTNER)).length;
    expect((await putStatus(partnerA1, { text })).status).toBe(200);
    expect((await putStatus(partnerA1, { text: 'あ'.repeat(61) })).status).toBe(400);
    expect((await putStatus(partnerA1, { text: '' })).status).toBe(200);
    const rows = (await auditRows(USER_A_PARTNER)).slice(before);
    expect(rows.map((row) => row.action)).toEqual([CHAT_STATUS_AUDIT_ACTION_UPDATE, CHAT_STATUS_AUDIT_ACTION_CLEAR]);
    for (const row of rows) {
      expect(row.tenantId).toBe(TENANT_A);
      expect(row.targetType).toBe('User');
      expect(row.targetId).toBe(USER_A_PARTNER);
      expect(JSON.stringify(row)).not.toContain(text);
    }
    expect(rows[0]?.summary).toEqual({ textLength: text.length });
    expect(rows[1]?.summary).toEqual({ textLength: 0 });

    const viewerBefore = (await auditRows(USER_A_HOST)).length;
    expect((await putStatus(hostViewer, { text: '閲覧専用' })).status).toBe(403);
    expect((await auditRows(USER_A_HOST)).length).toBe(viewerBefore);
    // 元に戻す（他の検査の前提を壊さない）。
    expect((await putStatus(partnerA1, { text: STATUS_A1 })).status).toBe(200);
  });
});
