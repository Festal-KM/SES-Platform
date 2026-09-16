// apps/web/app/api/admin/monitoring/_lib/readers.ts
// 🔴 API-A8（`A-005` 運用監視）の材料の読み取り口（docs/05 §6.9 API-A8 / §16.5 / docs/04 §A-005 / `F-059`）。T-11-04。
//
// 各項目の材料は `@ses/db/platform` の専用クエリ（`withPlatformRead` + `admin.monitoring.view`）と、起動時 DI が渡す
// Redis / 送信基盤の口（`monitoringRuntime()`）から読む。**DTO → View（JSON 化済みの形）の写しだけ**をここで行い、
// 項目単位の独立性（1 つの失敗が他を巻き込まない）は `buildMonitoringSnapshot`（`apps/web/lib/admin-monitoring/snapshot.ts`）が担う。
//
// 🔴 既存の材料を再実装しない: 項目 6 = `listOpenUsageMeasurementFindings`（T-10-02）/ 項目 11 = `listUnverifiedSendingDomains`
//    （T-11-06）/ 項目 12 = `listGateStalls`（T-11-05）/ 項目 17 = `readProviderMonthlySpend`（T-11-08）。
// 🔴 写すのは DTO のキーだけ（`BR-40`）。DTO に無いもの（本文・氏名・DKIM トークン・宛先・payload）はここにも現れない。
// 🔴 `process.env` を読まない。閾値・上限・口は `MonitoringRuntime`（`bootstrap.ts`）から受ける。
// 🔴 failed セット（BullMQ）は**読むだけ**の口（`runtime.failedJobs.list()`）で 1 回だけ読み、項目 3 と項目 12 で共有する。
//    `Job.retry()` / `remove()` に到達できる形はこのファイルに無い（`tests/static/admin-no-gate-retry.test.ts`）。
import type { AuthenticatedPlatformCtx } from '@ses/db';
import {
  listGateStalls,
  listOpenUsageMeasurementFindings,
  listUnverifiedSendingDomains,
  readGateFailRates,
  readMailDispatchStuck,
  readMailProviderHeld,
  readProviderMonthlySpend,
  readPurgeJobFailures,
  readPurgeNoticePending,
  readScanFailures,
  readSchedulerHeartbeat,
  readSendHolds,
  readSubmittingStalls,
  readUnattendedSubmitFailures,
  type GateStalls,
  type SendHoldByReason,
} from '@ses/db/platform';
import { gateStallWithFailedJobs, gateStallWithoutFailedJobs } from '../../../../../lib/admin-monitoring/gate-stall';
import { readMailProviderQuota } from '../../../../../lib/admin-monitoring/mail-provider-quota';
import type { FailedJobsSnapshot, MonitoringRuntime } from '../../../../../lib/admin-monitoring/runtime';
import type { MonitoringReaders } from '../../../../../lib/admin-monitoring/snapshot';
import type { GateStallPayload, SendHoldByReasonView } from '../../../../../lib/admin-monitoring/view';

export type MonitoringReadMeta = {
  readonly ipAddress: string | null;
  /** 🔴 現在時刻は 1 リクエストで 1 つ（項目間で「いま」がずれない）。 */
  readonly now: Date;
};

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** 🔴 `getQuota()` が最後に成功した時刻の記憶（プロセス内。`available: false` のときの `lastObservedAt`）。 */
const mailProviderMemory: { lastObservedAt: Date | null } = { lastObservedAt: null };

function toGateStallView(stalls: GateStalls): Omit<GateStallPayload, 'failedJobsAvailable' | 'unclassifiedOverdue'> {
  return {
    stallThresholdMinutes: stalls.stallThresholdMinutes,
    countsByReason: stalls.countsByReason,
    rows: stalls.rows.map((row) => ({
      tenantId: row.tenantId,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      since: row.since.toISOString(),
      stalledMinutes: row.stalledMinutes,
    })),
    total: stalls.total,
  };
}

function toSendHoldView(entry: SendHoldByReason): SendHoldByReasonView {
  if (entry.scope === 'ENVIRONMENT') {
    return { scope: 'ENVIRONMENT', proposals: entry.proposals, contracts: entry.contracts, oldestSince: iso(entry.oldestSince) };
  }
  return {
    scope: 'TENANT',
    rows: entry.rows.map((row) => ({
      tenantId: row.tenantId,
      proposals: row.proposals,
      contracts: row.contracts,
      oldestSince: iso(row.oldestSince),
    })),
  };
}

/**
 * 🔴 全項目の読み取り口を組み立てる。読み取りはここでは始まらない（`buildMonitoringSnapshot` が並列に呼ぶ）。
 */
export function createMonitoringReaders(
  ctx: AuthenticatedPlatformCtx,
  runtime: MonitoringRuntime,
  meta: MonitoringReadMeta,
): MonitoringReaders {
  const { thresholds } = runtime;
  const base = { ipAddress: meta.ipAddress, now: meta.now } as const;

  // 🔴 failed セットは 1 回だけ読む（項目 3 と 12 で共有）。失敗は各項目が自分の形で受ける。
  let failedJobsOnce: Promise<FailedJobsSnapshot> | null = null;
  const failedJobs = (): Promise<FailedJobsSnapshot> => {
    failedJobsOnce ??= runtime.failedJobs.list();
    return failedJobsOnce;
  };

  return {
    SUBMIT_FAILED_UNATTENDED: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readUnattendedSubmitFailures(ctx, base);
        return {
          rows: result.rows.map((row) => ({ tenantId: row.tenantId, count: row.count, oldestSince: iso(row.oldestSince) })),
          total: result.total,
        };
      },
    },
    SUBMITTING_STALL: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readSubmittingStalls(ctx, { ...base, stallThresholdMinutes: thresholds.submittingStallMinutes });
        return {
          rows: result.rows.map((row) => ({
            tenantId: row.tenantId,
            count: row.count,
            oldestSince: iso(row.oldestSince),
            longestStalledMinutes: row.longestStalledMinutes,
          })),
          total: result.total,
          stallThresholdMinutes: result.stallThresholdMinutes,
        };
      },
    },
    FAILED_JOBS: {
      errorKind: 'QUEUE_READ_FAILED',
      read: async () => {
        const snapshot = await failedJobs();
        return {
          byQueue: snapshot.byQueue.map((entry) => ({
            queueName: entry.queueName,
            count: entry.count,
            lastFailedAt: iso(entry.lastFailedAt),
          })),
          total: snapshot.total,
        };
      },
    },
    SCAN_FAILED: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readScanFailures(ctx, { ...base, scanStallThresholdMinutes: thresholds.scanStallMinutes });
        return {
          rows: result.rows.map((row) => ({
            tenantId: row.tenantId,
            countsByStatus: row.countsByStatus,
            count: row.count,
            oldestSince: iso(row.oldestSince),
          })),
          total: result.total,
          scanningStalled: {
            count: result.scanningStalled.count,
            oldestUploadedAt: iso(result.scanningStalled.oldestUploadedAt),
          },
          scanStallThresholdMinutes: result.scanStallThresholdMinutes,
        };
      },
    },
    GATE_FAIL_RATE: {
      errorKind: 'DB_READ_FAILED',
      read: () =>
        readGateFailRates(ctx, {
          ...base,
          windowHours: thresholds.gateFailRateWindowHours,
          baselineDays: thresholds.gateFailRateBaselineDays,
        }),
    },
    USAGE_MEASUREMENT: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await listOpenUsageMeasurementFindings(ctx, { ipAddress: meta.ipAddress });
        return {
          countsByKind: result.countsByKind,
          // 🔴 `expected` / `observed`（数値）は `A-005` の行には要らない（種別 / 欠測日だけ。docs/04 §A-005 項目 6）。
          items: result.items.map((item) => ({
            tenantId: item.tenantId,
            kind: item.kind,
            metric: item.metric,
            periodKind: item.periodKind,
            periodKey: item.periodKey,
            detectedAt: item.detectedAt.toISOString(),
            lastSeenAt: item.lastSeenAt.toISOString(),
          })),
        };
      },
    },
    PURGE_JOB_FAILED: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readPurgeJobFailures(ctx, base);
        return {
          rows: result.rows.map((row) => ({
            tenantId: row.tenantId,
            cause: row.cause,
            failedCount: row.failedCount,
            lastFailedAt: iso(row.lastFailedAt),
          })),
          total: result.total,
        };
      },
    },
    SENDING_DOMAIN_UNVERIFIED: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await listUnverifiedSendingDomains(ctx, base);
        return {
          items: result.items.map((item) => ({
            tenantId: item.tenantId,
            tenantName: item.tenantName,
            lifecycleState: item.lifecycleState,
            domain: item.domain,
            status: item.status,
            startedAt: item.startedAt.toISOString(),
            lastCheckedAt: iso(item.lastCheckedAt),
            daysSinceStarted: item.daysSinceStarted,
            revokedAt: iso(item.revokedAt),
            daysSinceRevoked: item.daysSinceRevoked,
            expectedRecords: item.expectedRecords,
          })),
          countsByStatus: result.countsByStatus,
          total: result.total,
        };
      },
    },
    GATE_STALL: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        // 🔴 Redis を読めなかったときは `RUNNING_OVERDUE` に畳まず「失敗記録を照合できていません」に落とす
        //    （docs/sprints/SP-11 T-11-05 の申し送り ②）。DB の失敗はそのまま throw（項目全体が `ok: false`）。
        let snapshot: FailedJobsSnapshot | null;
        try {
          snapshot = await failedJobs();
        } catch {
          snapshot = null;
        }
        const stalls = await listGateStalls(ctx, {
          ...base,
          stallThresholdMinutes: thresholds.gateStallMinutes,
          failedJobs: snapshot === null ? [] : snapshot.gateRun,
        });
        const view = toGateStallView(stalls);
        return snapshot === null ? gateStallWithoutFailedJobs(view) : gateStallWithFailedJobs(view);
      },
    },
    MAIL_PROVIDER_QUOTA: {
      errorKind: 'PROVIDER_READ_FAILED',
      read: async () => {
        const held = await readMailProviderHeld(ctx, base);
        return readMailProviderQuota(runtime.mailProvider, held, meta.now, mailProviderMemory);
      },
    },
    SEND_HOLD: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readSendHolds(ctx, base);
        return {
          byReason: {
            RATE_LIMIT: toSendHoldView(result.byReason.RATE_LIMIT),
            DOMAIN_UNVERIFIED: toSendHoldView(result.byReason.DOMAIN_UNVERIFIED),
            ESIGN_DISCONNECTED: toSendHoldView(result.byReason.ESIGN_DISCONNECTED),
            TENANT_SUSPENDED: toSendHoldView(result.byReason.TENANT_SUSPENDED),
            GATE_STALE: toSendHoldView(result.byReason.GATE_STALE),
            AI_COST_LIMIT: toSendHoldView(result.byReason.AI_COST_LIMIT),
            PROVIDER_QUOTA: toSendHoldView(result.byReason.PROVIDER_QUOTA),
          },
          total: result.total,
        };
      },
    },
    PURGE_NOTICE_PENDING: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readPurgeNoticePending(ctx, { ...base, graceDays: thresholds.purgeGraceDays });
        return { rows: result.rows, total: result.total, graceDays: result.graceDays };
      },
    },
    MAIL_DISPATCH_STUCK: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readMailDispatchStuck(ctx, { ...base, stallThresholdMinutes: thresholds.mailDispatchStuckMinutes });
        return {
          count: result.count,
          oldestSince: iso(result.oldestSince),
          stallThresholdMinutes: result.stallThresholdMinutes,
          countIsLowerBound: result.countIsLowerBound,
        };
      },
    },
    PROVIDER_SPEND: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const spend = await readProviderMonthlySpend(ctx, {
          ...base,
          capUsd: runtime.providerSpend.capUsd,
          warnPercent: runtime.providerSpend.warnPercent,
        });
        // 🔴 `byRole` は載せない（`A-004` の材料。docs/sprints/SP-11 T-11-08 ①）。`observedAt` は応答の `observedAt` と同じ。
        return {
          scope: 'ENVIRONMENT',
          periodKey: spend.periodKey,
          spentUsd: spend.spentUsd,
          capUsd: spend.capUsd,
          consumptionRate: spend.consumptionRate,
          level: spend.level,
          tenantCount: spend.tenantCount,
        };
      },
    },
    SCHEDULER_HEARTBEAT: {
      errorKind: 'DB_READ_FAILED',
      read: async () => {
        const result = await readSchedulerHeartbeat(ctx, { ...base, staleHours: thresholds.schedulerStaleHours });
        return { lastRunAt: iso(result.lastRunAt), staleHours: result.staleHours, stalled: result.stalled };
      },
    },
  };
}
