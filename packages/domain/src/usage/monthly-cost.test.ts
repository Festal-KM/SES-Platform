// packages/domain/src/usage/monthly-cost.test.ts
// 🔴 docs/02 章 7.5 の算出定義を固定する（`F-026 AC-5`）。T-10-02。
//
//   ① 原価（AI）は 6 ロールすべてに分解される（0 のロールもキーを持つ）
//   ② 売上（超過従量）は件数 × 円であり、金額から割り戻されていない
//   ③ メールの SES Tenants 課金は 3 値判定（`UNKNOWN` は高いほうに倒す）
//   ④ 契約が無ければ売上 0 / 粗利率 null（0 割りを 0% にしない）
//   ⑤ 版（`pricingRulesetVersion`）が結果に載る
import { describe, expect, it } from 'vitest';
import { AI_ROLES } from '../ai/roles.js';
import {
  computeTenantMonthlyCost,
  estimateEmailCostMicros,
  estimateStorageCostMicros,
  type BillingTerms,
  type MonthlyCostInput,
} from './monthly-cost.js';
import { PRICING_RULESET_V1 } from './pricing-ruleset.js';

const TERMS: BillingTerms = {
  monthlySeatPriceJpy: '3000.00',
  overageUnitPricesJpy: {
    AI_UNIT_SHEET_PARSE: '50',
    AI_UNIT_MATCH_RATIONALE: '6',
    AI_UNIT_PROPOSAL_DRAFT: '32',
    AI_UNIT_RENEWAL_SUMMARY: '26',
  },
  unitQuotas: {
    AI_UNIT_SHEET_PARSE: 70,
    AI_UNIT_MATCH_RATIONALE: 2300,
    AI_UNIT_PROPOSAL_DRAFT: 70,
    AI_UNIT_RENEWAL_SUMMARY: 10,
  },
  aiCostCapUsd: '40.00',
};

/** docs/03 §7.2 の基準ユニットに近い材料（30 席 / 410 通 / 1.5 GiB）。 */
const BASE: MonthlyCostInput = {
  periodMonth: '2026-09',
  seatCount: 30,
  aiCostByRoleUsd: { 'sheet-parser': '1.62', 'match-explainer': '8.00', 'gate-inspector': '1.44' },
  aiUnitCounts: { AI_UNIT_SHEET_PARSE: 80, AI_UNIT_MATCH_RATIONALE: 2000 },
  emailCount: 410,
  emailTenantsBilling: 'APPLIES',
  storageBytes: 1610612736n, // 1.5 GiB
  esignRequests: 0,
  billingTerms: TERMS,
  ruleset: PRICING_RULESET_V1,
};

describe('estimateEmailCostMicros（docs/05 §5.9 の式）', () => {
  it('APPLIES: 410/1000*0.16 + 0.005 + 410/1000*0.005', () => {
    expect(estimateEmailCostMicros(410, 'APPLIES', PRICING_RULESET_V1)).toBe(72_650n);
  });
  it('NOT_APPLICABLE: Essentials だけ', () => {
    expect(estimateEmailCostMicros(410, 'NOT_APPLICABLE', PRICING_RULESET_V1)).toBe(65_600n);
  });
  it('🔴 UNKNOWN は高いほう（APPLIES と同額）で見積もる（docs/05 §8.8）', () => {
    expect(estimateEmailCostMicros(410, 'UNKNOWN', PRICING_RULESET_V1)).toBe(
      estimateEmailCostMicros(410, 'APPLIES', PRICING_RULESET_V1),
    );
  });
  it('0 通でも Tenants の月額は乗る（NOT_APPLICABLE なら 0）', () => {
    expect(estimateEmailCostMicros(0, 'APPLIES', PRICING_RULESET_V1)).toBe(5_000n);
    expect(estimateEmailCostMicros(0, 'NOT_APPLICABLE', PRICING_RULESET_V1)).toBe(0n);
  });
});

describe('estimateStorageCostMicros', () => {
  it('1.5 GiB × $0.025 = $0.0375', () => {
    expect(estimateStorageCostMicros(1610612736n, PRICING_RULESET_V1)).toBe(37_500n);
  });
  it('0 バイトは 0', () => {
    expect(estimateStorageCostMicros(0n, PRICING_RULESET_V1)).toBe(0n);
  });
});

describe('computeTenantMonthlyCost', () => {
  it('① 原価（AI）は 6 ロールすべてに分解され、合計と一致する', () => {
    const result = computeTenantMonthlyCost(BASE);
    expect(Object.keys(result.costAiByRoleUsd).sort()).toEqual([...AI_ROLES].sort());
    expect(result.costAiByRoleUsd).toEqual({
      'sheet-parser': '1.620000',
      'skill-normalizer': '0.000000',
      'match-explainer': '8.000000',
      'gate-inspector': '1.440000',
      'proposal-drafter': '0.000000',
      'renewal-advisor': '0.000000',
    });
    expect(result.costAiUsd).toBe('11.060000');
  });

  it('② 売上は席 × 単価 + 超過件数 × 単価（件数 × 円。金額から割り戻さない）', () => {
    const result = computeTenantMonthlyCost(BASE);
    expect(result.revenueSeatJpy).toBe('90000.00');
    // sheetParse 80 − 70 = 10 件 × ¥50。matchRationale は 2000 < 2300 で超過なし。
    expect(result.revenueOverageJpy).toBe('500.00');
  });

  it('原価（メール / ストレージ / 電子署名）と粗利率・基準比・消化率', () => {
    const result = computeTenantMonthlyCost(BASE);
    expect(result.costEmailUsd).toBe('0.072650');
    expect(result.costStorageUsd).toBe('0.037500');
    expect(result.costEsignUsd).toBe('0.000000');
    // 売上 ¥90,500 / 原価 $11.17015 × 150 = ¥1,675.5225 → (90500 − 1675.52) / 90500 = 0.9814…
    expect(result.grossMarginRate).toBe('0.9814');
    // 11.06 / 12.82 = 0.8627…
    expect(result.baselineRatio).toBe('0.8627');
    // 11.06 / 40 = 0.2765
    expect(result.quotaConsumptionRate).toBe('0.2765');
    expect(result.pricingRulesetVersion).toBe('v1');
    expect(result.periodMonth).toBe('2026-09');
  });

  it('🔴 ④ 契約が無ければ売上 0・粗利率 null・消化率 null（原価は算出される）', () => {
    const result = computeTenantMonthlyCost({ ...BASE, billingTerms: null });
    expect(result.revenueSeatJpy).toBe('0.00');
    expect(result.revenueOverageJpy).toBe('0.00');
    expect(result.grossMarginRate).toBeNull();
    expect(result.quotaConsumptionRate).toBeNull();
    expect(result.costAiUsd).toBe('11.060000');
    expect(result.baselineRatio).toBe('0.8627');
  });

  it('材料が何も無い月は全項目 0（例外にしない。テナントは実在する）', () => {
    const result = computeTenantMonthlyCost({
      ...BASE,
      seatCount: 0,
      aiCostByRoleUsd: {},
      aiUnitCounts: {},
      emailCount: 0,
      emailTenantsBilling: 'NOT_APPLICABLE',
      storageBytes: 0n,
      billingTerms: null,
    });
    expect(result.costAiUsd).toBe('0.000000');
    expect(result.costEmailUsd).toBe('0.000000');
    expect(result.baselineRatio).toBe('0.0000');
    expect(result.grossMarginRate).toBeNull();
  });

  it('🔴 gate-inspector は原価に入るが従量売上には現れない（単位を持たない）', () => {
    const result = computeTenantMonthlyCost({
      ...BASE,
      aiCostByRoleUsd: { 'gate-inspector': '5' },
      aiUnitCounts: {},
    });
    expect(result.costAiByRoleUsd['gate-inspector']).toBe('5.000000');
    expect(result.revenueOverageJpy).toBe('0.00');
  });

  it('負の原価・非整数の件数は例外', () => {
    expect(() => computeTenantMonthlyCost({ ...BASE, aiCostByRoleUsd: { 'sheet-parser': '-1' } })).toThrow(RangeError);
    expect(() => computeTenantMonthlyCost({ ...BASE, emailCount: 1.5 })).toThrow(RangeError);
    expect(() => computeTenantMonthlyCost({ ...BASE, seatCount: -1 })).toThrow(RangeError);
  });
});
