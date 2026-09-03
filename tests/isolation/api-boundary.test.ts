// tests/isolation/api-boundary.test.ts
// T-03-04（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定を **DB 付きで**実証する:
//
//   🔴 `F-004 AC-2` ロール外は 403。参照範囲の判定にリクエスト入力を一切用いない
//      （body に他テナント / 他パートナー / 上位ロールを主張しても結果が変わらない）。
//   🔴 `F-004 AC-6` `VIEWER` は実行系（承認・送信・DL・エクスポート）を実行できない（`BR-31`）。
//   🔴 `F-004 AC-8` `CLOSING` の間は実行系が拒否され、**閲覧はできる**。
//   🔴 `F-004 AC-9` 拒否は画面の導線非表示ではなく **API を直接呼んでも**効く。
//      境界外の ID は **404** であり、存在しない ID と 1 バイトも違わない（docs/05 §4.8）。
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler**に `Request` を渡して行う。
//    差し替えるのは `requireTenantCtx`（T-03-01 が置いた seam）だけで、その戻り値も
//    **`buildTenantCtx` が実 DB から確定した ctx** である。ガード・Zod 境界・エラー写像・
//    サービス・RLS・Prisma 拡張はすべて本物が走る。
//    HTTP サーバを立てた通しの検証は E2E（T-03-11）が行う。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');

const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;

/**
 * 🔴 差し替えるのは「セッション → ctx」の 1 点だけである（`apps/web/lib/auth/session.ts`）。
 *    Auth.js の Cookie を組み立てる代わりに、**実 DB から作った ctx** をそのまま返す。
 */
const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { applyGuards, requireExecutable, requireNotViewer, requireRole } = await import(
  '../../apps/web/lib/api/guards'
);
const { requireFound } = await import('../../apps/web/lib/api/errors');
const { withApiRoute } = await import('../../apps/web/lib/api/withApiRoute');
const { configureAccountMailQueue, PendingAccountMailQueue } = await import(
  '../../apps/web/lib/jobs/account-mail'
);
// 🔴 実物の Route Handler（docs/05 §6.4 #14）。T-03-04 で `requireExecutable` を装着した。
const invitationsRoute = await import('../../apps/web/app/api/(main)/invitations/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_USER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const NONEXISTENT_ID = '01930000-0000-7000-8000-00000000ffff';

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

type ErrorBody = {
  readonly error: { readonly code: string; readonly messageKey: string };
};

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
}

async function setLifecycle(tenantId: string, lifecycleState: string): Promise<void> {
  await admin.tenant.update({
    where: { id: tenantId },
    data: { lifecycleState, lifecycleChangedAt: NOW },
  });
}

/** 2FA を「設定済み」にする（`OWNER` / `ADMIN` で ctx を作るための前提。`BR-30`）。 */
async function enrollTwoFactor(userId: string, tenantId: string): Promise<void> {
  const existing = await admin.twoFactorCredential.findFirst({
    where: { subjectId: userId, subjectType: 'USER' },
    select: { id: true },
  });
  if (existing !== null) return;
  await admin.twoFactorCredential.create({
    data: {
      subjectType: 'USER',
      subjectId: userId,
      tenantId,
      secretEncrypted: 'test:not-a-real-secret',
      recoveryCodeHashes: [],
      confirmedAt: NOW,
    },
  });
}

/** 🔴 ロールもライフサイクル状態も **DB から**確定した ctx を作る（セッションの主張ではない）。 */
async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

/** 実物のルートを「認証済みの誰か」として呼ぶ。 */
async function callInvitations(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return invitationsRoute.POST(
    new Request('https://app.test/api/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * 🔴 「ID を指定した取得」の最小ルート。境界の外は `withTenant` の中で 0 件になり、
 *    `requireFound` が 404 に畳む（docs/05 §4.8）。
 */
const getEngineerRoute = withApiRoute(
  { label: 'GET /api/engineers/{id}（テスト用）', guards: [] },
  async ({ ctx, request }) => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const engineer = requireFound(
      await withTenant(ctx, (db) => db.engineer.findFirst({ where: { id }, select: { id: true } })),
    );
    return Response.json(engineer);
  },
);

async function fetchEngineer(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return getEngineerRoute(new Request(`https://app.test/api/engineers?id=${id}`));
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });

  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
  await enrollTwoFactor(PARTNER_1_1.userId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  // 招待の発行は `account.mail` の enqueue 先を要求する（docs/05 §9.4）。
  configureAccountMailQueue(new PendingAccountMailQueue());
});

afterEach(async () => {
  // 🔴 テスト間で前提を持ち越さない（ロールとライフサイクル状態を戻す）。
  await setLifecycle(TENANT_1.tenantId, 'ACTIVE');
  await setRole(HOST_1, 'SALES');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await admin.invitation.deleteMany({ where: { tenantId: TENANT_1.tenantId } });
});

describe('🔴 F-004 AC-2: ロール外は 403。判定にリクエスト入力を用いない', () => {
  it('ADMIN は実行できる（対照）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await callInvitations(ctx, {
      email: 'ac2-admin@seed-isolation.test',
      role: 'SALES',
    });

    expect(response.status).toBe(201);
  });

  it.each(['SALES', 'VIEWER'] as const)('%s は 403 で、招待が 1 件も作られない', async (role) => {
    const ctx = await ctxOf(HOST_1, role);

    const response = await callInvitations(ctx, {
      email: 'ac2-denied@seed-isolation.test',
      role: 'SALES',
    });

    expect(response.status).toBe(403);
    expect(await admin.invitation.count({ where: { tenantId: TENANT_1.tenantId } })).toBe(0);
  });

  it('🔴 body に他テナント・他パートナー・上位ロールを主張しても結果が変わらない', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await callInvitations(ctx, {
      email: 'ac2-polluted@seed-isolation.test',
      role: 'SALES',
      // 🔴 分離キーはスキーマに存在せず、`withApiRoute` の構築時ガードも通らない。
      tenantId: TENANT_2.tenantId,
      partnerCompanyId: PARTNER_1_2.partnerCompanyId,
      ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
      lifecycleState: 'ACTIVE',
    });

    expect(response.status).toBe(201);
    const created = await admin.invitation.findFirst({
      where: { email: 'ac2-polluted@seed-isolation.test' },
    });
    // 所属は ctx（＝ DB の memberships）からのみ決まる。
    expect(created?.tenantId).toBe(TENANT_1.tenantId);
    expect(created?.partnerCompanyId).toBeNull();
  });

  it('🔴 セッションが上位ロールを主張しても、ctx のロールは memberships の値になる', async () => {
    await setRole(HOST_1, 'SALES');
    const ctx = await buildTenantCtx(
      { ...HOST_1, twoFactorVerified: true },
      { deviceKind: 'api' },
    );
    expect(ctx?.role).toBe('SALES');
  });
});

describe('🔴 F-004 AC-6: VIEWER は実行系を実行できない（BR-31）', () => {
  it('実物のルート（招待の発行）が 403 を返す', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const response = await callInvitations(ctx, {
      email: 'ac6@seed-isolation.test',
      role: 'SALES',
    });

    expect(response.status).toBe(403);
  });

  it('🔴 requireNotViewer が実 ctx で VIEWER を拒否する（承認・送信・DL・エクスポート）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const error = await applyGuards(ctx, [requireNotViewer()]).catch((caught: unknown) => caught);

    expect((error as { code?: string }).code).toBe('VIEWER_NOT_ALLOWED');
  });

  it('VIEWER でも閲覧はできる（拒否の射程は実行系だけである）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const response = await fetchEngineer(ctx, TENANT_1.hostEngineerId);

    expect(response.status).toBe(200);
  });
});

describe('🔴 F-004 AC-8 / AC-9: CLOSING では実行系が拒否され、閲覧はできる', () => {
  it('CLOSING のテナントでは ADMIN でも実行系が 409 になり、理由が返る', async () => {
    const ctx0 = await ctxOf(HOST_1, 'ADMIN');
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    // 🔴 ライフサイクル状態はセッションに焼き込まれない。次のリクエストの ctx で効く。
    expect(ctx0.lifecycleState).toBe('ACTIVE');
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    expect(ctx.lifecycleState).toBe('CLOSING');

    const response = await callInvitations(ctx, {
      email: 'ac8@seed-isolation.test',
      role: 'SALES',
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('TENANT_NOT_EXECUTABLE');
    // 🔴 「停止中」ではなく「解約手続き中」であることが利用者に伝わる（AC-9）。
    expect(body.error.messageKey).toBe('error.tenant.closing');
    expect(await admin.invitation.count({ where: { tenantId: TENANT_1.tenantId } })).toBe(0);
  });

  it('🔴 CLOSING でも閲覧はできる（AC-8「閲覧と返却のみ実行できる」）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await fetchEngineer(ctx, TENANT_1.hostEngineerId);
    const rows = await withTenant(ctx, (db) => db.engineer.findMany({ select: { id: true } }));

    expect(response.status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('🔴 CLOSING は他テナントに波及しない（テナント 2 は実行できる）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const identity: TenantIdentity = {
      tenantId: TENANT_2.tenantId,
      partnerCompanyId: null,
      userId: TENANT_2.hostUserId,
    };
    await enrollTwoFactor(TENANT_2.hostUserId, TENANT_2.tenantId);
    const ctx = await ctxOf(identity, 'ADMIN');

    await expect(applyGuards(ctx, [requireExecutable()])).resolves.toBeUndefined();

    await setRole(identity, 'SALES');
  });

  it('🔴 ガードの順序: CLOSING でもロール外には 403（テナント状態を教えない）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await callInvitations(ctx, {
      email: 'ac8-order@seed-isolation.test',
      role: 'SALES',
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
  });

  it('🔴 ガードの順序: CLOSING の VIEWER には 409（テナント状態がロールより優先する）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const error = await applyGuards(ctx, [
      requireNotViewer(),
      requireExecutable(),
      requireRole(['OWNER', 'ADMIN', 'VIEWER']),
    ]).catch((caught: unknown) => caught);

    expect((error as { code?: string }).code).toBe('TENANT_NOT_EXECUTABLE');
  });
});

describe('🔴 F-004 AC-9: 境界外の ID は 404（403 と区別しない。docs/05 §4.8）', () => {
  it('自テナントのエンジニアは 200 で取得できる（対照）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await fetchEngineer(ctx, TENANT_1.hostEngineerId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: TENANT_1.hostEngineerId });
  });

  it('🔴 他テナントのエンジニアを ID 直指定しても、存在しない ID と応答が一致する', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const crossTenant = await fetchEngineer(ctx, TENANT_2.hostEngineerId);
    const nonexistent = await fetchEngineer(ctx, NONEXISTENT_ID);

    expect(crossTenant.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(await crossTenant.text()).toBe(await nonexistent.text());
  });

  it('🔴 パートナーは他社のエンジニアを ID 直指定しても 404（第二境界）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const otherPartner = await fetchEngineer(ctx, PARTNER_1_2.engineerId);
    const nonexistent = await fetchEngineer(ctx, NONEXISTENT_ID);
    const own = await fetchEngineer(ctx, PARTNER_1_1.engineerId);

    expect(otherPartner.status).toBe(404);
    expect(await otherPartner.text()).toBe(await nonexistent.text());
    expect(own.status).toBe(200);
  });

  it('🔴 パートナーはホストのエンジニアも見えない（404）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const hostEngineer = await fetchEngineer(ctx, TENANT_1.hostEngineerId);

    expect(hostEngineer.status).toBe(404);
    expect(((await hostEngineer.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });
});
