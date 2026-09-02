// packages/db/src/partner-scope.test.ts
// T-02-07（docs/sprints/SP-02-schema-isolation.md）: 越境経路 5（当事者レコードの参照）の
// **型による到達不能性**と、`withPartnerScope` の当事者確定を固定する（docs/05 §4.3-6 / §4.9）。
//
// 🔴 これは主に型テストである（context.test.ts と同じ位置づけ）。型注釈の不一致は
//    `pnpm --filter @ses/db typecheck` / ルートの `pnpm typecheck` で失敗する。
//    vitest は esbuild で型情報なしにトランスパイルするため、実行時は単なる代入と
//    `expect` の確認になる。**「型で到達不能」を人手のレビューに委ねない**ためのもの。
//
// 🔴 行の絞り込み（RLS の C9）と列の絞り込み（射影ビュー）の実測は
//    tests/isolation/route5-counterparty.test.ts（Testcontainers）が担当する。
import { describe, expect, it } from 'vitest';
import { PartnerScopeTargetError, resolveTenantCtx, type AuthenticatedTenantCtx } from './context.js';
import { withHostTenant, withPartnerScope, withTenant } from './with-tenant.js';

/** `K` が `T` のキーとして存在するか（型レベルの述語）。 */
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

/** `withTenant` が `fn` に渡すクライアント（= 非公開の `TenantDb`）。 */
type TenantDbParam = Parameters<Parameters<typeof withTenant<unknown>>[1]>[0];
/** `withHostTenant` が `fn` に渡すクライアント（= 非公開の `HostTenantDb`）。 */
type HostTenantDbParam = Parameters<Parameters<typeof withHostTenant<unknown>>[1]>[0];
/** `withPartnerScope` が `fn` に渡すクライアント（= 公開型の `PartnerScopeDb`）。 */
type PartnerScopeDbParam = Parameters<Parameters<typeof withPartnerScope<unknown>>[2]>[0];

/** docs/05 §4.3-6 の 5 デリゲート（with-tenant.ts の `CounterpartyDelegate` の写し）。 */
type CounterpartyDelegateName =
  | 'assignment'
  | 'contract'
  | 'contractDocument'
  | 'order'
  | 'extensionReview';

/** docs/05 §4.9 の射影ビュー 4 本のデリゲート名。 */
type PartnerViewDelegateName =
  | 'partnerAssignmentsV'
  | 'partnerContractsV'
  | 'partnerContractDocumentsV'
  | 'partnerOrdersV';

// 🔴 いずれかのデリゲートが `TenantDb` に残っていると、そのキーの型が `true` になり
//    `false` を代入できずコンパイルエラーになる（= 型で到達不能であることの機械的な固定）。
const counterpartyAbsentFromTenantDb: { [K in CounterpartyDelegateName]: HasKey<TenantDbParam, K> } =
  {
    assignment: false,
    contract: false,
    contractDocument: false,
    order: false,
    extensionReview: false,
  };

// 🔴 対照: `HostTenantDb` には 5 デリゲートが**ある**（上の検査が「そもそも存在しない
//    モデル名を並べただけ」の空振りでないことを示す）。
const counterpartyPresentInHostTenantDb: {
  [K in CounterpartyDelegateName]: HasKey<HostTenantDbParam, K>;
} = {
  assignment: true,
  contract: true,
  contractDocument: true,
  order: true,
  extensionReview: true,
};

const rawSqlAbsentFromTenantDb: {
  [K in '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe']: HasKey<
    TenantDbParam,
    K
  >;
} = {
  $queryRaw: false,
  $queryRawUnsafe: false,
  $executeRaw: false,
  $executeRawUnsafe: false,
};

const partnerViewsInPartnerScopeDb: {
  [K in PartnerViewDelegateName]: HasKey<PartnerScopeDbParam, K>;
} = {
  partnerAssignmentsV: true,
  partnerContractsV: true,
  partnerContractDocumentsV: true,
  partnerOrdersV: true,
};

const counterpartyAbsentFromPartnerScopeDb: {
  [K in CounterpartyDelegateName]: HasKey<PartnerScopeDbParam, K>;
} = {
  assignment: false,
  contract: false,
  contractDocument: false,
  order: false,
  extensionReview: false,
};

// 🔴 経路 5 に書き込みは無い（BR-68）。ビューのデリゲートは findMany / count しか公開しない。
const partnerViewOperations: {
  findMany: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'findMany'>;
  count: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'count'>;
  create: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'create'>;
  update: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'update'>;
  updateMany: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'updateMany'>;
  delete: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'delete'>;
  deleteMany: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'deleteMany'>;
  upsert: HasKey<PartnerScopeDbParam['partnerAssignmentsV'], 'upsert'>;
} = {
  findMany: true,
  count: true,
  create: false,
  update: false,
  updateMany: false,
  delete: false,
  deleteMany: false,
  upsert: false,
};

describe('🔴 TenantDb は経路 5 の基底表 5 デリゲートを持たない（docs/05 §4.3-6 ①）', () => {
  it('assignment / contract / contractDocument / order / extensionReview が型に無い', () => {
    expect(Object.values(counterpartyAbsentFromTenantDb).every((value) => value === false)).toBe(
      true,
    );
  });

  it('対照: HostTenantDb には 5 デリゲートがある（withHostTenant だけが渡す）', () => {
    expect(Object.values(counterpartyPresentInHostTenantDb).every((value) => value === true)).toBe(
      true,
    );
  });

  it('生 SQL の入口も型に無い（docs/05 §4.3 規約 3）', () => {
    expect(Object.values(rawSqlAbsentFromTenantDb).every((value) => value === false)).toBe(true);
  });
});

describe('🔴 PartnerScopeDb は射影ビュー 4 本の読み取りだけを公開する（docs/05 §4.9）', () => {
  it('4 本のビューのデリゲートがある', () => {
    expect(Object.values(partnerViewsInPartnerScopeDb).every((value) => value === true)).toBe(true);
  });

  it('基底表の 5 デリゲートは 1 つも無い（列に到達できない。F-065 AC-2 / F-066 AC-3）', () => {
    expect(
      Object.values(counterpartyAbsentFromPartnerScopeDb).every((value) => value === false),
    ).toBe(true);
  });

  it('操作は findMany / count のみ（書き込みは型に無い。BR-68）', () => {
    expect(partnerViewOperations.findMany).toBe(true);
    expect(partnerViewOperations.count).toBe(true);
    for (const operation of ['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'] as const) {
      expect(partnerViewOperations[operation], `${operation} が型に残っている`).toBe(false);
    }
  });
});

// 🔴 当事者の確定は `getBaseClient()` より前に行われるため、DB 無しで検証できる。
//    正常系は「当事者の確定を通り抜けて DB 接続の初期化まで進んだ」ことを、
//    configureTenantDb 未実行のエラーで確かめる（このファイルは configureTenantDb を呼ばない）。
const NOT_CONFIGURED = /configureTenantDb/;

async function partnerCtx(): Promise<AuthenticatedTenantCtx> {
  return resolveTenantCtx(
    {
      tenantId: '01930000-0000-7000-8000-0000000000a1',
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
      userId: '01930000-0000-7000-8000-0000000000d2',
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
}

async function hostCtx(): Promise<AuthenticatedTenantCtx> {
  return resolveTenantCtx(
    {
      tenantId: '01930000-0000-7000-8000-0000000000a1',
      partnerCompanyId: null,
      userId: '01930000-0000-7000-8000-0000000000d1',
      role: 'SALES',
      lifecycleState: 'ACTIVE',
    },
    { deviceKind: 'api' },
  );
}

describe('🔴 withPartnerScope の当事者は 1 つの出所からしか決まらない（docs/05 §4.9 / BR-03）', () => {
  it('パートナー文脈で previewPartnerCompanyId を指定すると例外（リクエスト入力で当事者を指定できない）', async () => {
    const ctx = await partnerCtx();
    await expect(
      withPartnerScope(ctx, { previewPartnerCompanyId: '01930000-0000-7000-8000-0000000000c2' }, async () => 1),
    ).rejects.toBeInstanceOf(PartnerScopeTargetError);
  });

  it('ホスト文脈でプレビュー対象が無いと例外（0 件を返さない）', async () => {
    const ctx = await hostCtx();
    await expect(withPartnerScope(ctx, {}, async () => 1)).rejects.toBeInstanceOf(
      PartnerScopeTargetError,
    );
  });

  it('対照: パートナー文脈 + 指定なしは当事者の確定を通る（DB 未初期化のエラーまで進む）', async () => {
    const ctx = await partnerCtx();
    await expect(withPartnerScope(ctx, {}, async () => 1)).rejects.toThrow(NOT_CONFIGURED);
  });

  it('対照: ホスト文脈 + プレビュー対象ありは当事者の確定を通る（DB 未初期化のエラーまで進む）', async () => {
    const ctx = await hostCtx();
    await expect(
      withPartnerScope(ctx, { previewPartnerCompanyId: '01930000-0000-7000-8000-0000000000c1' }, async () => 1),
    ).rejects.toThrow(NOT_CONFIGURED);
  });
});
