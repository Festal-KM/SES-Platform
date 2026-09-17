// packages/db/src/quota-overrides.ts
// 🔴 テナント個別のクォータ上書き（`tenant_quota_overrides`。migration 20260924000000 / 20260928000000）の**テナント側の読み取り**
//    （docs/02 `F-057` 処理③ / docs/05 §5.8.1 ⑧ / §6.9 API-A6）。T-11-02 → T-12-12。
//
// ============================================================================
// 🔴 このファイルが答えるのは 3 つである
// ============================================================================
//   ① `resolveTenantQuotas` … 既定値（`packages/config` の `AI_UNIT_QUOTA_*_DEFAULT` / `EMAIL_DAILY_LIMIT_PER_TENANT` /
//      `STORAGE_LIMIT_BYTES_PER_TENANT`）と上書き行から「今日効いている上限」を **6 計測**について解く。🔴 `HostTenantCtx` 限定。
//      🔴 **判定（`usage.limit-check`）・表示（`GET /api/usage`）・執行（`email-send.ts` / `send-proposal.ts` /
//      `send-hold-release.ts`）の 3 者が同じ関数を通る** —— どれか 1 つが別の値を読むと
//      「停止中なのに残量がある」「上げたのに送られない」表示と実態の食い違いになる（T-11-02 NG-1 がまさにそれだった）。
//      選択の規則そのもの（適用日 ≤ 今日 の最新行）は `@ses/domain` の `resolveQuotaLimit` 1 実装であり、
//      運営者の一覧（`@ses/db/platform` の `readPlatformUsage`）も同じ関数で解く。**執行点が独自にこの表を読む経路は無い。**
//   ①' `resolveTenantStorageQuota` … ①のうち **`STORAGE_BYTES` 1 計測だけ**を、パートナー文脈（`AuthenticatedTenantCtx`）でも解く。
//      執行点は `issueSkillSheetUploadUrl`（ホスト / パートナーを問わず同じ関数）。①と同じ `resolveQuotaLimit` で解くので、
//      ホスト文脈の ① の `storageLimitBytes` と必ず一致する。
//   ② `listPendingQuotaLoweringNotices` … 🔴 引き下げ（`limit < previous_limit`）でまだ適用日が来ていない行。
//      `usage.limit-check` がテナント管理者へ通知（`email.dispatch`）する材料（`F-057 AC-3`「通知が必須」の実行側）。
//      通知の冪等性は `email_dispatches.dedupe_key`（テンプレート × 上書き行 ID × 宛先）が担うため、
//      この表に「通知済み」の列は無く、`app_tenant` は SELECT だけで足りる。
//
// 🔴 書き手はここに無い。`INSERT` は `app_platform_write`（`@ses/db/platform` の `setTenantQuotaOverride`）だけである。
// 🔴 金額（`AI_COST_USD`）は上書きの対象ではない（`QUOTA_OVERRIDE_METRICS`。運営者の内部指標は SP-20 の `Subscription`）。
// 🔴 T-12-12: 第二境界の線は **RLS と型の両方で同じ場所に引く**（`F-027 AC-1`「上限値はホスト所属ロールにのみ表示」）。
//    RLS（migration 20260928000000 ②）は C2 HOST_ONLY + `metric = 'STORAGE_BYTES'` の例外 —— パートナー文脈から見えるのは
//    自テナントの `STORAGE_BYTES` の行だけで、AI 4 単位 / `EMAIL_COUNT` の上限値は 1 行も見えない。
//    型は `resolveTenantQuotas(ctx: HostTenantCtx)`（6 計測）/ `resolveTenantStorageQuota(ctx: AuthenticatedTenantCtx)`（1 計測）。
//    パートナー文脈で 6 計測を解く経路をコンパイル時に無くす = 「読めたように見えて既定値が返る」（AI / メールが 0 行 = 常に既定値）
//    を型で防ぐ（T-11-02 の規律）。ストレージだけを開く理由は、取引先のアップロード（`PARTNER_*`）も同じテナントの枠を消費するため。
//    読む列は `id` / `metric` / `limit` / `effective_from` / `created_at` に固定し、`reason`（運営者の自由記述）と
//    `set_by_platform_user_id`（運営者の識別子）は **`app_tenant` に列 GRANT が無く SELECT できない**（同 ③）。
import { Prisma } from '@prisma/client';
import {
  AI_UNIT_METRICS,
  isQuotaOverrideMetric,
  resolveQuotaLimit,
  usagePeriodKey,
  type AiUnitMetric,
  type QuotaOverrideCountMetric,
  type QuotaOverrideMetric,
  type QuotaOverrideRow,
} from '@ses/domain';
import type { AuthenticatedTenantCtx, HostTenantCtx, SystemTenantCtx } from './context.js';
import { runInTenantTransaction, type TenantTransactionClient } from './with-tenant.js';

/** 上書きが無いときの上限（`packages/config` の値。呼び出し側が起動時に解決して渡す）。 */
export type TenantQuotaDefaults = {
  readonly aiUnitQuotas: Readonly<Record<AiUnitMetric, number>>;
  readonly emailDailyLimit: number;
  readonly storageLimitBytes: bigint;
};

export type QuotaSource = 'DEFAULT' | 'OVERRIDE';

/** 今日効いている上限（判定関数が受け取る型で返す）。 */
export type ResolvedTenantQuotas = {
  readonly dayKey: string;
  readonly aiUnitQuotas: Readonly<Record<AiUnitMetric, number>>;
  /** `decideEmailRate` / `reserveEmailDailyQuota` の `limit`。分次上限は含まない（上書きの対象外）。 */
  readonly emailDailyLimit: number;
  /** `decideStorageUpload` の `limitBytes`。 */
  readonly storageLimitBytes: bigint;
  /** 各計測の出所（`S-038` は出さない。`A-004` と結合テストが見る）。 */
  readonly sources: Readonly<Record<QuotaOverrideMetric, QuotaSource>>;
};

/** 今日効いているストレージ上限（`resolveTenantStorageQuota`。`ResolvedTenantQuotas` の `STORAGE_BYTES` 部分と同じ値）。 */
export type ResolvedTenantStorageQuota = {
  readonly dayKey: string;
  /** `decideStorageUpload` の `limitBytes`。 */
  readonly storageLimitBytes: bigint;
  readonly source: QuotaSource;
};

type OverrideRow = {
  readonly id: string;
  readonly metric: string;
  readonly limit: bigint;
  /** `effective_from::text`（`YYYY-MM-DD`。`date` を JS の `Date` にしない = タイムゾーンで日がずれない）。 */
  readonly effective_from: string;
  readonly created_at: Date;
};

/** 行 → domain の型。値集合の外の値は握り潰さない（CHECK の前提が壊れている）。 */
function toQuotaOverrideRow(row: OverrideRow): QuotaOverrideRow {
  if (!isQuotaOverrideMetric(row.metric)) {
    throw new Error(`tenant_quota_overrides に未知の metric があります（${row.metric}）。`);
  }
  return {
    id: row.id,
    metric: row.metric,
    limit: BigInt(row.limit),
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

const MAX_SAFE_COUNT = BigInt(Number.MAX_SAFE_INTEGER);

/** 件数・通数の上限を `number` へ（判定関数 `decideAiUnitQuota` / `decideEmailRate` の入力型）。 */
function toCountLimit(metric: QuotaOverrideCountMetric, limit: bigint): number {
  if (limit > MAX_SAFE_COUNT) {
    throw new RangeError(`${metric} の上限が Number の安全整数を超えています（${limit}）。`);
  }
  return Number(limit);
}

/**
 * 🔴 読む列はこの 5 列に固定する（`reason` / `set_by_platform_user_id` / `previous_limit` を持ち帰らない）。
 *    `app_tenant` には前 2 列の GRANT が無いため、ここに足すと実行時に permission denied になる（黙って空にならない）。
 */
async function selectRows(
  tx: TenantTransactionClient,
  tenantId: string,
  where: Prisma.Sql,
): Promise<readonly QuotaOverrideRow[]> {
  const rows = await tx.$queryRaw<OverrideRow[]>(Prisma.sql`
    SELECT id::text AS id, metric, "limit", effective_from::text AS effective_from, created_at
      FROM tenant_quota_overrides
     WHERE tenant_id = ${tenantId}::uuid
       AND ${where}
     ORDER BY metric ASC, effective_from DESC, created_at DESC, id DESC`);
  return rows.map(toQuotaOverrideRow);
}

/**
 * 🔴 ① 今日（`Asia/Tokyo`）効いている上限を 6 計測について解く（純粋部分は `resolveQuotaLimit`）。
 *
 * 🔴 `HostTenantCtx` を要求する（ジョブ文脈 `SystemTenantCtx` を含む）: RLS は C2（+ `STORAGE_BYTES` 例外）であり、パートナー文脈では
 *    AI 4 単位 / `EMAIL_COUNT` の行が 0 行 = 常に既定値に見えてしまう。「読めたように見えて既定値が返る」を型で防ぐ
 *    （`F-027 AC-1`。上限値はホスト所属ロールにのみ表示する）。パートナー文脈で要るのはストレージだけであり、
 *    それは `resolveTenantStorageQuota` が担う。現在時刻は引数で受ける（決定的に検証できる）。
 * 🔴 執行点はこの関数（または `resolveTenantStorageQuota`）の戻り値以外から上限を得てはならない（deps に固定値を渡す口を型から消してある）。
 */
export async function resolveTenantQuotas(
  ctx: HostTenantCtx,
  input: { readonly now: Date; readonly defaults: TenantQuotaDefaults },
): Promise<ResolvedTenantQuotas> {
  const dayKey = usagePeriodKey('DAY', input.now);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<ResolvedTenantQuotas> => {
      // 🔴 将来の行は読まない（効かない行を持ち帰らない）。選択は domain に委ねる。
      const rows = await selectRows(tx, ctx.tenantId, Prisma.sql`effective_from <= ${dayKey}::date`);
      return resolveQuotasFromRows({ rows, dayKey, defaults: input.defaults });
    },
  );
}

/**
 * 🔴 ①' 今日効いている **ストレージ上限だけ**を解く。ホスト / パートナー / ジョブ文脈のいずれでも呼べる。
 *
 * `issueSkillSheetUploadUrl`（`decideStorageUpload`）の執行点。取引先のアップロード（`PARTNER_*`。自社エンジニアのスキルシート）も
 * 同じテナントの枠を消費するため、パートナー文脈でも上書きが効かなければならない（T-11-02 NG-1 と同じ事故になる）。
 * 🔴 SQL の述語で `metric = 'STORAGE_BYTES'` に絞る（RLS の例外〔migration 20260928000000 ②〕と同じ線。ホスト文脈でも
 *    他の計測の行を持ち帰らない）。選択の規則は ① と同じ `resolveQuotaLimit` なので、ホスト文脈の ① の `storageLimitBytes`
 *    と必ず一致する（結合テスト `quota-override-enforcement.test.ts` ③ が固定）。
 */
export async function resolveTenantStorageQuota(
  ctx: AuthenticatedTenantCtx,
  input: { readonly now: Date; readonly defaults: TenantQuotaDefaults },
): Promise<ResolvedTenantStorageQuota> {
  const dayKey = usagePeriodKey('DAY', input.now);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<ResolvedTenantStorageQuota> => {
      const rows = await selectRows(
        tx,
        ctx.tenantId,
        Prisma.sql`metric = 'STORAGE_BYTES' AND effective_from <= ${dayKey}::date`,
      );
      const resolved = resolveQuotaLimit({
        rows,
        metric: 'STORAGE_BYTES',
        onDate: dayKey,
        defaultLimit: input.defaults.storageLimitBytes,
      });
      return { dayKey, storageLimitBytes: resolved.limit, source: resolved.source };
    },
  );
}

/**
 * 行 → 効いている上限（I/O なし）。6 計測すべてを `resolveQuotaLimit`（1 実装）で解く。
 */
function resolveQuotasFromRows(input: {
  readonly rows: readonly QuotaOverrideRow[];
  readonly dayKey: string;
  readonly defaults: TenantQuotaDefaults;
}): ResolvedTenantQuotas {
  const sources = {} as Record<QuotaOverrideMetric, QuotaSource>;
  const aiUnitQuotas = {} as Record<AiUnitMetric, number>;
  const resolve = (metric: QuotaOverrideMetric, defaultLimit: bigint): bigint => {
    const resolved = resolveQuotaLimit({ rows: input.rows, metric, onDate: input.dayKey, defaultLimit });
    sources[metric] = resolved.source;
    return resolved.limit;
  };
  for (const metric of AI_UNIT_METRICS) {
    aiUnitQuotas[metric] = toCountLimit(metric, resolve(metric, BigInt(input.defaults.aiUnitQuotas[metric])));
  }
  const emailDailyLimit = toCountLimit('EMAIL_COUNT', resolve('EMAIL_COUNT', BigInt(input.defaults.emailDailyLimit)));
  // 🔴 バイト数は `bigint` のまま（`decideStorageUpload` の入力型。安全整数を超えうる）。
  const storageLimitBytes = resolve('STORAGE_BYTES', input.defaults.storageLimitBytes);
  return { dayKey: input.dayKey, aiUnitQuotas, emailDailyLimit, storageLimitBytes, sources };
}

/** 引き下げ予告の材料 1 件（通知の `dedupeKey` の `targetId` は `overrideId`）。 */
export type PendingQuotaLoweringNotice = {
  readonly overrideId: string;
  readonly metric: QuotaOverrideMetric;
  readonly effectiveFrom: string;
};

/**
 * 🔴 ② 引き下げ（`limit < previous_limit`）で、適用日が今日以降の行（= まだ予告として意味のある行）。
 *
 * `SystemTenantCtx` を要求する: 通知を積むのはジョブ（`usage.limit-check`）だけである。
 * 🔴 「通知済みか」はこの関数では判定しない —— `reserveEmailDispatch` の `dedupeKey`（UNIQUE）が 2 通目を作らない。
 *    適用日を過ぎた行は対象から外れる（過ぎてから「これから下がる」と通知しない）。
 */
export async function listPendingQuotaLoweringNotices(
  ctx: SystemTenantCtx,
  now: Date,
): Promise<readonly PendingQuotaLoweringNotice[]> {
  const dayKey = usagePeriodKey('DAY', now);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await selectRows(
        tx,
        ctx.tenantId,
        Prisma.sql`"limit" < previous_limit AND effective_from >= ${dayKey}::date`,
      );
      return rows.map((row) => ({ overrideId: row.id, metric: row.metric, effectiveFrom: row.effectiveFrom }));
    },
  );
}
