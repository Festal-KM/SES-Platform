// packages/db/src/scope-injection.ts
// 第 2 防御（Prisma Client Extension）の中身のうち、Prisma に依存しない純粋部分。
// docs/05 §4.1 / docs/03 §4.3.1「$allOperations フックで where: { tenantId } を注入する」。
//
// 🔴 Prisma の生成物を import しない。ここを純粋に保つことで、
//    「拡張が何を注入するか」を DB もコンテナも無しにユニットテストで固定できる
//    （RLS が無効化されてもアプリは正常に動くため、機能テストでは第 2 防御の欠落に気づけない）。
//
// 🔴 防御は「読み側（where）」と「書き側（data）」の 2 面ある。where だけを注入しても、
//    既存行の所属を data で書き換える攻撃（行の移動）は止まらない。
//    update / updateMany / updateManyAndReturn / upsert(update 分岐) の data も検査する。
//
// 🔴 書き側の検査は「テナントキー列を書き換えうるネスト write すべて」を対象にする。方向は問わない。
//    子 → 親（Engineer.tenant）だけを塞ぐと、親 → 子（Tenant.engineers）から同じ列を書ける
//    （経路 ⑥。実測で突破された）。

/**
 * 🔴 テナントスコープの注入対象外にできるモデル（CLAUDE.md §3.1 / docs/03 §4.3.1）。
 * ここに追記することは情報境界の前提を変えることであり、人間の承認事項（CLAUDE.md §8.6）。
 */
export const TENANT_SCOPE_EXCLUDED_MODELS = [
  'Skill',
  'Plan',
  'Subscription',
  'PlatformUser',
] as const;

/**
 * 🔴 C0 SYSTEM_ONLY のモデル（docs/05 §4.4）。**テナントキーを持てない表**であり、
 * 到達経路は `withSystemScope()`（docs/05 §4.4.2）だけである。
 *
 * 射程外の 4 モデル（`TENANT_SCOPE_EXCLUDED_MODELS`）と扱いが違う点に注意する:
 * 射程外は「テナントに属さないマスタ / 運営データなので注入せず素通しする」が、
 * こちらは「テナント文脈から触ってはならない」。したがって**素通しではなく例外**にする
 * （`withSystemScope` は本拡張を適用しないクライアントを使うため、この経路には来ない）。
 *
 * 🔴 `EmailEvent` / `ImpersonationSession` は denormalize 目的の `tenant_id` 列を持つが、
 *    docs/05 §4.4 は両者を C0 に置いている。列があることを理由にテナント文脈から
 *    読み書きできる経路を作らない。
 */
export const TENANT_SCOPE_SYSTEM_ONLY_MODELS = [
  'SchedulerRun',
  'WebhookDelivery',
  'EmailEvent',
  'ImpersonationSession',
] as const;

/**
 * 🔴 経路 5（当事者レコードの参照）の**基底表**のモデル（docs/05 §4.3-6 / §4.4 C9）。
 *
 * C9 の RLS は**行**を通すが、パートナーが**列**を読めてはならない（`F-065 AC-2` / `F-066 AC-3`）。
 * パートナー文脈から到達してよいのは §4.9 の射影ビュー（`PARTNER_VIEW_MODELS`）だけであり、
 * 基底表のデリゲートは 3 層で塞ぐ:
 *   ①型: `TenantDb` から 5 デリゲートを `Omit` する（`with-tenant.ts`）
 *   ②実行時: 本モジュールの `assertPartnerBaseTableNotAccessed`（Prisma 拡張の `$allOperations` から呼ぶ）
 *   ③静的: `withHostTenant` / `requireHost` の呼び出し元限定（docs/05 §17.2 #20。SP-03 以降）
 *
 * 🔴 ②が要る理由: ①は `withHostTenant` を経ない「素の拡張越し」の呼び出しを止められない。
 *    RLS の C9 は行を通してしまう（0 件にならない）ので、**例外**で露見させる。
 * 🔴 `ExtensionReview` は C9 の対象ですらない（`BR-67`）が、ホスト内部の検討内容であることは同じであり、
 *    docs/05 §4.3-6 は 5 デリゲートをまとめてホスト文脈専用としている。
 * 🔴 この一覧を減らすことは経路 5 の情報境界を変えることであり、人間の承認事項（`CLAUDE.md` §8.6）。
 */
export const PARTNER_BASE_TABLE_MODELS = [
  'Assignment',
  'Contract',
  'ContractDocument',
  'Order',
  'ExtensionReview',
] as const;

/**
 * 🔴 経路 5 の射影ビューのモデル（docs/05 §4.9）。パートナーが当事者レコードに到達する唯一の経路。
 * 到達関数は `withPartnerScope` だけである（`with-tenant.ts`）。
 */
export const PARTNER_VIEW_MODELS = [
  'PartnerAssignmentsV',
  'PartnerContractsV',
  'PartnerContractDocumentsV',
  'PartnerOrdersV',
] as const;

/**
 * テナントキー列がモデルごとに異なる場合の宣言（docs/05 §3.1 の 2 例外）。
 * 既定は `tenantId`。
 *
 * C0（`SchedulerRun` / `WebhookDelivery` / `ImpersonationSession`）はテナントキーを持たないが、
 * ここには現れない。到達経路が `withSystemScope`（docs/05 §4.4.2）だけであり、
 * 本拡張を適用したクライアントからは触らないためである。
 *
 * 🔴 宣言と実体の一致は `tenant-relation.test.ts` が DMMF で検証する（`tenantKeyOf` が返す名前の
 *    スカラーフィールドが実在すること）。`Announcement` はこれを満たさないまま T-02-05 まで
 *    既定の `tenantId` に落ちており、`withTenant` 経由の読み取りが Prisma の引数検証で
 *    落ちる状態だった（T-02-06 で是正）。
 */
const TENANT_KEY_OVERRIDES: Readonly<Record<string, string>> = {
  Tenant: 'id',
  Announcement: 'targetTenantIds',
};

/**
 * 🔴 テナントスコープの注入方式（docs/05 §4.4 のポリシークラスに対応する第 2 防御側の宣言）。
 *
 * - `COLUMN`（既定）: テナントキー列 = ctx のテナント。読み書きとも同じ述語。
 * - `COLUMN_WITH_GLOBAL_ROWS`: テナントキーが NULL の**グローバル行**を持つモデル。
 *   🔴 **読み取りだけ** `テナントキー = ctx OR テナントキー IS NULL` に緩める。
 *   書き込み（`create` / `update` / `upsert` / `delete`）は `= ctx` のまま絞る。
 * - `ARRAY_MEMBERSHIP`: テナントキーが**配列**のモデル（`Announcement.targetTenantIds`）。
 *   読み取りは「空配列（全テナント宛）または ctx を含む」。テナント文脈からの書き込みは
 *   スコープを注入しようがないため `ReadOnlyModelWriteError` で fail-closed にする
 *   （DB 側も `app_tenant` に `SELECT` しか GRANT していない）。
 *
 * 🔴 なぜ「宣言」にするか（T-02-02 からの申し送り / code-reviewer 指定、2026-09-03）:
 * `skill_aliases` は第 1 防御（RLS の C1。`SELECT` は `OR tenant_id IS NULL`）ではグローバル行を
 * 読めるのに、第 2 防御が無条件に `AND tenantId = ctx` を注入していたため、`withTenant` 経由では
 * グローバル辞書が 1 件も読めなかった（`F-010 AC-2` を満たさない。**漏れる方向ではなく隠れる方向**
 * の不一致）。解決方法は 2 つあった:
 *   (a) 注入そのものをやめて RLS に任せる → 🔴 採らない。第 2 防御が消えるモデルを作ると、
 *       RLS が静かに無効化されたときに他テナントの別名が読めてしまう（二重防御が単一防御になる）
 *   (b) モデル単位に「グローバル行を許す読み取り」を宣言し、述語を `OR IS NULL` に緩める → 採用
 * (b) なら第 2 防御は残り（他テナントの行は依然として `where` で排除される）、緩むのは
 * 「テナントに属さない行」だけである。**緩和は読み取りに限り、書き込みは絞ったまま**にすることで、
 * グローバル行をテナントから作る・書き換える経路は増えない（`F-010 AC-2` の後半）。
 * 対象モデルを増やすことは情報境界の前提を変えるため、`scope-injection.test.ts` が
 * 「宣言の集合そのもの」を固定し、`tenant-relation.test.ts` が DMMF で
 * 「宣言されたモデルのテナントキーが実際に nullable / 配列であること」を検証する。
 */
export type TenantScopeStrategyKind =
  | 'COLUMN'
  | 'COLUMN_WITH_GLOBAL_ROWS'
  | 'ARRAY_MEMBERSHIP'
  | 'NO_TENANT_KEY';

const TENANT_SCOPE_STRATEGY_OVERRIDES: Readonly<Record<string, TenantScopeStrategyKind>> = {
  // docs/05 §4.4 C1: `skill_aliases` の SELECT は `OR tenant_id IS NULL`（グローバル別名。F-010 AC-2）
  SkillAlias: 'COLUMN_WITH_GLOBAL_ROWS',
  // docs/05 §4.4 C1 の読み替え: `announcements` は SELECT のみ（書込は app_platform_write）
  Announcement: 'ARRAY_MEMBERSHIP',
};

/** テナントキーを裏付けるリレーションフィールドの既定名。 */
const DEFAULT_TENANT_RELATION = 'tenant';

/**
 * 🔴 テナントキー列を裏付けるリレーションフィールド名の宣言。
 * スカラーキーだけを検査しても、`data: { tenant: { connect: { id: 他テナント } } }` で
 * 同じ列を書き換えられる（実測で突破された経路）。リレーション側も塞ぐ。
 *
 * `null` = そのモデルにはテナントキーを裏付けるリレーションが無い。
 * `Tenant` のテナントキーは自身の `id` であり、外部キーではないため `null`。
 *
 * 🔴 宣言と Prisma スキーマの実体が食い違うと、この防御は静かに無効になる。
 *    `tenant-relation.test.ts` が DMMF を走査して両者の一致を毎回検証する。
 */
const TENANT_RELATION_OVERRIDES: Readonly<Record<string, string | null>> = {
  Tenant: null,
};

/**
 * 🔴 逆リレーション（親 → 子）の宣言。
 *
 * `Engineer.tenant`（子 → 親）を塞いでも、**同じ `engineers.tenant_id` 列は
 * `Tenant.engineers`（親 → 子）からも書ける**。
 * `tenant.update({ where: { id: 自テナント }, data: { engineers: { connect: { id: 他テナントの行 } } } })`
 * は自テナントの行しか触っていないように見えて、他テナントの行を自テナントへ引き寄せる
 * （実測で突破された経路）。
 *
 * 🔴 したがって検査対象は「自モデルのテナントキーを裏付けるリレーション」ではなく、
 *    **テナントキー列を書き換えうるネスト write すべて（方向を問わない）**である。
 *
 * ここに挙げるのは「そのフィールドへのネスト write が**他モデルの**テナントキー列を
 * 書き換えうるリレーション」。値の形（`connect` / `set` / `create` / …）では場合分けしない。
 *
 * 🔴 射程外 4 モデル（`TENANT_SCOPE_EXCLUDED_MODELS`）はそもそも注入を行わないため、
 *    ここに宣言しても効かない。射程外モデルにこの種のリレーションが生えることは
 *    新たな越境経路の追加であり、人間の承認事項（`CLAUDE.md` §3.1 / §8.6）。
 *
 * 🔴 宣言漏れはこの防御を静かに無効化する。`tenant-relation.test.ts` が DMMF を
 *    逆方向に走査し、未宣言の逆リレーションが増えたら落とす（SP-02 の 56 表拡張への恒久対策）。
 *
 * 🔴 T-02-01: docs/05 §3.3 の 6 表（User / Membership / PartnerCompany / Invitation /
 *    TenantSendingDomain の `tenant` リレーション。加えて Engineer は T-01-04 から）を追加した。
 * 🔴 T-02-02: docs/05 §3.4 / §3.5 の 10 表（SkillAlias / EngineerSkill / SkillSheet /
 *    SkillSheetExtraction / FileScanResult / Project / ProjectRequirement / ProjectVisibility /
 *    MatchCandidate / EngineerShare の `tenant` リレーション）を追加した。
 * 🔴 T-02-03: docs/05 §3.6 の 5 表（ProposalRequest / Proposal / EngineerSnapshot /
 *    ProposalEvent / ReviewGate の `tenant` リレーション）を追加した。
 * 🔴 T-02-04: docs/05 §3.7 の 9 表（ChatThread / ThreadParticipant / Message / Contract /
 *    ContractDocument / ContractTemplate / Order / Assignment / ExtensionReview の
 *    `tenant` リレーション）を追加した。
 */
const TENANT_KEY_MOVING_RELATION_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  Tenant: [
    'engineers',
    'users',
    'memberships',
    'partnerCompanies',
    'invitations',
    'sendingDomains',
    'skillAliases',
    'engineerSkills',
    'skillSheets',
    'skillSheetExtractions',
    'fileScanResults',
    'projects',
    'projectRequirements',
    'projectVisibilities',
    'matchCandidates',
    'engineerShares',
    'proposalRequests',
    'proposals',
    'engineerSnapshots',
    'proposalEvents',
    'reviewGates',
    'chatThreads',
    'threadParticipants',
    'messages',
    'contracts',
    'contractDocuments',
    'contractTemplates',
    'orders',
    'assignments',
    'extensionReviews',
    // 🔴 T-02-05: docs/05 §3.8 / §3.9 / §3.10 の 15 表の `tenant` リレーション。
    //    Subscription は射程外モデル（tenantKeyOf('Subscription') === null）のためここに
    //    現れない（inverseTenantKeyRelations が自動的に除外する。tenant-relation.test.ts /
    //    scope-injection.test.ts が機械的に確認する）。
    'tasks',
    'notifications',
    'aiUsages',
    'auditLogs',
    'usageCounters',
    'sendAttempts',
    'emailDispatches',
    'tenantEsignConnection',
    'tenantMonthlyCosts',
    'billingMeterSubmissions',
    'dataExportRequests',
    'tenantPurgeRuns',
    'tenantRoleApprovalModes',
    'tenantRoleModels',
    'tenantMatchWeights',
  ],
};

const EXCLUDED = new Set<string>(TENANT_SCOPE_EXCLUDED_MODELS);
const SYSTEM_ONLY = new Set<string>(TENANT_SCOPE_SYSTEM_ONLY_MODELS);

/**
 * where だけを持つ読み取り操作。data を持たないため書き側の検査は要らない。
 * 🔴 削除は別集合にする（`COLUMN_WITH_GLOBAL_ROWS` の緩和を読み取りだけに限るため。
 *    削除にまで `OR IS NULL` を効かせると、テナントからグローバル行を消せてしまう）。
 */
const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'aggregate',
  'count',
  'groupBy',
]);

/** where だけを持つ削除操作。述語は常に「テナントキー = ctx」に絞る。 */
const DELETE_OPERATIONS = new Set(['delete', 'deleteMany']);

/** 🔴 where と data の両方を持つ更新操作。where の注入だけでは行の移動を止められない。 */
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/** data だけを持つ操作。 */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** where と create と update をすべて持つ操作。 */
const UPSERT_OPERATIONS = new Set(['upsert']);

/** 🔴 呼び出し側が ctx と異なるテナントキーで書き込もうとしたことを示す。 */
export class CrossTenantWriteError extends Error {
  constructor(tenantKey: string) {
    super(
      `書き込みデータの ${tenantKey} が認証コンテキストのテナントと一致しません。` +
        '分離キーはリクエスト入力から受け取れません（CLAUDE.md §3.1）。',
    );
    this.name = 'CrossTenantWriteError';
  }
}

/**
 * 🔴 書き込みデータが、テナントキー列を書き換えうるリレーションに触れたことを示す。
 * 対象は順方向（`Engineer.tenant`）と逆方向（`Tenant.engineers`）の両方である。
 * スカラーキーだけを検査してもリレーション経由（`connect` / `set` / `create` /
 * `connectOrCreate` / `disconnect`）で行を他テナントへ移せるため、リレーションへの書き込みは
 * 値の中身を問わず一律拒否する。テナントキーの値を決めるのは拡張だけである。
 */
export class TenantRelationWriteError extends Error {
  constructor(relation: string) {
    super(
      `書き込みデータがテナントのリレーション ${relation} に触れています。` +
        'テナントキーは認証コンテキストからのみ決まります（CLAUDE.md §3.1）。',
    );
    this.name = 'TenantRelationWriteError';
  }
}

/** 拡張が扱い方を知らない操作に遭遇したことを示す。🔴 素通しさせないための fail-closed。 */
export class UnscopedOperationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `テナントスコープを注入できない操作です: ${model}.${operation}。` +
        'packages/db/src/scope-injection.ts の操作分類に追加してください（素通しは許容しません）。',
    );
    this.name = 'UnscopedOperationError';
  }
}

/**
 * 🔴 テナント文脈からは読み取りしかできないモデルへ書き込もうとしたことを示す
 * （`ARRAY_MEMBERSHIP` 戦略のモデル。docs/05 §4.4 C1 の読み替え）。
 * DB 側でも `app_tenant` に `SELECT` しか GRANT していないため、これは二重防御の TS 側である。
 */
/**
 * 🔴 C0 SYSTEM_ONLY のモデル（docs/05 §4.4）へテナント文脈から触れようとしたことを示す。
 * 正しい経路は `withSystemScope()`（docs/05 §4.4.2）だけである。
 */
export class SystemOnlyModelAccessError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} はテナント文脈から触れません（${operation}）。` +
        'C0 SYSTEM_ONLY の表は withSystemScope() からのみ到達できます（docs/05 §4.4 / §4.4.2）。',
    );
    this.name = 'SystemOnlyModelAccessError';
  }
}

export class ReadOnlyModelWriteError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} はテナント文脈からは読み取り専用です（${operation}）。` +
        '書き込みは管理平面（withPlatformWrite）の経路だけが行います（docs/05 §4.4 C1 / §5.2）。',
    );
    this.name = 'ReadOnlyModelWriteError';
  }
}

/**
 * 🔴 パートナー文脈で経路 5 の基底 5 表のデリゲートに触れたことを示す（docs/05 §4.3-6 / §15.1）。
 *
 * 正しいコードでは到達しない（`TenantDb` の型に 5 デリゲートが無い）ため、**実装バグの検知**である。
 * docs/05 §15.1 では `InternalError`（500）配下に位置づけられる。`AppError` 階層が実装され次第
 * そちらへ継承させる（現時点の `packages/db` の他のエラーと同じく素の `Error` にしてある）。
 *
 * 🔴 0 件を返さず例外にする理由（docs/05 §4.7 #9）: 0 件は「そういうデータが無い」と区別できず、
 *    書き忘れが本番まで生き延びる。例外なら必ず露見する。
 */
export class PartnerBaseTableAccessError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} はホスト文脈専用です（${operation}）。` +
        'パートナー文脈から経路 5 の基底表には到達できません。' +
        'docs/05 §4.9 の射影ビュー（withPartnerScope）を使ってください（CLAUDE.md §3.1-5 / BR-66）。',
    );
    this.name = 'PartnerBaseTableAccessError';
  }
}

/**
 * 🔴 経路 5 の射影ビューへ書き込もうとしたことを示す。
 *
 * ビューは `GRANT SELECT` しか持たず、`partner_assignments_v` は結合を含むため PostgreSQL の
 * 自動更新可能ビューにもならない。それでも**素通しにせず**例外にするのは、
 * 「読み取り専用の経路」であることをアプリ層でも fail-closed に保つためである
 * （`PartnerScopeDb` の型は `findMany` / `count` しか公開しないので、正しいコードでは到達しない）。
 */
export class PartnerViewWriteError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} は読み取り専用の射影ビューです（${operation}）。` +
        '経路 5 に書き込みは無い（BR-68。docs/05 §4.9）。',
    );
    this.name = 'PartnerViewWriteError';
  }
}

const PARTNER_BASE_TABLES = new Set<string>(PARTNER_BASE_TABLE_MODELS);
const PARTNER_VIEWS = new Set<string>(PARTNER_VIEW_MODELS);

/** モデルが経路 5 の基底表（ホスト文脈専用の 5 デリゲート）かどうか。 */
export function isPartnerBaseTableModel(model: string): boolean {
  return PARTNER_BASE_TABLES.has(model);
}

/** モデルが経路 5 の射影ビューかどうか。 */
export function isPartnerViewModel(model: string): boolean {
  return PARTNER_VIEWS.has(model);
}

/**
 * 🔴 第 2 防御の実行時フック（docs/05 §4.3-6 ②）。
 * `app.partner_company_id` が立った接続（= パートナー文脈）で経路 5 の基底表を操作したら例外にする。
 *
 * 🔴 `partnerCompanyId === null`（ホスト文脈 / systemTenantCtx）では何もしない。ホストは C2 で
 *    これらの表を読み書きするのが正常系である。
 */
export function assertPartnerBaseTableNotAccessed(params: {
  model: string;
  operation: string;
  partnerCompanyId: string | null;
}): void {
  if (params.partnerCompanyId === null) return;
  if (!isPartnerBaseTableModel(params.model)) return;
  throw new PartnerBaseTableAccessError(params.model, params.operation);
}

/**
 * モデル名から注入先のテナントキー列名を返す。
 * `null` は「注入先の列が無い」（射程外の 4 モデルと、C0 SYSTEM_ONLY の 4 モデル）。
 */
export function tenantKeyOf(model: string): string | null {
  if (EXCLUDED.has(model) || SYSTEM_ONLY.has(model)) return null;
  return TENANT_KEY_OVERRIDES[model] ?? 'tenantId';
}

/**
 * モデル名からテナントスコープの注入方式を返す。`null` は注入対象外（射程外 4 モデル）。
 * 宣言が無いモデルは既定の `COLUMN`。
 */
export function tenantScopeStrategyOf(model: string): TenantScopeStrategyKind | null {
  if (EXCLUDED.has(model)) return null;
  if (SYSTEM_ONLY.has(model)) return 'NO_TENANT_KEY';
  return TENANT_SCOPE_STRATEGY_OVERRIDES[model] ?? 'COLUMN';
}

/** 🔴 既定（`COLUMN`）以外の注入方式を宣言したモデルの一覧。テストが集合そのものを固定する。 */
export const TENANT_SCOPE_STRATEGY_DECLARATIONS = Object.freeze(
  Object.entries(TENANT_SCOPE_STRATEGY_OVERRIDES).map(([model, kind]) => ({ model, kind })),
);

/**
 * モデル名からテナントキーを裏付けるリレーションフィールド名を返す。
 * `null` は「そのリレーションが無い」（= 射程外モデル、または `Tenant`）。
 */
export function tenantRelationOf(model: string): string | null {
  if (EXCLUDED.has(model)) return null;
  const override = TENANT_RELATION_OVERRIDES[model];
  return override === undefined ? DEFAULT_TENANT_RELATION : override;
}

/**
 * モデル名から「そのフィールドへのネスト write が**他モデルの**テナントキー列を
 * 書き換えうる」リレーションフィールド名（逆リレーション）を返す。
 * 宣言の引き当てのみを行う（射程の判断は `tenantKeyOf` が済ませている）。
 */
export function tenantKeyMovingRelationsOf(model: string): readonly string[] {
  return TENANT_KEY_MOVING_RELATION_OVERRIDES[model] ?? [];
}

/**
 * 🔴 書き込み `data` で検査すべきリレーションフィールド名の全体。
 * 順方向（自モデルのテナントキーを裏付ける）と逆方向（他モデルのテナントキーを書き換えうる）を
 * 束ねる。**どちらか一方だけを見ると、もう片方が素通しの経路になる**（経路 ④ と経路 ⑥）。
 */
function guardedRelationsOf(model: string): readonly string[] {
  const forward = tenantRelationOf(model);
  const inverse = tenantKeyMovingRelationsOf(model);
  return forward === null ? inverse : [forward, ...inverse];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};
}

/**
 * where に `AND: [..., { [tenantKey]: tenantId }]` を足す。
 *
 * 🔴 最上位へのマージ（上書き）にしない理由: 上書きは呼び出し側の条件を静かに書き換える。
 *    `deleteMany({ where: { tenantId: 他テナント } })` が「何も消さない」ではなく
 *    「自テナントの行を全部消す」に化けうる。`AND` なら条件は**狭まる方向にしか動かない**ため、
 *    他テナントを指定したクエリは必ず 0 件になる（docs/05 §4.7 #3「0 件」/ §4.8「見えない ＝ 存在しない」）。
 *
 * 🔴 `AND` に入れても `findUnique` は壊れない。呼び出し側の一意フィールドは最上位に残り、
 *    `AND` は追加のフィルタとして評価される（Prisma の extendedWhereUnique）。
 */
function withScopedWhere(args: UnknownRecord, predicate: UnknownRecord): UnknownRecord {
  const where = asRecord(args['where']);
  const existing = where['AND'];
  const and = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  return { ...args, where: { ...where, AND: [...and, predicate] } };
}

/**
 * 注入する述語を作る。
 *
 * 🔴 `intent` が `READ` のときだけ、宣言された戦略に応じて述語を緩める（グローバル行 / 全テナント宛）。
 *    `WRITE`（`update` / `upsert` / `delete`）は常に「テナントキー = ctx」に絞る。
 *    緩和を書き込みにも効かせると、テナントからグローバル行を書き換え・削除できてしまう。
 */
function scopePredicate(
  strategy: TenantScopeStrategyKind,
  tenantKey: string,
  tenantId: string,
  intent: 'READ' | 'WRITE',
): UnknownRecord {
  if (strategy === 'ARRAY_MEMBERSHIP') {
    // 読み取り専用モデル（呼び出し側は intent='READ' でしか到達しない）。
    return {
      OR: [{ [tenantKey]: { isEmpty: true } }, { [tenantKey]: { has: tenantId } }],
    };
  }
  if (strategy === 'COLUMN_WITH_GLOBAL_ROWS' && intent === 'READ') {
    return { OR: [{ [tenantKey]: tenantId }, { [tenantKey]: null }] };
  }
  return { [tenantKey]: tenantId };
}

/**
 * 🔴 テナントキー列を書き換えうるリレーションへの書き込みを一律拒否する（方向を問わない）。
 *
 * 値の形（`connect` / `set` / `create` / `connectOrCreate` / `disconnect` / `update` / …）で
 * 場合分けしない。場合分けは Prisma のネスト書き込み構文が増えるたびに穴が空くうえ、
 * 「自テナントへの connect」だけを許しても得られるものが無い（スカラーキーは拡張が確定させる）。
 *
 * 🔴 宣言されたフィールド名だけを見る。「オブジェクト値を一律拒否」にはしない
 *    （Json 列・DateTime・スカラーの `{ set: … }` が正当なオブジェクト値として来るため）。
 *    宣言と Prisma スキーマの実体の一致は `tenant-relation.test.ts` が毎回検証する。
 */
function assertNoTenantRelationWrite(record: UnknownRecord, relations: readonly string[]): void {
  for (const relation of relations) {
    if (record[relation] !== undefined) {
      throw new TenantRelationWriteError(relation);
    }
  }
}

/**
 * 更新データのスカラー値を取り出す。
 * 🔴 Prisma のスカラー更新は素の値と `{ set: value }` の 2 形をとる
 *    （`StringFieldUpdateOperationsInput`）。片方だけ検査すると、もう片方が素通しの経路になる。
 *    どちらでもない形（`{ increment: … }` 等）は解釈できないため fail-closed 側に倒す。
 */
function updateTargetValue(supplied: unknown): { readonly known: boolean; readonly value: unknown } {
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    return { known: true, value: supplied };
  }
  const record = supplied as UnknownRecord;
  if ('set' in record) return { known: true, value: record['set'] };
  return { known: false, value: supplied };
}

/** 🔴 書き込みデータがテナントキーを他テナントへ動かそうとしていないことを確かめる。 */
function assertTenantKeyNotMoved(
  record: UnknownRecord,
  tenantKey: string,
  tenantId: string,
): void {
  const supplied = record[tenantKey];
  if (supplied === undefined) return; // 未指定 = 変更しない。正常系。
  const target = updateTargetValue(supplied);
  if (!target.known || (target.value !== undefined && target.value !== tenantId)) {
    throw new CrossTenantWriteError(tenantKey);
  }
}

/** create 系の 1 行分。テナントキーを ctx の値で確定させる。 */
function scopedRow(
  row: unknown,
  tenantKey: string,
  tenantId: string,
  relations: readonly string[],
): UnknownRecord {
  const record = asRecord(row);
  assertNoTenantRelationWrite(record, relations);
  // 🔴 書き込みには「狭める」が無いため、値を確定させるしかない。呼び出し側が別テナントを
  //    指定していたら静かに書き換えず、明示的に落とす（CLAUDE.md §3.1「分離キーはリクエスト
  //    入力から受け取らない」/ 事故を握り潰さない）。
  assertTenantKeyNotMoved(record, tenantKey, tenantId);
  return { ...record, [tenantKey]: tenantId };
}

function withScopedData(
  data: unknown,
  tenantKey: string,
  tenantId: string,
  relations: readonly string[],
): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => scopedRow(row, tenantKey, tenantId, relations));
  }
  return scopedRow(data, tenantKey, tenantId, relations);
}

/**
 * update 系の data。🔴 create と違い、値を書き足さず「動かそうとしていないこと」だけを検査する。
 * 未指定はそのモデルの所属を変えない正常系であり、そこへ `tenantId` を注入すると
 * `updateMany` の意味（一致した全行の該当列を更新する）を変えてしまうため。
 */
function verifiedUpdateData(
  data: unknown,
  tenantKey: string,
  tenantId: string,
  relations: readonly string[],
): unknown {
  if (Array.isArray(data)) {
    for (const row of data) {
      const record = asRecord(row);
      assertNoTenantRelationWrite(record, relations);
      assertTenantKeyNotMoved(record, tenantKey, tenantId);
    }
    return data;
  }
  const record = asRecord(data);
  assertNoTenantRelationWrite(record, relations);
  assertTenantKeyNotMoved(record, tenantKey, tenantId);
  return data;
}

/**
 * 1 回の Prisma 操作の引数にテナントスコープを注入した新しい引数を返す（引数は破壊しない）。
 * `model` が射程外なら引数をそのまま返す。
 */
export function injectTenantScope(params: {
  model: string;
  operation: string;
  args: unknown;
  tenantId: string;
}): unknown {
  const { model, operation, args, tenantId } = params;
  const strategy = tenantScopeStrategyOf(model);
  // 🔴 C0 SYSTEM_ONLY はテナント文脈から触れない。素通しせず例外にする（fail-closed）。
  if (strategy === 'NO_TENANT_KEY') throw new SystemOnlyModelAccessError(model, operation);
  const tenantKey = tenantKeyOf(model);
  if (tenantKey === null || strategy === null) return args;
  const relations = guardedRelationsOf(model);
  const readPredicate = scopePredicate(strategy, tenantKey, tenantId, 'READ');
  const writePredicate = scopePredicate(strategy, tenantKey, tenantId, 'WRITE');

  const record = asRecord(args);

  if (READ_OPERATIONS.has(operation)) {
    return withScopedWhere(record, readPredicate);
  }

  const isKnownWrite =
    DELETE_OPERATIONS.has(operation) ||
    UPDATE_OPERATIONS.has(operation) ||
    CREATE_OPERATIONS.has(operation) ||
    UPSERT_OPERATIONS.has(operation);

  // 🔴 テナント文脈から書けないモデルは、ここで fail-closed にする（DB 権限との二重）。
  //    分類の無い操作は最後の UnscopedOperationError に落とす（素通しはしない）。
  if (strategy === 'ARRAY_MEMBERSHIP' && isKnownWrite) {
    throw new ReadOnlyModelWriteError(model, operation);
  }

  if (DELETE_OPERATIONS.has(operation)) {
    return withScopedWhere(record, writePredicate);
  }

  if (UPDATE_OPERATIONS.has(operation)) {
    const scoped = withScopedWhere(record, writePredicate);
    return { ...scoped, data: verifiedUpdateData(record['data'], tenantKey, tenantId, relations) };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    return { ...record, data: withScopedData(record['data'], tenantKey, tenantId, relations) };
  }

  if (UPSERT_OPERATIONS.has(operation)) {
    const scoped = withScopedWhere(record, writePredicate);
    return {
      ...scoped,
      create: withScopedData(record['create'], tenantKey, tenantId, relations),
      update: verifiedUpdateData(record['update'], tenantKey, tenantId, relations),
    };
  }

  throw new UnscopedOperationError(model, operation);
}

/**
 * 🔴 経路 5 の射影ビューに「当事者」の述語を注入する（docs/05 §4.9）。
 *
 * 行の絞り込み自体は第 1 防御（RLS の C9）が行うため、これは**第 2 防御**である
 * （RLS が静かに無効化されても、注入された `where` が他社の当事者レコードを排除する）。
 * 加えてホストのプレビュー（`S-029` / `S-025` の「取引先にはこう見えています」）では、
 * C9 がホスト文脈で偽になり C2 で全行が見えるため、**この注入だけが対象パートナーへ絞る**。
 *
 * 🔴 当事者の値は `withPartnerScope` が ①パートナー文脈なら `ctx.partnerCompanyId`
 *    ②ホストのプレビューなら明示引数 のどちらか一方だけから決める（`BR-03`。
 *    リクエスト入力で当事者を指定できるのはホストのプレビューに限られ、その検証は
 *    `withPartnerScope` が実行時に行う）。
 *
 * 🔴 `PartnerContractDocumentsV` には「署名済み最終版のみ」（`F-066 AC-2`）も AND する。
 *    C9 の `AND signed_at IS NOT NULL` と同じ述語である。ビューの定義（docs/05 §4.9）は
 *    `SELECT … FROM contract_documents` のみで WHERE を持たないため、**RLS が静かに
 *    無効化されるとドラフト版が射影に現れる**。C9 の述語を第 2 防御でもそのまま鏡写しにして、
 *    「片方が落ちても止まる」を経路 5 でも成立させる（docs/05 §4.1 の二重防御）。
 *
 * 🔴 射影ビュー以外のモデルは素通しする（本拡張の責務は経路 5 の当事者スコープだけであり、
 *    テナントスコープの注入は `injectTenantScope` が同じクライアントで別途行う）。
 */
export function injectPartnerViewScope(params: {
  model: string;
  operation: string;
  args: unknown;
  counterpartyPartnerCompanyId: string;
}): unknown {
  const { model, operation, args, counterpartyPartnerCompanyId } = params;
  if (!isPartnerViewModel(model)) return args;
  if (!READ_OPERATIONS.has(operation)) throw new PartnerViewWriteError(model, operation);
  const predicate: UnknownRecord = { counterpartyPartnerCompanyId };
  if (model === 'PartnerContractDocumentsV') {
    predicate['signedAt'] = { not: null };
  }
  return withScopedWhere(asRecord(args), predicate);
}
