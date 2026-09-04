// tests/isolation/platform-plane.test.ts
// T-03-08（docs/sprints/SP-03-auth-audit-admin0.md）: 管理平面の分離バイパス
// （`withPlatformRead` / `withPlatformWrite`。docs/05 §5.2 / §5.3 / §5.5 / `BR-37` / `BR-40` / `BR-41`）。
//
// 🔴 ここで実証するのは「型でそう書いてある」ではなく「**DB がそう振る舞う**」ことである:
//   ① 監査の先行 —— `fn` の中から自分の監査ログが**既に見える**（= `fn` より前に書かれている）
//   ② 監査に失敗したらクエリが 1 度も実行されない（注入テスト。`BR-41` / `F-055 AC-4`）
//   ③ `fn` が失敗したら監査もロールバックされる（同一トランザクションであることの裏返し）
//   ④ `targetTenantId` を指定した操作はそのテナントに閉じる（RLS。アプリの where に依存しない）
//   ⑤ 読み取り接続は業務データを書けない（DB 権限。型を `as any` で破っても止まる）
//   ⑥ 運営者に非開示の列は SQL レベルで `permission denied` になる（§5.5 第 1 層 / `BR-40`）
//   ⑦ 書き込みは宣言したドメインのモデルにしか届かない（§5.2 の「3 枚目」）
//   ⑧ 認証専用ポリシー（T-03-07）が管理平面の通常操作の接続で真にならない（§5.3 の注記）
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configurePlatformReadDb, configurePlatformWriteDb, resolvePlatformCtx } from '@ses/db';
import type { AuthenticatedPlatformCtx } from '@ses/db';
import {
  PlatformWriteDomainViolationError,
  withPlatformRead,
  withPlatformWrite,
} from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const PLATFORM_USER_ID = '01930000-0000-7000-8000-0000000000aa';

let database: IsolationDatabase;
/** 🔴 GRANT の一時的な取り外し（注入テスト）にだけ使う。検証のクエリには使わない。 */
let migrator: UnextendedClient;
/** 監査ログの事後確認に使う（superuser は RLS を素通りするので「本当に行が無い」を言える）。 */
let superuser: UnextendedClient;
let ctx: AuthenticatedPlatformCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  migrator = createUnextendedClient(database.migratorUrl);
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  ctx = await resolvePlatformCtx(
    { platformUserId: PLATFORM_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await migrator?.$disconnect();
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

async function auditCount(action: string): Promise<number> {
  const rows = await superuser.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM audit_logs WHERE action = ${action}`;
  return Number(rows[0]?.count ?? 0n);
}

describe('① 監査の先行（docs/05 §5.3 / BR-41）', () => {
  it('🔴 fn の中から、その操作自身の監査ログが既に見える（= fn より前に書かれている）', async () => {
    const visibleInsideFn = await withPlatformRead(
      { ctx, action: 'admin.tenant.list', targetTenantId: null },
      async (db) => db.auditLog.count({ where: { action: 'admin.tenant.list' } }),
    );
    expect(visibleInsideFn).toBe(1);
    expect(await auditCount('admin.tenant.list')).toBe(1);
  });

  it('🔴 記録される主体・対象は ctx と op から来る（リクエスト入力から来ない）', async () => {
    await withPlatformRead(
      { ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A, targetType: 'Tenant', targetId: TENANT_A },
      async () => undefined,
    );
    const rows = await superuser.$queryRaw<
      Array<{
        tenant_id: string | null;
        actor_kind: string;
        actor_id: string | null;
        target_id: string | null;
        summary: Record<string, unknown>;
        device_kind: string | null;
      }>
    >`SELECT tenant_id, actor_kind, actor_id, target_id, summary, device_kind
        FROM audit_logs WHERE action = 'admin.tenant.view'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_kind).toBe('PLATFORM_USER');
    expect(rows[0]?.actor_id).toBe(PLATFORM_USER_ID);
    expect(rows[0]?.tenant_id).toBe(TENANT_A);
    expect(rows[0]?.target_id).toBe(TENANT_A);
    expect(rows[0]?.device_kind).toBe('desktop');
    expect(rows[0]?.summary['platformRole']).toBe('PLATFORM_OWNER');
  });
});

describe('② 監査に失敗したらクエリを実行しない（注入テスト。BR-41 / F-055 AC-4）', () => {
  it('🔴 audit_logs の INSERT 権限を外すと、fn は 1 度も呼ばれず操作全体が失敗する', async () => {
    await migrator.$executeRawUnsafe('REVOKE INSERT ON audit_logs FROM app_platform');
    let called = 0;
    try {
      await expect(
        withPlatformRead({ ctx, action: 'admin.monitoring.view', targetTenantId: null }, async (db) => {
          called += 1;
          return db.tenant.count();
        }),
      ).rejects.toThrow();
    } finally {
      await migrator.$executeRawUnsafe('GRANT INSERT ON audit_logs TO app_platform');
    }
    expect(called, 'クエリ（fn）が実行された').toBe(0);
    expect(await auditCount('admin.monitoring.view')).toBe(0);
  });

  it('対照: 権限を戻すと同じ操作が成功し、監査が 1 行残る（注入テストが空振りでない）', async () => {
    const count = await withPlatformRead(
      { ctx, action: 'admin.monitoring.view', targetTenantId: null },
      async (db) => db.tenant.count(),
    );
    expect(count).toBeGreaterThan(0);
    expect(await auditCount('admin.monitoring.view')).toBe(1);
  });
});

describe('③ fn が失敗したら監査もロールバックされる（同一トランザクション。§5.3）', () => {
  it('🔴 クエリが失敗した操作の監査ログは残らない（記録だけが残る経路が無い）', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.usage.view', targetTenantId: null }, async () => {
        throw new Error('意図的な失敗');
      }),
    ).rejects.toThrow('意図的な失敗');
    expect(await auditCount('admin.usage.view')).toBe(0);
  });
});

describe('④ targetTenantId が RLS でクエリを閉じる（docs/05 §5.2）', () => {
  it('🔴 対象テナントを指定した読み取りは、そのテナントの行しか返さない（where に依存しない）', async () => {
    const rows = await withPlatformRead(
      { ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A },
      async (db) => db.engineer.findMany({ select: { id: true, tenantId: true } }),
    );
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    expect(rows.every((row) => row.tenantId === TENANT_A)).toBe(true);
  });

  it('🔴 別テナントを指定すると、先ほどの行が 1 件も現れない', async () => {
    const rows = await withPlatformRead(
      { ctx, action: 'admin.tenant.view', targetTenantId: TENANT_B },
      async (db) => db.engineer.findMany({ select: { id: true, tenantId: true } }),
    );
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    expect(rows.every((row) => row.tenantId === TENANT_B)).toBe(true);
  });

  it('横断（targetTenantId = null）のときだけ複数テナントが見える（F-058 / F-059 の集計）', async () => {
    const tenantIds = await withPlatformRead(
      { ctx, action: 'admin.audit_log.search', targetTenantId: null },
      async (db) => {
        const rows = await db.engineer.findMany({ select: { tenantId: true } });
        return new Set(rows.map((row) => row.tenantId));
      },
    );
    expect(tenantIds.size).toBeGreaterThan(1);
  });
});

describe('⑤⑥ read-only と列マスキング（docs/05 §5.2 / §5.5 / BR-40）', () => {
  it('🔴 型を破っても業務データを書けない（DB 権限で permission denied）', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A }, async (db) => {
        const writable = db.engineer as unknown as {
          updateMany: (args: unknown) => Promise<unknown>;
        };
        return writable.updateMany({ where: {}, data: { availability: 'AVAILABLE' } });
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('🔴 型を破っても業務データを作れない（DB 権限で permission denied）', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A }, async (db) => {
        const writable = db.engineer as unknown as {
          createMany: (args: unknown) => Promise<unknown>;
        };
        return writable.createMany({ data: [{ tenantId: TENANT_A, displayName: 'x' }] });
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('🔴 非開示列（engineers.display_name）を select すると permission denied になる', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A }, async (db) => {
        const delegate = db.engineer as unknown as {
          findMany: (args: unknown) => Promise<unknown>;
        };
        return delegate.findMany({ select: { displayName: true } });
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('🔴 チャット本文（messages.body）も permission denied になる（CLAUDE.md §10.5）', async () => {
    await expect(
      withPlatformRead({ ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A }, async (db) => {
        const delegate = db.message as unknown as {
          findMany: (args: unknown) => Promise<unknown>;
        };
        return delegate.findMany({ select: { body: true } });
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('対照: 開示列だけの読み取りは成功する（上の 2 件が「クエリ全体の失敗」ではない）', async () => {
    const rows = await withPlatformRead(
      { ctx, action: 'admin.tenant.view', targetTenantId: TENANT_A },
      async (db) => db.message.findMany({ select: { id: true, sentAt: true } }),
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('⑦ withPlatformWrite（docs/05 §5.2 / CLAUDE.md §10.5）', () => {
  const NEW_TENANT_ID = '01930000-0000-7000-8000-0000000000f9';

  it('🔴 TENANT_PROVISIONING でテナントを開設でき、監査に domain / before / after が残る', async () => {
    const created = await withPlatformWrite(
      {
        ctx,
        action: 'admin.tenant.create',
        targetTenantId: null,
        domain: 'TENANT_PROVISIONING',
        before: null,
        after: { environment: 'production', lifecycleState: 'ACTIVE' },
      },
      async (db) =>
        db.tenant.create({
          data: {
            id: NEW_TENANT_ID,
            name: 'T-03-08 検証テナント',
            environment: 'production',
            lifecycleState: 'ACTIVE',
            lifecycleChangedAt: new Date(),
            provisioningRequestId: 'req-t-03-08',
          },
          // 🔴 Issue #24 の決定 = 既定値 A。読み戻せるのはこの 2 列だけである。
          select: { id: true, lifecycleState: true },
        }),
    );
    expect(created).toEqual({ id: NEW_TENANT_ID, lifecycleState: 'ACTIVE' });

    const rows = await superuser.$queryRaw<Array<{ summary: Record<string, unknown> }>>`
      SELECT summary FROM audit_logs WHERE action = 'admin.tenant.create'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary['domain']).toBe('TENANT_PROVISIONING');
    expect(rows[0]?.summary['before']).toBeNull();
    expect(String(rows[0]?.summary['after'])).toContain('production');
  });

  it('🔴 読み戻せない列（name）を select すると permission denied になる（行全体に広げていない）', async () => {
    await expect(
      withPlatformWrite(
        {
          ctx,
          action: 'admin.tenant.view',
          targetTenantId: NEW_TENANT_ID,
          domain: 'TENANT_PROVISIONING',
          before: null,
          after: null,
        },
        async (db) => {
          const delegate = db.tenant as unknown as {
            findMany: (args: unknown) => Promise<unknown>;
          };
          return delegate.findMany({ select: { name: true } });
        },
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('🔴 宣言したドメイン以外のモデルには到達できない（§5.2 の「3 枚目」）', async () => {
    await expect(
      withPlatformWrite(
        {
          ctx,
          action: 'admin.tenant.lifecycle_change',
          targetTenantId: TENANT_A,
          domain: 'TENANT_LIFECYCLE',
          before: { lifecycleState: 'ACTIVE' },
          after: { lifecycleState: 'CLOSING' },
        },
        async (db) => {
          const escaped = db as unknown as Record<string, { findMany: () => Promise<unknown> }>;
          return escaped['engineer']?.findMany();
        },
      ),
    ).rejects.toThrow(PlatformWriteDomainViolationError);
  });

  it('🔴 ライフサイクル列は更新できるが、name は列 GRANT が無く更新できない', async () => {
    const updated = await withPlatformWrite(
      {
        ctx,
        action: 'admin.tenant.lifecycle_change',
        targetTenantId: NEW_TENANT_ID,
        domain: 'TENANT_LIFECYCLE',
        before: { lifecycleState: 'ACTIVE' },
        after: { lifecycleState: 'CLOSING' },
      },
      async (db) =>
        db.tenant.updateMany({
          where: { id: NEW_TENANT_ID },
          data: { lifecycleState: 'CLOSING', lifecycleChangedAt: new Date() },
        }),
    );
    expect(updated.count).toBe(1);

    await expect(
      withPlatformWrite(
        {
          ctx,
          action: 'admin.tenant.lifecycle_change',
          targetTenantId: NEW_TENANT_ID,
          domain: 'TENANT_LIFECYCLE',
          before: { name: 'T-03-08 検証テナント' },
          after: { name: '改ざん' },
        },
        async (db) =>
          db.tenant.updateMany({ where: { id: NEW_TENANT_ID }, data: { name: '改ざん' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('⑧ 認証専用ポリシーは管理平面の通常操作で真にならない（docs/05 §5.3 の注記）', () => {
  it('🔴 app.platform_auth_subject_id を空で上書きするため、two_factor_credentials が 0 件になる', async () => {
    const client = createUnextendedClient(database.platformWriteUrl);
    try {
      const rows = await client.$transaction(async (tx) => {
        // withPlatformWrite が発行するのと同じ GUC（platformScopeSql。§5.3）。
        await tx.$queryRaw`SELECT
          set_config('app.platform_user_id', ${PLATFORM_USER_ID}, true),
          set_config('app.target_tenant_id', '', true),
          set_config('app.platform_auth_email', '', true),
          set_config('app.platform_auth_subject_id', '', true)`;
        return tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM two_factor_credentials`;
      });
      expect(Number(rows[0]?.count ?? 0n)).toBe(0);
    } finally {
      await client.$disconnect();
    }
  });

  it('🔴 逆に、認証経路の GUC を立てても provisioning ポリシーは真にならない（app.platform_user_id が空）', async () => {
    const client = createUnextendedClient(database.platformWriteUrl);
    try {
      await expect(
        client.$transaction(async (tx) => {
          // platform-auth.ts が発行するのと同じ GUC（platformAuthScopeSql。§4.4.2）。
          await tx.$queryRaw`SELECT
            set_config('app.platform_user_id', '', true),
            set_config('app.target_tenant_id', '', true),
            set_config('app.platform_auth_email', '', true),
            set_config('app.platform_auth_subject_id', ${PLATFORM_USER_ID}, true)`;
          return tx.$executeRawUnsafe(
            `INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, provisioning_request_id)
             VALUES ('01930000-0000-7000-8000-0000000000fa', 'x', 'production', 'ACTIVE', now(), 'req-x')`,
          );
        }),
      ).rejects.toThrow(/row-level security|policy/i);
    } finally {
      await client.$disconnect();
    }
  });
});
