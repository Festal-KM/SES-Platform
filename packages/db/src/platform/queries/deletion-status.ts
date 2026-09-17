// packages/db/src/platform/queries/deletion-status.ts
// 🔴 API-A12 `GET /api/admin/tenants/{id}/deletion-status`（`A-010` セクション 4「削除完了の確認」。
//    docs/05 §6.9 / `F-062 AC-7` / `F-064 AC-2` / `BR-40`）。T-10-10。
//
// 🔴 **`TenantPurgeRun` を行として読む管理平面の経路はこの 1 本だけである**（docs/05 §6.9「API-A12 以外に削除完了の
//    確認を返す API を作らない」/ §17.2 #15 `deletion-status-single-route.test.ts`）。`A-005` 項目 7（`monitoring.ts`）は
//    `groupBy` で**失敗の件数**だけを数え、完了の事実を返さない。`A-003` / `A-013` / `S-042` にはこの DTO を写さない。
// 🔴 `select` は `failureReason` を含めない。`tenant_purge_runs.failure_reason` は `app_platform` から REVOKE 済み
//    （migration 20260925000000 / docs/05 §5.5）であり、select に書けば DB が拒否する（fail-closed）。**型にも載せない。**
// 🔴 返すのは件数・状態・時刻だけ（`counts` = `PURGE_SPEC.delete` の表ごとの削除件数。削除された内容・返却データの
//    `object_key` には列としても到達しない）。
import type { TenantLifecycleState } from '@ses/domain';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import type { TenantPurgeCause, TenantPurgeStatus } from '../../schema-value-sets.js';
import type { PlatformRequestMeta } from './admin-home.js';

/** 🔴 Phase 1 の対象は `F-064`（`CLOSING → PURGED`）だけ。`RETENTION`（`F-046`。Phase 2）はここに加わるまで返さない。 */
export const DELETION_STATUS_CAUSES = ['TENANT_PURGED'] as const satisfies readonly TenantPurgeCause[];

export type DeletionStatusCause = (typeof DELETION_STATUS_CAUSES)[number];

/** `TenantPurgeRun.counts`（`Record<table, number>`。キーは `PURGE_SPEC.delete` の表名）。 */
export type PurgeCountsView = Readonly<Record<string, number>>;

export type DeletionStatusRunView = {
  readonly cause: DeletionStatusCause;
  /** `RUNNING` = 未完了（④の CAS 成功後に ⑤ で落ちた行も含む）/ `COMPLETED` / `FAILED`（詳細は `A-005` 項目 7）。 */
  readonly status: TenantPurgeStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /** 🔴 `COMPLETED` で確定する。`RUNNING` / `FAILED` は `{}`（T-10-09 は完了時にだけ書く）。 */
  readonly counts: PurgeCountsView;
};

export type DeletionStatusView = {
  readonly tenantId: string;
  readonly lifecycleState: TenantLifecycleState;
  /** `cause='TENANT_PURGED'` の実行を**新しい順**に。先頭が最新。 */
  readonly purgeRuns: readonly DeletionStatusRunView[];
};

/** 1 テナントの削除実行は高々数行（再試行の分）。上限は防御のため。 */
const PURGE_RUNS_LIMIT = 20;

/**
 * `counts`（JSONB）を `Record<table, number>` に正規化する（純粋）。
 * 🔴 数値でない値・負の値・非整数は**落とす**（`NaN` を件数として画面に出さない）。オブジェクト以外（配列 / null / 文字列）は `{}`。
 */
export function normalizePurgeCounts(raw: unknown): PurgeCountsView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) >= 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

/**
 * API-A12。docs/05 §6.9。
 *
 * 🔴 存在しないテナントは `null`（404 への写像は呼び出し側。docs/05 §4.8）。`PO` / `PP` とも可（`F-062 AC-7`）。
 * 🔴 `withPlatformRead` は監査（`admin.deletion_status.view`。対象テナントに閉じる）を先に書く。
 */
export async function readDeletionStatus(
  ctx: AuthenticatedPlatformCtx,
  tenantId: string,
  meta: PlatformRequestMeta = {},
): Promise<DeletionStatusView | null> {
  return withPlatformRead(
    {
      ctx,
      action: 'admin.deletion_status.view',
      targetTenantId: tenantId,
      targetType: 'Tenant',
      targetId: tenantId,
      ipAddress: meta.ipAddress ?? null,
    },
    async (db) => {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, lifecycleState: true },
      });
      if (tenant === null) return null;

      const runs = await db.tenantPurgeRun.findMany({
        where: { tenantId: tenant.id, cause: { in: [...DELETION_STATUS_CAUSES] } },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: PURGE_RUNS_LIMIT,
        // 🔴 `failureReason` を書かない（GRANT が無い。冒頭コメント）。
        select: { cause: true, status: true, startedAt: true, completedAt: true, counts: true },
      });

      return {
        tenantId: tenant.id,
        lifecycleState: tenant.lifecycleState as TenantLifecycleState,
        purgeRuns: runs.map((run) => ({
          cause: run.cause as DeletionStatusCause,
          status: run.status as TenantPurgeStatus,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          counts: normalizePurgeCounts(run.counts),
        })),
      };
    },
  );
}
