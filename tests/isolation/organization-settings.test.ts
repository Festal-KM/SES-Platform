// tests/isolation/organization-settings.test.ts
// `S-035` 組織設定（docs/05 §6.3 #64 / `F-001` / `F-021`）。T-03-10。
//
// 🔴 ここで実証するのは 3 つである:
//   ① `lifecycleState` が**読み取り専用**である（#64）。Zod スキーマだけでなく
//      **DB の列レベル `GRANT`** が拒否する（migration 20260905000000）
//   ② テナント境界 —— 自テナントの設定しか読めず、書けない
//   ③ パートナー文脈からは書けない（RLS の `app_is_host()`）
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { NotFoundError } from '../../apps/web/lib/api/errors';
import {
  readOrganizationSettings,
  updateOrganizationSettings,
} from '../../apps/web/lib/settings/organization';
import {
  PARTNER_A1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

let database: IsolationDatabase;
let admin: UnextendedClient;
/** 🔴 app_tenant ロールの生接続（列レベル GRANT の拒否を実測するためだけに使う）。 */
let tenantRaw: UnextendedClient;
let ownerA: AuthenticatedTenantCtx;
let ownerB: AuthenticatedTenantCtx;
let partnerA: AuthenticatedTenantCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  tenantRaw = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  ownerA = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'OWNER',
      lifecycleState: 'ACTIVE',
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  ownerB = await resolveTenantCtx(
    {
      tenantId: TENANT_B,
      partnerCompanyId: null,
      userId: USER_B_HOST,
      role: 'OWNER',
      lifecycleState: 'ACTIVE',
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  partnerA = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_ADMIN',
      lifecycleState: 'ACTIVE',
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await tenantRaw?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('GET /api/settings/organization（#64）', () => {
  it('自テナントの設定を返す', async () => {
    const settings = await readOrganizationSettings(ownerA);
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });
    expect(settings.name).toBe(tenant.name);
    expect(settings.lifecycleState).toBe(tenant.lifecycleState);
  });

  it('🔴 応答のフィールドは #64 が定める 6 つだけである', async () => {
    const settings = await readOrganizationSettings(ownerA);
    expect(Object.keys(settings).sort()).toEqual(
      [
        'autoApproveEnabled',
        'environment',
        'lifecycleState',
        'name',
        'piiRetentionYears',
        'timezone',
      ].sort(),
    );
  });

  it('テナントごとに独立している（他テナントの設定は見えない）', async () => {
    const a = await readOrganizationSettings(ownerA);
    const b = await readOrganizationSettings(ownerB);
    expect(a.name).not.toBe(b.name);
  });
});

describe('PATCH /api/settings/organization（#64）', () => {
  it('name / autoApproveEnabled / piiRetentionYears を更新できる', async () => {
    const updated = await updateOrganizationSettings(ownerA, {
      name: 'ホスト株式会社（改称）',
      autoApproveEnabled: true,
      piiRetentionYears: 5,
    });
    expect(updated).toMatchObject({
      name: 'ホスト株式会社（改称）',
      autoApproveEnabled: true,
      piiRetentionYears: 5,
    });

    const row = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });
    expect(row.name).toBe('ホスト株式会社（改称）');
    expect(row.autoApproveEnabled).toBe(true);
  });

  it('🔴 他テナントの設定は 1 件も変わらない（F-004 AC-1）', async () => {
    const before = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_B } });
    await updateOrganizationSettings(ownerA, { name: 'A だけを変える' });
    const after = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_B } });
    expect(after.name).toBe(before.name);
    expect(after.autoApproveEnabled).toBe(before.autoApproveEnabled);
  });

  it('空の patch は何も変えずに現在値を返す', async () => {
    const before = await readOrganizationSettings(ownerA);
    const after = await updateOrganizationSettings(ownerA, {});
    expect(after).toEqual(before);
  });

  it('🔴 パートナー文脈からは更新できない（RLS の app_is_host）', async () => {
    const before = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });
    await expect(
      updateOrganizationSettings(partnerA, { name: 'パートナーが変えようとした名前' }),
    ).rejects.toThrow(NotFoundError);
    const after = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });
    expect(after.name).toBe(before.name);
  });
});

describe('🔴 lifecycleState は読み取り専用（docs/05 §6.3 #64 / CLAUDE.md §4.2）', () => {
  it('app_tenant は tenants.lifecycle_state を UPDATE できない（列レベル GRANT）', async () => {
    const before = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });

    await expect(
      tenantRaw.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true),
                  set_config('app.partner_company_id', '', true),
                  set_config('app.actor_user_id', $2, true)`,
          TENANT_A,
          USER_A_HOST,
        );
        await tx.$executeRawUnsafe(
          `UPDATE tenants SET lifecycle_state = 'PURGED' WHERE id = $1::uuid`,
          TENANT_A,
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    const after = await admin.tenant.findUniqueOrThrow({ where: { id: TENANT_A } });
    expect(after.lifecycleState).toBe(before.lifecycleState);
  });

  it('app_tenant は environment / timezone も UPDATE できない（開設時にしか書けない）', async () => {
    for (const column of ['environment', 'timezone']) {
      await expect(
        tenantRaw.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.tenant_id', $1, true),
                    set_config('app.partner_company_id', '', true),
                    set_config('app.actor_user_id', $2, true)`,
            TENANT_A,
            USER_A_HOST,
          );
          await tx.$executeRawUnsafe(
            `UPDATE tenants SET ${column} = 'x' WHERE id = $1::uuid`,
            TENANT_A,
          );
        }),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('🔴 対照: 許可された 3 列は UPDATE できる（GRANT が空振りしていない）', async () => {
    await expect(
      tenantRaw.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true),
                  set_config('app.partner_company_id', '', true),
                  set_config('app.actor_user_id', $2, true)`,
          TENANT_A,
          USER_A_HOST,
        );
        await tx.$executeRawUnsafe(
          `UPDATE tenants SET auto_approve_enabled = false WHERE id = $1::uuid`,
          TENANT_A,
        );
      }),
    ).resolves.not.toThrow();
  });
});
