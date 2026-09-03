// tests/isolation/route5-counterparty.test.ts
// T-02-07（docs/sprints/SP-02-schema-isolation.md）: 越境経路 5（当事者レコードの参照）の
// **C9 COUNTERPARTY_READ と射影ビュー 4 本**を、正負の経路で実証する
// （docs/05 §4.4 C9 / §4.9 / §4.7 #8〜#10 / CLAUDE.md §3.1-5 / BR-65〜BR-69）。
//
// 🔴 経路 5 は人間が承認して追加した越境経路（Issue #8）である。設計の要は
//    「**行**は RLS の C9 が絞り、**列**は DB のビューが絞る」ことであり、
//    アプリの `select` の書き分け・取得後のフィルタには一切頼らない。
//    したがって検証も「アプリを通した結果」ではなく **DB の実挙動とカタログ**で行う。
//
// 🔴 本ファイルは T-02-07 の範囲（C9 / ビュー / PartnerScopeDb）の最小実証である。
//    カタログ走査 13 本は T-02-09、二重防御 10 件と seed:isolation は T-02-10 が担当する。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PartnerBaseTableAccessError,
  configureTenantDb,
  disconnectTenantDb,
  requireHost,
  resolveTenantCtx,
  withHostTenant,
  withPartnerScope,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  createUnextendedClient,
  hasTablePrivilege,
  readPolicies,
  readTableColumns,
  runUnextended,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ASSIGNMENT_A_HOST,
  ASSIGNMENT_A_P1_PRIVATE,
  ASSIGNMENT_A_P1_PUBLISHED,
  ASSIGNMENT_A_P2,
  CONTRACT_A_HOST,
  CONTRACT_A_P1,
  CONTRACT_A_P2,
  CONTRACT_DOC_A_P1_DRAFT,
  CONTRACT_DOC_A_P1_SIGNED,
  CONTRACT_DOC_A_P2_SIGNED,
  EXTENSION_REVIEW_A_P1,
  FORBIDDEN_MARKERS,
  ORDER_A_P1,
  ORDER_A_P2,
  PARTNER_A1,
  PARTNER_A2,
  TENANT_A,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
// 🔴 T-02-09 申し送り 2: 許可列の一覧は tests/isolation/support/route5-views.ts に単一出所化した
//    （route5-counterparty.test.ts と rls-enforced.test.ts の両方が同じ期待値を実測する）。
import { ALLOWED_VIEW_COLUMNS, ALLOWED_VIEW_DEPENDENCY_TABLES, VIEW_NAMES } from './support/route5-views.js';

const SETUP_TIMEOUT_MS = 600_000;

const SCOPE_HOST_A = { tenantId: TENANT_A, partnerCompanyId: null, actorUserId: USER_A_HOST };
const SCOPE_P1 = { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, actorUserId: USER_A_PARTNER };
const SCOPE_P2 = { tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, actorUserId: USER_A_PARTNER2 };

/** 経路 5 の基底表（docs/05 §4.4 C9）と、パートナー読み取りを一切許さない extension_reviews。 */
const COUNTERPARTY_TABLES = ['assignments', 'contracts', 'contract_documents', 'orders'] as const;

/** docs/05 §4.3-6 の 5 デリゲート（`TenantDb` から除去済み）。 */
const COUNTERPARTY_DELEGATES = [
  'assignment',
  'contract',
  'contractDocument',
  'order',
  'extensionReview',
] as const;

type LooseDelegate = { findMany: (args?: unknown) => Promise<unknown[]> };

let database: IsolationDatabase;
let db: UnextendedClient;
let ctxHost: AuthenticatedTenantCtx;
let ctxPartner1: AuthenticatedTenantCtx;
let ctxPartner2: AuthenticatedTenantCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  db = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxHost = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
  ctxPartner1 = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
  ctxPartner2 = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A2,
      userId: USER_A_PARTNER2,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await db?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('C9 の正の経路: パートナーは自社が当事者のレコードをビュー越しに読める（F-065 / F-066）', () => {
  it('稼働: 自社が当事者の 2 件だけが見える（未公開案件の稼働も行としては見える。F-065 AC-1）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerAssignmentsV.findMany({ orderBy: { endDate: 'asc' } }),
    );
    expect(rows.map((row) => row.id)).toEqual([ASSIGNMENT_A_P1_PRIVATE, ASSIGNMENT_A_P1_PUBLISHED]);
  });

  it('🔴 公開済みの案件は案件名が見え、未公開の案件は project_name が NULL になる（稼働行ごと消えない）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerAssignmentsV.findMany(),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ASSIGNMENT_A_P1_PUBLISHED)?.projectName).toBe('Project A Published');
    expect(byId.get(ASSIGNMENT_A_P1_PRIVATE)?.projectName).toBeNull();
  });

  it('🔴 extension_review_open は state からの導出である（extension_reviews を参照しない。BR-67）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerAssignmentsV.findMany(),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ASSIGNMENT_A_P1_PRIVATE)?.state).toBe('EXTENSION_REVIEW');
    expect(byId.get(ASSIGNMENT_A_P1_PRIVATE)?.extensionReviewOpen).toBe(true);
    expect(byId.get(ASSIGNMENT_A_P1_PUBLISHED)?.extensionReviewOpen).toBe(false);
  });

  it('契約: 自社が当事者の 1 件だけが見え、単価は自社とホストの間の契約単価である（BR-66）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerContractsV.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([CONTRACT_A_P1]);
    expect(rows[0]?.unitPrice?.toString()).toBe('650000');
  });

  it('🔴 契約書: 署名済みの最終版だけが見える（未署名のドラフト版は行として存在しない。F-066 AC-2）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerContractDocumentsV.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([CONTRACT_DOC_A_P1_SIGNED]);
    expect(rows.map((row) => row.id)).not.toContain(CONTRACT_DOC_A_P1_DRAFT);
  });

  it('発注: 自社が当事者の 1 件だけが見える', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerOrdersV.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ORDER_A_P1]);
  });

  it('対照: PARTNER_A2 は自社が当事者の行だけを見る（PARTNER_A1 のものは 1 件も無い）', async () => {
    const [assignments, contracts, documents, orders] = await withPartnerScope(
      ctxPartner2,
      {},
      async (scoped) =>
        Promise.all([
          scoped.partnerAssignmentsV.findMany(),
          scoped.partnerContractsV.findMany(),
          scoped.partnerContractDocumentsV.findMany(),
          scoped.partnerOrdersV.findMany(),
        ]),
    );
    expect(assignments.map((row) => row.id)).toEqual([ASSIGNMENT_A_P2]);
    expect(contracts.map((row) => row.id)).toEqual([CONTRACT_A_P2]);
    expect(documents.map((row) => row.id)).toEqual([CONTRACT_DOC_A_P2_SIGNED]);
    expect(orders.map((row) => row.id)).toEqual([ORDER_A_P2]);
  });
});

describe('🔴 C9 の負の経路: 他社が当事者のレコードは件数からも推測できない（§4.7 #8）', () => {
  it('ID 直指定でも他社が当事者の行は 0 件（404 相当。§4.8「見えない ＝ 存在しない」）', async () => {
    const found = await withPartnerScope(ctxPartner1, {}, async (scoped) => ({
      assignment: await scoped.partnerAssignmentsV.findMany({ where: { id: ASSIGNMENT_A_P2 } }),
      contract: await scoped.partnerContractsV.findMany({ where: { id: CONTRACT_A_P2 } }),
      document: await scoped.partnerContractDocumentsV.findMany({
        where: { id: CONTRACT_DOC_A_P2_SIGNED },
      }),
      order: await scoped.partnerOrdersV.findMany({ where: { id: ORDER_A_P2 } }),
    }));
    expect(found.assignment).toHaveLength(0);
    expect(found.contract).toHaveLength(0);
    expect(found.document).toHaveLength(0);
    expect(found.order).toHaveLength(0);
  });

  it('🔴 同一案件に他社の稼働があっても total が変わらない（COUNT は境界適用後の母集団だけ）', async () => {
    const counts = await withPartnerScope(ctxPartner1, {}, async (scoped) => ({
      all: await scoped.partnerAssignmentsV.count(),
      sameProject: await scoped.partnerAssignmentsV.count({
        where: { id: { in: [ASSIGNMENT_A_P1_PUBLISHED, ASSIGNMENT_A_P2, ASSIGNMENT_A_HOST] } },
      }),
    }));
    // 同一案件（PROJECT_A_PUBLISHED）には PARTNER_A2 と自社エンジニアの稼働も存在するが、
    // PARTNER_A1 から数えられるのは自社が当事者の 1 件だけである。
    expect(counts.all).toBe(2);
    expect(counts.sameProject).toBe(1);
  });

  it('🔴 当事者列が NULL の行（自社エンジニアの稼働 / ホストとエンド企業の契約）も見えない', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, async (scoped) => ({
      assignments: await scoped.partnerAssignmentsV.findMany({
        where: { id: ASSIGNMENT_A_HOST },
      }),
      contracts: await scoped.partnerContractsV.findMany({ where: { id: CONTRACT_A_HOST } }),
    }));
    expect(rows.assignments).toHaveLength(0);
    expect(rows.contracts).toHaveLength(0);
  });

  it('🔴 素のクライアント（Prisma 拡張なし）でも、基底表の SELECT は自社が当事者の行しか返さない', async () => {
    const rows = await runUnextended(db, SCOPE_P1, async (tx) => ({
      assignments: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM assignments ORDER BY id`,
      contracts: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM contracts ORDER BY id`,
      documents: await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM contract_documents ORDER BY id`,
      orders: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM orders ORDER BY id`,
    }));
    expect(rows.assignments.map((row) => row.id).sort()).toEqual(
      [ASSIGNMENT_A_P1_PUBLISHED, ASSIGNMENT_A_P1_PRIVATE].sort(),
    );
    expect(rows.contracts.map((row) => row.id)).toEqual([CONTRACT_A_P1]);
    // 🔴 C9 の `AND signed_at IS NOT NULL`（署名済み最終版のみ）が基底表の行そのものを消す。
    expect(rows.documents.map((row) => row.id)).toEqual([CONTRACT_DOC_A_P1_SIGNED]);
    expect(rows.orders.map((row) => row.id)).toEqual([ORDER_A_P1]);
  });

  it('🔴 対称: PARTNER_A2 の素の SELECT にも PARTNER_A1 の当事者レコードは 1 件も現れない', async () => {
    const rows = await runUnextended(db, SCOPE_P2, async (tx) => ({
      assignments: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM assignments`,
      contracts: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM contracts`,
      documents: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM contract_documents`,
      orders: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM orders`,
    }));
    expect(rows.assignments.map((row) => row.id)).toEqual([ASSIGNMENT_A_P2]);
    expect(rows.contracts.map((row) => row.id)).toEqual([CONTRACT_A_P2]);
    expect(rows.documents.map((row) => row.id)).toEqual([CONTRACT_DOC_A_P2_SIGNED]);
    expect(rows.orders.map((row) => row.id)).toEqual([ORDER_A_P2]);
  });

  it('対照: ホスト文脈（C2）では 4 表の全行が見える（C9 の 0 件が「そもそも行が無い」からではない）', async () => {
    const rows = await runUnextended(db, SCOPE_HOST_A, async (tx) => ({
      assignments: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM assignments`,
      contracts: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM contracts`,
      documents: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM contract_documents`,
      orders: await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM orders`,
    }));
    expect(rows.assignments).toHaveLength(4);
    expect(rows.contracts).toHaveLength(3);
    expect(rows.documents).toHaveLength(3);
    expect(rows.orders).toHaveLength(2);
  });
});

describe('🔴 extension_reviews にはパートナー読み取りの経路が 1 つも無い（BR-67）', () => {
  it('パートナー文脈では 0 件（当事者列も持たない）', async () => {
    const rows = await runUnextended(
      db,
      SCOPE_P1,
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM extension_reviews`,
    );
    expect(rows).toHaveLength(0);
  });

  it('対照: ホスト文脈では見える（C2）', async () => {
    const rows = await runUnextended(
      db,
      SCOPE_HOST_A,
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM extension_reviews`,
    );
    expect(rows.map((row) => row.id)).toEqual([EXTENSION_REVIEW_A_P1]);
  });

  it('🔴 カタログ: extension_reviews の全ポリシーが app_is_host() を含む（パートナー文脈で真になり得ない）', async () => {
    const policies = (await readPolicies(db)).filter(
      (policy) => policy.table === 'extension_reviews' && policy.roles.includes('app_tenant'),
    );
    expect(policies.length).toBeGreaterThan(0); // 空振り防止
    for (const policy of policies) {
      const expressions = [policy.using, policy.withCheck].filter(
        (value): value is string => value !== null,
      );
      expect(expressions.length).toBeGreaterThan(0);
      for (const expression of expressions) {
        expect(
          expression.includes('app_is_host()'),
          `${policy.policy}: app_is_host() を含まない（パートナー文脈で真になりうる）`,
        ).toBe(true);
      }
    }
  });
});

describe('🔴 経路 5 の 4 表にパートナー向けの書込ポリシーが無い（§4.7 #10 / BR-68）', () => {
  it.each(COUNTERPARTY_TABLES)(
    '%s: INSERT / UPDATE / DELETE のポリシーはすべて app_is_host() を含む',
    async (table) => {
      const policies = (await readPolicies(db)).filter(
        (policy) =>
          policy.table === table &&
          policy.roles.includes('app_tenant') &&
          policy.command !== 'SELECT',
      );
      expect(policies.length).toBeGreaterThan(0); // 空振り防止
      for (const policy of policies) {
        const expressions = [policy.using, policy.withCheck].filter(
          (value): value is string => value !== null,
        );
        for (const expression of expressions) {
          expect(
            expression.includes('app_is_host()'),
            `${policy.policy}: 書込ポリシーが app_is_host() を含まない（BR-68 違反）`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(COUNTERPARTY_TABLES)('%s: パートナー文脈の UPDATE / DELETE は 0 件更新', async (table) => {
    const affected = await runUnextended(db, SCOPE_P1, async (tx) => ({
      updated: await tx.$executeRawUnsafe(
        `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1::uuid`,
        TENANT_A,
      ),
      deleted: await tx.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE tenant_id = $1::uuid`,
        TENANT_A,
      ),
    }));
    // 🔴 C9 は SELECT のみであり、C2 の書込ポリシーは app_is_host() で偽になる。
    //    自社が当事者の行が SELECT では見えていても、UPDATE / DELETE の USING は 1 行も通さない。
    expect(affected.updated).toBe(0);
    expect(affected.deleted).toBe(0);
  });

  it('🔴 パートナー文脈の INSERT は WITH CHECK で拒否される（0 件ではなく違反として落ちる）', async () => {
    await expect(
      runUnextended(db, SCOPE_P1, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO contracts (id, tenant_id, kind, state, counterparty_name, counterparty_partner_company_id)
           VALUES (gen_random_uuid(), $1::uuid, 'INDIVIDUAL', 'DRAFT', 'forged', $2::uuid)`,
          TENANT_A,
          PARTNER_A1,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('対照: ホスト文脈なら同じ UPDATE が行を更新する（0 件が「行が無い」からではない）', async () => {
    const updated = await runUnextended(db, SCOPE_HOST_A, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE assignments SET state = state WHERE tenant_id = $1::uuid`,
        TENANT_A,
      ),
    );
    expect(updated).toBe(4);
  });
});

describe('🔴 パートナーは基底表のデリゲートに到達できない（§4.3-6 / §4.7 #9）', () => {
  it.each(COUNTERPARTY_DELEGATES)(
    '%s: 素の拡張越しに呼ぶと PartnerBaseTableAccessError（0 件ではなく例外）',
    async (delegate) => {
      await expect(
        withTenant(ctxPartner1, async (scoped) => {
          const loose = (scoped as unknown as Record<string, LooseDelegate>)[delegate];
          return loose.findMany();
        }),
      ).rejects.toBeInstanceOf(PartnerBaseTableAccessError);
    },
  );

  it('対照: ホスト文脈では withHostTenant から 5 デリゲートに触れる（C2 の正常系）', async () => {
    requireHost(ctxHost);
    const counts = await withHostTenant(ctxHost, async (scoped) => ({
      assignments: await scoped.assignment.count(),
      contracts: await scoped.contract.count(),
      documents: await scoped.contractDocument.count(),
      orders: await scoped.order.count(),
      extensionReviews: await scoped.extensionReview.count(),
    }));
    expect(counts).toEqual({
      assignments: 4,
      contracts: 3,
      documents: 3,
      orders: 2,
      extensionReviews: 1,
    });
  });
});

describe('🔴 射影ビューの列集合が BR-66 の許可列と 1 対 1（docs/05 §4.9）', () => {
  it.each(VIEW_NAMES)('%s: 列集合が許可列の一覧と完全に一致する', async (view) => {
    const columns = await readTableColumns(db, view);
    expect(columns).toEqual([...(ALLOWED_VIEW_COLUMNS[view] ?? [])]);
  });

  it('🔴 created_at / updated_at はどのビューにも無い（BR-66 外の導出項目。docs/04 申し送り 9）', async () => {
    for (const view of VIEW_NAMES) {
      const columns = await readTableColumns(db, view);
      expect(columns, `${view}: created_at がある`).not.toContain('created_at');
      expect(columns, `${view}: updated_at がある`).not.toContain('updated_at');
    }
  });

  it('🔴 商流・ホスト内部の列がどのビューにも無い（§4.7 #9）', async () => {
    const forbiddenEverywhere = [
      'internal_unit_price',
      'end_client_name',
      'summary',
      'facts',
      'note',
      'object_key',
      'counterparty_name',
      'payment_terms',
      'owner_user_id',
      'review_opened_at',
      'reminder30_sent_at',
    ];
    for (const view of VIEW_NAMES) {
      const columns = await readTableColumns(db, view);
      for (const forbidden of forbiddenEverywhere) {
        expect(columns, `${view}: ${forbidden} が露出している`).not.toContain(forbidden);
      }
    }
  });

  it('🔴 unit_price を持つのは partner_contracts_v だけである（自社との契約単価。BR-66）', async () => {
    for (const view of VIEW_NAMES) {
      const columns = await readTableColumns(db, view);
      expect(columns.includes('unit_price'), `${view}: unit_price の有無が §4.9 と違う`).toBe(
        view === 'partner_contracts_v',
      );
    }
  });

  it.each(VIEW_NAMES)('%s: security_invoker = true（所有者権限で RLS を素通りしない）', async (view) => {
    const rows = await db.$queryRaw<Array<{ reloptions: string[] | null }>>`
      SELECT c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = ${view}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reloptions ?? []).toContain('security_invoker=true');
  });

  it('🔴 ビューが依存する表は基底 4 表 + projects + project_visibilities だけである（BR-67）', async () => {
    const rows = await db.$queryRaw<Array<{ view_name: string; dependency: string }>>`
      SELECT DISTINCT v.relname AS view_name, t.relname AS dependency
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class v ON v.oid = r.ev_class
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND v.relkind = 'v'
        AND v.relname LIKE 'partner\\_%\\_v'
        AND t.relkind IN ('r', 'p')
        AND n.nspname = 'public'
      ORDER BY 1, 2`;
    expect(rows.length).toBeGreaterThan(0); // 空振り防止
    const allowed = new Set<string>(ALLOWED_VIEW_DEPENDENCY_TABLES);
    for (const row of rows) {
      expect(
        allowed.has(row.dependency),
        `${row.view_name} が ${row.dependency} に依存している（依存先の増加は開示か行消失を生む）`,
      ).toBe(true);
    }
    // 🔴 extension_reviews を参照するビューが 1 本も無いこと（BR-67 の直接確認）。
    expect(rows.map((row) => row.dependency)).not.toContain('extension_reviews');
  });
});

describe('🔴 ビューの GRANT は app_tenant の SELECT だけ（BR-40）', () => {
  it.each(VIEW_NAMES)('%s: app_tenant は SELECT できるが書き込めない', async (view) => {
    expect(await hasTablePrivilege(db, 'app_tenant', view, 'SELECT')).toBe(true);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      expect(
        await hasTablePrivilege(db, 'app_tenant', view, privilege),
        `${view}: app_tenant に ${privilege} 権限がある`,
      ).toBe(false);
    }
  });

  it.each(VIEW_NAMES)(
    '%s: app_platform / app_platform_write には一切の権限が無い（運営者は経路 5 に到達しない）',
    async (view) => {
      for (const role of ['app_platform', 'app_platform_write'] as const) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const) {
          expect(
            await hasTablePrivilege(db, role, view, privilege),
            `${view}: ${role} に ${privilege} 権限がある（BR-40 違反）`,
          ).toBe(false);
        }
      }
    },
  );

  it('🔴 実測: app_tenant がビューへ INSERT / UPDATE / DELETE を発行すると permission denied', async () => {
    for (const statement of [
      `INSERT INTO partner_contracts_v (id, tenant_id) VALUES ('${CONTRACT_A_P2}', '${TENANT_A}')`,
      `UPDATE partner_contracts_v SET unit_price = 1`,
      `DELETE FROM partner_contracts_v`,
    ]) {
      await expect(
        runUnextended(db, SCOPE_P1, (tx) => tx.$executeRawUnsafe(statement)),
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe('🔴 ホストのプレビューは取引先の見え方と一致する（docs/05 §4.9 / §17.3 #21）', () => {
  it('同じビュー・同じ列で、PARTNER_A1 が見るものと同じ行が返る', async () => {
    const asPartner = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerAssignmentsV.findMany({ orderBy: { endDate: 'asc' } }),
    );
    const asHostPreview = await withPartnerScope(
      ctxHost,
      { previewPartnerCompanyId: PARTNER_A1 },
      (scoped) => scoped.partnerAssignmentsV.findMany({ orderBy: { endDate: 'asc' } }),
    );
    expect(asHostPreview).toEqual(asPartner);
  });

  it('🔴 プレビューでも未公開案件の project_name は NULL になる（ホストは全案件が見える文脈である）', async () => {
    const rows = await withPartnerScope(ctxHost, { previewPartnerCompanyId: PARTNER_A1 }, (scoped) =>
      scoped.partnerAssignmentsV.findMany({ where: { id: ASSIGNMENT_A_P1_PRIVATE } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectName).toBeNull();
  });

  it('プレビュー対象を PARTNER_A2 に変えると PARTNER_A2 の当事者レコードだけが返る', async () => {
    const rows = await withPartnerScope(ctxHost, { previewPartnerCompanyId: PARTNER_A2 }, (scoped) =>
      scoped.partnerAssignmentsV.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ASSIGNMENT_A_P2]);
  });
});

describe('🔴 二重防御: RLS を落としても射影が他社の当事者レコードを返さない（docs/05 §4.1）', () => {
  beforeAll(async () => {
    await setRowLevelSecurity({
      ownerDatasourceUrl: database.migratorUrl,
      tables: [...COUNTERPARTY_TABLES],
      enabled: false,
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await setRowLevelSecurity({
      ownerDatasourceUrl: database.migratorUrl,
      tables: [...COUNTERPARTY_TABLES],
      enabled: true,
    });
  }, SETUP_TIMEOUT_MS);

  it('対照: RLS が確かに落ちている（素のクライアントがパートナー文脈で全社の行を見る）', async () => {
    const rows = await runUnextended(
      db,
      SCOPE_P1,
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM assignments`,
    );
    expect(rows).toHaveLength(4);
  });

  it('🔴 withPartnerScope 越しでは、それでも自社が当事者の行だけが返る（第 2 防御の where）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, async (scoped) => ({
      assignments: await scoped.partnerAssignmentsV.findMany(),
      contracts: await scoped.partnerContractsV.findMany(),
      orders: await scoped.partnerOrdersV.findMany(),
    }));
    expect(rows.assignments.map((row) => row.id).sort()).toEqual(
      [ASSIGNMENT_A_P1_PUBLISHED, ASSIGNMENT_A_P1_PRIVATE].sort(),
    );
    expect(rows.contracts.map((row) => row.id)).toEqual([CONTRACT_A_P1]);
    expect(rows.orders.map((row) => row.id)).toEqual([ORDER_A_P1]);
  });

  it('🔴 未署名のドラフト版も、RLS 抜きで（第 2 防御の signed_at 述語だけで）排除される（F-066 AC-2）', async () => {
    const rows = await withPartnerScope(ctxPartner1, {}, (scoped) =>
      scoped.partnerContractDocumentsV.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([CONTRACT_DOC_A_P1_SIGNED]);
  });
});

describe('🔴 パートナーの応答に商流・ホスト内部の値が 1 つも混ざらない（§4.7 #9）', () => {
  it('4 ビューの応答を JSON 化しても禁止マーカーが現れない', async () => {
    const payload = await withPartnerScope(ctxPartner1, {}, async (scoped) => ({
      assignments: await scoped.partnerAssignmentsV.findMany(),
      contracts: await scoped.partnerContractsV.findMany(),
      documents: await scoped.partnerContractDocumentsV.findMany(),
      orders: await scoped.partnerOrdersV.findMany(),
    }));
    const serialized = JSON.stringify(payload, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const marker of Object.values(FORBIDDEN_MARKERS)) {
      expect(serialized.includes(marker), `禁止値 ${marker} が応答に含まれている`).toBe(false);
    }
    // 🔴 ホストの販売単価（projects.internal_unit_price = 900000 / 800000）とエンド企業名。
    expect(serialized).not.toContain('End Client');
    expect(serialized).not.toContain('900000');
    expect(serialized).not.toContain('800000');
    // 対照: 自社との契約単価（650000）は BR-66 の開示項目なので現れる。
    expect(serialized).toContain('650000');
  });
});
