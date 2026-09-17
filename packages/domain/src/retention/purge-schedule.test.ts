// packages/domain/src/retention/purge-schedule.test.ts
// T-10-09: 期限判定が予告（`closingNoticeSchedule`）と同じ JST 暦日で揃うことを固定する。
import { describe, expect, it } from 'vitest';
import { closingNoticeSchedule } from './closing-notice.js';
import { daysUntilPurge, isPurgeDue, purgeScheduledOn } from './purge-schedule.js';

const ENTERED = '2026-09-01';

describe('purge-schedule（docs/05 §9.7 / F-064 AC-1）', () => {
  it('削除予定日は予告の本文と同じ計算（closingNoticeSchedule().purgeScheduledOn）', () => {
    expect(purgeScheduledOn({ closingEnteredDayKey: ENTERED, graceDays: 30 })).toBe('2026-10-01');
    expect(purgeScheduledOn({ closingEnteredDayKey: ENTERED, graceDays: 30 })).toBe(
      closingNoticeSchedule({ closingEnteredDayKey: ENTERED, graceDays: 30 }).purgeScheduledOn,
    );
  });

  it('🔴 29 日目は期限前、30 日目（予定日当日）から期限を過ぎたと判定する', () => {
    expect(isPurgeDue({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2026-09-30' })).toBe(false);
    expect(isPurgeDue({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2026-10-01' })).toBe(true);
  });

  it('🔴 日付一致ではない: 予定日を過ぎた後の日でも真（ジョブを止めた日があっても翌日に取り返す）', () => {
    expect(isPurgeDue({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2026-10-02' })).toBe(true);
    expect(isPurgeDue({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2027-01-15' })).toBe(true);
  });

  it('残り日数は予定日までの暦日差。当日以降は 0 で負にならない', () => {
    expect(daysUntilPurge({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: ENTERED })).toBe(30);
    expect(daysUntilPurge({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2026-09-30' })).toBe(1);
    expect(daysUntilPurge({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2026-10-01' })).toBe(0);
    expect(daysUntilPurge({ closingEnteredDayKey: ENTERED, graceDays: 30, todayKey: '2026-10-09' })).toBe(0);
  });

  it('猶予日数が不正なら例外（予告側と同じ検査）', () => {
    expect(() => isPurgeDue({ closingEnteredDayKey: ENTERED, graceDays: 0, todayKey: ENTERED })).toThrow(RangeError);
  });
});
