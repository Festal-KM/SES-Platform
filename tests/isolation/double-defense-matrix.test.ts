// tests/isolation/double-defense-matrix.test.ts
// 🔴 T-02-10（docs/sprints/SP-02-schema-isolation.md）: **docs/05 §4.7 の二重防御テスト 10 件**を
//    表の並びどおりに 1 箇所へ置く。CLAUDE.md §7 の「0 件（許容しない）」4 項目
//    （テナント越境 / パートナー間相互参照 / 匿名候補の身元露出 / 経路 5 の越境）の根拠である。
//
// 🔴 なぜ「1 箇所」なのか: 分離の検証は、個別の機能テストに散らすと**何が検証されていないか**が
//    分からなくなる。§4.7 の表と 1 対 1 に並べ、番号で照合できる形にしておくことが、
//    レビューと監査の前提になる。個々の層を深く掘るテスト（rls-classes / route5-counterparty /
//    owner-counterparty-inheritance / double-defense）はそのまま残す。
//
// 🔴 母集団は **`seed:isolation`**（`@ses/db/seed`）が投入する（docs/05 §17.5「DB のフィクスチャは
//    使わない。`packages/db/seed` のプリセットを使う」/ §17.6 globalSetup ④）。
//    固定 SQL のフィクスチャではなく、`packages/domain` の `transition()` を通して状態が
//    進んだ本物の母集団に対して検証する。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CrossTenantWriteError,
  PartnerBaseTableAccessError,
  TenantRelationWriteError,
  configureTenantDb,
  disconnectTenantDb,
  requireHost,
  resolveTenantCtx,
  withHostTenant,
  withPartnerScope,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { ISOLATION_FORBIDDEN_MARKERS, ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import {
  createUnextendedClient,
  hasTablePrivilege,
  readPolicies,
  readPublicBaseTables,
  readScopeSettings,
  runUnextended,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import { BUSINESS_TABLES, startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { ALLOWED_VIEW_COLUMNS } from './support/route5-views.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6「システム時刻を動かさない。now を引数で渡す」）。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');

const [TENANT_1, TENANT_2] = ISOLATION_SEED_IDS.tenants;
const [PARTNER_1, PARTNER_2] = TENANT_1.partners;

const SCOPE_HOST_1 = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  actorUserId: TENANT_1.hostUserId,
};
const SCOPE_PARTNER_1 = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1.partnerCompanyId,
  actorUserId: PARTNER_1.userId,
};
const SCOPE_PARTNER_2 = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_2.partnerCompanyId,
  actorUserId: PARTNER_2.userId,
};

/** 経路 5 の基底表（docs/05 §4.4 C9）。 */
const COUNTERPARTY_TABLES = ['assignments', 'contracts', 'contract_documents', 'orders'] as const;

/** docs/05 §4.3-6 の 5 デリゲート（`TenantDb` から除去済み）。 */
const COUNTERPARTY_DELEGATES = [
  'assignment',
  'contract',
  'contractDocument',
  'order',
  'extensionReview',
] as const;

/** 🔴 CLAUDE.md §3.1 の射程外 4 表（ここを広げることが、このテストが防ぐ壊し方そのものである）。 */
const OUT_OF_SCOPE_TABLES = ['platform_users', 'plans', 'subscriptions', 'skills'];

type LooseDelegate = { findMany: (args?: unknown) => Promise<unknown[]> };

let database: IsolationDatabase;
/** 🔴 検証は `app_tenant`（BYPASSRLS 無し）で行う。投入だけが superuser である。 */
let unextended: UnextendedClient;
let singleConnection: UnextendedClient;
let ctxHost1: AuthenticatedTenantCtx;
let ctxPartner1: AuthenticatedTenantCtx;
let ctxPartner2: AuthenticatedTenantCtx;
let seededCounts: Readonly<Record<string, number>>;

beforeAll(async () => {
  // 🔴 fixtures の固定 SQL は投入しない。母集団は seed:isolation が作る。
  database = await startIsolationDatabase({ seed: 'none' });
  const result = await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });
  seededCounts = result.counts;

  unextended = createUnextendedClient(database.tenantUrl);
  singleConnection = createUnextendedClient(database.singleConnectionTenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  ctxHost1 = await resolveTenantCtx(
    {
      tenantId: TENANT_1.tenantId,
      partnerCompanyId: null,
      userId: TENANT_1.hostUserId,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      twoFactor: 'NOT_ENROLLED',
    },
    { deviceKind: 'api' },
  );
  ctxPartner1 = await resolveTenantCtx(
    {
      tenantId: TENANT_1.tenantId,
      partnerCompanyId: PARTNER_1.partnerCompanyId,
      userId: PARTNER_1.userId,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
      twoFactor: 'NOT_ENROLLED',
    },
    { deviceKind: 'api' },
  );
  ctxPartner2 = await resolveTenantCtx(
    {
      tenantId: TENANT_1.tenantId,
      partnerCompanyId: PARTNER_2.partnerCompanyId,
      userId: PARTNER_2.userId,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
      twoFactor: 'NOT_ENROLLED',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await unextended?.$disconnect();
  await singleConnection?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// 前提: seed:isolation が §4.7 #8〜#10 の母集団を作れている（空振り防止）
// ---------------------------------------------------------------------------

describe('前提: seed:isolation の母集団（CLAUDE.md §5 Phase 0 / docs/05 §13.6）', () => {
  it('2 テナント × 2 パートナーが投入されている', () => {
    expect(seededCounts.tenants).toBe(2);
    expect(seededCounts.partner_companies).toBe(4);
    expect(ISOLATION_SEED_IDS.tenants).toHaveLength(2);
    expect(TENANT_1.partners).toHaveLength(2);
    expect(TENANT_2.partners).toHaveLength(2);
  });

  it('🔴 各パートナーが当事者の Assignment / Contract / Order を 1 件ずつ持つ', async () => {
    requireHost(ctxHost1);
    const rows = await withHostTenant(ctxHost1, async (db) => ({
      assignments: await db.assignment.findMany({ select: { id: true, counterpartyPartnerCompanyId: true, projectId: true } }),
      contracts: await db.contract.findMany({ select: { id: true, counterpartyPartnerCompanyId: true } }),
      orders: await db.order.findMany({ select: { id: true, counterpartyPartnerCompanyId: true } }),
    }));
    for (const partner of TENANT_1.partners) {
      expect(
        rows.assignments.filter((r) => r.counterpartyPartnerCompanyId === partner.partnerCompanyId).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        rows.contracts.filter((r) => r.counterpartyPartnerCompanyId === partner.partnerCompanyId),
      ).toHaveLength(1);
      expect(
        rows.orders.filter((r) => r.counterpartyPartnerCompanyId === partner.partnerCompanyId),
      ).toHaveLength(1);
    }
  });

  it('🔴 同一案件に両社の稼働が置かれている（#8 の母集団）', async () => {
    requireHost(ctxHost1);
    const onPublished = await withHostTenant(ctxHost1, (db) =>
      db.assignment.findMany({
        where: { projectId: TENANT_1.publishedProjectId },
        select: { id: true, counterpartyPartnerCompanyId: true },
      }),
    );
    const counterparties = onPublished.map((row) => row.counterpartyPartnerCompanyId);
    expect(counterparties).toContain(PARTNER_1.partnerCompanyId);
    expect(counterparties).toContain(PARTNER_2.partnerCompanyId);
    expect(counterparties).toContain(null); // 自社エンジニアの稼働
  });

  it('🔴 状態が transition() を通って進んでいる（DRAFT のまま置かれていない）', async () => {
    requireHost(ctxHost1);
    const [proposals, contracts, assignments] = await Promise.all([
      withTenant(ctxHost1, (db) =>
        db.proposal.findMany({ select: { id: true, state: true, approvedAt: true, contentHash: true } }),
      ),
      withHostTenant(ctxHost1, (db) => db.contract.findMany({ select: { state: true, executedAt: true } })),
      withHostTenant(ctxHost1, (db) => db.assignment.findMany({ select: { state: true } })),
    ]);
    // WON まで進んだ提案は、承認記録（approved_at / content_hash）を必ず持っている。
    for (const proposal of proposals.filter((p) => p.state === 'WON')) {
      expect(proposal.approvedAt).not.toBeNull();
      expect(proposal.contentHash).not.toBeNull();
    }
    expect(proposals.map((p) => p.state)).toContain('GATE_FAILED');
    expect(contracts.every((c) => c.state === 'EXECUTED' && c.executedAt !== null)).toBe(true);
    expect(assignments.map((a) => a.state).sort()).toEqual(
      ['ACTIVE', 'ACTIVE', 'ACTIVE', 'EXTENSION_REVIEW'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// #1 Prisma 拡張を無効化した素のクライアント（app_tenant）で他テナントの行を取る
// ---------------------------------------------------------------------------

describe('#1 拡張を無効化した素のクライアントで他テナントの行を取る → 0 件（RLS が止める）', () => {
  it('他テナントを明示指定しても 0 件（engineers / proposals / assignments）', async () => {
    const rows = await runUnextended(unextended, SCOPE_HOST_1, async (tx) => ({
      engineers: await tx.engineer.findMany({ where: { tenantId: TENANT_2.tenantId } }),
      proposals: await tx.proposal.findMany({ where: { tenantId: TENANT_2.tenantId } }),
      assignments: await tx.assignment.findMany({ where: { tenantId: TENANT_2.tenantId } }),
    }));
    expect(rows.engineers).toHaveLength(0);
    expect(rows.proposals).toHaveLength(0);
    expect(rows.assignments).toHaveLength(0);
  });

  it('ID 直指定（findUnique）でも他テナントの行は取れない', async () => {
    const row = await runUnextended(unextended, SCOPE_HOST_1, (tx) =>
      tx.engineer.findUnique({ where: { id: TENANT_2.hostEngineerId } }),
    );
    expect(row).toBeNull();
  });

  it('🔴 件数も漏れない（COUNT が境界適用後の母集団だけを数える。docs/05 §4.8）', async () => {
    const total = await runUnextended(unextended, SCOPE_HOST_1, (tx) => tx.engineer.count());
    // テナント 1 のホスト所属エンジニア 1 名のみ（パートナー所属 2 名は C3 で見えない）。
    expect(total).toBe(1);
  });

  it('対照: 自テナントの行は取れる（テストが空振りしていない）', async () => {
    const rows = await runUnextended(unextended, SCOPE_HOST_1, (tx) => tx.engineer.findMany());
    expect(rows.map((row) => row.id)).toEqual([TENANT_1.hostEngineerId]);
  });
});

// ---------------------------------------------------------------------------
// #2 SET LOCAL app.tenant_id を発行せずにクエリする
// ---------------------------------------------------------------------------

describe('#2 SET LOCAL を発行せずにクエリする → C0 の 4 表を除き 0 件', () => {
  it('app.* が 1 つも設定されていない', async () => {
    const settings = await runUnextended(unextended, null, (tx) => readScopeSettings(tx));
    expect(settings).toEqual({
      tenantId: '',
      partnerCompanyId: '',
      actorUserId: '',
      sharedScope: '',
    });
  });

  it('業務テーブルはすべて 0 件（ポリシー式が NULL になり一致しない）', async () => {
    const rows = await runUnextended(unextended, null, async (tx) => ({
      tenants: await tx.tenant.count(),
      engineers: await tx.engineer.count(),
      proposals: await tx.proposal.count(),
      messages: await tx.message.count(),
      assignments: await tx.assignment.count(),
      contracts: await tx.contract.count(),
    }));
    expect(Object.values(rows).every((count) => count === 0)).toBe(true);
  });

  it('🔴 テナント文脈が無いときだけ真になる表（C0）は 4 表だけである', async () => {
    // 🔴 「テナントキー列の有無」では C0 を判定しない（email_events / impersonation_sessions は
    //    nullable な tenant_id を持つ）。C0 の定義は「ポリシー式が `app_tenant_id() IS NULL` である」
    //    ことであり（docs/05 §4.4 / P-A-12）、テーブル名を列挙せずポリシーのカタログから導出する。
    const policies = (await readPolicies(unextended)).filter((policy) =>
      policy.roles.includes('app_tenant'),
    );
    const tenantPolicyExpressions = new Map<string, string[]>();
    for (const policy of policies) {
      const expressions = [policy.using, policy.withCheck].filter(
        (value): value is string => value !== null,
      );
      tenantPolicyExpressions.set(policy.table, [
        ...(tenantPolicyExpressions.get(policy.table) ?? []),
        ...expressions,
      ]);
    }
    const tables = (await readPublicBaseTables(unextended)).filter(
      (table) => table !== '_prisma_migrations' && !OUT_OF_SCOPE_TABLES.includes(table),
    );
    const systemOnly = tables.filter((table) => {
      const expressions = tenantPolicyExpressions.get(table);
      // app_tenant 向けのポリシーが 1 つも無い（= 権限も無い。impersonation_sessions）か、
      // すべての式が `app_tenant_id() IS NULL`（= テナント文脈があると必ず偽）か。
      if (expressions === undefined) return true;
      return expressions.every((expression) => expression.includes('app_tenant_id() IS NULL'));
    });
    // 🔴 ここが増えることは「テナント文脈を持たない表が増えた」ことであり、分離の前提が変わる
    //    （CLAUDE.md §3.1「新たな例外を作らない」）。
    expect(systemOnly.sort()).toEqual(
      ['email_events', 'impersonation_sessions', 'scheduler_runs', 'webhook_deliveries'].sort(),
    );

    // 🔴 そのうち app_tenant に権限があるのは withSystemScope が触る 3 表だけであり、
    //    impersonation_sessions（代理閲覧の記録）は主平面から到達できない（§4.4.2）。
    const reachable: string[] = [];
    for (const table of systemOnly) {
      const granted = await hasTablePrivilege(unextended, 'app_tenant', table, 'SELECT');
      if (granted) reachable.push(table);
    }
    expect(reachable.sort()).toEqual(['email_events', 'scheduler_runs', 'webhook_deliveries']);
  });

  it('🔴 C0 の 4 表に業務データが 1 行も無い（テナントの行がそこへ漏れていない）', async () => {
    // 🔴 ここだけは superuser で数える。app_tenant からは permission denied で数えられず、
    //    「見えない」と「無い」を区別できないためである（数えるのは行数だけで、内容は読まない）。
    const superuser = createUnextendedClient(database.superuserUrl);
    try {
      for (const table of [
        'scheduler_runs',
        'webhook_deliveries',
        'email_events',
        'impersonation_sessions',
      ]) {
        const rows = await superuser.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*)::bigint AS count FROM ${table}`,
        );
        expect(Number(rows[0]?.count ?? 0n), `${table}: 業務データが入っている`).toBe(0);
      }
    } finally {
      await superuser.$disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// #3 RLS を DISABLE した DB で、拡張越しに他テナントを取る
// ---------------------------------------------------------------------------

describe('#3 RLS を落として拡張越しに他テナントを取る → 0 件（拡張の where が止める）', () => {
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

  it('対照: RLS が確かに落ちている（素のクライアントが全テナントの行を見る）', async () => {
    const rows = await runUnextended(unextended, null, (tx) => tx.engineer.findMany());
    // 2 テナント × 3 名（ホスト 1 + パートナー 2 社）。
    expect(rows).toHaveLength(6);
  });

  it('他テナントを明示指定しても 0 件 / ID 直指定でも取れない', async () => {
    const rows = await withTenant(ctxHost1, (db) =>
      db.engineer.findMany({ where: { tenantId: TENANT_2.tenantId } }),
    );
    expect(rows).toHaveLength(0);
    const row = await withTenant(ctxHost1, (db) =>
      db.engineer.findUnique({ where: { id: TENANT_2.hostEngineerId } }),
    );
    expect(row).toBeNull();
  });

  it('無条件の一覧・COUNT にも他テナントの行が 1 件も混ざらない', async () => {
    const [rows, total] = await withTenant(ctxHost1, async (db) => [
      await db.engineer.findMany(),
      await db.engineer.count(),
    ] as const);
    // 🔴 パートナー境界（C3）は RLS の担当なので、RLS を落とすと自テナントの 3 名が見える。
    //    ここで確かめているのは「テナント境界は拡張だけでも保たれる」ことである。
    expect(rows.every((row) => row.tenantId === TENANT_1.tenantId)).toBe(true);
    expect(total).toBe(3);
  });

  it('🔴 書き込み data による行の移動（6 経路）がすべて例外になる', async () => {
    const currentTenantOf = async (engineerId: string): Promise<string | undefined> => {
      const rows = await runUnextended(unextended, null, (tx) =>
        tx.engineer.findMany({ where: { id: engineerId } }),
      );
      return rows[0]?.tenantId;
    };

    // ① update の data.tenantId
    await expect(
      withTenant(ctxHost1, (db) =>
        db.engineer.update({
          where: { id: TENANT_1.hostEngineerId },
          data: { tenantId: TENANT_2.tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
    // ② updateMany の data.tenantId
    await expect(
      withTenant(ctxHost1, (db) =>
        db.engineer.updateMany({
          where: { id: TENANT_1.hostEngineerId },
          data: { tenantId: TENANT_2.tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
    // ③ upsert（update 分岐）
    await expect(
      withTenant(ctxHost1, (db) =>
        db.engineer.upsert({
          where: { id: TENANT_1.hostEngineerId },
          create: { displayName: '偽装', tenantId: TENANT_1.tenantId },
          update: { tenantId: TENANT_2.tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
    // ④ 順方向のリレーション（tenant: { connect }）
    await expect(
      withTenant(ctxHost1, (db) =>
        db.engineer.update({
          where: { id: TENANT_1.hostEngineerId },
          data: { tenant: { connect: { id: TENANT_2.tenantId } } },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantRelationWriteError);
    // ⑤ { set: … } 形（Prisma のスカラー更新は 2 形をとる）
    await expect(
      withTenant(ctxHost1, (db) =>
        db.engineer.update({
          where: { id: TENANT_1.hostEngineerId },
          data: { tenantId: { set: TENANT_2.tenantId } },
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
    // ⑥ 逆リレーション（他テナントの行を自テナントへ引き寄せる）
    await expect(
      withTenant(ctxHost1, (db) =>
        db.tenant.update({
          where: { id: TENANT_1.tenantId },
          data: { engineers: { connect: { id: TENANT_2.hostEngineerId } } },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantRelationWriteError);

    // 🔴 1 行も移動していない（RLS は落ちているので、移動していれば拡張が素通ししたということ）。
    expect(await currentTenantOf(TENANT_1.hostEngineerId)).toBe(TENANT_1.tenantId);
    expect(await currentTenantOf(TENANT_2.hostEngineerId)).toBe(TENANT_2.tenantId);
  });

  it('🔴 create で他テナントの tenantId を指定しても、静かに書き換えず例外になる', async () => {
    await expect(
      withTenant(ctxHost1, (db) =>
        db.engineer.create({ data: { displayName: '偽装', tenantId: TENANT_2.tenantId } }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
    const leaked = await runUnextended(unextended, null, (tx) =>
      tx.engineer.findMany({ where: { displayName: '偽装' } }),
    );
    expect(leaked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #3b ネスト create で他テナント tenantId を注入する（RLS の WITH CHECK が唯一の防御）
// ---------------------------------------------------------------------------
//
// 🔴 SP-02 T-01-04 からの申し送り（code-reviewer 指定、2026-09-02。
//    docs/sprints/SP-02-schema-isolation.md:159）: 対向 FK がテナントキーでない子リレーション
//    （`Project.requirements` → `project_requirements.project_id`。子は自分の `tenant_id` 列を持つ）
//    への nested create は、拡張の `$allOperations` フックには `project.update` としてしか見えず、
//    `data.requirements.create.tenantId` は検査されない（`packages/db/src/extension.ts` の
//    known-gap コメント。DMMF の逆方向走査も対向 FK が `project_id` であるため検知しない）。
//    ここでの唯一の防御線は RLS の `WITH CHECK`（`project_requirements_c2_insert`）である。
describe('#3b ネスト create で他テナント tenantId を注入する → RLS の WITH CHECK が拒否する', () => {
  const FORGED_FREE_TEXT = '偽装-nested-create-probe';
  const NESTED_TABLE = 'project_requirements';

  const nestedForgedUpdate = () =>
    withTenant(ctxHost1, (db) =>
      db.project.update({
        where: { id: TENANT_1.publishedProjectId },
        data: {
          requirements: {
            create: { tenantId: TENANT_2.tenantId, kind: 'MUST', freeText: FORGED_FREE_TEXT },
          },
        },
      }),
    );

  it('🔴 対照: RLS を DISABLE すると、拡張だけではこの経路を止められず注入が成立する（known-gap の実証）', async () => {
    await setRowLevelSecurity({
      ownerDatasourceUrl: database.migratorUrl,
      tables: [NESTED_TABLE],
      enabled: false,
    });
    try {
      await nestedForgedUpdate();
      // 🔴 拡張はネスト create の tenantId を検査しない。RLS が落ちていると、
      //    他テナントの tenantId を持つ行が実際に作られてしまう。
      const rows = await runUnextended(unextended, null, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
          `SELECT tenant_id FROM ${NESTED_TABLE} WHERE free_text = $1`,
          FORGED_FREE_TEXT,
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_2.tenantId);
    } finally {
      // 実証で作った偽装行を、次のテスト（0 件の検証）が拾わないよう必ず消す。
      await runUnextended(unextended, null, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM ${NESTED_TABLE} WHERE free_text = $1`, FORGED_FREE_TEXT),
      );
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [NESTED_TABLE],
        enabled: true,
      });
    }
  }, SETUP_TIMEOUT_MS);

  it('RLS が有効な状態（既定）では、同じネスト create が WITH CHECK 違反で拒否される', async () => {
    await expect(nestedForgedUpdate()).rejects.toThrow(/row-level security/i);
  });

  it('🔴 拒否されたあと、素のクライアント（superuser。RLS を素通りする）で読んでも偽装行が 1 行も無い', async () => {
    // 🔴 ここは superuser で数える（#2 の「C0 の 4 表に業務データが 1 行も無い」と同じ理由）。
    //    app_tenant で数えるとテナント文脈次第で 0 件になり、「見えない」と「無い」を区別できない。
    const superuser = createUnextendedClient(database.superuserUrl);
    try {
      const rows = await superuser.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM ${NESTED_TABLE} WHERE free_text = $1`,
        FORGED_FREE_TEXT,
      );
      expect(Number(rows[0]?.count ?? 0n)).toBe(0);
    } finally {
      await superuser.$disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// #4 パートナー文脈で他パートナーの Engineer / Proposal / Message / 匿名候補を取る
// ---------------------------------------------------------------------------

describe('#4 パートナー文脈で他パートナーのものを取る → 0 件（C3 / C5 / C6）', () => {
  it('Engineer: 自社が持ち込んだ 1 名だけ（他社のエンジニアは ID 直指定でも取れない）', async () => {
    const result = await withTenant(ctxPartner1, async (db) => ({
      rows: await db.engineer.findMany(),
      total: await db.engineer.count(),
      direct: await db.engineer.findUnique({ where: { id: PARTNER_2.engineerId } }),
      host: await db.engineer.findUnique({ where: { id: TENANT_1.hostEngineerId } }),
    }));
    expect(result.rows.map((row) => row.id)).toEqual([PARTNER_1.engineerId]);
    expect(result.total).toBe(1);
    expect(result.direct).toBeNull();
    expect(result.host).toBeNull();
  });

  it('Proposal: 自社の提案だけ（他社の提案は存在も件数も見えない）', async () => {
    const result = await withTenant(ctxPartner1, async (db) => ({
      rows: await db.proposal.findMany({ select: { id: true, ownerPartnerCompanyId: true } }),
      total: await db.proposal.count(),
      direct: await db.proposal.findUnique({ where: { id: PARTNER_2.wonProposalId } }),
    }));
    expect(result.rows.every((row) => row.ownerPartnerCompanyId === PARTNER_1.partnerCompanyId)).toBe(
      true,
    );
    expect(result.rows.map((row) => row.id).sort()).toEqual(
      [PARTNER_1.wonProposalId, PARTNER_1.gateFailedProposalId, TENANT_1.privateProposalId].sort(),
    );
    expect(result.total).toBe(3);
    expect(result.direct).toBeNull();
  });

  it('Message: 参加しているスレッドの本文だけ（他社スレッドの本文は 0 件）', async () => {
    const result = await withTenant(ctxPartner1, async (db) => ({
      rows: await db.message.findMany({ select: { id: true, threadId: true, body: true } }),
      threads: await db.chatThread.findMany({ select: { id: true } }),
      direct: await db.message.findUnique({ where: { id: PARTNER_2.partnerMessageId } }),
    }));
    expect(result.threads.map((row) => row.id)).toEqual([PARTNER_1.threadId]);
    expect(result.rows.every((row) => row.threadId === PARTNER_1.threadId)).toBe(true);
    expect(result.direct).toBeNull();
    // 🔴 他社の本文が 1 文字も混ざらない。
    const serialized = JSON.stringify(result.rows);
    expect(serialized).not.toContain(`${ISOLATION_FORBIDDEN_MARKERS.messageBody}-p2`);
  });

  it('🔴 匿名候補（MatchCandidate）はパートナーから 1 件も見えない（C2。ホストの生成物）', async () => {
    const result = await withTenant(ctxPartner1, async (db) => ({
      rows: await db.matchCandidate.findMany(),
      total: await db.matchCandidate.count(),
      direct: await db.matchCandidate.findUnique({ where: { id: PARTNER_2.matchCandidateId } }),
    }));
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.direct).toBeNull();
  });

  it('🔴 他社の匿名共有（EngineerShare）の存在も見えない', async () => {
    const rows = await withTenant(ctxPartner1, (db) =>
      db.engineerShare.findMany({ select: { id: true, partnerCompanyId: true } }),
    );
    expect(rows.map((row) => row.id)).toEqual([PARTNER_1.engineerShareId]);
  });

  it('対照: 2 社目のパートナーからも 1 社目のものが 1 件も見えない（対称であること）', async () => {
    const result = await withTenant(ctxPartner2, async (db) => ({
      engineers: await db.engineer.findMany({ select: { id: true } }),
      proposals: await db.proposal.count(),
      messages: await db.message.findMany({ select: { threadId: true } }),
    }));
    expect(result.engineers.map((row) => row.id)).toEqual([PARTNER_2.engineerId]);
    expect(result.proposals).toBe(2); // 自社の提案 2 件（won / gate_failed）だけ
    expect(result.messages.every((row) => row.threadId === PARTNER_2.threadId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #5 ホスト文脈で他パートナーの Engineer を取る（C3。BR-06）
// ---------------------------------------------------------------------------

describe('#5 ホスト文脈で他パートナーの Engineer を取る → 0 件（C3 / BR-06）', () => {
  it('ホストに見えるのは自社所属のエンジニアだけ（取引先の台帳全体は読めない）', async () => {
    const result = await withTenant(ctxHost1, async (db) => ({
      rows: await db.engineer.findMany({ select: { id: true } }),
      total: await db.engineer.count(),
      direct1: await db.engineer.findUnique({ where: { id: PARTNER_1.engineerId } }),
      direct2: await db.engineer.findUnique({ where: { id: PARTNER_2.engineerId } }),
    }));
    expect(result.rows.map((row) => row.id)).toEqual([TENANT_1.hostEngineerId]);
    expect(result.total).toBe(1);
    expect(result.direct1).toBeNull();
    expect(result.direct2).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #6 withSharedCandidateScope の外で app.shared_scope を立てる
// ---------------------------------------------------------------------------

describe('#6 共有スコープを外から立てても、withTenant が毎回 off で上書きする', () => {
  // 🔴 このテストの静的側（`$executeRaw` の呼び出しを ESLint が禁止し、
  //    `withSharedCandidateScope` 以外から共有スコープを立てるコードが書けないこと）は
  //    tests/static/db-raw-access.test.ts ④ が担保する。ここでは実行時の上書きを確かめる。
  //    🔴 `runUnextended` が発行する設定 SQL は `withTenant` と**同一の実装**
  //    （`packages/db/src/scope-settings.ts` の `tenantScopeSettingsSql`）であり、
  //    書き分けは存在しない。`withTenant` は自前の接続プールを持つため、
  //    「セッションに残った GUC」を仕込むにはこの経路でしか観測できない。
  it('セッションに残った app.shared_scope=on が、次の withTenant 相当の文脈で off になる', async () => {
    // connection_limit=1 の接続なので、以降のトランザクションも同じ物理接続を使う。
    await singleConnection.$executeRawUnsafe(`SET app.shared_scope = 'on'`);
    const before = await readScopeSettings(singleConnection);
    expect(before.sharedScope).toBe('on'); // 空振り防止（本当に立っている）

    const inside = await runUnextended(singleConnection, SCOPE_HOST_1, (tx) =>
      readScopeSettings(tx),
    );
    // 🔴 withTenant が発行する SET LOCAL は毎回 'off' で上書きする（docs/05 §4.3）。
    expect(inside.sharedScope).toBe('off');

    await singleConnection.$executeRawUnsafe(`RESET app.shared_scope`);
  });
});

// ---------------------------------------------------------------------------
// #7 ホスト文脈で app.shared_scope='on' のうえ engineer_shares を直接 SELECT
// ---------------------------------------------------------------------------

describe('#7 ホスト文脈で共有スコープを立てて engineer_shares を直接読む → 0 件', () => {
  it('共有スコープが on でも、ホストからは engineer_shares の行が 1 件も見えない（C3 / BR-56）', async () => {
    const result = await runUnextended(unextended, SCOPE_HOST_1, async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.shared_scope', 'on', true)`);
      return {
        settings: await readScopeSettings(tx),
        shares: await tx.engineerShare.findMany(),
        total: await tx.engineerShare.count(),
        direct: await tx.engineerShare.findUnique({ where: { id: PARTNER_1.engineerShareId } }),
      };
    });
    expect(result.settings.sharedScope).toBe('on'); // 空振り防止
    // 🔴 存在判定は app_engineer_is_shared() の真偽値でしか得られない（§4.5）。
    //    共有元（partner_company_id / shared_by）がホストに見えると BR-06 に抵触する。
    expect(result.shares).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.direct).toBeNull();
  });

  it('対照: 共有元のパートナーからは自社の行が見える（0 件が「行が無い」からではない）', async () => {
    const shares = await runUnextended(unextended, SCOPE_PARTNER_1, (tx) =>
      tx.engineerShare.findMany({ select: { id: true } }),
    );
    expect(shares.map((row) => row.id)).toEqual([PARTNER_1.engineerShareId]);
  });
});

// ---------------------------------------------------------------------------
// #8 パートナー文脈で他社が当事者の 4 表を取る（一覧 / COUNT / ID 直指定 / ビュー越し）
// ---------------------------------------------------------------------------

describe('#8 他社が当事者のレコードは、どの取り方でも 0 件（C9。件数も推測不可）', () => {
  it('基底表（素のクライアント）: 自社が当事者の行だけが返る', async () => {
    const rows = await runUnextended(unextended, SCOPE_PARTNER_1, async (tx) => ({
      assignments: await tx.assignment.findMany({ select: { id: true } }),
      contracts: await tx.contract.findMany({ select: { id: true } }),
      documents: await tx.contractDocument.findMany({ select: { id: true } }),
      orders: await tx.order.findMany({ select: { id: true } }),
    }));
    expect(rows.assignments.map((r) => r.id).sort()).toEqual(
      [PARTNER_1.assignmentId, TENANT_1.privateAssignmentId].sort(),
    );
    expect(rows.contracts.map((r) => r.id)).toEqual([PARTNER_1.contractId]);
    // 🔴 署名済みの最終版のみ（未署名のドラフト版は行として存在しない。F-066 AC-2）。
    expect(rows.documents.map((r) => r.id)).toEqual([PARTNER_1.signedDocumentId]);
    expect(rows.orders.map((r) => r.id)).toEqual([PARTNER_1.orderId]);
  });

  it('対照: 2 社目のパートナーからも 1 社目の当事者レコードが 1 件も見えない（対称であること）', async () => {
    const rows = await runUnextended(unextended, SCOPE_PARTNER_2, async (tx) => ({
      assignments: await tx.assignment.findMany({ select: { id: true } }),
      contracts: await tx.contract.findMany({ select: { id: true } }),
      orders: await tx.order.findMany({ select: { id: true } }),
    }));
    expect(rows.assignments.map((r) => r.id)).toEqual([PARTNER_2.assignmentId]);
    expect(rows.contracts.map((r) => r.id)).toEqual([PARTNER_2.contractId]);
    expect(rows.orders.map((r) => r.id)).toEqual([PARTNER_2.orderId]);
  });

  it('ID 直指定でも他社が当事者の行は 0 件（404 相当。docs/05 §4.8）', async () => {
    const rows = await runUnextended(unextended, SCOPE_PARTNER_1, async (tx) => ({
      assignment: await tx.assignment.findUnique({ where: { id: PARTNER_2.assignmentId } }),
      contract: await tx.contract.findUnique({ where: { id: PARTNER_2.contractId } }),
      document: await tx.contractDocument.findUnique({ where: { id: PARTNER_2.signedDocumentId } }),
      order: await tx.order.findUnique({ where: { id: PARTNER_2.orderId } }),
      hostAssignment: await tx.assignment.findUnique({ where: { id: TENANT_1.hostAssignmentId } }),
      hostContract: await tx.contract.findUnique({ where: { id: TENANT_1.hostContractId } }),
    }));
    expect(Object.values(rows).every((row) => row === null)).toBe(true);
  });

  it('🔴 COUNT も自社分だけ（同一案件に他社の稼働があっても total が変わらない）', async () => {
    const partner1 = await withPartnerScope(ctxPartner1, {}, async (db) => ({
      assignments: await db.partnerAssignmentsV.count(),
      contracts: await db.partnerContractsV.count(),
      documents: await db.partnerContractDocumentsV.count(),
      orders: await db.partnerOrdersV.count(),
    }));
    const partner2 = await withPartnerScope(ctxPartner2, {}, async (db) => ({
      assignments: await db.partnerAssignmentsV.count(),
      contracts: await db.partnerContractsV.count(),
      documents: await db.partnerContractDocumentsV.count(),
      orders: await db.partnerOrdersV.count(),
    }));
    expect(partner1).toEqual({ assignments: 2, contracts: 1, documents: 1, orders: 1 });
    expect(partner2).toEqual({ assignments: 1, contracts: 1, documents: 1, orders: 1 });

    // 対照: ホストからは同じ案件に 3 件の稼働（自社 + 両パートナー）が見えている。
    requireHost(ctxHost1);
    const hostTotal = await withHostTenant(ctxHost1, (db) =>
      db.assignment.count({ where: { projectId: TENANT_1.publishedProjectId } }),
    );
    expect(hostTotal).toBe(3);
  });

  it('ビュー越し（withPartnerScope）: 他社の行 ID が 1 つも現れない', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, async (db) => ({
      assignments: await db.partnerAssignmentsV.findMany(),
      contracts: await db.partnerContractsV.findMany(),
      documents: await db.partnerContractDocumentsV.findMany(),
      orders: await db.partnerOrdersV.findMany(),
    }));
    const serialized = JSON.stringify(rows, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const forbiddenId of [
      PARTNER_2.assignmentId,
      PARTNER_2.contractId,
      PARTNER_2.signedDocumentId,
      PARTNER_2.orderId,
      TENANT_1.hostAssignmentId,
      TENANT_1.hostContractId,
      PARTNER_1.draftDocumentId,
      TENANT_1.extensionReviewId,
    ]) {
      expect(serialized).not.toContain(forbiddenId);
    }
    expect(
      rows.assignments.every(
        (row) => row.counterpartyPartnerCompanyId === PARTNER_1.partnerCompanyId,
      ),
    ).toBe(true);
  });

  it('🔴 他テナントのパートナー文脈からも、このテナントの当事者レコードは 0 件', async () => {
    const rows = await runUnextended(
      unextended,
      {
        tenantId: TENANT_2.tenantId,
        partnerCompanyId: TENANT_2.partners[0].partnerCompanyId,
        actorUserId: TENANT_2.partners[0].userId,
      },
      async (tx) => ({
        assignments: await tx.assignment.findMany({ where: { tenantId: TENANT_1.tenantId } }),
        contracts: await tx.contract.findMany({ where: { tenantId: TENANT_1.tenantId } }),
      }),
    );
    expect(rows.assignments).toHaveLength(0);
    expect(rows.contracts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #9 基底表の SELECT * はコンパイルエラー + 実行時 throw / ビューに禁止列が無い
// ---------------------------------------------------------------------------

describe('#9 基底表へは到達できず、ビューの応答に商流・ホスト内部の値が無い', () => {
  it('🔴 TenantDb には経路 5 の 5 デリゲートが無い（参照するとコンパイルエラーになる）', async () => {
    // 🔴 `@ts-expect-error` は「その行にエラーが**出ること**」を要求する。したがってこの
    //    テストは、5 デリゲートが `TenantDb` の型に戻された瞬間に `tsc` が落ちる装置である
    //    （docs/05 §4.3-6「型で到達不能にする」）。実行時には delegate 自体は存在するため、
    //    それだけでは足りない —— だから次のテスト（実行時の throw）と対にする。
    await withTenant(ctxPartner1, async (db) => {
      // @ts-expect-error docs/05 §4.3-6: assignment デリゲートは TenantDb の型に存在しない
      const assignment: unknown = db.assignment;
      // @ts-expect-error docs/05 §4.3-6: contract デリゲートは TenantDb の型に存在しない
      const contract: unknown = db.contract;
      // @ts-expect-error docs/05 §4.3-6: contractDocument デリゲートは TenantDb の型に存在しない
      const contractDocument: unknown = db.contractDocument;
      // @ts-expect-error docs/05 §4.3-6: order デリゲートは TenantDb の型に存在しない
      const order: unknown = db.order;
      // @ts-expect-error docs/05 §4.3-6: extensionReview デリゲートは TenantDb の型に存在しない
      const extensionReview: unknown = db.extensionReview;
      return [assignment, contract, contractDocument, order, extensionReview];
    });
  });

  it.each(COUNTERPARTY_DELEGATES)(
    '%s: 型を迂回して呼ぶと PartnerBaseTableAccessError（0 件ではなく例外）',
    async (delegate) => {
      await expect(
        withTenant(ctxPartner1, async (db) => {
          const loose = (db as unknown as Record<string, LooseDelegate>)[delegate];
          return loose.findMany();
        }),
      ).rejects.toBeInstanceOf(PartnerBaseTableAccessError);
    },
  );

  it('🔴 ビューの応答に unit_price（ホスト販売）/ internal_unit_price / end_client_name / summary / facts / note が無い', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, async (db) => ({
      partner_assignments_v: await db.partnerAssignmentsV.findMany(),
      partner_contracts_v: await db.partnerContractsV.findMany(),
      partner_contract_documents_v: await db.partnerContractDocumentsV.findMany(),
      partner_orders_v: await db.partnerOrdersV.findMany(),
    }));

    // ① 応答のキー集合が §4.9 の許可列と 1 対 1（列が増えたら落ちる）。
    const toCamel = (value: string): string =>
      value.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
    for (const [view, allowed] of Object.entries(ALLOWED_VIEW_COLUMNS)) {
      const viewRows = rows[view as keyof typeof rows];
      expect(viewRows.length, `${view}: 空振り（行が 0 件）`).toBeGreaterThan(0);
      for (const row of viewRows) {
        expect(Object.keys(row as object).sort()).toEqual(allowed.map(toCamel).sort());
      }
    }

    // ② 禁止された値が 1 つも現れない（商流・ホスト内部の値）。
    const serialized = JSON.stringify(rows, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.endClientName);
    expect(serialized).not.toContain(String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice));
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.contractPaymentTerms);
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.contractDocumentObjectKey);
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.extensionReviewFacts);
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.extensionReviewSummary);
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.proposalBody);

    // ③ 見えてよい値は見えている（空振り防止）。自社との契約単価は BR-66 の許可項目。
    expect(serialized).toContain('650000');
  });

  it('🔴 ホスト内部の延長検討（ExtensionReview）はパートナーからどの経路でも見えない（BR-67）', async () => {
    const rows = await runUnextended(unextended, SCOPE_PARTNER_1, async (tx) => ({
      list: await tx.extensionReview.findMany(),
      total: await tx.extensionReview.count(),
      direct: await tx.extensionReview.findUnique({ where: { id: TENANT_1.extensionReviewId } }),
    }));
    expect(rows.list).toHaveLength(0);
    expect(rows.total).toBe(0);
    expect(rows.direct).toBeNull();

    // 対照: ホストからは見える（0 件が「行が無い」からではない）。
    requireHost(ctxHost1);
    const hostRows = await withHostTenant(ctxHost1, (db) => db.extensionReview.count());
    expect(hostRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #10 パートナー文脈で経路 5 の 4 表に INSERT / UPDATE / DELETE
// ---------------------------------------------------------------------------

describe('#10 経路 5 の 4 表への書き込みは 0 件更新（C9 に書込ポリシーが無い。BR-68）', () => {
  it.each(COUNTERPARTY_TABLES)('%s: パートナー文脈の UPDATE / DELETE は 0 件', async (table) => {
    const affected = await runUnextended(unextended, SCOPE_PARTNER_1, async (tx) => ({
      updated: await tx.$executeRawUnsafe(
        `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1::uuid`,
        TENANT_1.tenantId,
      ),
      deleted: await tx.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE tenant_id = $1::uuid`,
        TENANT_1.tenantId,
      ),
    }));
    expect(affected.updated).toBe(0);
    expect(affected.deleted).toBe(0);
  });

  it('🔴 パートナー文脈の INSERT は WITH CHECK で拒否される（0 件ではなく違反として落ちる）', async () => {
    await expect(
      runUnextended(unextended, SCOPE_PARTNER_1, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO contracts (id, tenant_id, kind, state, counterparty_name, counterparty_partner_company_id)
           VALUES (gen_random_uuid(), $1::uuid, 'INDIVIDUAL', 'DRAFT', 'forged', $2::uuid)`,
          TENANT_1.tenantId,
          PARTNER_1.partnerCompanyId,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('🔴 書き込みを試みたあとも母集団が変わっていない', async () => {
    requireHost(ctxHost1);
    const counts = await withHostTenant(ctxHost1, async (db) => ({
      assignments: await db.assignment.count(),
      contracts: await db.contract.count(),
      documents: await db.contractDocument.count(),
      orders: await db.order.count(),
    }));
    expect(counts).toEqual({ assignments: 4, contracts: 3, documents: 4, orders: 2 });
  });

  it('対照: ホスト文脈なら同じ UPDATE が行を更新する（0 件が「行が無い」からではない）', async () => {
    const updated = await runUnextended(unextended, SCOPE_HOST_1, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE assignments SET state = state WHERE tenant_id = $1::uuid`,
        TENANT_1.tenantId,
      ),
    );
    expect(updated).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// seed:isolation の冪等性（docs/05 §13.6 / F-053 AC-2）
// ---------------------------------------------------------------------------

describe('🔴 seed:isolation は reset() → seed() で冪等に再生成できる（F-053 AC-2）', () => {
  it('同じ引数で再実行すると、行数も ID も同じになる', async () => {
    const before = await runUnextended(unextended, SCOPE_HOST_1, (tx) =>
      tx.proposal.findMany({ select: { id: true, state: true }, orderBy: { id: 'asc' } }),
    );

    const rerun = await runSeed({
      appEnv: 'development',
      databaseUrl: database.superuserUrl,
      preset: 'isolation',
      reset: true,
      now: NOW,
    });
    expect(rerun.counts).toEqual(seededCounts);

    const after = await runUnextended(unextended, SCOPE_HOST_1, (tx) =>
      tx.proposal.findMany({ select: { id: true, state: true }, orderBy: { id: 'asc' } }),
    );
    expect(after).toEqual(before);
  }, SETUP_TIMEOUT_MS);

  it('🔴 reset を挟まない再実行は一意制約で失敗する（黙って二重投入されない）', async () => {
    await expect(
      runSeed({
        appEnv: 'development',
        databaseUrl: database.superuserUrl,
        preset: 'isolation',
        reset: false,
        now: NOW,
      }),
    ).rejects.toThrow();
    // 失敗しても母集団は壊れていない（テナントは 2 件のまま）。
    const tenants = await runUnextended(unextended, SCOPE_HOST_1, (tx) => tx.tenant.count());
    expect(tenants).toBe(1); // 自テナントの 1 行だけが見える（C1）
  }, SETUP_TIMEOUT_MS);

  it('🔴 reset は対象テナントの業務データを消す（前の商談のデータが残らない）', async () => {
    const result = await runSeed({
      appEnv: 'development',
      databaseUrl: database.superuserUrl,
      preset: 'isolation',
      reset: true,
      now: NOW,
    });
    expect(result.counts).toEqual(seededCounts);
  }, SETUP_TIMEOUT_MS);
});
