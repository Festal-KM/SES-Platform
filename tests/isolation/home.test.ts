// tests/isolation/home.test.ts
// T-03-06（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定:
//
//   🔴 `F-006 AC-1` パートナー所属の利用者の応答（`getMeView` の `partnerCompanyId`）が
//      自社の所属からのみ決まる（他パートナーの ID を混入できない）
//   🔴 `F-006 AC-3` `VIEWER` の `capabilities.execute` が全て false（承認・送信・DL の導線が無い）
//   `getMeView`（`GET /api/me`）がロール・テナント状態・利用者情報を正しく組み立てる
//
// `getHomeView`（`GET /api/home`）は DB を読まない純粋関数のため、境界テストは
// `apps/web/lib/home/service.test.ts`（DB 無し）が担う。ここでは DB を要する `getMeView` のみを
// 検証する（`tests/isolation/audit-log.test.ts` と同じ方針。HTTP 層の検証は E2E の範囲）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { buildTenantCtx } from '../../apps/web/lib/auth/tenant-context';
import { getMeView } from '../../apps/web/lib/home/service';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-04T00:00:00.000Z');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const PARTNER_1_1 = TENANT_1.partners[0];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

let database: IsolationDatabase;
/** 🔴 投入・前提づくり（role の付け替え）にだけ使う特権接続。 */
let admin: UnextendedClient;

async function ctxOf(identity: TenantIdentity, role: string): Promise<AuthenticatedTenantCtx> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
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

  await admin.twoFactorCredential.create({
    data: {
      subjectType: 'USER',
      subjectId: TENANT_1.hostUserId,
      tenantId: TENANT_1.tenantId,
      secretEncrypted: 'test:not-a-real-secret',
      recoveryCodeHashes: [],
      confirmedAt: NOW,
    },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

describe('getMeView（GET /api/me。docs/05 §6.3 #8 / F-006）', () => {
  it('ホストの ADMIN は role=ADMIN / partnerCompanyId=null / 全実行系が許可された capabilities を得る', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const user = await admin.user.findUniqueOrThrow({ where: { id: TENANT_1.hostUserId } });

    const view = await getMeView(ctx, { appEnv: 'development' });

    expect(view.role).toBe('ADMIN');
    expect(view.partnerCompanyId).toBeNull();
    expect(view.user).toEqual({ id: user.id, displayName: user.displayName, email: user.email });
    expect(view.capabilities.execute).toEqual({
      approve: true,
      submit: true,
      download: true,
      export: true,
    });
    expect(view.env).toBe('development');
  });

  it('🔴 F-006 AC-1: パートナー所属の応答は自社の partnerCompanyId のみを持つ（他社混入なし）', async () => {
    const ctx = await ctxOf(PARTNER_USER, 'PARTNER_SALES');

    const view = await getMeView(ctx, { appEnv: 'development' });

    expect(view.role).toBe('PARTNER_SALES');
    expect(view.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(view.partnerCompanyId).not.toBe(TENANT_1.partners[1].partnerCompanyId);
  });

  it('🔴 F-006 AC-3: VIEWER は capabilities.execute が全て false', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const view = await getMeView(ctx, { appEnv: 'development' });

    expect(view.capabilities.execute).toEqual({
      approve: false,
      submit: false,
      download: false,
      export: false,
    });
  });

  it('tenantState は Tenant.lifecycleState をそのまま反映する', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_1.tenantId } });

    const view = await getMeView(ctx, { appEnv: 'development' });

    expect(view.tenantState).toBe(tenant.lifecycleState);
  });
});
