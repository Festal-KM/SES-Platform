// apps/web/lib/admin-monitoring/severity.ts
// 🔴 `A-005` の各項目の「重さ」（docs/04 §A-005 の色分け / `CLAUDE.md` §4.2「失敗と保留を混同しない」/ `F-059 AC-6` / `AC-7`）。T-11-04。
//
//   - `failure`（障害の色）… 項目 1 / 2 / 3 / 4 / 7、項目 12 の `JOB_FAILED` / `RUNNING_OVERDUE`、項目 5 の急変、
//     項目 6（計測欠測。後から遡れない）、項目 17 の `REACHED`（全テナントの AI が同時に止まる）、スケジューラ停止
//   - `hold`（保留・注意の色）… 項目 12 の `AI_COST_LIMIT_HELD`、13（到達・接近）、14、15、16、項目 11、項目 17 の `NEARING`
//   - `ok` … 成立（0 件 / 上限未満）
//
// 🔴 保留を障害の色にしない。保留は「外部への送信を 1 回も試みていない」状態であり、自動で復帰する（再送の操作も無い）。
// 🔴 外部 import を持たない純粋モジュール（`'use client'` の画面から値 import できる）。
import type { GateFailRatePayload, MonitoringItemView, MonitoringSeverity } from './view';

/**
 * 項目 5「急変」の暫定閾値（docs/04 §A-005 項目 5「急変を異常として検知」。値は本書に無く、`PLATFORM_OWNER` の閾値設定は
 * 本タスクの範囲外〔docs/04 §A-005 操作と結果〕）。**運用で変えるときはこの 3 行だけを直す**（画面側に散らさない）。
 *  - 直近の実行が `MIN_RUNS` 未満なら判定しない（1 件の FAIL で 100% になる）
 *  - 基準（その前の期間）があれば `+DELTA` 以上の上昇、無ければ `ABSOLUTE` 以上
 */
export const GATE_FAIL_RATE_SPIKE_MIN_RUNS = 5;
export const GATE_FAIL_RATE_SPIKE_DELTA = 0.25;
export const GATE_FAIL_RATE_SPIKE_ABSOLUTE = 0.5;

export function isGateFailRateSpike(row: GateFailRatePayload['rows'][number]): boolean {
  if (row.recent.rate === null || row.recent.done < GATE_FAIL_RATE_SPIKE_MIN_RUNS) return false;
  if (row.baseline.rate === null) return row.recent.rate >= GATE_FAIL_RATE_SPIKE_ABSOLUTE;
  return row.recent.rate >= row.baseline.rate + GATE_FAIL_RATE_SPIKE_DELTA;
}

/** 🔴 取得できなかった項目（`ok: false`）は重さを持たない（「異常なし」でも「異常」でもなく「不明」）。 */
export function severityOf(item: MonitoringItemView): MonitoringSeverity | 'unavailable' {
  if (!item.ok) return 'unavailable';
  switch (item.kind) {
    case 'SUBMIT_FAILED_UNATTENDED':
    case 'SUBMITTING_STALL':
    case 'FAILED_JOBS':
      return item.total > 0 ? 'failure' : 'ok';
    case 'PURGE_JOB_FAILED':
      // 🔴 T-12-17 ⑱: `RUNNING` の滞留は失敗ではなく「未完了の疑い」（項目 4 の `SCANNING` 滞留と同じ扱い = hold）。
      if (item.total > 0) return 'failure';
      return item.runningOverdue.total > 0 ? 'hold' : 'ok';
    case 'SCAN_FAILED':
      if (item.total > 0) return 'failure';
      return item.scanningStalled.count > 0 ? 'hold' : 'ok';
    case 'GATE_FAIL_RATE':
      return item.rows.some(isGateFailRateSpike) ? 'failure' : 'ok';
    case 'USAGE_MEASUREMENT':
      return Object.values(item.countsByKind).some((count) => count > 0) ? 'failure' : 'ok';
    case 'SENDING_DOMAIN_UNVERIFIED':
      // 🔴 障害の色にしない（DNS 反映待ちが最多。docs/sprints/SP-11 T-11-06 ①）。
      return item.total > 0 ? 'hold' : 'ok';
    case 'GATE_STALL': {
      const failures = item.countsByReason.JOB_FAILED + item.countsByReason.RUNNING_OVERDUE + item.unclassifiedOverdue;
      if (failures > 0) return 'failure';
      return item.countsByReason.AI_COST_LIMIT_HELD > 0 ? 'hold' : 'ok';
    }
    case 'MAIL_PROVIDER_QUOTA': {
      // 🔴 到達・接近・確認不能はいずれも「保留・注意」。障害ではない（保留分は自動で送られる）。
      if (!item.providerReading.available) return 'hold';
      if (item.heldCount > 0 || item.providerReading.consumptionRate >= item.warnRatio) return 'hold';
      return 'ok';
    }
    case 'SEND_HOLD':
    case 'PURGE_NOTICE_PENDING':
      return item.total > 0 ? 'hold' : 'ok';
    case 'MAIL_DISPATCH_STUCK':
      return item.count > 0 ? 'hold' : 'ok';
    case 'PROVIDER_SPEND':
      if (item.level === 'REACHED') return 'failure';
      return item.level === 'NEARING' ? 'hold' : 'ok';
    case 'SCHEDULER_HEARTBEAT':
      return item.stalled ? 'failure' : 'ok';
  }
}

/** 全項目が取れていて、かつ重さがすべて `ok`（docs/04 §A-005「異常は検知されていません」の条件）。 */
export function isAllClear(items: readonly MonitoringItemView[]): boolean {
  return items.every((item) => severityOf(item) === 'ok');
}
