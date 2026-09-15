// packages/db/src/usage-rollup.ts
// 🔴 `usage.daily-rollup`（毎日 01:10 JST。docs/05 §9.8）の本体。T-10-02。
//
// ============================================================================
// 🔴 何を突き合わせ、何を突き合わせないか
// ============================================================================
//   ① `AI_COST_USD`（DAY）… 正は `AiUsage`（docs/03 §4.15「`UsageCounter` はその日次ロールアップ」）。
//      JST の暦日で `estimated_cost_usd` を合計し、`usage_counters.value` を**確定値で上書き**する。
//      `reserved_value`（呼び出し前の予約）には触れない（`ai-cost-guard.ts` 冒頭の 4）。
//   ② `EMAIL_COUNT`（MONTH）… DAY 行（予約の確定値。docs/05 §8.7）を月で合計して MONTH 行に置く。
//      §5.9 の原価（メール）と `S-038` の「メール N 通 / 月」がこの行を読む。**通数を数え直す**のではなく、
//      日次の確定値を畳むだけである。
//   🔴 ③ `AI_UNIT_*`（件数）は**対象外**（docs/05 §9.8 / §7.6）。`AiUsage` の行数から数え直すと
//      再試行・`skill-normalizer`・`gate-inspector` が混入する。本ファイルは `AI_UNIT_*` に一切触れない
//      （`tests/isolation/usage-measurement.test.ts` が「rollup の前後で件数が変わらない」ことを固定する）。
//
// 🔴 対象の暦日は**呼び出し側が渡す**（ジョブは「昨日」を渡す。当日は呼び出しが進行中であり、
//    予約と `AiUsage` の間で一時的に食い違うのが正常である）。
// 🔴 冪等: `SET` の upsert（同じ入力なら同じ確定値）。再実行しても値は二重にならない。
import { Prisma } from '@prisma/client';
import { formatUsdMicros, parseUsdMicros, usagePeriodKey } from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { usagePeriodRange } from './usage-period.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

const AI_COST_METRIC = 'AI_COST_USD';
const EMAIL_METRIC = 'EMAIL_COUNT';

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

type ValueRow = { readonly value: string };
type SumRow = { readonly total: string | null };

export type AiCostDayRollup = {
  readonly periodKey: string;
  /** `AiUsage` の合計（正）。行が 1 つも無ければ `'0.000000'`。 */
  readonly expectedUsd: string;
  /** 突き合わせ前の `usage_counters.value`。行が無ければ `null`。 */
  readonly previousUsd: string | null;
  /** 突き合わせ後の `usage_counters.value`。 */
  readonly valueUsd: string;
  /** 🔴 値が変わった（＝ 乖離があった）。`SchedulerRun.detail` に件数として残す。 */
  readonly corrected: boolean;
};

/**
 * 🔴 `AI_COST_USD`（DAY）を `AiUsage` の合計に揃える。
 *
 * `AiUsage` が 1 行も無く、カウンタ行も無い日は**行を作らない**（使わなかった日を 0 の行で埋めると、
 * `usage.gap-check` の「`AiUsage` がある日だけを見る」判定と食い違う）。カウンタ行だけがある日
 * （`AiUsage` が 0 行）は 0 に揃える —— 記録に失敗した予約の残骸を「使った」に見せない。
 */
export async function rollupAiCostDay(
  ctx: HostTenantCtx,
  input: { readonly periodKey: string; readonly now: Date },
): Promise<AiCostDayRollup> {
  if (!DAY_KEY_PATTERN.test(input.periodKey)) {
    throw new RangeError(`rollupAiCostDay: periodKey は YYYY-MM-DD で渡してください（${input.periodKey}）。`);
  }
  const range = usagePeriodRange('DAY', input.periodKey);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const sums = await tx.$queryRaw<SumRow[]>(Prisma.sql`
        SELECT SUM(estimated_cost_usd)::text AS total
          FROM ai_usage
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND started_at >= ${range.startAt}::timestamptz
           AND started_at <  ${range.endAt}::timestamptz`);
      const hasUsage = sums[0]?.total !== null && sums[0]?.total !== undefined;
      const expectedUsd = formatUsdMicros(parseUsdMicros(sums[0]?.total ?? '0'));

      const current = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        SELECT value::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY'
           AND period_key = ${input.periodKey}
           AND metric = ${AI_COST_METRIC}`);
      const previousUsd = current[0] === undefined ? null : formatUsdMicros(parseUsdMicros(current[0].value));

      if (!hasUsage && previousUsd === null) {
        return { periodKey: input.periodKey, expectedUsd, previousUsd, valueUsd: expectedUsd, corrected: false };
      }
      if (previousUsd === expectedUsd) {
        return { periodKey: input.periodKey, expectedUsd, previousUsd, valueUsd: previousUsd, corrected: false };
      }

      // 🔴 `value` だけを確定値で上書きする。`reserved_value` は残す（ai-cost-guard.ts の TTL の設計）。
      //    `observed_at` は突き合わせ時刻ではなく**その日の終わり**に留める（過去日の行を「今日観測した」に
      //    しない。`GREATEST` で既存より過去へは戻さない）。
      const rows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        INSERT INTO usage_counters
          (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
        VALUES
          (${uuidV7(range.startAt)}::uuid, ${ctx.tenantId}::uuid, 'DAY', ${input.periodKey},
           ${AI_COST_METRIC}, ${expectedUsd}::numeric, 0, ${range.startAt}::timestamptz)
        ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
          SET value = EXCLUDED.value,
              observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
        RETURNING value::text AS value`);
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`UsageCounter(${AI_COST_METRIC}) を突き合わせられませんでした（periodKey=${input.periodKey}）。`);
      }
      return {
        periodKey: input.periodKey,
        expectedUsd,
        previousUsd,
        valueUsd: formatUsdMicros(parseUsdMicros(row.value)),
        corrected: true,
      };
    },
  );
}

export type EmailMonthRollup = {
  readonly periodKey: string;
  /** DAY 行の合計（通）。 */
  readonly total: number;
  /** MONTH 行を書いた（DAY 行が 1 つも無ければ書かない）。 */
  readonly written: boolean;
};

/**
 * 🔴 `EMAIL_COUNT`（DAY → MONTH）。日次の確定値（予約の `value`）を月で畳んで MONTH 行に置く。
 *
 * DAY 行が 1 つも無い月は行を作らない（0 通の月を 0 の行で埋める必要が無い。読む側は行無し = 0）。
 */
export async function rollupEmailMonth(
  ctx: HostTenantCtx,
  input: { readonly periodKey: string; readonly now: Date },
): Promise<EmailMonthRollup> {
  if (!MONTH_KEY_PATTERN.test(input.periodKey)) {
    throw new RangeError(`rollupEmailMonth: periodKey は YYYY-MM で渡してください（${input.periodKey}）。`);
  }
  const range = usagePeriodRange('MONTH', input.periodKey);
  const monthKeyOfNow = usagePeriodKey('MONTH', input.now);
  // 🔴 `observed_at` は「月内の最新の観測」に留める。当月なら今、過去月ならその月の終わり（1 ms 前）。
  const observedAt = monthKeyOfNow === input.periodKey ? input.now : new Date(range.endAt.getTime() - 1);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const sums = await tx.$queryRaw<Array<{ readonly total: string | null; readonly days: number }>>(Prisma.sql`
        SELECT SUM(value)::text AS total, COUNT(*)::int AS days
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY'
           AND metric = ${EMAIL_METRIC}
           AND period_key >= ${`${input.periodKey}-01`}
           AND period_key <= ${`${input.periodKey}-31`}`);
      const days = sums[0]?.days ?? 0;
      const total = Number(sums[0]?.total ?? '0');
      if (days === 0) return { periodKey: input.periodKey, total: 0, written: false };

      const rows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        INSERT INTO usage_counters
          (id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at)
        VALUES
          (${uuidV7(observedAt)}::uuid, ${ctx.tenantId}::uuid, 'MONTH', ${input.periodKey},
           ${EMAIL_METRIC}, ${String(total)}::numeric, 0, ${observedAt}::timestamptz)
        ON CONFLICT (tenant_id, period_kind, period_key, metric) DO UPDATE
          SET value = EXCLUDED.value,
              observed_at = GREATEST(usage_counters.observed_at, EXCLUDED.observed_at)
        RETURNING value::text AS value`);
      if (rows[0] === undefined) {
        throw new Error(`UsageCounter(${EMAIL_METRIC}, MONTH) を書き込めませんでした（periodKey=${input.periodKey}）。`);
      }
      return { periodKey: input.periodKey, total, written: true };
    },
  );
}
