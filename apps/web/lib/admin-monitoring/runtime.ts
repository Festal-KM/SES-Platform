// apps/web/lib/admin-monitoring/runtime.ts
// 🔴 `A-005`（API-A8）が起動時 DI（`apps/web/lib/db/bootstrap.ts`）から受け取る口の**型**。T-11-04。
//
// ルート（`apps/web/app/api/admin/monitoring/route.ts`）は `process.env` を読まず、閾値・上限・Redis の口を
// `bootstrap.ts` のアクセサ（`monitoringRuntime()` ほか）から受け取る（`CLAUDE.md` §3.5 / §11.1「差し替えは起動時の 1 箇所」）。
//
// 🔴 failed セットの口は**読むだけ**（`FailedJobsSnapshot` は件数・時刻・`gate.run` の 3 つの ID の写し）。
//    `Job` / `Queue` / `retry()` / `remove()` に到達できる形をここに置かない（docs/05 §9.10 ① / Issue #16。
//    `tests/static/admin-no-gate-retry.test.ts`）。実体は `@ses/connectors/bullmq` の `createBullMqFailedJobsReader` で、
//    bootstrap だけがそれを import する。
import type { FailedJobsSnapshot } from '@ses/connectors/bullmq';
import type { MailProviderQuotaReader } from './mail-provider-quota';

export type { FailedJobsSnapshot };

/** BullMQ の failed セットを読む口。失敗したら throw する（呼び出し側が「照合できていません」に落とす。0 件で埋めない）。 */
export type FailedJobsReader = {
  list(): Promise<FailedJobsSnapshot>;
};

/** 閾値・方針値（`packages/config` が唯一の出所。ルートで `process.env` を読まない）。 */
export type MonitoringThresholds = {
  /** `SUBMITTING_STALL_ALERT_MINUTES` */
  readonly submittingStallMinutes: number;
  /** `GATE_STALL_ALERT_MINUTES` */
  readonly gateStallMinutes: number;
  /** `MAIL_DISPATCH_STUCK_ALERT_MINUTES` */
  readonly mailDispatchStuckMinutes: number;
  /** `SCAN_STALL_ALERT_MINUTES` */
  readonly scanStallMinutes: number;
  /** `TENANT_PURGE_GRACE_DAYS` */
  readonly purgeGraceDays: number;
  /** `PURGE_RUN_STALL_ALERT_MINUTES`（T-12-17 ⑱。項目 7 の `RUNNING_OVERDUE`） */
  readonly purgeRunStallMinutes: number;
  /** `SCHEDULER_HEARTBEAT_STALE_HOURS` */
  readonly schedulerStaleHours: number;
  /** `GATE_FAIL_RATE_WINDOW_HOURS` */
  readonly gateFailRateWindowHours: number;
  /** `GATE_FAIL_RATE_BASELINE_DAYS` */
  readonly gateFailRateBaselineDays: number;
};

/** 項目 17（`readProviderMonthlySpend`）に渡す値（docs/sprints/SP-11 T-11-08 ②）。 */
export type ProviderSpendRuntime = {
  /** `ANTHROPIC_MONTHLY_SPEND_CAP_USD` */
  readonly capUsd: number;
  /** `QUOTA_WARNING_THRESHOLD_PERCENT` */
  readonly warnPercent: number;
};

export type MonitoringRuntime = {
  readonly thresholds: MonitoringThresholds;
  readonly providerSpend: ProviderSpendRuntime;
  readonly mailProvider: MailProviderQuotaReader;
  readonly failedJobs: FailedJobsReader;
};
