// apps/web/lib/admin-monitoring/snapshot.test.ts
// 🔴 API-A8 の「項目ごとに独立して返す」（docs/05 §6.9 / docs/04 §A-005）。T-11-04。
//    1 項目の材料が throw しても他の項目は返り、失敗した項目は `{ ok: false, errorKind }`（0 件で埋めない）。
import { describe, expect, it, vi } from 'vitest';
import { buildMonitoringSnapshot, MonitoringReadError, type MonitoringReader, type MonitoringReaders } from './snapshot';
import { MONITORING_KINDS, type MonitoringKind, type MonitoringPayloadByKind } from './view';

const NOW = new Date('2026-09-16T09:00:00.000Z');

const EMPTY_RATE = { done: 0, failed: 0, rate: null } as const;

/** 全項目の「0 件 / 成立」の材料。 */
const PAYLOADS: MonitoringPayloadByKind = {
  SUBMIT_FAILED_UNATTENDED: { rows: [], total: 0 },
  SUBMITTING_STALL: { rows: [], total: 0, stallThresholdMinutes: 30 },
  FAILED_JOBS: { byQueue: [{ queueName: 'email.dispatch', count: 0, lastFailedAt: null }], total: 0 },
  SCAN_FAILED: { rows: [], total: 0, scanningStalled: { count: 0, oldestUploadedAt: null }, scanStallThresholdMinutes: 10 },
  GATE_FAIL_RATE: { rows: [], recent: EMPTY_RATE, baseline: EMPTY_RATE, windowHours: 24, baselineDays: 7 },
  USAGE_MEASUREMENT: { countsByKind: { GAP_MISSING: 0, GAP_MISMATCH: 0, STORAGE_DIVERGENCE: 0 }, items: [] },
  PURGE_JOB_FAILED: { rows: [], total: 0, runningOverdue: { kind: 'RUNNING_OVERDUE', rows: [], total: 0, stallThresholdMinutes: 30 } },
  SENDING_DOMAIN_UNVERIFIED: {
    items: [],
    countsByStatus: { NOT_REGISTERED: 0, REGISTERED: 0, PENDING: 0, FAILED: 0, REVOKED: 0 },
    total: 0,
  },
  GATE_STALL: {
    stallThresholdMinutes: 30,
    countsByReason: { AI_COST_LIMIT_HELD: 0, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
    rows: [],
    total: 0,
    failedJobsAvailable: true,
    unclassifiedOverdue: 0,
  },
  MAIL_PROVIDER_QUOTA: {
    scope: 'ENVIRONMENT',
    providerReading: { available: true, max24h: 200, sentLast24h: 10, consumptionRate: 0.05, observedAt: NOW.toISOString() },
    envLimit: 200,
    warnRatio: 0.8,
    reachedAt: null,
    nearingSince: null,
    heldCount: 0,
  },
  SEND_HOLD: {
    byReason: {
      RATE_LIMIT: { scope: 'TENANT', rows: [] },
      DOMAIN_UNVERIFIED: { scope: 'TENANT', rows: [] },
      ESIGN_DISCONNECTED: { scope: 'TENANT', rows: [] },
      TENANT_SUSPENDED: { scope: 'TENANT', rows: [] },
      GATE_STALE: { scope: 'TENANT', rows: [] },
      AI_COST_LIMIT: { scope: 'TENANT', rows: [] },
      PROVIDER_QUOTA: { scope: 'ENVIRONMENT', proposals: 0, contracts: 0, oldestSince: null },
    },
    total: 0,
  },
  PURGE_NOTICE_PENDING: { rows: [], total: 0, graceDays: 30 },
  MAIL_DISPATCH_STUCK: { count: 0, oldestSince: null, stallThresholdMinutes: 15, countIsLowerBound: false },
  PROVIDER_SPEND: {
    scope: 'ENVIRONMENT',
    periodKey: '2026-09',
    spentUsd: '12.000000',
    capUsd: '500.000000',
    consumptionRate: 0.024,
    level: 'BELOW',
    tenantCount: 3,
  },
  SCHEDULER_HEARTBEAT: { lastRunAt: NOW.toISOString(), staleHours: 24, stalled: false },
};

function readers(overrides: Partial<{ [K in MonitoringKind]: MonitoringReader<K> }> = {}): MonitoringReaders {
  const base = Object.fromEntries(
    MONITORING_KINDS.map((kind) => [kind, { errorKind: 'DB_READ_FAILED', read: async () => PAYLOADS[kind] }]),
  ) as unknown as MonitoringReaders;
  return { ...base, ...overrides } as MonitoringReaders;
}

describe('buildMonitoringSnapshot（項目ごとに独立。docs/04 §A-005）', () => {
  it('🔴 全項目が MONITORING_KINDS の順で返り、observedAt は引数の now', async () => {
    const onFailure = vi.fn();
    const snapshot = await buildMonitoringSnapshot(readers(), NOW, onFailure);
    expect(snapshot.observedAt).toBe(NOW.toISOString());
    expect(snapshot.items.map((item) => item.kind)).toEqual([...MONITORING_KINDS]);
    expect(snapshot.items.every((item) => item.ok)).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('🔴 1 項目の材料が throw しても他の項目は返り、失敗した項目だけが { ok: false, errorKind } になる（0 件で埋めない）', async () => {
    const onFailure = vi.fn();
    const failing: MonitoringReader<'FAILED_JOBS'> = {
      errorKind: 'QUEUE_READ_FAILED',
      read: async () => {
        throw new Error('ECONNREFUSED redis');
      },
    };
    const snapshot = await buildMonitoringSnapshot(readers({ FAILED_JOBS: failing }), NOW, onFailure);
    const failed = snapshot.items.find((item) => item.kind === 'FAILED_JOBS');
    expect(failed).toEqual({ kind: 'FAILED_JOBS', ok: false, errorKind: 'QUEUE_READ_FAILED' });
    expect(JSON.stringify(failed)).not.toContain('total');
    const others = snapshot.items.filter((item) => item.kind !== 'FAILED_JOBS');
    expect(others).toHaveLength(MONITORING_KINDS.length - 1);
    expect(others.every((item) => item.ok)).toBe(true);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith('FAILED_JOBS', 'QUEUE_READ_FAILED', expect.any(Error));
  });

  it('複数の項目が同時に失敗しても、それぞれの errorKind で個別に返る', async () => {
    const throwing = <K extends MonitoringKind>(errorKind: MonitoringReader<K>['errorKind']): MonitoringReader<K> => ({
      errorKind,
      read: async () => {
        throw new Error('boom');
      },
    });
    const snapshot = await buildMonitoringSnapshot(
      readers({ MAIL_PROVIDER_QUOTA: throwing('PROVIDER_READ_FAILED'), SEND_HOLD: throwing('DB_READ_FAILED') }),
      NOW,
      () => undefined,
    );
    const byKind = new Map(snapshot.items.map((item) => [item.kind, item]));
    expect(byKind.get('MAIL_PROVIDER_QUOTA')).toMatchObject({ ok: false, errorKind: 'PROVIDER_READ_FAILED' });
    expect(byKind.get('SEND_HOLD')).toMatchObject({ ok: false, errorKind: 'DB_READ_FAILED' });
    expect(byKind.get('PROVIDER_SPEND')).toMatchObject({ ok: true, level: 'BELOW' });
  });

  it('🔴 T-12-17 ⑦: MonitoringReadError は reader の既定を上書きし、原因（cause）が sink に流れる', async () => {
    const onFailure = vi.fn();
    const cause = new Error('ECONNREFUSED postgres');
    const reader: MonitoringReader<'MAIL_PROVIDER_QUOTA'> = {
      errorKind: 'PROVIDER_READ_FAILED',
      read: async () => {
        throw new MonitoringReadError('DB_READ_FAILED', cause);
      },
    };
    const snapshot = await buildMonitoringSnapshot(readers({ MAIL_PROVIDER_QUOTA: reader }), NOW, onFailure);
    expect(snapshot.items.find((item) => item.kind === 'MAIL_PROVIDER_QUOTA')).toEqual({
      kind: 'MAIL_PROVIDER_QUOTA',
      ok: false,
      errorKind: 'DB_READ_FAILED',
    });
    expect(onFailure).toHaveBeenCalledWith('MAIL_PROVIDER_QUOTA', 'DB_READ_FAILED', cause);
  });

  it('成功した項目は kind / ok と材料のキーを持つ（材料のキーを落とさない）', async () => {
    const snapshot = await buildMonitoringSnapshot(readers(), NOW, () => undefined);
    const quota = snapshot.items.find((item) => item.kind === 'MAIL_PROVIDER_QUOTA');
    expect(quota).toEqual({ kind: 'MAIL_PROVIDER_QUOTA', ok: true, ...PAYLOADS.MAIL_PROVIDER_QUOTA });
  });
});
