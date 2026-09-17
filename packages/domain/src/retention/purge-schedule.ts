// packages/domain/src/retention/purge-schedule.ts
// 🔴 `CLOSING → PURGED` の期限判定（docs/05 §9.7 `tenant.purge-scan` / `F-064 AC-1`）。T-10-09。
//
// 🔴 期限は **JST 暦日**で予告（`tenant.closing-notify`）と揃える（T-10-12 レビュー申し送り）。
//    予告の本文に載せた削除予定日は `closingNoticeSchedule().purgeScheduledOn`（暦日キー）であり、
//    判定を ms 加算（`closing_entered_at + 30d <= now`）で書くと予告より 1 日遅れる（安全側だが不一致）。
//    ここでは**同じ `closingNoticeSchedule` から同じ暦日**を取り、`compareDayKeys` で比較する。
// 🔴 `Date` を生成しない（`packages/domain` の純粋性。暦日キーの整数演算だけ）。

import { compareDayKeys } from '../usage/day-keys.js';
import { closingNoticeSchedule } from './closing-notice.js';

export type PurgeScheduleInput = {
  /** `tenants.closing_entered_at` を `Asia/Tokyo` の暦日キーにしたもの（`usagePeriodKey('DAY', …)`）。 */
  readonly closingEnteredDayKey: string;
  /** `TENANT_PURGE_GRACE_DAYS`（`packages/config`。既定 30）。 */
  readonly graceDays: number;
  /** 判定する日（`usagePeriodKey('DAY', now)`）。 */
  readonly todayKey: string;
};

/** 削除予定日（暦日キー）。予告の本文と**同じ計算**である。 */
export function purgeScheduledOn(input: Pick<PurgeScheduleInput, 'closingEnteredDayKey' | 'graceDays'>): string {
  return closingNoticeSchedule(input).purgeScheduledOn;
}

/** 🔴 期限を過ぎているか（`todayKey >= purgeScheduledOn`。日付一致にしない = ジョブを止めた日があっても翌日に取り返す）。 */
export function isPurgeDue(input: PurgeScheduleInput): boolean {
  return compareDayKeys(input.todayKey, purgeScheduledOn(input)) >= 0;
}

/**
 * 削除予定日までの残り日数（`S-042` の固定バナー「あと N 日で削除されます」）。期限当日以降は 0。
 */
export function daysUntilPurge(input: PurgeScheduleInput): number {
  return Math.max(0, compareDayKeys(purgeScheduledOn(input), input.todayKey));
}
