// apps/worker/src/jobs/usage-gap-check.test.ts
// 🔴 `usage.gap-check`（毎日 01:20 JST。docs/05 §9.8 / `F-026 AC-4`）の検証。T-10-02。
// 🔴 DB を触らない（`@ses/db` はモック）。欠測が `usage_measurement_findings` に現れることの実測は
//    `tests/isolation/usage-measurement.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkUsageGaps = vi.fn();

vi.mock('@ses/db', () => ({
  checkUsageGaps,
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

const { createUsageGapCheckHandler, parseUsageGapCheckPayload, USAGE_GAP_CHECK_JOB, USAGE_GAP_CHECK_SCHEDULE } =
  await import('./usage-gap-check.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { isQueueName, QUEUE_DEFINITIONS } = await import('@ses/connectors');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-15T16:20:00.000Z'); // 01:20 JST

beforeEach(() => {
  checkUsageGaps.mockReset();
  checkUsageGaps.mockResolvedValue({ checkedDays: ['2026-09-15'], findings: [], detected: 0, opened: 0, resolved: 0 });
});

describe('🔴 usage.gap-check: 宣言とキュー定義', () => {
  it('キュー名は QUEUE_DEFINITIONS にあり attempts: 3（読み取りと検知結果の upsert だけ）', () => {
    expect(USAGE_GAP_CHECK_JOB).toBe('usage.gap-check');
    expect(isQueueName(USAGE_GAP_CHECK_JOB)).toBe(true);
    expect(QUEUE_DEFINITIONS['usage.gap-check'].defaultJobOptions).toEqual({ attempts: 3 });
  });

  it('毎日 01:20 JST（docs/05 §9.8。daily-rollup の後）', () => {
    expect(USAGE_GAP_CHECK_SCHEDULE).toEqual({ cron: '20 1 * * *', timeZone: 'Asia/Tokyo' });
  });
});

describe('🔴 ハンドラ: ジョブ文脈で packages/db の 1 関数を呼ぶだけ', () => {
  it('payload の tenantId から systemTenantCtx を組み立て、now と lookback を渡す', async () => {
    const handler = createUsageGapCheckHandler({ now: () => NOW, gapCheckLookbackDays: 7 });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:usage.gap-check:1');
    expect(outcome.detected).toBe(0);
    const [ctx, input] = checkUsageGaps.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx['tenantId']).toBe(TENANT_ID);
    expect(ctx['partnerCompanyId']).toBeNull();
    expect(ctx['job']).toEqual({ queue: 'usage.gap-check', jobId: 'repeat:usage.gap-check:1' });
    expect(input).toEqual({ now: NOW, lookbackDays: 7 });
  });

  it.each([
    ['オブジェクトでない', 42],
    ['tenantId が無い', {}],
    ['tenantId が UUID でない', { tenantId: 'x' }],
  ])('🔴 payload が不正（%s）なら InvalidJobPayloadError で、DB を 1 度も呼ばない', async (_label, payload) => {
    const handler = createUsageGapCheckHandler({ now: () => NOW, gapCheckLookbackDays: 7 });
    await expect(handler(payload, 'repeat:usage.gap-check:2')).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(() => parseUsageGapCheckPayload(payload)).toThrow(InvalidJobPayloadError);
    expect(checkUsageGaps).not.toHaveBeenCalled();
  });
});
