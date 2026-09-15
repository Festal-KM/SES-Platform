// packages/db/src/tenant-monthly-cost.ts
// 🔴 `cost.monthly-rollup`（毎日 01:40 JST。docs/05 §9.8 / §5.9 / docs/03 §4.15 / `F-026 AC-5` /
//    `CLAUDE.md` §10.2）の本体 = `tenant_monthly_costs` を書く**唯一の経路**。T-10-02。
//
// ============================================================================
// 🔴 日次で更新し、月末を過ぎたら確定して以後書き換えない
// ============================================================================
// `CLAUDE.md` §10.2 の受け入れ基準は「月次を待たずに検知できること」であり、当月の行は毎日
// 上書きされる（暫定値）。月が終わった行は **`finalized_at` を立てて確定**し、以後は
//   - アプリ側: `ON CONFLICT ... DO UPDATE ... WHERE finalized_at IS NULL`（確定行は 0 件更新）
//   - DB 側:    トリガ `tenant_monthly_costs_guard_finalized`（`meter_diff_jpy` 以外の変更を拒否）
// の二重で守る（migration 20260919000000 の判断事項 4）。
//
// 🔴 ストレージ原価は**月末値**（docs/05 §5.9 / docs/03 §4.15）。確定時に `UsageCounter(MONTH,'STORAGE_BYTES')`
//    の「その月以前の最新行」を `storage_bytes_at_month_end` に固定する。暫定行は現在値で計算する。
//
// 🔴 売上の材料（`Plan` / `Subscription`）は引数 `billingTerms` で受ける。Phase 1 には `Subscription` が
//    存在せず（docs/05 §5.2 / migration 20260904010000「`plans` / `subscriptions` は `A-004` / `A-010` で足す」）、
//    `null` = 売上 0 / 粗利率 null として記録する（0% と偽らない。`computeTenantMonthlyCost`）。
import { Prisma } from '@prisma/client';
import {
  computeTenantMonthlyCost,
  formatUsdMicros,
  parseUsdMicros,
  shiftMonthKey,
  usagePeriodKey,
  type AiRole,
  type AiUnitMetric,
  type BillingTerms,
  type EmailTenantsBilling,
  type MonthlyCostBreakdown,
  type PricingRuleset,
} from '@ses/domain';
import type { HostTenantCtx } from './context.js';
import { readStorageBytesUsed } from './storage-usage.js';
import { usagePeriodRange } from './usage-period.js';
import { runInTenantTransaction } from './with-tenant.js';

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export type MonthlyCostRollupInput = {
  readonly periodMonth: string;
  readonly now: Date;
  readonly billingTerms: BillingTerms | null;
  readonly emailTenantsBilling: EmailTenantsBilling;
  readonly ruleset: PricingRuleset;
};

export type MonthlyCostRollupOutcome =
  | {
      /** 当月（暫定）。毎日上書きされる。 */
      readonly kind: 'PROVISIONAL';
      readonly breakdown: MonthlyCostBreakdown;
    }
  | {
      /** 月末を過ぎたので確定した（この実行で `finalized_at` を立てた）。 */
      readonly kind: 'FINALIZED';
      readonly breakdown: MonthlyCostBreakdown;
      readonly storageBytesAtMonthEnd: bigint;
    }
  | {
      /** 🔴 既に確定済み。**何も書いていない**（再実行の 2 度目はここ）。 */
      readonly kind: 'ALREADY_FINALIZED';
    };

type RoleSumRow = { readonly role: string; readonly total: string };
type MetricValueRow = { readonly metric: string; readonly value: string };
type MaxRow = { readonly max: string | null };
type FinalizedRow = { readonly finalized_at: Date | null };

/**
 * 🔴 対象月を集計して `tenant_monthly_costs` に upsert する。
 *
 * 月末を過ぎている（`periodMonth < 今月`）なら確定行として書き、既に確定済みなら 0 件更新で
 * `ALREADY_FINALIZED` を返す（例外にしない。再実行は冪等に成功する）。
 */
export async function rollupTenantMonthlyCost(
  ctx: HostTenantCtx,
  input: MonthlyCostRollupInput,
): Promise<MonthlyCostRollupOutcome> {
  if (!MONTH_KEY_PATTERN.test(input.periodMonth)) {
    throw new RangeError(`rollupTenantMonthlyCost: periodMonth は YYYY-MM で渡してください（${input.periodMonth}）。`);
  }
  const currentMonth = usagePeriodKey('MONTH', input.now);
  if (input.periodMonth > currentMonth) {
    throw new RangeError(`rollupTenantMonthlyCost: 未来の月は集計できません（${input.periodMonth} > ${currentMonth}）。`);
  }
  const shouldFinalize = input.periodMonth < currentMonth;
  const range = usagePeriodRange('MONTH', input.periodMonth);
  // 🔴 ストレージ: 確定なら月末（範囲の終わりの 1 ms 前）の値、暫定なら現在値。
  const storageAt = shouldFinalize ? new Date(range.endAt.getTime() - 1) : input.now;
  const storageBytes = await readStorageBytesUsed(ctx, storageAt);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const existing = await tx.$queryRaw<FinalizedRow[]>(Prisma.sql`
        SELECT finalized_at FROM tenant_monthly_costs
         WHERE tenant_id = ${ctx.tenantId}::uuid AND period_month = ${input.periodMonth}`);
      if (existing[0]?.finalized_at != null) return { kind: 'ALREADY_FINALIZED' } as const;

      // 🔴 原価（AI）: `AiUsage` をロールで GROUP BY（docs/05 §5.9「`costAiByRole`」/ `F-026 AC-2`）。
      const roleRows = await tx.$queryRaw<RoleSumRow[]>(Prisma.sql`
        SELECT role, SUM(estimated_cost_usd)::text AS total
          FROM ai_usage
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND started_at >= ${range.startAt}::timestamptz
           AND started_at <  ${range.endAt}::timestamptz
         GROUP BY role`);
      const aiCostByRoleUsd: Partial<Record<AiRole, string>> = {};
      for (const row of roleRows) {
        aiCostByRoleUsd[row.role as AiRole] = formatUsdMicros(parseUsdMicros(row.total));
      }

      // 🔴 件数（`AI_UNIT_*`）とメール通数は MONTH 行を**読むだけ**（数え直さない）。
      const monthRows = await tx.$queryRaw<MetricValueRow[]>(Prisma.sql`
        SELECT metric, trunc(value)::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'MONTH' AND period_key = ${input.periodMonth}
           AND metric IN ('AI_UNIT_SHEET_PARSE', 'AI_UNIT_MATCH_RATIONALE', 'AI_UNIT_PROPOSAL_DRAFT',
                          'AI_UNIT_RENEWAL_SUMMARY', 'EMAIL_COUNT', 'ESIGN_REQUESTS')`);
      const aiUnitCounts: Partial<Record<AiUnitMetric, number>> = {};
      let emailCount = 0;
      let esignRequests = 0;
      for (const row of monthRows) {
        if (row.metric === 'EMAIL_COUNT') emailCount = Number(row.value);
        else if (row.metric === 'ESIGN_REQUESTS') esignRequests = Number(row.value);
        else aiUnitCounts[row.metric as AiUnitMetric] = Number(row.value);
      }

      // 席数: 日次スナップショットの当月最大値（docs/05 §5.9）。
      const seatRows = await tx.$queryRaw<MaxRow[]>(Prisma.sql`
        SELECT trunc(MAX(value))::text AS max
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY' AND metric = 'SEAT_COUNT'
           AND period_key >= ${`${input.periodMonth}-01`} AND period_key <= ${`${input.periodMonth}-31`}`);
      const seatCount = Number(seatRows[0]?.max ?? '0');

      const breakdown = computeTenantMonthlyCost({
        periodMonth: input.periodMonth,
        seatCount,
        aiCostByRoleUsd,
        aiUnitCounts,
        emailCount,
        emailTenantsBilling: input.emailTenantsBilling,
        storageBytes,
        esignRequests,
        billingTerms: input.billingTerms,
        ruleset: input.ruleset,
      });

      const finalizedAt = shouldFinalize ? input.now : null;
      const storageAtMonthEnd = shouldFinalize ? storageBytes.toString() : null;
      // 🔴 `WHERE tenant_monthly_costs.finalized_at IS NULL`: 確定行は 0 件更新（トリガが第 2 防御）。
      const rows = await tx.$queryRaw<FinalizedRow[]>(Prisma.sql`
        INSERT INTO tenant_monthly_costs
          (tenant_id, period_month, revenue_seat_jpy, revenue_overage_jpy, cost_ai_usd, cost_ai_by_role,
           cost_email_usd, cost_storage_usd, cost_esign_usd, pricing_ruleset_version,
           storage_bytes_at_month_end, gross_margin_rate, baseline_ratio, quota_consumption_rate,
           meter_diff_jpy, finalized_at, updated_at)
        VALUES
          (${ctx.tenantId}::uuid, ${input.periodMonth},
           ${breakdown.revenueSeatJpy}::numeric, ${breakdown.revenueOverageJpy}::numeric,
           ${breakdown.costAiUsd}::numeric, ${JSON.stringify(breakdown.costAiByRoleUsd)}::jsonb,
           ${breakdown.costEmailUsd}::numeric, ${breakdown.costStorageUsd}::numeric,
           ${breakdown.costEsignUsd}::numeric, ${breakdown.pricingRulesetVersion},
           ${storageAtMonthEnd}::bigint, ${breakdown.grossMarginRate}::numeric,
           ${breakdown.baselineRatio}::numeric, ${breakdown.quotaConsumptionRate}::numeric,
           NULL, ${finalizedAt}::timestamptz, ${input.now}::timestamptz)
        ON CONFLICT (tenant_id, period_month) DO UPDATE
          SET revenue_seat_jpy = EXCLUDED.revenue_seat_jpy,
              revenue_overage_jpy = EXCLUDED.revenue_overage_jpy,
              cost_ai_usd = EXCLUDED.cost_ai_usd,
              cost_ai_by_role = EXCLUDED.cost_ai_by_role,
              cost_email_usd = EXCLUDED.cost_email_usd,
              cost_storage_usd = EXCLUDED.cost_storage_usd,
              cost_esign_usd = EXCLUDED.cost_esign_usd,
              pricing_ruleset_version = EXCLUDED.pricing_ruleset_version,
              storage_bytes_at_month_end = EXCLUDED.storage_bytes_at_month_end,
              gross_margin_rate = EXCLUDED.gross_margin_rate,
              baseline_ratio = EXCLUDED.baseline_ratio,
              quota_consumption_rate = EXCLUDED.quota_consumption_rate,
              finalized_at = EXCLUDED.finalized_at,
              updated_at = EXCLUDED.updated_at
          WHERE tenant_monthly_costs.finalized_at IS NULL
        RETURNING finalized_at`);
      const row = rows[0];
      if (row === undefined) {
        // 🔴 SELECT 時点では未確定だったが、並行実行が先に確定した（`WHERE` で 0 件）。書いていない。
        return { kind: 'ALREADY_FINALIZED' } as const;
      }
      return shouldFinalize
        ? { kind: 'FINALIZED', breakdown, storageBytesAtMonthEnd: storageBytes }
        : { kind: 'PROVISIONAL', breakdown };
    },
  );
}

/**
 * SES Tenants の割当状況（docs/05 §8.8「メールの Tenants 課金」の 3 値判定の材料）。
 *
 * - `ASSIGNED` … `tenant_sending_domains.ses_tenant_name` を持つ行がある（`domain.provision` が作った）
 * - `NONE` … 送信元ドメインの行が 1 つも無い（SES Tenant は作られていないと確認できる）
 * - `UNCONFIRMED` … 行はあるが `ses_tenant_name` が無い（登録途中 / 失敗。割当を確認できない）
 *
 * 🔴 `production` 以外では呼ばない（非本番 = 非該当。判断は起動時の 1 箇所 `apps/worker/src/runtime.ts`）。
 */
export type SesTenantAssignment = 'ASSIGNED' | 'NONE' | 'UNCONFIRMED';

export async function readSesTenantAssignment(ctx: HostTenantCtx): Promise<SesTenantAssignment> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ readonly total: number; readonly assigned: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total,
               COUNT(ses_tenant_name)::int AS assigned
          FROM tenant_sending_domains
         WHERE tenant_id = ${ctx.tenantId}::uuid`);
      const row = rows[0];
      if (row === undefined || row.total === 0) return 'NONE';
      return row.assigned > 0 ? 'ASSIGNED' : 'UNCONFIRMED';
    },
  );
}

/**
 * 🔴 `cost.monthly-rollup` が 1 回の実行で扱う月の一覧: 当月（暫定）+ 先月（確定の機会）+
 *    それより前で**まだ確定していない行**（ジョブが止まっていた月を取り返す。docs/03 §4.6 の
 *    「日付一致にしない」と同じ規律）。昇順。
 */
export async function listMonthsToRollup(ctx: HostTenantCtx, now: Date): Promise<readonly string[]> {
  const currentMonth = usagePeriodKey('MONTH', now);
  const previousMonth = shiftMonthKey(currentMonth, -1);
  const stale = await runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    (tx) =>
      tx.$queryRaw<Array<{ readonly period_month: string }>>(Prisma.sql`
        SELECT period_month FROM tenant_monthly_costs
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND finalized_at IS NULL
           AND period_month < ${previousMonth}
         ORDER BY period_month`),
  );
  return [...stale.map((row) => row.period_month), previousMonth, currentMonth];
}
