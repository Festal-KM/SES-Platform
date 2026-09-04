// tests/isolation/platform-tenants.test.ts
// `A-002`（テナント一覧）/ `A-003`（テナント詳細）の専用クエリ関数
// （docs/05 §5.7 / `F-056`。T-03-09）。
//
// 🔴 ここで実証するのは:
//   ① AC-1: 応答が件数・状態・日時のみを持ち、既知の PII・本文が JSON に一切現れない
//      （`Object.keys` 照合 + 走査。`app_platform` の列 GRANT に無い列は select しようとした
//       時点で `permission denied` になるが、ここでは「そもそも select していない」ことを、
//       実データを使った応答の走査で二重に確かめる）
//   ② AC-3: 一覧・詳細の閲覧が使う経路（`app_platform`。読み取り専用ロール）では
//      業務データを 1 行も書けない（DB 権限）。書き込み用の Route Handler が存在しないことは
//      `tests/static/admin-tenants-read-only.test.ts` が担保する
//   ③ AC-4: 一覧・詳細の閲覧が `AuditLog` に記録される
//   ④ `PURGED` はライフサイクル状態のみを返し、削除件数を含めない（`F-062 AC-7`）
//   ⑤ カーソルページングが機能し、テナントごとの件数が母集団と一致する
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configurePlatformReadDb, configurePlatformWriteDb, resolvePlatformCtx } from '@ses/db';
import type { AuthenticatedPlatformCtx } from '@ses/db';
import { getPlatformTenantDetail, listPlatformTenants, withPlatformRead } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const PLATFORM_USER_ID = '01930000-0000-7000-8000-0000000000bb';
const TENANT_PURGED = '01930000-0000-7000-8000-0000000000c9';
const TENANT_NONEXISTENT = '01930000-0000-7000-8000-000000000fff';

let database: IsolationDatabase;
let superuser: UnextendedClient;
let ctx: AuthenticatedPlatformCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  ctx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // 🔴 PURGED テナント（④ の検証専用）。件数を持つ関連行は 1 つも作らない
  //    （PURGED では件数クエリ自体が発行されないため、無くても検証できる）。
  await superuser.$executeRawUnsafe(`
    INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, provisioning_request_id)
    VALUES ('${TENANT_PURGED}', 'Tenant Purged', 'production', 'PURGED', now(), 'seed-provisioning-tenant-purged')
  `);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('listPlatformTenants（API-A2 / F-056 AC-1 / AC-4）', () => {
  it('🔴 件数・状態・日時のみを返す（境界外フィールドが無い）', async () => {
    const page = await listPlatformTenants(ctx, { limit: 200 });
    const tenantA = page.items.find((item) => item.id === TENANT_A);
    expect(tenantA).toBeDefined();
    expect(Object.keys(tenantA as object).sort()).toEqual(
      [
        'createdAt',
        'engineerCount',
        'environment',
        'id',
        'lastActivityAt',
        'lifecycleChangedAt',
        'lifecycleState',
        'name',
        'partnerCompanyCount',
        'projectCount',
        'seatCount',
      ].sort(),
    );
  });

  it('🔴 既知の氏名・本文・エンド企業名が応答の JSON に一切現れない（BR-40）', async () => {
    const page = await listPlatformTenants(ctx, { limit: 200 });
    const serialized = JSON.stringify(page.items);
    expect(serialized).not.toContain('Engineer A-Host');
    expect(serialized).not.toContain('Engineer A-Partner');
    expect(serialized).not.toContain('partner1 からの本文');
    expect(serialized).not.toContain('End Client A');
  });

  it('テナントごとの件数が母集団と一致する', async () => {
    const page = await listPlatformTenants(ctx, { limit: 200 });
    const tenantA = page.items.find((item) => item.id === TENANT_A);
    const tenantB = page.items.find((item) => item.id === TENANT_B);
    expect(tenantA).toMatchObject({
      seatCount: 3,
      partnerCompanyCount: 2,
      engineerCount: 3,
      projectCount: 2,
    });
    expect(tenantB).toMatchObject({
      seatCount: 1,
      partnerCompanyCount: 0,
      engineerCount: 1,
      projectCount: 0,
    });
  });

  it('カーソルページングが機能する（limit=1 で 2 ページ目に別のテナントが現れる）', async () => {
    const first = await listPlatformTenants(ctx, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await listPlatformTenants(ctx, {
      limit: 1,
      cursor: first.nextCursor as string,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it('🔴 F-056 AC-4: 一覧の閲覧が横断操作（tenant_id = NULL）として AuditLog に記録される', async () => {
    await listPlatformTenants(ctx, { limit: 200 });
    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; actor_kind: string; actor_id: string }>
    >`SELECT tenant_id, actor_kind, actor_id FROM audit_logs WHERE action = 'admin.tenant.list'`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === null)).toBe(true);
    expect(rows.every((row) => row.actor_kind === 'PLATFORM_USER')).toBe(true);
    expect(rows.every((row) => row.actor_id === PLATFORM_USER_ID)).toBe(true);
  });
});

describe('getPlatformTenantDetail（API-A3 / F-056 AC-1 / AC-4）', () => {
  it('🔴 件数・状態・日時のみを返す（境界外フィールドが無い）', async () => {
    const detail = await getPlatformTenantDetail(ctx, TENANT_A);
    expect(detail).not.toBeNull();
    expect(Object.keys(detail as object).sort()).toEqual(
      [
        'closingEnteredAt',
        'createdAt',
        'engineerCount',
        'environment',
        'id',
        'lastActivityAt',
        'lifecycleChangedAt',
        'lifecycleState',
        'name',
        'partnerCompanyCount',
        'projectCount',
        'proposalCount',
        'recentActivityCount30d',
        'sandboxExpiresAt',
        'seatCount',
      ].sort(),
    );
  });

  it('🔴 既知の氏名・本文・エンド企業名が応答の JSON に一切現れない（BR-40）', async () => {
    const detail = await getPlatformTenantDetail(ctx, TENANT_A);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('Engineer A-Host');
    expect(serialized).not.toContain('partner1 からの本文');
    expect(serialized).not.toContain('End Client A');
  });

  it('テナント A の件数が母集団と一致する（提案 4 件を含む）', async () => {
    const detail = await getPlatformTenantDetail(ctx, TENANT_A);
    if (detail === null || detail.lifecycleState === 'PURGED') throw new Error('unreachable');
    expect(detail.seatCount).toBe(3);
    expect(detail.partnerCompanyCount).toBe(2);
    expect(detail.engineerCount).toBe(3);
    expect(detail.projectCount).toBe(2);
    expect(detail.proposalCount).toBe(4);
    expect(typeof detail.recentActivityCount30d).toBe('number');
  });

  it('存在しない ID は null を返す（呼び出し側が 404 に写像する。docs/05 §4.8）', async () => {
    const detail = await getPlatformTenantDetail(ctx, TENANT_NONEXISTENT);
    expect(detail).toBeNull();
  });

  it('🔴 存在しない ID への閲覧も、tenant_id=NULL・target_id=元の ID で AuditLog にコミットされる（FK 違反 500 の回帰防止）', async () => {
    await getPlatformTenantDetail(ctx, TENANT_NONEXISTENT);
    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; target_id: string | null; actor_kind: string }>
    >`SELECT tenant_id, target_id, actor_kind FROM audit_logs
        WHERE action = 'admin.tenant.view' AND target_id = ${TENANT_NONEXISTENT}::uuid`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === null)).toBe(true);
    expect(rows.every((row) => row.target_id === TENANT_NONEXISTENT)).toBe(true);
    expect(rows.every((row) => row.actor_kind === 'PLATFORM_USER')).toBe(true);
  });

  it('🔴 restore の実効性: 対象が実在しなくても fn は RLS だけで 0 件に閉じる（アプリの where に依存しない。§5.2 の不変条件）', async () => {
    // 🔴 意図的に where を書かない。`writePlatformAuditRow` が `INSERT` 後に
    //    `app.target_tenant_id` を元の（実在しない）ID へ戻していれば、RLS だけで 0 件になる。
    //    restore が抜けていると GUC が空（横断可視）のままになり、TENANT_A / TENANT_B の
    //    エンジニア行が返ってこのテストが落ちる（§5.2「targetTenantId を指定した操作は RLS に
    //    より自動的にそのテナントへ閉じる」の回帰防止）。
    const rows = await withPlatformRead(
      {
        ctx,
        action: 'admin.tenant.view',
        targetTenantId: TENANT_NONEXISTENT,
        targetType: 'Tenant',
        targetId: TENANT_NONEXISTENT,
      },
      async (db) => db.engineer.findMany({ select: { id: true } }),
    );
    expect(rows).toEqual([]);
  });

  it('🔴 F-062 AC-7: PURGED はライフサイクル状態のみを返し、削除件数を含めない', async () => {
    const detail = await getPlatformTenantDetail(ctx, TENANT_PURGED);
    expect(detail).toEqual({
      id: TENANT_PURGED,
      name: 'Tenant Purged',
      lifecycleState: 'PURGED',
      lifecycleChangedAt: expect.any(String) as unknown as string,
    });
  });

  it('🔴 F-056 AC-4: 詳細の閲覧が対象テナントに紐づけて AuditLog に記録される', async () => {
    await getPlatformTenantDetail(ctx, TENANT_A);
    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; target_id: string | null; actor_kind: string }>
    >`SELECT tenant_id, target_id, actor_kind FROM audit_logs
        WHERE action = 'admin.tenant.view' AND target_id = ${TENANT_A}::uuid`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenant_id === TENANT_A)).toBe(true);
    expect(rows.every((row) => row.actor_kind === 'PLATFORM_USER')).toBe(true);
  });
});

describe('F-056 AC-3: 運営者はテナントの業務データを作成・更新・削除できない', () => {
  it('🔴 一覧・詳細と同じ action（admin.tenant.view）の読み取り接続では業務データを更新できない', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A }, async (db) => {
        const writable = db.engineer as unknown as {
          updateMany: (args: unknown) => Promise<unknown>;
        };
        return writable.updateMany({ where: {}, data: { availability: 'AVAILABLE' } });
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('🔴 一覧・詳細と同じ action の読み取り接続では業務データを作成できない', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.tenant.list', targetTenantId: null }, async (db) => {
        const writable = db.project as unknown as { createMany: (args: unknown) => Promise<unknown> };
        return writable.createMany({ data: [{ tenantId: TENANT_A, name: 'x' }] });
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
