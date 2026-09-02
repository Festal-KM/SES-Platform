// tests/isolation/double-defense.test.ts
// 🔴 T-01-04（docs/sprints/SP-01-bootstrap.md）/ docs/05 §4.7「二重防御テスト #1〜#3」。
//
// なぜこのテストが要るか（docs/05 §4.1 第 5 防御）:
//   RLS が静かに無効化されても、Prisma 拡張が静かに外れても、アプリは正常に動く。
//   機能テストでは絶対に気づけない。片方を落として他方が 0 件に止めることを直接確かめる
//   このテストだけが検知手段である。CLAUDE.md §7「テナント越境の情報漏洩 0 件」の根拠。
//
// 実行: `pnpm test:isolation`（Docker が要る。既定の `pnpm test:unit` からは分離してある）。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CrossTenantWriteError,
  TenantRelationWriteError,
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  createUnextendedClient,
  readRoleBypassRls,
  readScopeSettings,
  readTableRlsStatus,
  runUnextended,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_B_HOST,
  PARTNER_A1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_B_HOST,
} from './support/fixtures.js';
import {
  BUSINESS_TABLES,
  startIsolationDatabase,
  type IsolationDatabase,
} from './support/postgres.js';

// コンテナ起動 + db push + RLS 適用 + シード。初回は image の取得が入りうる。
const SETUP_TIMEOUT_MS = 600_000;

const SCOPE_A_HOST = { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST };
const SCOPE_A_PARTNER = {
  tenantId: TENANT_A,
  partnerCompanyId: PARTNER_A1,
  actorUserId: USER_A_PARTNER,
};
const SCOPE_B_HOST = { tenantId: TENANT_B, partnerCompanyId: null, actorUserId: USER_B_HOST };

let database: IsolationDatabase;
let unextended: UnextendedClient;
let singleConnection: UnextendedClient;
let ctxAHost: AuthenticatedTenantCtx;
let ctxAPartner: AuthenticatedTenantCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  unextended = createUnextendedClient(database.tenantUrl);
  singleConnection = createUnextendedClient(database.singleConnectionTenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  ctxAHost = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
  ctxAPartner = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await unextended?.$disconnect();
  await singleConnection?.$disconnect();
  await disconnectTenantDb();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('前提: 分離機構そのものが有効であること（対照）', () => {
  it('検証対象の全表で RLS が有効かつ FORCE されている', async () => {
    const status = await readTableRlsStatus(unextended, BUSINESS_TABLES);
    expect(status.map((row) => row.table).sort()).toEqual([...BUSINESS_TABLES].sort());
    for (const row of status) {
      expect(row.rlsEnabled, `${row.table}: RLS 無効`).toBe(true);
      // 🔴 FORCE が無いとテーブル所有者（app_migrator）が RLS を素通りする（docs/05 §4.2）。
      expect(row.rlsForced, `${row.table}: FORCE 無し`).toBe(true);
    }
  });

  it('🔴 app_tenant / app_migrator は BYPASSRLS を持たない', async () => {
    const roles = await readRoleBypassRls(unextended, ['app_tenant', 'app_migrator']);
    expect(roles).toEqual([
      { role: 'app_migrator', bypassRls: false },
      { role: 'app_tenant', bypassRls: false },
    ]);
  });

  it('対照: 素のクライアントでも、自テナントのスコープなら自社の行は取れる（テストが空振りしていない）', async () => {
    const rows = await runUnextended(unextended, SCOPE_A_HOST, (tx) => tx.engineer.findMany());
    expect(rows.map((row) => row.id)).toEqual([ENGINEER_A_HOST]);
  });
});

describe('#1 Prisma 拡張を無効化した素のクライアント（app_tenant）で他テナントの行を取る', () => {
  it('engineers: 他テナントを明示指定しても 0 件（RLS が止める）', async () => {
    const rows = await runUnextended(unextended, SCOPE_A_HOST, (tx) =>
      tx.engineer.findMany({ where: { tenantId: TENANT_B } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('tenants: 他テナントの行は 0 件', async () => {
    const rows = await runUnextended(unextended, SCOPE_A_HOST, (tx) =>
      tx.tenant.findMany({ where: { id: TENANT_B } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('ID 直指定（findUnique）でも他テナントの行は取れない', async () => {
    const row = await runUnextended(unextended, SCOPE_A_HOST, (tx) =>
      tx.engineer.findUnique({ where: { id: ENGINEER_B_HOST } }),
    );
    expect(row).toBeNull();
  });

  it('🔴 件数も漏れない（COUNT が境界適用後の母集団だけを数える）', async () => {
    const total = await runUnextended(unextended, SCOPE_A_HOST, (tx) => tx.engineer.count());
    expect(total).toBe(1);
  });
});

describe('#2 SET LOCAL app.tenant_id を発行せずにクエリする', () => {
  it('app.* が 1 つも設定されていない', async () => {
    const settings = await runUnextended(unextended, null, (tx) => readScopeSettings(tx));
    expect(settings).toEqual({
      tenantId: '',
      partnerCompanyId: '',
      actorUserId: '',
      sharedScope: '',
    });
  });

  it('engineers は 0 件（ポリシー式が NULL になり一致しない）', async () => {
    const rows = await runUnextended(unextended, null, (tx) => tx.engineer.findMany());
    expect(rows).toHaveLength(0);
  });

  it('tenants も 0 件', async () => {
    const rows = await runUnextended(unextended, null, (tx) => tx.tenant.findMany());
    expect(rows).toHaveLength(0);
  });

  it('COUNT も 0 件', async () => {
    const total = await runUnextended(unextended, null, (tx) => tx.engineer.count());
    expect(total).toBe(0);
  });
});

describe('🔴 SET LOCAL がトランザクション外へ漏れない（docs/05 §4.3 規約 1）', () => {
  it('トランザクション内では 4 つの app.* が設定され、shared_scope は off である', async () => {
    const settings = await runUnextended(singleConnection, SCOPE_A_PARTNER, (tx) =>
      readScopeSettings(tx),
    );
    expect(settings).toEqual({
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      actorUserId: USER_A_PARTNER,
      sharedScope: 'off',
    });
  });

  it('同じ物理接続でも、トランザクションを抜けた時点で設定が残っていない', async () => {
    // connection_limit=1 の接続文字列なので、直前のトランザクションと同じ接続が使われる。
    const settings = await readScopeSettings(singleConnection);
    expect(settings).toEqual({
      tenantId: '',
      partnerCompanyId: '',
      actorUserId: '',
      sharedScope: '',
    });
  });

  it('同じ物理接続で別テナントのトランザクションを開くと、前のテナントの行は見えない', async () => {
    const rows = await runUnextended(singleConnection, SCOPE_B_HOST, (tx) =>
      tx.engineer.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ENGINEER_B_HOST]);
  });
});

describe('withTenant（二重防御が両方効いている通常経路）', () => {
  it('ホスト文脈ではホスト所属のエンジニアだけが見える', async () => {
    const rows = await withTenant(ctxAHost, (db) => db.engineer.findMany());
    expect(rows.map((row) => row.id)).toEqual([ENGINEER_A_HOST]);
  });

  it('🔴 パートナー文脈では自社が持ち込んだエンジニアだけが見える（第二境界）', async () => {
    const rows = await withTenant(ctxAPartner, (db) => db.engineer.findMany());
    expect(rows.map((row) => row.id)).toEqual([ENGINEER_A_PARTNER]);
  });

  it('他テナントを明示指定しても 0 件', async () => {
    const rows = await withTenant(ctxAHost, (db) =>
      db.engineer.findMany({ where: { tenantId: TENANT_B } }),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('#3 RLS を一時的に DISABLE した DB で、拡張越しに他テナントを取る', () => {
  beforeAll(async () => {
    await setRowLevelSecurity({
      ownerDatasourceUrl: database.migratorUrl,
      tables: BUSINESS_TABLES,
      enabled: false,
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await setRowLevelSecurity({
      ownerDatasourceUrl: database.migratorUrl,
      tables: BUSINESS_TABLES,
      enabled: true,
    });
  }, SETUP_TIMEOUT_MS);

  it('対照: RLS が確かに落ちている（素のクライアントがスコープ無しで全テナントの行を見る）', async () => {
    const rows = await runUnextended(unextended, null, (tx) => tx.engineer.findMany());
    expect(rows.map((row) => row.id).sort()).toEqual(
      [ENGINEER_A_HOST, ENGINEER_A_PARTNER, ENGINEER_B_HOST].sort(),
    );
  });

  it('他テナントを明示指定しても 0 件（拡張の where が止める）', async () => {
    const rows = await withTenant(ctxAHost, (db) =>
      db.engineer.findMany({ where: { tenantId: TENANT_B } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('ID 直指定（findUnique）でも他テナントの行は取れない', async () => {
    const row = await withTenant(ctxAHost, (db) =>
      db.engineer.findUnique({ where: { id: ENGINEER_B_HOST } }),
    );
    expect(row).toBeNull();
  });

  it('無条件の一覧・COUNT にも他テナントの行が 1 件も混ざらない', async () => {
    const [rows, total] = await withTenant(ctxAHost, async (db) => [
      await db.engineer.findMany(),
      await db.engineer.count(),
    ] as const);
    // 🔴 パートナー境界（C3）は RLS の担当なので、RLS を落とすとテナント A の 2 件が見える。
    //    ここで確認しているのは「テナント境界は拡張だけでも保たれる」ことである。
    expect(rows.map((row) => row.id).sort()).toEqual([ENGINEER_A_HOST, ENGINEER_A_PARTNER].sort());
    expect(total).toBe(2);
  });

  it('🔴 create で他テナントの tenantId を指定すると、静かに書き換えず例外になる', async () => {
    await expect(
      withTenant(ctxAHost, (db) =>
        db.engineer.create({ data: { displayName: 'Injected', tenantId: TENANT_B } }),
      ),
    ).rejects.toThrow(CrossTenantWriteError);

    // 行が 1 件も増えていないこと（RLS は落ちているので、増えていれば拡張が素通ししたということ）。
    const leaked = await runUnextended(unextended, null, (tx) =>
      tx.engineer.findMany({ where: { displayName: 'Injected' } }),
    );
    expect(leaked).toHaveLength(0);
  });

  it('自テナントの create は成立する（対照。上のケースが常に例外なのではない）', async () => {
    const created = await withTenant(ctxAHost, (db) =>
      db.engineer.create({ data: { displayName: 'Created', tenantId: TENANT_A } }),
    );
    try {
      expect(created.tenantId).toBe(TENANT_A);
    } finally {
      await withTenant(ctxAHost, (db) => db.engineer.delete({ where: { id: created.id } }));
    }
  });

  // 🔴 第 2 防御の「書き込み側」。where の注入だけでは、既存行の所属を data で
  //    書き換える攻撃（行の移動）を止められない。RLS を落とした状態で実際に
  //    ENGINEER_A_HOST が tenant_id = TENANT_B へ移動できること、および
  //    ENGINEER_B_HOST が逆リレーション経由で TENANT_A へ奪えること（⑥）が実証されたため、
  //    6 経路すべてを回帰テストとして固定する（docs/05 §4.1 第 2 防御）。
  //    🔴 テナントキー列を書き換えうるネスト write は方向を問わず検査対象である。
  describe('🔴 書き込み data による行の移動（update 系）', () => {
    async function currentTenantIdOf(engineerId: string): Promise<string | undefined> {
      // RLS を落としてある区画なので、スコープ無しの素のクライアントが実体を直接読める。
      const rows = await runUnextended(unextended, null, (tx) =>
        tx.engineer.findMany({ where: { id: engineerId } }),
      );
      return rows[0]?.tenantId;
    }

    afterEach(async () => {
      // 🔴 万一移動していたら次のテストが偽陰性になるため、毎回もとに戻す。
      await runUnextended(unextended, null, async (tx) => {
        await tx.engineer.updateMany({
          where: { id: ENGINEER_A_HOST },
          data: { tenantId: TENANT_A },
        });
        // 逆リレーション経由（⑥）の標的はテナント B の行なので、こちらも戻す。
        await tx.engineer.updateMany({
          where: { id: ENGINEER_B_HOST },
          data: { tenantId: TENANT_B },
        });
      });
    });

    it('① update の data.tenantId で他テナントへ移せない', async () => {
      await expect(
        withTenant(ctxAHost, (db) =>
          db.engineer.update({
            where: { id: ENGINEER_A_HOST },
            data: { tenantId: TENANT_B },
          }),
        ),
      ).rejects.toThrow(CrossTenantWriteError);
      expect(await currentTenantIdOf(ENGINEER_A_HOST)).toBe(TENANT_A);
    });

    it('② updateMany の data.tenantId で他テナントへ移せない', async () => {
      await expect(
        withTenant(ctxAHost, (db) =>
          db.engineer.updateMany({
            where: { id: ENGINEER_A_HOST },
            data: { tenantId: TENANT_B },
          }),
        ),
      ).rejects.toThrow(CrossTenantWriteError);
      expect(await currentTenantIdOf(ENGINEER_A_HOST)).toBe(TENANT_A);
    });

    it('③ upsert の update 分岐の tenantId で他テナントへ移せない', async () => {
      await expect(
        withTenant(ctxAHost, (db) =>
          db.engineer.upsert({
            where: { id: ENGINEER_A_HOST },
            create: { displayName: 'Upserted', tenantId: TENANT_A },
            update: { tenantId: TENANT_B },
          }),
        ),
      ).rejects.toThrow(CrossTenantWriteError);
      expect(await currentTenantIdOf(ENGINEER_A_HOST)).toBe(TENANT_A);
    });

    it('④ update の tenant: { connect } で他テナントへ移せない', async () => {
      await expect(
        withTenant(ctxAHost, (db) =>
          db.engineer.update({
            where: { id: ENGINEER_A_HOST },
            data: { tenant: { connect: { id: TENANT_B } } },
          }),
        ),
      ).rejects.toThrow(TenantRelationWriteError);
      expect(await currentTenantIdOf(ENGINEER_A_HOST)).toBe(TENANT_A);
    });

    it('⑤ update の data.tenantId を { set: ... } 形で渡しても移せない', async () => {
      // Prisma のスカラー更新は素の値と `{ set: value }` の 2 形をとる。
      // 片方だけ検査すると、もう片方が素通しの経路になる。
      await expect(
        withTenant(ctxAHost, (db) =>
          db.engineer.update({
            where: { id: ENGINEER_A_HOST },
            data: { tenantId: { set: TENANT_B } },
          }),
        ),
      ).rejects.toThrow(CrossTenantWriteError);
      expect(await currentTenantIdOf(ENGINEER_A_HOST)).toBe(TENANT_A);
    });

    it('⑥ Tenant.update の逆リレーション engineers: { connect } で他テナントの行を奪えない', async () => {
      // 🔴 子→親（Engineer.tenant）を塞いでも、親→子（Tenant.engineers）から同じ
      //    engineers.tenant_id 列を書ける。テナントキー列を書き換えうるネスト write は
      //    方向を問わず検査対象である（docs/05 §4.1 第 2 防御）。
      await expect(
        withTenant(ctxAHost, (db) =>
          db.tenant.update({
            where: { id: TENANT_A },
            data: { engineers: { connect: { id: ENGINEER_B_HOST } } },
          }),
        ),
      ).rejects.toThrow(TenantRelationWriteError);
      expect(await currentTenantIdOf(ENGINEER_B_HOST)).toBe(TENANT_B);
    });

    it('自テナント内の update は成立する（対照。上の 6 件が常に例外なのではない）', async () => {
      const updated = await withTenant(ctxAHost, (db) =>
        db.engineer.update({
          where: { id: ENGINEER_A_HOST },
          data: { displayName: 'Engineer A-Host (renamed)' },
        }),
      );
      try {
        expect(updated.tenantId).toBe(TENANT_A);
        expect(updated.displayName).toBe('Engineer A-Host (renamed)');
      } finally {
        await withTenant(ctxAHost, (db) =>
          db.engineer.update({
            where: { id: ENGINEER_A_HOST },
            data: { displayName: 'Engineer A-Host' },
          }),
        );
      }
    });
  });
});
