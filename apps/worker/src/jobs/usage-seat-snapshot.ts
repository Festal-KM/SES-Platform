// apps/worker/src/jobs/usage-seat-snapshot.ts
// `usage.seat-snapshot`（docs/05 §9.8 / `CLAUDE.md` §10.6 / `F-026`）。T-03-10。
//
// 毎日 01:00 JST に、テナントの有効な `Membership` の行数を
// `UsageCounter(DAY, 'SEAT_COUNT')` に記録する。
//
// ============================================================================
// 🔴 Phase 0 で「どこまで」実装するか（seam の明示）
// ============================================================================
// BullMQ のキュー実体（`packages/connectors/src/queues.ts`。docs/05 §9.1）と
// `runScheduled()`（`SchedulerRun` による多重起動防止）は **SP-07 の範囲**である。
// 本ファイルが持つのは、そのとき**そのまま登録できる形**の 3 つだけである:
//   ① スケジュール（cron + タイムゾーン）の宣言
//   ② payload の解釈（`parseUsageSeatSnapshotPayload`）
//   ③ 実行本体（`createUsageSeatSnapshotHandler`）
// 🔴 「動かないコード」を置かないため、③は**引数だけで完結する純粋な合成**にしてある
//    （キュー・スケジューラを import しない）。結合テストは②③を直接呼んで検証する。
//
// ============================================================================
// 🔴 依存を `@ses/db` の 1 つに保つ理由
// ============================================================================
// `apps/worker` は現時点で `@ses/config` / `zod` を依存に持たない（マニフェスト未宣言）。
// **キュー実体を配線する SP-07 / 起動時 DI を入れる T-03-12 と同時に足すべき依存**であり、
// ここで宣言だけして未インストールのまま残すと build が壊れる。したがって
//   - payload の検証は手書きの門番（②）で行う。🔴 **SP-07 で Zod スキーマへ置き換える**
//     （docs/05 §9.1「payload は Zod スキーマで定義し、ワーカー側で `parse` する」）
//   - `countPartnerSeats` の既定値（`packages/config` の `SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS`）は
//     **合成側から渡す**（下記 `UsageSeatSnapshotDeps`）
import { snapshotSeatCount, systemTenantCtx, type SeatSnapshotResult } from '@ses/db';
// 🔴 T-04-03: payload の門番は `payload.ts` に集約した（`email.dispatch` / `account.mail` と共用）。
//    同じ判定を 2 箇所に書くと、片方だけ緩む。
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export { InvalidJobPayloadError } from './payload.js';

/** キュー名（docs/05 §9.8）。`jobId` の接頭辞にもなる。 */
export const USAGE_SEAT_SNAPSHOT_JOB = 'usage.seat-snapshot';

/**
 * 🔴 毎日 01:00 JST（docs/05 §9.8）。タイムゾーンは `Asia/Tokyo` 固定であり、
 *    組織別に持たない（§9.1）。
 */
export const USAGE_SEAT_SNAPSHOT_SCHEDULE = {
  cron: '0 1 * * *',
  timeZone: 'Asia/Tokyo',
} as const;

export type UsageSeatSnapshotPayload = {
  /** 🔴 docs/05 §9.1「payload に `tenantId` を必ず含め、ハンドラ冒頭で ctx を組み立てる」。 */
  readonly tenantId: string;
};

/**
 * payload の門番。🔴 **不正なら例外にする**（既定値で補完しない）。
 * 補完すると「別のテナントを計測した」「全テナント分が 1 テナントに積まれた」に化ける。
 */
export function parseUsageSeatSnapshotPayload(raw: unknown): UsageSeatSnapshotPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(USAGE_SEAT_SNAPSHOT_JOB, 'オブジェクトではありません');
  }
  const tenantId = requireUuid(
    USAGE_SEAT_SNAPSHOT_JOB,
    'tenantId',
    (raw as { readonly tenantId?: unknown }).tenantId,
  );
  return { tenantId };
}

export type UsageSeatSnapshotDeps = {
  /**
   * 🔴 取引先所属の席を数に含めるか（docs/05 TBD-19 /
   *    [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。
   *    **決め打ちしない。** 既定値は `packages/config` の
   *    `SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS` が持ち、合成側（SP-07 / T-03-12 の起動処理）が渡す。
   */
  readonly countPartnerSeats: boolean;
  /** 🔴 現在時刻の取得も注入する（同日 2 回の冪等性をテストで固定できるようにするため）。 */
  readonly now: () => Date;
};

export type UsageSeatSnapshotHandler = (
  payload: unknown,
  jobId: string,
) => Promise<SeatSnapshotResult>;

/**
 * `usage.seat-snapshot` の実行本体を作る。
 *
 * 🔴 ctx は `systemTenantCtx`（docs/05 §9.2）で組み立てる。ワーカーは
 *    `resolveTenantCtx` を持たない = パートナー文脈を作れない（§17.2 #20 ①）。
 * 🔴 冪等性は `snapshotSeatCount` の `INSERT ... ON CONFLICT DO UPDATE`（確定値の上書き）が
 *    担保する。同じ日に 2 回実行しても `usage_counters` は 1 行のままである。
 */
export function createUsageSeatSnapshotHandler(
  deps: UsageSeatSnapshotDeps,
): UsageSeatSnapshotHandler {
  return async (payload, jobId) => {
    const { tenantId } = parseUsageSeatSnapshotPayload(payload);
    const ctx = systemTenantCtx(tenantId, { queue: USAGE_SEAT_SNAPSHOT_JOB, jobId });
    return snapshotSeatCount(ctx, {
      countPartnerSeats: deps.countPartnerSeats,
      observedAt: deps.now(),
    });
  };
}
