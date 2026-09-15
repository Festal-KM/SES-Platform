// apps/worker/src/jobs/usage-daily-rollup.test.ts
// 🔴 `usage.daily-rollup`（毎日 01:10 JST。docs/05 §9.8）の検証。T-10-02。
//
//   ① 対象は**昨日**（JST）であり、当日ではない
//   ② `EMAIL_COUNT` の MONTH 行は昨日の月（+ 月をまたいだ翌日は今月も）を畳む
//   ③ 🔴 payload が不正なら**実行しない**
//   ④ スケジュールは 01:10 JST の日次、キュー名は `QUEUE_DEFINITIONS` にある（attempts: 3）
//   ⑤ 🔴 `AI_UNIT_*` に触れる関数を 1 つも呼ばない（`@ses/db` のモックが受けた関数名で固定する）
//
// 🔴 DB を触らない（`@ses/db` はモック）。突き合わせの実測は `tests/isolation/usage-measurement.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rollupAiCostDay = vi.fn();
const rollupEmailMonth = vi.fn();

vi.mock('@ses/db', () => ({
  rollupAiCostDay,
  rollupEmailMonth,
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

const { createUsageDailyRollupHandler, parseUsageDailyRollupPayload, USAGE_DAILY_ROLLUP_JOB, USAGE_DAILY_ROLLUP_SCHEDULE } =
  await import('./usage-daily-rollup.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { isQueueName, QUEUE_DEFINITIONS } = await import('@ses/connectors');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
/** 2026-09-16 01:10 JST。 */
const NOW = new Date('2026-09-15T16:10:00.000Z');

beforeEach(() => {
  rollupAiCostDay.mockReset();
  rollupEmailMonth.mockReset();
  rollupAiCostDay.mockResolvedValue({ periodKey: '2026-09-15', expectedUsd: '1.000000', previousUsd: '1.000000', valueUsd: '1.000000', corrected: false });
  rollupEmailMonth.mockImplementation(async (_ctx: unknown, input: { periodKey: string }) => ({ periodKey: input.periodKey, total: 3, written: true }));
});

describe('🔴 usage.daily-rollup: 宣言とキュー定義', () => {
  it('キュー名は QUEUE_DEFINITIONS にあり attempts: 3（外部 API を呼ばない）', () => {
    expect(USAGE_DAILY_ROLLUP_JOB).toBe('usage.daily-rollup');
    expect(isQueueName(USAGE_DAILY_ROLLUP_JOB)).toBe(true);
    expect(QUEUE_DEFINITIONS['usage.daily-rollup'].defaultJobOptions).toEqual({ attempts: 3 });
  });

  it('毎日 01:10 JST（docs/05 §9.8）', () => {
    expect(USAGE_DAILY_ROLLUP_SCHEDULE).toEqual({ cron: '10 1 * * *', timeZone: 'Asia/Tokyo' });
  });
});

describe('🔴 ハンドラ', () => {
  it('① 昨日（JST）の AI_COST_USD を突き合わせ、② 昨日の月の EMAIL_COUNT を畳む', async () => {
    const handler = createUsageDailyRollupHandler({ now: () => NOW });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:usage.daily-rollup:1');

    expect(rollupAiCostDay).toHaveBeenCalledTimes(1);
    const [ctx, input] = rollupAiCostDay.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx['tenantId']).toBe(TENANT_ID);
    expect(ctx['partnerCompanyId']).toBeNull();
    expect(ctx['job']).toEqual({ queue: 'usage.daily-rollup', jobId: 'repeat:usage.daily-rollup:1' });
    expect(input).toEqual({ periodKey: '2026-09-15', now: NOW });

    expect(rollupEmailMonth).toHaveBeenCalledTimes(1);
    expect(rollupEmailMonth.mock.calls[0]?.[1]).toEqual({ periodKey: '2026-09', now: NOW });
    expect(outcome.email.map((row) => row.periodKey)).toEqual(['2026-09']);
  });

  it('🔴 月初（昨日 = 先月末）は先月と今月の両方を畳む（先月の MONTH 行を確定させる）', async () => {
    const firstOfMonth = new Date('2026-09-30T16:10:00.000Z'); // 2026-10-01 01:10 JST
    const handler = createUsageDailyRollupHandler({ now: () => firstOfMonth });
    await handler({ tenantId: TENANT_ID }, 'repeat:usage.daily-rollup:2');
    expect(rollupAiCostDay.mock.calls[0]?.[1]).toEqual({ periodKey: '2026-09-30', now: firstOfMonth });
    expect(rollupEmailMonth.mock.calls.map((call) => (call[1] as { periodKey: string }).periodKey)).toEqual(['2026-09', '2026-10']);
  });

  it('🔴 JST の 0 時〜9 時でも「昨日」は JST の暦で決まる（UTC で切らない）', async () => {
    const early = new Date('2026-09-15T15:30:00.000Z'); // 2026-09-16 00:30 JST（UTC ではまだ 15 日）
    const handler = createUsageDailyRollupHandler({ now: () => early });
    await handler({ tenantId: TENANT_ID }, 'repeat:usage.daily-rollup:3');
    expect(rollupAiCostDay.mock.calls[0]?.[1]).toEqual({ periodKey: '2026-09-15', now: early });
  });

  it.each([
    ['オブジェクトでない', 'not-an-object'],
    ['tenantId が無い', {}],
    ['tenantId が UUID でない', { tenantId: 'tenant-a' }],
  ])('🔴 ③ payload が不正（%s）なら InvalidJobPayloadError で、DB を 1 度も呼ばない', async (_label, payload) => {
    const handler = createUsageDailyRollupHandler({ now: () => NOW });
    await expect(handler(payload, 'repeat:usage.daily-rollup:4')).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(() => parseUsageDailyRollupPayload(payload)).toThrow(InvalidJobPayloadError);
    expect(rollupAiCostDay).not.toHaveBeenCalled();
    expect(rollupEmailMonth).not.toHaveBeenCalled();
  });
});
