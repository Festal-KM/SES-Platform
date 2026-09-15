// packages/db/src/usage-gap-check.ts
// 🔴 `usage.gap-check`（毎日 01:20 JST。docs/05 §9.8 / §16.5「計測欠測」/ `F-026 AC-4`）の本体。T-10-02。
//
// 判定の定義は `@ses/domain` の `detectUsageGaps`（純粋関数）にあり、ここは**材料を揃えて**
// 結果を `usage_measurement_findings` に同期するだけである（`usage-findings.ts`）。
//
// 🔴 読み取りはすべてテナント文脈（RLS C2）の中で行う。`usage_counters` を書かない（自動補正しない）。
import { Prisma } from '@prisma/client';
import {
  detectUsageGaps,
  formatUsdMicros,
  parseUsdMicros,
  usageGapWindow,
  usagePeriodKey,
  type UsageGapFinding,
} from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { syncUsageMeasurementFindings, type UsageMeasurementFindingSync } from './usage-findings.js';
import { usagePeriodRange } from './usage-period.js';
import { runInTenantTransaction } from './with-tenant.js';

export type UsageGapCheckInput = {
  readonly now: Date;
  /** 遡る日数（`packages/config` の `USAGE_GAP_CHECK_LOOKBACK_DAYS`）。 */
  readonly lookbackDays: number;
};

export type UsageGapCheckOutcome = UsageMeasurementFindingSync & {
  /** 検査した暦日（昇順）。空ならテナント作成日が今日以降で検査対象が無い。 */
  readonly checkedDays: readonly string[];
  readonly findings: readonly UsageGapFinding[];
};

type PeriodRow = { readonly period_key: string; readonly value: string };
type AiDayRow = { readonly day: string; readonly total: string };

/**
 * 🔴 日次の連続性を検査し、欠測を `usage_measurement_findings` に出す。
 *
 * 窓は `[max(テナント作成日, 今日 − lookback), 昨日]`（`usageGapWindow`）。
 * `AiUsage` の暦日は `started_at` を JST で切る（`usagePeriodRange` と同じ暦）。
 */
export async function checkUsageGaps(ctx: HostTenantCtx, input: UsageGapCheckInput): Promise<UsageGapCheckOutcome> {
  const todayKey = usagePeriodKey('DAY', input.now);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { createdAt: true } });
      if (tenant === null) {
        // 🔴 RLS で自テナントが見えない = ジョブ文脈が壊れている。0 件を成功にしない。
        throw new Error('usage.gap-check: テナント行を読めませんでした（ジョブ文脈が不正です）。');
      }
      const expectedDays = usageGapWindow({
        todayKey,
        lookbackDays: input.lookbackDays,
        tenantCreatedDayKey: usagePeriodKey('DAY', tenant.createdAt),
      });
      if (expectedDays.length === 0) {
        return { checkedDays: [], findings: [], detected: 0, opened: 0, resolved: 0 };
      }
      const firstDay = expectedDays[0]!;
      const lastDay = expectedDays[expectedDays.length - 1]!;
      const windowRange = {
        startAt: usagePeriodRange('DAY', firstDay).startAt,
        endAt: usagePeriodRange('DAY', lastDay).endAt,
      };

      const seatRows = await tx.$queryRaw<PeriodRow[]>(Prisma.sql`
        SELECT period_key, value::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY' AND metric = 'SEAT_COUNT'
           AND period_key >= ${firstDay} AND period_key <= ${lastDay}`);
      const aiCounterRows = await tx.$queryRaw<PeriodRow[]>(Prisma.sql`
        SELECT period_key, value::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY' AND metric = 'AI_COST_USD'
           AND period_key >= ${firstDay} AND period_key <= ${lastDay}`);
      // 🔴 暦日の切り出しは SQL 側の `AT TIME ZONE 'Asia/Tokyo'` で行う。`usagePeriodKey` と同じ暦
      //    （夏時間の無い固定 +09:00）であり、`usage-period.test.ts` が境界の一致を固定する。
      const aiUsageRows = await tx.$queryRaw<AiDayRow[]>(Prisma.sql`
        SELECT to_char(started_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS day,
               SUM(estimated_cost_usd)::text AS total
          FROM ai_usage
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND started_at >= ${windowRange.startAt}::timestamptz
           AND started_at <  ${windowRange.endAt}::timestamptz
         GROUP BY 1`);

      const aiUsageUsdByDay = new Map<string, string>();
      for (const row of aiUsageRows) {
        aiUsageUsdByDay.set(row.day, formatUsdMicros(parseUsdMicros(row.total)));
      }

      const findings = detectUsageGaps({
        expectedDays,
        seatCountDays: new Set(seatRows.map((row) => row.period_key)),
        aiUsageUsdByDay,
        aiCostCounterUsdByDay: new Map(aiCounterRows.map((row) => [row.period_key, formatUsdMicros(parseUsdMicros(row.value))])),
      });

      const sync = await syncUsageMeasurementFindings(tx, {
        tenantId: ctx.tenantId,
        now: input.now,
        scope: { kinds: ['GAP_MISSING', 'GAP_MISMATCH'], periodKind: 'DAY', periodKeys: expectedDays },
        findings: findings.map((finding) => ({
          kind: finding.kind,
          metric: finding.metric,
          periodKind: 'DAY',
          periodKey: finding.periodKey,
          expected: finding.expected,
          observed: finding.observed,
        })),
      });
      return { checkedDays: expectedDays, findings, ...sync };
    },
  );
}
