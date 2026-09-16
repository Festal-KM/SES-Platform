// apps/web/lib/admin-monitoring/gate-stall.test.ts
// `A-005` 項目 12 で failed セット（BullMQ）を照合できなかったときの扱い（docs/sprints/SP-11 T-11-05 ②）。T-11-04。
import { describe, expect, it } from 'vitest';
import { gateStallWithFailedJobs, gateStallWithoutFailedJobs } from './gate-stall';
import type { GateStallRowView } from './view';

const row = (reason: GateStallRowView['reason'], targetId: string): GateStallRowView => ({
  tenantId: '01930000-0000-7000-8000-0000000000a1',
  targetType: 'PROPOSAL',
  targetId,
  reason,
  since: '2026-09-16T08:00:00.000Z',
  stalledMinutes: 60,
});

const BASE = {
  stallThresholdMinutes: 30,
  countsByReason: { AI_COST_LIMIT_HELD: 1, JOB_FAILED: 0, RUNNING_OVERDUE: 2 },
  rows: [row('AI_COST_LIMIT_HELD', 'p-held'), row('RUNNING_OVERDUE', 'p-1'), row('RUNNING_OVERDUE', 'p-2')],
  total: 3,
};

describe('gateStallWithFailedJobs', () => {
  it('照合できたときは rows をそのまま、failedJobsAvailable: true', () => {
    expect(gateStallWithFailedJobs(BASE)).toEqual({ ...BASE, failedJobsAvailable: true, unclassifiedOverdue: 0 });
  });
});

describe('gateStallWithoutFailedJobs', () => {
  it('🔴 RUNNING_OVERDUE に畳まず、保留（DB の事実）だけを残して閾値超過は件数だけ unclassifiedOverdue に寄せる', () => {
    const result = gateStallWithoutFailedJobs(BASE);
    expect(result).toEqual({
      stallThresholdMinutes: 30,
      countsByReason: { AI_COST_LIMIT_HELD: 1, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
      rows: [row('AI_COST_LIMIT_HELD', 'p-held')],
      total: 1,
      failedJobsAvailable: false,
      unclassifiedOverdue: 2,
    });
    expect(Object.values(result.countsByReason).reduce((sum, n) => sum + n, 0)).toBe(result.total);
  });

  it('保留も閾値超過も無ければ 0 件で成立する', () => {
    const result = gateStallWithoutFailedJobs({
      stallThresholdMinutes: 30,
      countsByReason: { AI_COST_LIMIT_HELD: 0, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
      rows: [],
      total: 0,
    });
    expect(result).toMatchObject({ total: 0, unclassifiedOverdue: 0, failedJobsAvailable: false });
  });
});
