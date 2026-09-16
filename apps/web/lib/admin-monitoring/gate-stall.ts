// apps/web/lib/admin-monitoring/gate-stall.ts
// 🔴 `A-005` 項目 12「`GATE_RUNNING` の滞留」の、failed セット（BullMQ）を照合できなかったときの扱い
//    （docs/sprints/SP-11 T-11-05 の申し送り ②「`RUNNING_OVERDUE` に畳まず、`failedJobsAvailable=false` 相当で
//    『失敗記録を照合できていません』と出す」）。T-11-04。
//
// `listGateStalls` は failed セットが空だと閾値超過を `RUNNING_OVERDUE` に分類する（それが唯一の検知元だから）。
// Redis を読めなかったときにそのまま出すと、**実際には失敗している対象を「応答不明」と誤って表示する**。
// ここでは保留（`AI_COST_LIMIT_HELD`。DB の事実であり Redis に依存しない）だけを残し、閾値超過は件数だけを
// `unclassifiedOverdue` に寄せる。
import type { GateStallPayload, GateStallRowView } from './view';

/** failed セットを照合できたときの写し（`rows` はそのまま）。 */
export function gateStallWithFailedJobs(payload: Omit<GateStallPayload, 'failedJobsAvailable' | 'unclassifiedOverdue'>): GateStallPayload {
  return { ...payload, failedJobsAvailable: true, unclassifiedOverdue: 0 };
}

/**
 * 🔴 failed セットを照合できなかったときの写し。`RUNNING_OVERDUE` の行を落とし、`JOB_FAILED` は 0（判定不能）、
 *    落とした件数を `unclassifiedOverdue` に置く。`total` は残した行数（`countsByReason` の合計と一致させる）。
 */
export function gateStallWithoutFailedJobs(payload: Omit<GateStallPayload, 'failedJobsAvailable' | 'unclassifiedOverdue'>): GateStallPayload {
  const rows: GateStallRowView[] = payload.rows.filter((row) => row.reason === 'AI_COST_LIMIT_HELD');
  // `rows` は 500 件で切られうるため、落とした件数は `countsByReason` の側（全件）から取る。
  const unclassifiedOverdue = payload.countsByReason.RUNNING_OVERDUE + payload.countsByReason.JOB_FAILED;
  return {
    stallThresholdMinutes: payload.stallThresholdMinutes,
    countsByReason: { AI_COST_LIMIT_HELD: payload.countsByReason.AI_COST_LIMIT_HELD, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
    rows,
    total: payload.countsByReason.AI_COST_LIMIT_HELD,
    failedJobsAvailable: false,
    unclassifiedOverdue,
  };
}
