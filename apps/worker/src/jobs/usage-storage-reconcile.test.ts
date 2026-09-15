// apps/worker/src/jobs/usage-storage-reconcile.test.ts
// 🔴 `usage.storage-reconcile`（毎日 01:30 JST。docs/05 §9.8 / docs/03 §4.5）の検証。T-10-02。
//
//   ① オブジェクトストアの実測（`measureTenantUsage`）を payload の tenantId で取り、`packages/db` に渡す
//   ② 🔴 `usage_counters` を書く関数を 1 つも呼ばない（自動補正しない）
//   ③ payload が不正なら実測もしない（他テナントのプレフィックスを走査しない）
//   ④ スケジュールは 01:30 JST の日次、キュー名は `QUEUE_DEFINITIONS` にある（attempts: 2）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reconcileTenantStorage = vi.fn();
const incrementUsageCounter = vi.fn();
const recordUsageCounterSnapshot = vi.fn();

vi.mock('@ses/db', () => ({
  reconcileTenantStorage,
  incrementUsageCounter,
  recordUsageCounterSnapshot,
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
  createUsageStorageReconcileHandler,
  parseUsageStorageReconcilePayload,
  USAGE_STORAGE_RECONCILE_JOB,
  USAGE_STORAGE_RECONCILE_SCHEDULE,
} = await import('./usage-storage-reconcile.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { isQueueName, QUEUE_DEFINITIONS } = await import('@ses/connectors');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-15T16:30:00.000Z'); // 01:30 JST

beforeEach(() => {
  reconcileTenantStorage.mockReset();
  incrementUsageCounter.mockReset();
  recordUsageCounterSnapshot.mockReset();
  reconcileTenantStorage.mockResolvedValue({
    periodKey: '2026-09',
    counterBytes: 100n,
    measuredBytes: 120n,
    decision: { kind: 'DIVERGENCE', deltaBytes: 20n },
    detected: 1,
    opened: 1,
    resolved: 0,
  });
});

describe('🔴 usage.storage-reconcile: 宣言とキュー定義', () => {
  it('キュー名は QUEUE_DEFINITIONS にあり attempts: 2（docs/05 §9.8 の表のとおり）', () => {
    expect(USAGE_STORAGE_RECONCILE_JOB).toBe('usage.storage-reconcile');
    expect(isQueueName(USAGE_STORAGE_RECONCILE_JOB)).toBe(true);
    expect(QUEUE_DEFINITIONS['usage.storage-reconcile'].defaultJobOptions).toEqual({ attempts: 2 });
  });

  it('毎日 01:30 JST（docs/05 §9.8）', () => {
    expect(USAGE_STORAGE_RECONCILE_SCHEDULE).toEqual({ cron: '30 1 * * *', timeZone: 'Asia/Tokyo' });
  });
});

describe('🔴 ハンドラ', () => {
  it('① 実測を payload の tenantId で取り、② カウンタを書かずに packages/db へ渡す', async () => {
    const measureTenantUsage = vi.fn(async () => ({ byteSize: 120n, objectCount: 2 }));
    const handler = createUsageStorageReconcileHandler({ now: () => NOW, objectStore: { measureTenantUsage } });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:usage.storage-reconcile:1');

    expect(measureTenantUsage).toHaveBeenCalledWith(TENANT_ID);
    const [ctx, input] = reconcileTenantStorage.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx['tenantId']).toBe(TENANT_ID);
    expect(ctx['job']).toEqual({ queue: 'usage.storage-reconcile', jobId: 'repeat:usage.storage-reconcile:1' });
    expect(input).toEqual({ measuredBytes: 120n, now: NOW });
    expect(outcome.objectCount).toBe(2);
    expect(outcome.decision).toEqual({ kind: 'DIVERGENCE', deltaBytes: 20n });
    // 🔴 自動補正しない: カウンタを書く経路を 1 度も呼ばない。
    expect(incrementUsageCounter).not.toHaveBeenCalled();
    expect(recordUsageCounterSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['オブジェクトでない', null],
    ['tenantId が無い', {}],
    ['tenantId が UUID でない', { tenantId: '../..' }],
  ])('🔴 ③ payload が不正（%s）なら実測もしない', async (_label, payload) => {
    const measureTenantUsage = vi.fn(async () => ({ byteSize: 0n, objectCount: 0 }));
    const handler = createUsageStorageReconcileHandler({ now: () => NOW, objectStore: { measureTenantUsage } });
    await expect(handler(payload, 'repeat:usage.storage-reconcile:2')).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(() => parseUsageStorageReconcilePayload(payload)).toThrow(InvalidJobPayloadError);
    expect(measureTenantUsage).not.toHaveBeenCalled();
    expect(reconcileTenantStorage).not.toHaveBeenCalled();
  });
});
