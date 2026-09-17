// packages/db/src/quota-overrides.ts
// 🔴 テナント個別のクォータ上書き（`tenant_quota_overrides`。migration 20260924000000）の**テナント側の読み取り**
//    （docs/02 `F-057` 処理③ / docs/05 §5.8.1 ⑧ / §6.9 API-A6）。T-11-02。
//
// ============================================================================
// 🔴 このファイルが答えるのは 2 つである
// ============================================================================
//   ① `resolveTenantQuotas` … 既定値（`packages/config` の `AI_UNIT_QUOTA_*_DEFAULT` / `EMAIL_DAILY_LIMIT_PER_TENANT` /
//      `STORAGE_LIMIT_BYTES_PER_TENANT`）と上書き行から「今日効いている上限」を解く。
//      🔴 ワーカー（`usage.limit-check`。判定・通知）と主平面（`GET /api/usage`。表示）が**同じ関数**を通る ——
//      判定と表示で上限値がずれると「停止中なのに残量がある」表示になる（T-10-03 と同じ規律）。
//      選択の規則そのもの（適用日 ≤ 今日 の最新行）は `@ses/domain` の `resolveQuotaLimit` 1 実装であり、
//      運営者の一覧（`@ses/db/platform` の `readPlatformUsage`）も同じ関数で解く。
//   ② `listPendingQuotaLoweringNotices` … 🔴 引き下げ（`limit < previous_limit`）でまだ適用日が来ていない行。
//      `usage.limit-check` がテナント管理者へ通知（`email.dispatch`）する材料（`F-057 AC-3`「通知が必須」の実行側）。
//      通知の冪等性は `email_dispatches.dedupe_key`（テンプレート × 上書き行 ID × 宛先）が担うため、
//      この表に「通知済み」の列は無く、`app_tenant` は SELECT だけで足りる。
//
// 🔴 書き手はここに無い。`INSERT` は `app_platform_write`（`@ses/db/platform` の `setTenantQuotaOverride`）だけである。
// 🔴 金額（`AI_COST_USD`）は上書きの対象ではない（`QUOTA_OVERRIDE_METRICS`。運営者の内部指標は SP-20 の `Subscription`）。
// 🔴 メール（`EMAIL_COUNT`）とストレージ（`STORAGE_BYTES`）も上書きの対象ではない（`QUOTA_OVERRIDE_METRICS` は
//    AI の月次件数 4 単位のみ）。執行点（`email-send.ts` / `send-hold-release.ts` / `issueSkillSheetUploadUrl`）が
//    既定値しか読まないため、`tenant_quota_overrides` にこの 2 metric の行は存在せず（CHECK が拒む）、
//    `emailDailyLimit` / `storageLimitBytes` は常に既定値を返す（`source` は常に `'DEFAULT'`。配線は SP-12 に申し送り）。
import { Prisma } from '@prisma/client';
import {
  AI_UNIT_METRICS,
  isQuotaOverrideMetric,
  resolveQuotaLimit,
  usagePeriodKey,
  type AiUnitMetric,
  type QuotaOverrideMetric,
  type QuotaOverrideRow,
} from '@ses/domain';
import type { HostTenantCtx, SystemTenantCtx } from './context.js';
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
  readonly emailDailyLimit: number;
  readonly storageLimitBytes: bigint;
  /**
   * 各計測の出所（`S-038` は出さない。`A-004` と結合テストが見る）。
   * 🔴 `EMAIL_COUNT` / `STORAGE_BYTES` は上書きの対象外なので常に `'DEFAULT'`（`QUOTA_OVERRIDE_METRICS` を参照）。
   */
  readonly sources: Readonly<Record<QuotaOverrideMetric | 'EMAIL_COUNT' | 'STORAGE_BYTES', QuotaSource>>;
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
function toCountLimit(metric: QuotaOverrideMetric, limit: bigint): number {
  if (limit > MAX_SAFE_COUNT) {
    throw new RangeError(`${metric} の上限が Number の安全整数を超えています（${limit}）。`);
  }
  return Number(limit);
}

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
 * 🔴 ① 今日（`Asia/Tokyo`）効いている上限を解く（純粋部分は `resolveQuotaLimit`）。
 *
 * `HostTenantCtx` を要求する: 行は C2（ホスト文脈のみ SELECT）であり、パートナー文脈では 0 行 = 常に既定値に
 * 見えてしまう（読めたように見えて既定値が返る、を型で防ぐ）。現在時刻は引数で受ける（決定的に検証できる）。
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
 * 行 → 効いている上限（I/O なし。`readPlatformUsage` がテナント横断の 1 回の読み取りから同じ規則で解くために export）。
 */
function resolveQuotasFromRows(input: {
  readonly rows: readonly QuotaOverrideRow[];
  readonly dayKey: string;
  readonly defaults: TenantQuotaDefaults;
}): ResolvedTenantQuotas {
  const sources = {} as Record<QuotaOverrideMetric | 'EMAIL_COUNT' | 'STORAGE_BYTES', QuotaSource>;
  const aiUnitQuotas = {} as Record<AiUnitMetric, number>;
  for (const metric of AI_UNIT_METRICS) {
    const resolved = resolveQuotaLimit({
      rows: input.rows,
      metric,
      onDate: input.dayKey,
      defaultLimit: BigInt(input.defaults.aiUnitQuotas[metric]),
    });
    aiUnitQuotas[metric] = toCountLimit(metric, resolved.limit);
    sources[metric] = resolved.source;
  }
  // 🔴 メール / ストレージは上書きの対象外（`QUOTA_OVERRIDE_METRICS` が AI 4 単位に限定されている。CHECK が
  //    この 2 metric の行を拒むため `tenant_quota_overrides` に該当行は存在せず、`resolveQuotaLimit` を呼ばずに
  //    常に既定値・常に `'DEFAULT'` で決まる。表示と実際の執行が食い違う経路を構造的に無くす）。
  sources.EMAIL_COUNT = 'DEFAULT';
  sources.STORAGE_BYTES = 'DEFAULT';
  return {
    dayKey: input.dayKey,
    aiUnitQuotas,
    emailDailyLimit: input.defaults.emailDailyLimit,
    storageLimitBytes: input.defaults.storageLimitBytes,
    sources,
  };
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
