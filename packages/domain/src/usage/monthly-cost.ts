// packages/domain/src/usage/monthly-cost.ts
// 🔴 テナント × 月の **売上・原価・粗利の算出**（docs/02 章 7.5 / docs/05 §5.9 / `F-026 AC-5` /
//    `CLAUDE.md` §10.2）。T-10-02。
//
// ============================================================================
// 🔴 この関数が守っていること
// ============================================================================
// ① **原価（AI）はロール別に分解して保持する**（`costAiByRoleUsd`。6 ロールすべてのキーを持つ）。
//    `CLAUDE.md` §10.2「どのロールが原価を食っているか」/ `F-063 AC-2` はこれに依存する。
// ② **売上（超過従量）は件数 × 円**である（`Σ_unit max(0, 件数 − クォータ) × 単価`）。金額（USD）から
//    割り戻さない（`F-026 AC-6` / Issue #12）。`gate-inspector` は従量の対象外（単位を持たない）。
// ③ **金額は整数演算**（USD は micro、JPY は銭〔1/100 円〕）。`number` の浮動小数点を通さない。
//    端数は**切り捨て**（`bigint` の除算）で統一し、丸めの向きが呼び出し側で揺れないようにする。
// ④ 単価の出所は `PricingRuleset`（版付き）1 つである。`version` を結果に載せ、
//    `TenantMonthlyCost.pricingRulesetVersion` として確定させる（docs/05 §8.8）。
// ⑤ 🔴 メールの SES Tenants 課金は **確定 / 非該当 / 不明の 3 値**で受け取り、**不明は高いほうで見積もる**
//    （docs/05 §8.8。過小見積もりは請求超過という不可逆な結果を生む）。
//
// 🔴 DB も現在時刻も読まない。材料（カウンタの値・`AiUsage` のロール別合計・契約条件）は
//    `packages/db` の `rollupTenantMonthlyCost` が揃えて渡す。

import { AI_ROLES, type AiRole } from '../ai/roles.js';
import { AI_UNIT_METRICS, type AiUnitMetric } from '../ai/units.js';
import type { PricingRuleset } from './pricing-ruleset.js';
import { formatUsdMicros, parseUsdMicros, USD_MICRO_SCALE } from './usd.js';

/** SES Tenants 課金の判定（docs/05 §8.8 の 3 値）。 */
export type EmailTenantsBilling = 'APPLIES' | 'NOT_APPLICABLE' | 'UNKNOWN';

/**
 * 契約条件（`Plan` / `Subscription` から引く値。docs/05 §5.9）。
 *
 * 🔴 `null` は「契約が記録されていない」= 売上 0（Phase 1 は `Subscription` が存在しない。
 *    docs/05 §5.2 / migration 20260904010000「`plans` / `subscriptions` は `A-004` / `A-010` で足す」）。
 */
export type BillingTerms = {
  /** `Plan.monthlySeatPriceJpy`（`Decimal(12,2)`）。 */
  readonly monthlySeatPriceJpy: string;
  /** `Plan.overageUnitPricesJpy`（`Record<AiUnit, 円>`）。 */
  readonly overageUnitPricesJpy: Readonly<Record<AiUnitMetric, string>>;
  /** 件数クォータ（`Plan.unitQuota*` に `Subscription.unitQuotaOverride` を適用したもの）。 */
  readonly unitQuotas: Readonly<Record<AiUnitMetric, number>>;
  /** 月間の金額上限（`Subscription.quotaOverrideUsd ?? Plan.aiCostCapUsd`。運営者の内部指標）。 */
  readonly aiCostCapUsd: string;
};

export type MonthlyCostInput = {
  readonly periodMonth: string;
  /** 当月の席数（`UsageCounter(DAY,'SEAT_COUNT')` の当月最大値。docs/05 §5.9）。 */
  readonly seatCount: number;
  /** `AiUsage.estimatedCostUsd` の当月合計をロール別に（無いロールは省略可 = 0）。 */
  readonly aiCostByRoleUsd: Readonly<Partial<Record<AiRole, string>>>;
  /** `UsageCounter(MONTH,'AI_UNIT_*')`（無い単位は省略可 = 0）。 */
  readonly aiUnitCounts: Readonly<Partial<Record<AiUnitMetric, number>>>;
  /** `UsageCounter(MONTH,'EMAIL_COUNT')`。 */
  readonly emailCount: number;
  readonly emailTenantsBilling: EmailTenantsBilling;
  /** `UsageCounter(MONTH,'STORAGE_BYTES')`（月末値または現在値。docs/05 §5.9）。 */
  readonly storageBytes: bigint;
  /** `UsageCounter(MONTH,'ESIGN_REQUESTS')`（Phase 3。現状 0）。 */
  readonly esignRequests: number;
  readonly billingTerms: BillingTerms | null;
  readonly ruleset: PricingRuleset;
};

export type MonthlyCostBreakdown = {
  readonly periodMonth: string;
  readonly pricingRulesetVersion: string;
  /** 売上（席）。`Decimal(14,2)`。 */
  readonly revenueSeatJpy: string;
  /** 売上（超過従量）。`Decimal(14,2)`。 */
  readonly revenueOverageJpy: string;
  /** 原価（AI）。`Decimal(14,6)`。 */
  readonly costAiUsd: string;
  /** 🔴 6 ロールすべてのキーを持つ（0 のロールも `'0.000000'` で載る）。 */
  readonly costAiByRoleUsd: Readonly<Record<AiRole, string>>;
  readonly costEmailUsd: string;
  readonly costStorageUsd: string;
  /** 🔴 BYO のため常に 0（列は残す。docs/05 §5.9）。 */
  readonly costEsignUsd: string;
  /** 粗利率（`(売上 − 原価) / 売上`。`Decimal(6,4)`）。🔴 売上 0 のときは `null`（0 割りを 0% にしない）。 */
  readonly grossMarginRate: string | null;
  /** 基準ユニット比（`costAiUsd / aiBaselineCostUsd`。`Decimal(8,4)`）。 */
  readonly baselineRatio: string;
  /** クォータ消化率（`costAiUsd / aiCostCapUsd`。`Decimal(6,4)`）。契約が無ければ `null`。 */
  readonly quotaConsumptionRate: string | null;
};

const SCALED_PATTERN = /^-?\d{1,20}(\.\d{1,6})?$/;

/** 十進文字列 → `10^digits` 倍した整数（切り捨てではなく桁不足は 0 詰め、桁超過は例外）。 */
function parseScaled(value: string, digits: number, name: string): bigint {
  if (!SCALED_PATTERN.test(value)) throw new RangeError(`${name} の書式が不正です（${value}）。`);
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (fraction.length > digits) {
    throw new RangeError(`${name} の小数部は ${digits} 桁までです（${value}）。`);
  }
  const scaled = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'));
  return negative ? -scaled : scaled;
}

function formatScaled(value: bigint, digits: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole.toString()}${digits === 0 ? '' : `.${fraction}`}`;
}

/** 銭（1/100 円）の刻み。`Decimal(14,2)` と一致する。 */
const JPY_SEN_DIGITS = 2;
/** 比率の刻み（`Decimal(_,4)`）。 */
const RATE_DIGITS = 4;
const RATE_SCALE = 10n ** BigInt(RATE_DIGITS);
/** 1 GiB（S3 の GB-月は 2^30 バイト）。 */
const GIB_BYTES = 1n << 30n;

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/** `count` 通 × (USD / 1,000 通) を micro-USD で（切り捨て）。 */
function perThousandMicros(count: bigint, usdPerThousand: string): bigint {
  return (count * parseUsdMicros(usdPerThousand)) / 1000n;
}

/**
 * 🔴 メール原価（docs/05 §5.9「`count/1000*0.16 + 0.005 + count/1000*0.005`」）。
 *
 * SES Tenants の分（`+ 0.005 + count/1000*0.005`）は判定が `NOT_APPLICABLE` のときだけ外す。
 * **`UNKNOWN` は `APPLIES` と同じ扱い**（docs/05 §8.8「不明は高いほうの単価で見積もる」）。
 */
export function estimateEmailCostMicros(
  emailCount: number,
  tenantsBilling: EmailTenantsBilling,
  ruleset: PricingRuleset,
): bigint {
  assertCount('emailCount', emailCount);
  const count = BigInt(emailCount);
  const essentials = perThousandMicros(count, ruleset.emailEssentialsUsdPerThousand);
  if (tenantsBilling === 'NOT_APPLICABLE') return essentials;
  return (
    essentials +
    parseUsdMicros(ruleset.emailTenantsUsdPerTenantMonth) +
    perThousandMicros(count, ruleset.emailTenantsUsdPerThousand)
  );
}

/** ストレージ原価（GiB・月 × 単価。バイト単位で按分し切り捨て）。 */
export function estimateStorageCostMicros(storageBytes: bigint, ruleset: PricingRuleset): bigint {
  if (storageBytes < 0n) throw new RangeError(`storageBytes は 0 以上である必要があります（${storageBytes}）。`);
  return (storageBytes * parseUsdMicros(ruleset.storageUsdPerGibMonth)) / GIB_BYTES;
}

/**
 * 🔴 テナント × 月の売上・原価・粗利（純粋関数。docs/02 章 7.5 の定義そのもの）。
 */
export function computeTenantMonthlyCost(input: MonthlyCostInput): MonthlyCostBreakdown {
  assertCount('seatCount', input.seatCount);
  assertCount('esignRequests', input.esignRequests);

  // --- 原価（AI）: ロール別 ---------------------------------------------------------------
  const costAiByRoleMicros = {} as Record<AiRole, bigint>;
  let costAiMicros = 0n;
  for (const role of AI_ROLES) {
    const micros = parseUsdMicros(input.aiCostByRoleUsd[role] ?? '0');
    if (micros < 0n) throw new RangeError(`aiCostByRoleUsd.${role} は 0 以上である必要があります。`);
    costAiByRoleMicros[role] = micros;
    costAiMicros += micros;
  }
  const costAiByRoleUsd = {} as Record<AiRole, string>;
  for (const role of AI_ROLES) costAiByRoleUsd[role] = formatUsdMicros(costAiByRoleMicros[role]);

  // --- 原価（メール / ストレージ / 電子署名）----------------------------------------------
  const costEmailMicros = estimateEmailCostMicros(input.emailCount, input.emailTenantsBilling, input.ruleset);
  const costStorageMicros = estimateStorageCostMicros(input.storageBytes, input.ruleset);
  const costEsignMicros = BigInt(input.esignRequests) * parseUsdMicros(input.ruleset.esignUsdPerRequest);
  const costTotalMicros = costAiMicros + costEmailMicros + costStorageMicros + costEsignMicros;

  // --- 売上（席 + 超過従量。円）------------------------------------------------------------
  let revenueSeatSen = 0n;
  let revenueOverageSen = 0n;
  let quotaConsumptionRate: string | null = null;
  if (input.billingTerms !== null) {
    const terms = input.billingTerms;
    revenueSeatSen = BigInt(input.seatCount) * parseScaled(terms.monthlySeatPriceJpy, JPY_SEN_DIGITS, 'monthlySeatPriceJpy');
    for (const unit of AI_UNIT_METRICS) {
      const used = input.aiUnitCounts[unit] ?? 0;
      assertCount(`aiUnitCounts.${unit}`, used);
      const quota = terms.unitQuotas[unit];
      assertCount(`unitQuotas.${unit}`, quota);
      const overage = Math.max(0, used - quota);
      revenueOverageSen +=
        BigInt(overage) * parseScaled(terms.overageUnitPricesJpy[unit], JPY_SEN_DIGITS, `overageUnitPricesJpy.${unit}`);
    }
    const capMicros = parseUsdMicros(terms.aiCostCapUsd);
    quotaConsumptionRate = capMicros > 0n ? formatScaled((costAiMicros * RATE_SCALE) / capMicros, RATE_DIGITS) : null;
  }
  const revenueTotalSen = revenueSeatSen + revenueOverageSen;

  // --- 粗利率（円で比べる。原価 USD → 銭: micro × fx(4 桁スケール) / 10^8）-------------------
  const fxScaled = parseScaled(input.ruleset.fxJpyPerUsd, RATE_DIGITS, 'fxJpyPerUsd');
  const costTotalSen = (costTotalMicros * fxScaled * 100n) / (USD_MICRO_SCALE * RATE_SCALE);
  const grossMarginRate =
    revenueTotalSen > 0n
      ? formatScaled(((revenueTotalSen - costTotalSen) * RATE_SCALE) / revenueTotalSen, RATE_DIGITS)
      : null;

  // --- 基準ユニット比（docs/03 §7.5-3。粗利率だけでは異常を検知できない）------------------------
  const baselineMicros = parseUsdMicros(input.ruleset.aiBaselineCostUsd);
  if (baselineMicros <= 0n) throw new RangeError('aiBaselineCostUsd は 0 より大きい必要があります。');
  const baselineRatio = formatScaled((costAiMicros * RATE_SCALE) / baselineMicros, RATE_DIGITS);

  return {
    periodMonth: input.periodMonth,
    pricingRulesetVersion: input.ruleset.version,
    revenueSeatJpy: formatScaled(revenueSeatSen, JPY_SEN_DIGITS),
    revenueOverageJpy: formatScaled(revenueOverageSen, JPY_SEN_DIGITS),
    costAiUsd: formatUsdMicros(costAiMicros),
    costAiByRoleUsd,
    costEmailUsd: formatUsdMicros(costEmailMicros),
    costStorageUsd: formatUsdMicros(costStorageMicros),
    costEsignUsd: formatUsdMicros(costEsignMicros),
    grossMarginRate,
    baselineRatio,
    quotaConsumptionRate,
  };
}
