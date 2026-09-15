// apps/worker/src/jobs/cost-monthly-rollup.ts
// 🔴 `cost.monthly-rollup`（毎日 01:40 JST。docs/05 §9.8 / §5.9 / `F-026 AC-5` / `CLAUDE.md` §10.2）。T-10-02。
//
// `TenantMonthlyCost`（テナント × 月 × ロール別の売上・原価・粗利）を日次で更新し、月末を過ぎた月は
// 確定して以後書き換えない。本体は `packages/db` の `rollupTenantMonthlyCost`（集計 + upsert）と
// `@ses/domain` の `computeTenantMonthlyCost`（算出）であり、**ワーカーは起動と配線だけ**を持つ。
//
// ============================================================================
// 🔴 契約条件（売上の材料）は seam で受ける（Phase 1 は `null` = 売上 0）
// ============================================================================
// `Subscription` は Phase 3（`A-010`）まで存在せず、`plans` / `subscriptions` は `app_tenant` から読めない
// （migration 20260904010000「`A-004` / `A-010` で許可リストと同時に足す」）。したがって Phase 1 の配線は
// `billingTermsNotRecorded`（常に `null`）であり、原価だけが実測で埋まる。SP-20 が `packages/db` に
// `planAccess.ts`（docs/05 §3.10 末尾）を置いた時点で、ここの seam に差し替える。
// 🔴 `null` は「契約が記録されていない」という**事実**であり、0% の粗利率を偽らない
//    （`computeTenantMonthlyCost` は売上 0 のとき `grossMarginRate = null`）。
//
// ============================================================================
// 🔴 SES Tenants 課金の 3 値判定（docs/05 §8.8）は起動時の 1 箇所で決める
// ============================================================================
// 「`production` かつ SES Tenant が割り当て済み = 確定 / 非本番 = 非該当 / 確認できない = 不明」のうち
// **環境による分岐は `resolveEmailTenantsBillingPolicy(appEnv)` を起動時に 1 回**呼ぶだけであり
// （`resolveMockAiOptions` と同じ位置づけ）、ジョブは `policy` を見るだけで `APP_ENV` を読まない。
import {
  listMonthsToRollup,
  readSesTenantAssignment,
  rollupTenantMonthlyCost,
  systemTenantCtx,
  type MonthlyCostRollupOutcome,
} from '@ses/db';
import type { AppEnvKind } from '@ses/config';
import type { BillingTerms, EmailTenantsBilling, PricingRuleset } from '@ses/domain';
import type { InternalJobName } from '@ses/connectors';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

/** 🔴 キュー定義（`packages/connectors/src/queues.ts`）に無い名前はここに書けない。 */
export const COST_MONTHLY_ROLLUP_JOB = 'cost.monthly-rollup' satisfies InternalJobName;

/** 🔴 毎日 01:40 JST（docs/05 §9.8）。`usage.daily-rollup`（01:10）で先月末の突き合わせが済んだ後。 */
export const COST_MONTHLY_ROLLUP_SCHEDULE = { cron: '40 1 * * *', timeZone: 'Asia/Tokyo' } as const;

export type CostMonthlyRollupPayload = { readonly tenantId: string };

export function parseCostMonthlyRollupPayload(raw: unknown): CostMonthlyRollupPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(COST_MONTHLY_ROLLUP_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(COST_MONTHLY_ROLLUP_JOB, 'tenantId', record.tenantId) };
}

/**
 * 🔴 契約条件の読み取り口（seam）。`tenantId` はジョブ payload の検証済みの値。
 *    `null` = 契約が記録されていない（売上 0 / 粗利率 null）。
 */
export type BillingTermsReader = (tenantId: string) => Promise<BillingTerms | null>;

/**
 * 🔴 Phase 1 の配線: `Subscription` が存在しないため常に `null`（上記の理由）。
 *    SP-20（`A-010` / `planAccess.ts`）がこれを差し替えるまで消さないこと（消すと deps が欠けて
 *    コンパイルが通らない = 気づける形が壊れる。`sendHoldReleaseNotImplemented` と同じ位置づけ）。
 */
export const billingTermsNotRecorded: BillingTermsReader = () => Promise.resolve(null);

/**
 * SES Tenants 課金の判定方針（docs/05 §8.8）。
 * - `NOT_APPLICABLE` … 非本番。SES Tenants の課金は発生しない扱い
 * - `BY_ASSIGNMENT` … 本番。テナントの SES Tenant 割当を見て 確定 / 不明 に分ける
 */
export type EmailTenantsBillingPolicy = 'NOT_APPLICABLE' | 'BY_ASSIGNMENT';

/** 🔴 起動時に 1 回だけ呼ぶ（`apps/worker/src/runtime.ts`）。ジョブ本体は `APP_ENV` を読まない。 */
export function resolveEmailTenantsBillingPolicy(appEnv: AppEnvKind): EmailTenantsBillingPolicy {
  return appEnv === 'production' ? 'BY_ASSIGNMENT' : 'NOT_APPLICABLE';
}

export type CostMonthlyRollupDeps = {
  readonly now: () => Date;
  readonly billingTerms: BillingTermsReader;
  readonly emailTenantsBillingPolicy: EmailTenantsBillingPolicy;
  /** 版付きの単価表（`PRICING_RULESET_V1`）。`TenantMonthlyCost.pricingRulesetVersion` に残る。 */
  readonly pricingRuleset: PricingRuleset;
};

export type CostMonthlyRollupOutcome = {
  readonly emailTenantsBilling: EmailTenantsBilling;
  readonly months: readonly { readonly periodMonth: string; readonly outcome: MonthlyCostRollupOutcome }[];
};

export type CostMonthlyRollupHandler = (payload: unknown, jobId: string) => Promise<CostMonthlyRollupOutcome>;

export function createCostMonthlyRollupHandler(deps: CostMonthlyRollupDeps): CostMonthlyRollupHandler {
  return async (payload, jobId) => {
    const job = parseCostMonthlyRollupPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: COST_MONTHLY_ROLLUP_JOB, jobId });
    const now = deps.now();

    const emailTenantsBilling = await resolveEmailTenantsBilling(deps.emailTenantsBillingPolicy, ctx);
    const billingTerms = await deps.billingTerms(job.tenantId);

    const months: { periodMonth: string; outcome: MonthlyCostRollupOutcome }[] = [];
    for (const periodMonth of await listMonthsToRollup(ctx, now)) {
      const outcome = await rollupTenantMonthlyCost(ctx, {
        periodMonth,
        now,
        billingTerms,
        emailTenantsBilling,
        ruleset: deps.pricingRuleset,
      });
      months.push({ periodMonth, outcome });
    }
    return { emailTenantsBilling, months };
  };
}

/** 🔴 docs/05 §8.8 の 3 値。**不明は高いほう（`UNKNOWN` = `APPLIES` と同額）で見積もる**のは domain 側。 */
async function resolveEmailTenantsBilling(
  policy: EmailTenantsBillingPolicy,
  ctx: ReturnType<typeof systemTenantCtx>,
): Promise<EmailTenantsBilling> {
  if (policy === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  const assignment = await readSesTenantAssignment(ctx);
  if (assignment === 'ASSIGNED') return 'APPLIES';
  if (assignment === 'NONE') return 'NOT_APPLICABLE';
  return 'UNKNOWN';
}
