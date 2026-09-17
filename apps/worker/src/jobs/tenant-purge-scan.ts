// apps/worker/src/jobs/tenant-purge-scan.ts
// 🔴 `tenant.purge-scan`（毎日 02:10 JST。docs/05 §9.7 / `docs/02` `F-064 AC-1` / `AC-10` / `CLAUDE.md` §4.2 `Tenant`）。T-10-09。
//
// ============================================================================
// 🔴 このジョブがやることは 1 つだけである
// ============================================================================
//   `CLOSING` のテナントのうち、**期限を過ぎ（JST 暦日で `closing_entered_at + TENANT_PURGE_GRACE_DAYS <= today`）、かつ未処理
//   （`TenantPurgeRun` が `COMPLETED` でない）、かつ 🔴 削除予告が配送済み（`readClosingNoticeDelivery().delivered`）** のものに
//   `tenant.purge` を 1 本積む（`jobId = tenant.purge.{tenantId}` で重複排除）。
//
//   - 期限は**予告と同じ暦日**（`isPurgeDue` = `closingNoticeSchedule().purgeScheduledOn` との比較。T-10-12 レビュー申し送り）。
//     ms 加算で書くと予告より 1 日遅れる。
//   - 「期限を過ぎ、かつ未処理」（日付一致にしない）。ジョブが止まった日があっても翌日に取り返す（`F-064 AC-1`）。
//   - 🔴 `delivered === false`（予告行が無い / `QUEUED` / `HELD_*` が残る）なら **何もせず次回へ持ち越す**。記録も残さない
//     （`A-005` 項目 15 `PURGE_NOTICE_PENDING` が既に見せる）。上限到達を理由に予告を省いて削除に進む経路を作らない。
//   - 🔴 `closing_entered_at IS NULL` の `CLOSING` は `SKIPPED(NO_CLOSING_ENTERED_AT)` として数える（CHECK 制約
//     `tenants_closing_entered_at_check` が入った後は起こらない。起きたら DB 側の不変条件が破れている）。
//
// 🔴 母集団は `CLOSING`（`TENANT_PURGE_SCAN_POPULATION`。ファンアウトは `runtime.ts`）。`ctx.lifecycleState` は `SystemTenantCtx` では
//    固定値なので判定に使わず、`tenants` の行を読む。
// 🔴 削除そのものはここでは行わない。積むだけ。`tenant.purge` が開始時に**同じ関数**で配送確認をもう一度行う（二重の確認）。
import type { AppEnvKind } from '@ses/config';
import type { InternalJobName, TenantPurgeEnqueueOutcome, TenantPurgeJob } from '@ses/connectors';
import {
  hasCompletedTenantPurge,
  readClosingNoticeDelivery,
  readTenantClosingSchedule,
  systemTenantCtx,
  type SchedulerFanoutPopulation,
  type SystemTenantCtx,
} from '@ses/db';
import { isPurgeDue, purgeScheduledOn, usagePeriodKey, type ClosingNoticeDelivery } from '@ses/domain';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const TENANT_PURGE_SCAN_JOB = 'tenant.purge-scan' satisfies InternalJobName;

/** 🔴 毎日 02:10 JST（docs/05 §9.7。`tenant.closing-notify` 02:08 の後）。時刻の出所はここ 1 箇所。 */
export const TENANT_PURGE_SCAN_SCHEDULE = { cron: '10 2 * * *', timeZone: 'Asia/Tokyo' } as const;

/** 🔴 ファンアウトの母集団（migration 20260926000000）。`CLOSING` だけ。 */
export const TENANT_PURGE_SCAN_POPULATION = 'CLOSING' satisfies SchedulerFanoutPopulation;

export type TenantPurgeScanPayload = { readonly tenantId: string };

export function parseTenantPurgeScanPayload(raw: unknown): TenantPurgeScanPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(TENANT_PURGE_SCAN_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { tenantId: requireUuid(TENANT_PURGE_SCAN_JOB, 'tenantId', record.tenantId) };
}

export type TenantPurgeScanDeps = {
  readonly now: () => Date;
  /** `TENANT_PURGE_GRACE_DAYS`（`packages/config`。既定 30）。予告（`tenant.closing-notify`）と同じキー。 */
  readonly purgeGraceDays: number;
  /**
   * 🔴 起動時に解決した `APP_ENV`（`RuntimeConfig.env.APP_ENV`）。`readClosingNoticeDelivery` が `MOCKED` を配送済みと
   *    みなすかを決める（`development` / `demo` だけ）。呼び出し側に真偽値を書かせない。
   */
  readonly appEnv: AppEnvKind;
  /** 🔴 `tenant.purge` を積む。既定値（no-op）を置かない（「積んだつもりで積まれていない」を作らない）。 */
  readonly enqueueTenantPurge: (job: TenantPurgeJob) => Promise<TenantPurgeEnqueueOutcome>;
};

export type TenantPurgeScanOutcome =
  /** 列挙と実行の間に `CLOSING` を離れた / `closing_entered_at` が無い。 */
  | { readonly kind: 'SKIPPED'; readonly reason: 'NOT_CLOSING' | 'NO_CLOSING_ENTERED_AT' }
  | { readonly kind: 'NOT_DUE'; readonly todayKey: string; readonly purgeScheduledOn: string }
  /** `TenantPurgeRun` に `COMPLETED` がある（`PURGED` に到達済み。母集団から外れるので通常は来ない）。 */
  | { readonly kind: 'ALREADY_PURGED' }
  /** 🔴 予告が配送済みでない。次回へ持ち越す（何も積まない）。 */
  | { readonly kind: 'NOTICE_PENDING'; readonly purgeScheduledOn: string; readonly delivery: ClosingNoticeDelivery }
  | { readonly kind: 'ENQUEUED'; readonly purgeScheduledOn: string; readonly outcome: TenantPurgeEnqueueOutcome };

/** 🔴 1 テナント分の走査（`runScheduled` → ファンアウト → 本関数）。 */
export async function scanTenantPurge(deps: TenantPurgeScanDeps, ctx: SystemTenantCtx): Promise<TenantPurgeScanOutcome> {
  const tenant = await readTenantClosingSchedule(ctx);
  if (tenant.lifecycleState !== 'CLOSING') return { kind: 'SKIPPED', reason: 'NOT_CLOSING' };
  if (tenant.closingEnteredAt === null) return { kind: 'SKIPPED', reason: 'NO_CLOSING_ENTERED_AT' };

  const now = deps.now();
  const todayKey = usagePeriodKey('DAY', now);
  const schedule = {
    closingEnteredDayKey: usagePeriodKey('DAY', tenant.closingEnteredAt),
    graceDays: deps.purgeGraceDays,
  };
  const scheduledOn = purgeScheduledOn(schedule);
  if (!isPurgeDue({ ...schedule, todayKey })) return { kind: 'NOT_DUE', todayKey, purgeScheduledOn: scheduledOn };
  if (await hasCompletedTenantPurge(ctx)) return { kind: 'ALREADY_PURGED' };

  // 🔴 期限判定の**後**に配送確認（T-10-12 の申し送り ①）。偽なら積まない。
  const delivery = await readClosingNoticeDelivery(ctx, { appEnv: deps.appEnv });
  if (!delivery.delivered) return { kind: 'NOTICE_PENDING', purgeScheduledOn: scheduledOn, delivery };

  const outcome = await deps.enqueueTenantPurge({ tenantId: ctx.tenantId });
  return { kind: 'ENQUEUED', purgeScheduledOn: scheduledOn, outcome };
}

export type TenantPurgeScanHandler = (payload: unknown, jobId: string) => Promise<TenantPurgeScanOutcome>;

export function createTenantPurgeScanHandler(deps: TenantPurgeScanDeps): TenantPurgeScanHandler {
  return async (payload, jobId) => {
    const job = parseTenantPurgeScanPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: TENANT_PURGE_SCAN_JOB, jobId });
    return scanTenantPurge(deps, ctx);
  };
}
