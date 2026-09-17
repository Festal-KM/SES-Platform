// apps/web/lib/retention/view.ts
// `S-042` データの返却と保持期間（docs/04 §S-042 / `F-064` / docs/05 §6.7 #76〜#78）の読み取りモデル。T-10-09。
//
// 🔴 Phase 1 の最小版 = セクション 2（削除予定）/ 3（返却）/ 4（実行履歴）。セクション 1（保持期間の設定 = `F-046`）は
//    Phase 2 であり、**描かない**（「準備中」も出さない）。
// 🔴 削除予定の件数は**この利用者に見える範囲**（通常の RLS。`countVisiblePurgeTargets`）。取引先が持ち込んだ行の件数を
//    ホストに見せない（`BR-06`）。対象種別の一覧は `PURGE_SPEC.delete` の並びそのもの（設定が唯一の出所）。
// 🔴 `TenantPurgeRun` は出さない（`PURGED` 後に見る人がいない。運営者の確認は `A-010` = T-10-10）。
// 🔴 `GET /api/retention`（#76）はまだ実装しない（画面は本関数を直接呼ぶ。`S-038` と同じ方針。`F-046` で `retentionYears` が
//    入るときに #76 を作る）。削除完了の確認はここに**含めない**（docs/05 §6.8）。
import { PURGE_SPEC } from '@ses/config';
import {
  countVisiblePurgeTargets,
  listDataExportRequests,
  readTenantRetentionState,
  type AuthenticatedTenantCtx,
  type DataExportStatus,
  type TenantLifecycleState,
} from '@ses/db';
import { daysUntilPurge, purgeScheduledOn, usagePeriodKey } from '@ses/domain';

/** `PURGE_SPEC.delete` の表名（対象種別の識別子。文言は `retention.schedule.kind.{table}`）。 */
export type PurgeTargetTable = (typeof PURGE_SPEC.delete)[number]['table'];

export const PURGE_TARGET_TABLES: readonly PurgeTargetTable[] = PURGE_SPEC.delete.map((spec) => spec.table);

export type PurgeTargetView = {
  readonly table: PurgeTargetTable;
  /** この利用者に見える範囲の未処理件数。 */
  readonly count: number;
};

export type DataExportView = {
  readonly id: string;
  readonly status: DataExportStatus;
  /** ISO 8601（表示の整形は画面側）。 */
  readonly requestedAt: string;
  readonly readyAt: string | null;
  readonly expiresAt: string | null;
};

export type RetentionView = {
  readonly lifecycleState: TenantLifecycleState;
  /** `CLOSING` のときだけ。削除予定日（JST 暦日）と残り日数。予告メール・`tenant.purge-scan` と同じ計算。 */
  readonly purge: { readonly scheduledOn: string; readonly daysUntil: number } | null;
  readonly targets: readonly PurgeTargetView[];
  readonly exports: readonly DataExportView[];
};

export type RetentionViewDeps = {
  readonly now: Date;
  /** `TENANT_PURGE_GRACE_DAYS`（`lib/db/bootstrap.ts` の `purgeGraceDays()`）。 */
  readonly purgeGraceDays: number;
};

export async function readRetentionView(ctx: AuthenticatedTenantCtx, deps: RetentionViewDeps): Promise<RetentionView> {
  const state = await readTenantRetentionState(ctx);
  const purge =
    state.lifecycleState === 'CLOSING' && state.closingEnteredAt !== null
      ? (() => {
          const schedule = {
            closingEnteredDayKey: usagePeriodKey('DAY', state.closingEnteredAt),
            graceDays: deps.purgeGraceDays,
          };
          return {
            scheduledOn: purgeScheduledOn(schedule),
            daysUntil: daysUntilPurge({ ...schedule, todayKey: usagePeriodKey('DAY', deps.now) }),
          };
        })()
      : null;
  const counts = purge === null ? null : await countVisiblePurgeTargets(ctx, deps.now);
  const exports = await listDataExportRequests(ctx);
  return {
    lifecycleState: state.lifecycleState,
    purge,
    targets: PURGE_TARGET_TABLES.map((table) => ({ table, count: counts?.[table] ?? 0 })),
    exports: exports.map((row) => ({
      id: row.id,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      readyAt: row.readyAt === null ? null : row.readyAt.toISOString(),
      expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    })),
  };
}
