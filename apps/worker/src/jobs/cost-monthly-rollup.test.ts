// apps/worker/src/jobs/cost-monthly-rollup.test.ts
// 🔴 `cost.monthly-rollup`（毎日 01:40 JST。docs/05 §9.8 / §5.9 / `F-026 AC-5`）の検証。T-10-02。
//
//   ① `listMonthsToRollup` が返した月をすべて集計し、契約条件（seam）・SES Tenants 課金・単価表の版を渡す
//   ② 🔴 `production` 以外では SES Tenants 課金は `NOT_APPLICABLE`（DB の割当を見に行かない）
//   ③ `production` では割当（ASSIGNED / NONE / UNCONFIRMED）を 確定 / 非該当 / 不明 に写す
//   ④ Phase 1 の seam（`billingTermsNotRecorded`）は `null`（売上 0 の事実）
//   ⑤ payload が不正なら実行しない / スケジュールは 01:40 JST / attempts: 3
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMonthsToRollup = vi.fn();
const readSesTenantAssignment = vi.fn();
const rollupTenantMonthlyCost = vi.fn();

vi.mock('@ses/db', () => ({
  listMonthsToRollup,
  readSesTenantAssignment,
  rollupTenantMonthlyCost,
  systemTenantCtx: (tenantId: string, job: { queue: string; jobId: string }) => ({
    tenantId,
    partnerCompanyId: null,
    userId: '',
    role: 'SALES',
    lifecycleState: 'ACTIVE',
    deviceKind: 'api',
    job,
  }),
}));

const {
  billingTermsNotRecorded,
  COST_MONTHLY_ROLLUP_JOB,
  COST_MONTHLY_ROLLUP_SCHEDULE,
  createCostMonthlyRollupHandler,
  parseCostMonthlyRollupPayload,
  resolveEmailTenantsBillingPolicy,
} = await import('./cost-monthly-rollup.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { isQueueName, QUEUE_DEFINITIONS } = await import('@ses/connectors');
const { PRICING_RULESET_V1 } = await import('@ses/domain');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-15T16:40:00.000Z'); // 2026-09-16 01:40 JST

const TERMS = {
  monthlySeatPriceJpy: '3000.00',
  overageUnitPricesJpy: {
    AI_UNIT_SHEET_PARSE: '50',
    AI_UNIT_MATCH_RATIONALE: '6',
    AI_UNIT_PROPOSAL_DRAFT: '32',
    AI_UNIT_RENEWAL_SUMMARY: '26',
  },
  unitQuotas: { AI_UNIT_SHEET_PARSE: 70, AI_UNIT_MATCH_RATIONALE: 2300, AI_UNIT_PROPOSAL_DRAFT: 70, AI_UNIT_RENEWAL_SUMMARY: 10 },
  aiCostCapUsd: '40.00',
} as const;

beforeEach(() => {
  listMonthsToRollup.mockReset();
  readSesTenantAssignment.mockReset();
  rollupTenantMonthlyCost.mockReset();
  listMonthsToRollup.mockResolvedValue(['2026-08', '2026-09']);
  readSesTenantAssignment.mockResolvedValue('ASSIGNED');
  rollupTenantMonthlyCost.mockImplementation(async (_ctx: unknown, input: { periodMonth: string }) =>
    input.periodMonth === '2026-09' ? { kind: 'PROVISIONAL', breakdown: {} } : { kind: 'ALREADY_FINALIZED' },
  );
});

describe('🔴 cost.monthly-rollup: 宣言とキュー定義', () => {
  it('キュー名は QUEUE_DEFINITIONS にあり attempts: 3（外部 API を呼ばない。upsert は冪等）', () => {
    expect(COST_MONTHLY_ROLLUP_JOB).toBe('cost.monthly-rollup');
    expect(isQueueName(COST_MONTHLY_ROLLUP_JOB)).toBe(true);
    expect(QUEUE_DEFINITIONS['cost.monthly-rollup'].defaultJobOptions).toEqual({ attempts: 3 });
  });

  it('毎日 01:40 JST（docs/05 §9.8。daily-rollup の後）', () => {
    expect(COST_MONTHLY_ROLLUP_SCHEDULE).toEqual({ cron: '40 1 * * *', timeZone: 'Asia/Tokyo' });
  });
});

describe('🔴 SES Tenants 課金の方針は起動時に 1 回決まる（docs/05 §8.8 / §13.1）', () => {
  it.each(['development', 'demo', 'sandbox', 'staging'] as const)('%s は NOT_APPLICABLE', (env) => {
    expect(resolveEmailTenantsBillingPolicy(env)).toBe('NOT_APPLICABLE');
  });
  it('production は BY_ASSIGNMENT', () => {
    expect(resolveEmailTenantsBillingPolicy('production')).toBe('BY_ASSIGNMENT');
  });
});

describe('🔴 ハンドラ', () => {
  it('① 返された月をすべて集計し、契約条件・課金判定・単価表を渡す', async () => {
    const billingTerms = vi.fn(async () => TERMS);
    const handler = createCostMonthlyRollupHandler({
      now: () => NOW,
      billingTerms,
      emailTenantsBillingPolicy: 'BY_ASSIGNMENT',
      pricingRuleset: PRICING_RULESET_V1,
    });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:cost.monthly-rollup:1');

    expect(billingTerms).toHaveBeenCalledWith(TENANT_ID);
    expect(listMonthsToRollup).toHaveBeenCalledTimes(1);
    expect(rollupTenantMonthlyCost).toHaveBeenCalledTimes(2);
    for (const [index, periodMonth] of ['2026-08', '2026-09'].entries()) {
      const [ctx, input] = rollupTenantMonthlyCost.mock.calls[index] as [Record<string, unknown>, Record<string, unknown>];
      expect(ctx['tenantId']).toBe(TENANT_ID);
      expect(ctx['job']).toEqual({ queue: 'cost.monthly-rollup', jobId: 'repeat:cost.monthly-rollup:1' });
      expect(input).toEqual({
        periodMonth,
        now: NOW,
        billingTerms: TERMS,
        emailTenantsBilling: 'APPLIES',
        ruleset: PRICING_RULESET_V1,
      });
    }
    expect(outcome.emailTenantsBilling).toBe('APPLIES');
    expect(outcome.months.map((month) => [month.periodMonth, month.outcome.kind])).toEqual([
      ['2026-08', 'ALREADY_FINALIZED'],
      ['2026-09', 'PROVISIONAL'],
    ]);
  });

  it('🔴 ② NOT_APPLICABLE の方針では DB の割当を見に行かない', async () => {
    const handler = createCostMonthlyRollupHandler({
      now: () => NOW,
      billingTerms: billingTermsNotRecorded,
      emailTenantsBillingPolicy: 'NOT_APPLICABLE',
      pricingRuleset: PRICING_RULESET_V1,
    });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:cost.monthly-rollup:2');
    expect(readSesTenantAssignment).not.toHaveBeenCalled();
    expect(outcome.emailTenantsBilling).toBe('NOT_APPLICABLE');
  });

  it.each([
    ['ASSIGNED', 'APPLIES'],
    ['NONE', 'NOT_APPLICABLE'],
    ['UNCONFIRMED', 'UNKNOWN'],
  ] as const)('③ BY_ASSIGNMENT: 割当 %s → %s', async (assignment, expected) => {
    readSesTenantAssignment.mockResolvedValue(assignment);
    const handler = createCostMonthlyRollupHandler({
      now: () => NOW,
      billingTerms: billingTermsNotRecorded,
      emailTenantsBillingPolicy: 'BY_ASSIGNMENT',
      pricingRuleset: PRICING_RULESET_V1,
    });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:cost.monthly-rollup:3');
    expect(outcome.emailTenantsBilling).toBe(expected);
    expect(rollupTenantMonthlyCost.mock.calls[0]?.[1]).toMatchObject({ emailTenantsBilling: expected });
  });

  it('🔴 ④ Phase 1 の seam は null（契約が記録されていない事実。売上 0 / 粗利率 null は domain が担う）', async () => {
    expect(await billingTermsNotRecorded(TENANT_ID)).toBeNull();
  });

  it.each([
    ['オブジェクトでない', 'x'],
    ['tenantId が無い', {}],
    ['tenantId が UUID でない', { tenantId: 'tenant' }],
  ])('🔴 ⑤ payload が不正（%s）なら InvalidJobPayloadError で、DB を 1 度も呼ばない', async (_label, payload) => {
    const handler = createCostMonthlyRollupHandler({
      now: () => NOW,
      billingTerms: billingTermsNotRecorded,
      emailTenantsBillingPolicy: 'NOT_APPLICABLE',
      pricingRuleset: PRICING_RULESET_V1,
    });
    await expect(handler(payload, 'repeat:cost.monthly-rollup:4')).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(() => parseCostMonthlyRollupPayload(payload)).toThrow(InvalidJobPayloadError);
    expect(listMonthsToRollup).not.toHaveBeenCalled();
    expect(rollupTenantMonthlyCost).not.toHaveBeenCalled();
  });
});
