// packages/db/src/with-tenant.ts
// 🔴 主平面が業務データに触れる唯一の経路（CLAUDE.md §3.1 / docs/05 §4.3）。
//    第 1 防御（RLS への SET LOCAL）と第 2 防御（Prisma 拡張の where 注入）を
//    同じ 1 箇所で必ず両方適用する。片方だけ適用される経路を作らない（docs/03 §4.3.2）。
import type { PrismaClient } from '@prisma/client';
import { getBaseClient } from './client.js';
import {
  PartnerScopeTargetError,
  type AuthenticatedTenantCtx,
  type HostTenantCtx,
} from './context.js';
import { partnerViewScopeExtension, tenantScopeExtension } from './extension.js';
import {
  systemScopeSettingsSql,
  tenantScopeSettingsSql,
  type TenantScopeSettings,
} from './scope-settings.js';

/** 第 2 防御（Prisma 拡張）の注入に要るのは分離キー 2 つだけ（ロール・利用者 ID は使わない）。 */
type ScopeKeys = {
  readonly tenantId: string;
  readonly partnerCompanyId: string | null;
};

function extendWithTenantScope(client: PrismaClient, scope: ScopeKeys) {
  return client.$extends(
    tenantScopeExtension({ tenantId: scope.tenantId, partnerCompanyId: scope.partnerCompanyId }),
  );
}

type ExtendedClient = ReturnType<typeof extendWithTenantScope>;

/** `$transaction` のコールバックが受け取るクライアント（`$transaction` 等は Prisma 側で除去済み）。 */
type TenantTransactionClient = Parameters<Parameters<ExtendedClient['$transaction']>[0]>[0];

/**
 * 🔴 経路 5（当事者レコードの参照）の**基底表**のデリゲート（docs/05 §4.3-6 / §4.4 C9）。
 *    C9 が行を通してもパートナーは列を読めてはならず（`F-065 AC-2` / `F-066 AC-3`）、
 *    パートナーが到達してよいのは §4.9 の射影ビュー（`PartnerScopeDb`）だけである。
 *    したがって 5 デリゲートは `TenantDb` の型から除去し、`withHostTenant` だけが渡す。
 *    実行時の担保は `packages/db/src/scope-injection.ts` の
 *    `assertPartnerBaseTableNotAccessed`（`PARTNER_BASE_TABLE_MODELS`）。
 */
type CounterpartyDelegate =
  | 'assignment'
  | 'contract'
  | 'contractDocument'
  | 'order'
  | 'extensionReview';

/**
 * `fn` に渡すクライアント。
 * 🔴 生 SQL の入口を型から除去する（docs/05 §4.3 実装の規約 3）。拡張のフックを通らないため。
 * 🔴 経路 5 の基底表 5 デリゲートも除去する（同・規約 6）。**型で到達不能にする**のが第 1 層であり、
 *    「アプリは直接読まない」という規約文にしない。
 * 🔴 export しない（`fn` の引数型としてのみ現れる。docs/05 §4.3 違反時の挙動）。
 */
type TenantDb = Omit<
  TenantTransactionClient,
  '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe' | CounterpartyDelegate
>;

/**
 * `withHostTenant` が `fn` に渡すクライアント（docs/05 §4.3 実装の規約 6）。
 * 🔴 `TenantDb` に 5 デリゲートを戻したもの。**5 デリゲートを渡す関数は `withHostTenant` だけ**であり、
 *    その引数 `ctx` は `requireHost`（または `apps/worker` の `systemTenantCtx`）でしか作れない。
 * 🔴 export しない（`TenantDb` と同じ理由）。
 */
type HostTenantDb = TenantDb & Pick<TenantTransactionClient, CounterpartyDelegate>;

/**
 * 🔴 トランザクションの分離レベル（T-04-09。docs/05 §6.7 #84 / #85）。
 *
 * **既定（省略時）は PostgreSQL の既定である `Read Committed`** であり、ほぼすべての経路は
 * それでよい（RLS と第 2 防御は分離レベルに依存しない）。`'Serializable'` を要求するのは
 * **「読んだ集合に対する判定の結果で書く」経路**だけである（write skew。下記）。
 *
 * 🔴 なぜ列挙で持つか: 呼び出し側が任意の文字列を渡せる形にすると、`Read Uncommitted` の
 *    ような**弱める**指定が書けてしまう。強める方向の 1 値しか置かない。
 */
export type TenantTransactionIsolationLevel = 'Serializable';

export type TenantTransactionOptions = {
  readonly isolationLevel?: TenantTransactionIsolationLevel;
};

/**
 * 🔴 直列化に失敗した（PostgreSQL の `40001` / `40P01`。Prisma の `P2034`）。T-04-09。
 *
 * **これは障害ではなく「同時に実行された」ことの通知である。** API 境界は 409 に写像し、
 * 利用者に再実行を促す（`apps/web/lib/api/errors.ts` の `ConcurrentUpdateError`）。
 * 🔴 **自動で再試行しない。** 本エラーが出る経路は「読んだ結果で書く」判定を含んでおり、
 *    黙って再実行すると**判定をやり直したのか、同じ判定で書き直したのかが記録から読めない**
 *    （`CLAUDE.md` §4.2「失敗と保留を混同しない」と同じ考え方）。
 */
export class TransactionSerializationError extends Error {
  constructor(cause?: unknown) {
    super(
      '同時に実行された操作と競合したため、トランザクションを直列化できませんでした（docs/05 §6.7）。',
    );
    this.name = 'TransactionSerializationError';
    this.cause = cause;
  }
}

/** Prisma が直列化失敗・デッドロックに割り当てるコード（`P2034`）。 */
function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'P2034'
  );
}

/**
 * 🔴 `withTenant` / `withHostTenant` / `loadTenantMembership`（`auth-context.ts`）の共通実装。
 *    トランザクションを開き、その先頭で `SET LOCAL` 相当（`set_config(..., true)`）を発行する。
 *    複数の関数で手順を書き分けない（どれか 1 つだけ `SET LOCAL` を忘れる経路を作らないため）。
 *
 * 🔴 T-03-01: 引数を `AuthenticatedTenantCtx` から `TenantScopeSettings`（分離キー 3 つ）へ
 *    狭めた。`loadTenantMembership` は「ロールを DB から確定させる」関数であり、
 *    呼び出し時点でロールが未確定である。ctx を要求すると**仮のロールを詰めた ctx**を
 *    組み立てることになり、「ロールを騙った ctx が一瞬でも存在しうる」状態を作ってしまう。
 *    RLS が参照するのは `app.tenant_id` / `app.partner_company_id` / `app.actor_user_id` の
 *    3 つだけであり（docs/05 §4.4）、ロールは第 1・第 2 防御のいずれにも寄与しない。
 * @internal packages/db の内部からのみ使う（index.ts から export しない）。
 */
export async function runInTenantTransaction<T>(
  scope: TenantScopeSettings,
  fn: (tx: TenantTransactionClient) => Promise<T>,
  options?: TenantTransactionOptions,
): Promise<T> {
  const scoped = extendWithTenantScope(getBaseClient(), {
    tenantId: scope.tenantId,
    partnerCompanyId: scope.partnerCompanyId,
  });
  try {
    return await scoped.$transaction(
      async (tx) => {
        await tx.$queryRaw(tenantScopeSettingsSql(scope));
        return fn(tx);
      },
      options?.isolationLevel === undefined ? undefined : { isolationLevel: options.isolationLevel },
    );
  } catch (error) {
    // 🔴 直列化失敗を専用の型にする（T-04-09）。**握り潰さず、500 にも潰さない。**
    //    ここは主平面のテナントトランザクションが必ず通る 1 箇所であり、写像を各所に散らさない。
    //    🔴 分離レベルの指定が無い経路でもデッドロックで `P2034` は起こりうるため、
    //       条件を `isolationLevel` の有無で絞らない（絞ると「たまに 500 になる」経路が残る）。
    if (isSerializationFailure(error)) throw new TransactionSerializationError(error);
    throw error;
  }
}

/** `ctx`（認証済み文脈）から `SET LOCAL` に渡す 3 つの分離キーを取り出す。 */
function scopeOf(ctx: AuthenticatedTenantCtx): TenantScopeSettings {
  return {
    tenantId: ctx.tenantId,
    partnerCompanyId: ctx.partnerCompanyId,
    actorUserId: ctx.userId,
  };
}

/**
 * テナント文脈で業務データにアクセスする。
 *
 * 🔴 `ctx` は `resolveTenantCtx` でしか作れない = 分離キーがリクエスト入力から来る経路が無い。
 * 🔴 必ず `$transaction` を開き、その先頭で `SET LOCAL`（= `set_config(..., true)`）を発行する。
 *
 * 🔴 `options.isolationLevel = 'Serializable'`（T-04-09）は、**「読んだ集合に対する判定の結果で
 *    書く」経路にだけ**指定する。典型は「最後の 1 人の `OWNER` を降格・無効化させない」
 *    （docs/05 §6.7 #84 / #85）で、これは write skew の教科書例そのものである ——
 *    `COUNT` → 判定 → `UPDATE` を `Read Committed` で行うと、**2 つの要求が互いの書き込みを
 *    見ないまま両方とも「まだ 2 人居る」と判断して通過し、`OWNER` が 0 人になる**。
 *    PostgreSQL の SSI（`Serializable`）は述語の読みと書きの依存を検出して片方を
 *    `40001` で落とすため、この 1 行で不変条件が守られる。
 *    🔴 失敗は `TransactionSerializationError` として上がる（API 境界が 409 に写像）。
 */
export async function withTenant<T>(
  ctx: AuthenticatedTenantCtx,
  fn: (db: TenantDb) => Promise<T>,
  options?: TenantTransactionOptions,
): Promise<T> {
  return runInTenantTransaction(scopeOf(ctx), (tx) => fn(tx), options);
}

/**
 * ホスト文脈で経路 5 の基底表（`assignment` 等）に触れる唯一の関数（docs/05 §4.3 実装の規約 6）。
 *
 * 🔴 `ctx` は `requireHost` を経た `HostTenantCtx` でしか作れない = パートナー文脈からは
 *    型レベルで呼び出せない。
 * 🔴 `withTenant` へは委譲できない（`fn` が要求する `HostTenantDb` に対し、`withTenant` が
 *    渡すのは 5 デリゲートを落とした `TenantDb` であり型が合わない）。T-01-06 が仕込んだ
 *    「委譲したままだと SP-02 で型エラーになる」強制装置がここで発火した。共通処理は
 *    `runInTenantTransaction` に置き、渡す型だけを変える。
 */
export async function withHostTenant<T>(
  ctx: HostTenantCtx,
  fn: (db: HostTenantDb) => Promise<T>,
): Promise<T> {
  return runInTenantTransaction(scopeOf(ctx), (tx) => fn(tx));
}

// ---------------------------------------------------------------------------
// 経路 5（当事者レコードの参照）の読み取り（docs/05 §4.9 / CLAUDE.md §3.1-5 / BR-65〜BR-69）
// ---------------------------------------------------------------------------

function extendWithPartnerViewScope(
  client: PrismaClient,
  ctx: AuthenticatedTenantCtx,
  counterpartyPartnerCompanyId: string,
) {
  return extendWithTenantScope(client, scopeOf(ctx)).$extends(
    partnerViewScopeExtension({ counterpartyPartnerCompanyId }),
  );
}

type PartnerExtendedClient = ReturnType<typeof extendWithPartnerViewScope>;
type PartnerTransactionClient = Parameters<
  Parameters<PartnerExtendedClient['$transaction']>[0]
>[0];

/** docs/05 §4.9 の射影ビュー 4 本に対応する Prisma のデリゲート名。 */
type PartnerViewDelegate =
  | 'partnerAssignmentsV'
  | 'partnerContractsV'
  | 'partnerContractDocumentsV'
  | 'partnerOrdersV';

/**
 * 🔴 経路 5 の読み取りはこの型でしか受け取れない（docs/05 §4.9）。
 *
 * - 見えるのは射影ビュー 4 本だけ（基底表のデリゲートは 1 つも無い）。
 * - 操作は `findMany` / `count` だけ（`total` は「同じビュー・同じ `where` の `COUNT`」）。
 *   書き込みは型に無く、DB 側も `GRANT SELECT` しか持たない（`BR-68`）。
 * 🔴 これは `TenantDb` と違って **export する**（docs/05 §4.9 のとおり。API 層が
 *    `toPartnerView()` の入力型として参照する）。
 */
export type PartnerScopeDb = {
  readonly [K in PartnerViewDelegate]: Pick<PartnerTransactionClient[K], 'findMany' | 'count'>;
};

/**
 * 🔴 当事者を決める唯一の引数（docs/05 §4.9「当事者判定」）。
 *
 * `previewPartnerCompanyId` は **ホストのプレビュー**（`S-029` / `S-025` の
 * 「取引先にはこう見えています」）専用である。パートナー自身の当事者は
 * `ctx.partnerCompanyId`（認証コンテキスト）からしか来ない（`BR-03`）。
 */
export type PartnerScopeTarget = {
  readonly previewPartnerCompanyId?: string;
};

/**
 * 当事者を 1 つに確定する。🔴 fail-closed（決められないなら 0 件ではなく例外）。
 *
 * - パートナー文脈: `ctx.partnerCompanyId`。`previewPartnerCompanyId` の指定は拒否する
 *   （リクエスト入力で当事者を指定できてはならない。`CLAUDE.md` §3.1 / `BR-03`）。
 * - ホスト文脈: `previewPartnerCompanyId` が必須（プレビュー対象が無ければ絞りようがない）。
 */
function resolvePartnerScopeCounterparty(
  ctx: AuthenticatedTenantCtx,
  target: PartnerScopeTarget,
): string {
  if (ctx.partnerCompanyId !== null) {
    if (target.previewPartnerCompanyId !== undefined) {
      throw new PartnerScopeTargetError(
        'パートナー文脈では previewPartnerCompanyId を指定できません（当事者は認証コンテキストから決まります）。',
      );
    }
    return ctx.partnerCompanyId;
  }
  if (target.previewPartnerCompanyId === undefined) {
    throw new PartnerScopeTargetError(
      'ホスト文脈で経路 5 の射影を読むには previewPartnerCompanyId（プレビュー対象の取引先）が必要です。',
    );
  }
  return target.previewPartnerCompanyId;
}

/**
 * 経路 5（当事者レコードの参照）の射影ビューを読む唯一の関数（docs/05 §4.9）。
 *
 * 🔴 行は C9（RLS）が絞り、列は DB のビューが絞る。アプリの `select` の書き分けには頼らない。
 * 🔴 ホストのプレビューとパートナー本人で**同じビュー・同じシリアライザ**を使う
 *    （2 実装にすると片方だけ開示が漏れる。docs/04 申し送り 9）。
 * 🔴 書き込みは無い（`BR-68`）。`PartnerScopeDb` に書き込みのデリゲートが存在しない。
 */
export async function withPartnerScope<T>(
  ctx: AuthenticatedTenantCtx,
  target: PartnerScopeTarget,
  fn: (db: PartnerScopeDb) => Promise<T>,
): Promise<T> {
  const counterpartyPartnerCompanyId = resolvePartnerScopeCounterparty(ctx, target);
  const scoped = extendWithPartnerViewScope(
    getBaseClient(),
    ctx,
    counterpartyPartnerCompanyId,
  );
  return scoped.$transaction(async (tx) => {
    await tx.$queryRaw(tenantScopeSettingsSql(scopeOf(ctx)));
    return fn(tx);
  });
}

/** 素の（拡張を適用していない）トランザクションクライアント。 */
type RawTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * `withSystemScope` が `fn` に渡すクライアント。
 * 🔴 C0 SYSTEM_ONLY の 3 表だけを型として渡す（docs/05 §4.4 / §4.4.2）。
 *    `impersonation_sessions` は同じ C0 だが `app_tenant` に権限が無いため含めない
 *    （管理平面の `app_platform*` 経由でのみ触れる）。
 * 🔴 export しない（`fn` の引数型としてのみ現れる）。
 */
type SystemScopeDb = Pick<RawTransactionClient, 'schedulerRun' | 'webhookDelivery' | 'emailEvent'>;

/**
 * テナント文脈を持たない接続で C0 SYSTEM_ONLY の 3 表にだけ触れる（docs/05 §4.4.2）。
 *
 * 🔴 `app.tenant_id` を設定しない（空文字で上書きする）ため `app_tenant_id()` は NULL になり、
 *    C0 以外の表のポリシーは 1 つも真にならない = 他表は 0 件・書き込み不可になる。
 *    「見えないのは型のおかげ」ではなく、**RLS でも 0 件**である点が要点である。
 * 🔴 Prisma 拡張（第 2 防御）は適用しない。注入すべき tenantId が存在しないためであり、
 *    ここでの防御は RLS と、渡す型を 3 デリゲートに絞ることによる。
 * 🔴 呼び出し元は docs/05 §4.4.2 の 3 箇所（webhook 受信 2 経路と `runScheduled()`）に限る。
 *    ESLint による呼び出し元の限定は、その 3 箇所が実在するようになる SP-03 以降に入れる
 *    （現時点で apps/** に呼び出し元は 1 つも無い）。
 */
export async function withSystemScope<T>(fn: (db: SystemScopeDb) => Promise<T>): Promise<T> {
  return getBaseClient().$transaction(async (tx) => {
    await tx.$queryRaw(systemScopeSettingsSql());
    return fn(tx);
  });
}
