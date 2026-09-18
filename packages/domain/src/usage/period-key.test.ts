// packages/domain/src/usage/period-key.test.ts
// 🔴 日境界（JST）で切れていることを固定する。UTC で切ると JST の 00:00〜08:59 が
//    前日の集計に落ち、`usage.gap-check`（docs/05 §9.8 / `F-026 AC-4`）が
//    「欠測」と「1 日ずれ」を区別できなくなる。
import { describe, expect, it } from 'vitest';
import { previousMonthPeriodKey, usagePeriodKey } from './period-key.js';

describe('usagePeriodKey（docs/05 §3.8 / §9.8）', () => {
  it('DAY は Asia/Tokyo の暦日で YYYY-MM-DD を返す', () => {
    expect(usagePeriodKey('DAY', new Date('2026-09-04T03:00:00.000Z'))).toBe('2026-09-04');
  });

  it('🔴 JST の 00:00 は「その日」である（UTC では前日 15:00）', () => {
    expect(usagePeriodKey('DAY', new Date('2026-09-03T15:00:00.000Z'))).toBe('2026-09-04');
  });

  it('🔴 JST の 23:59 は「その日」である（UTC では翌日 14:59）', () => {
    expect(usagePeriodKey('DAY', new Date('2026-09-04T14:59:59.999Z'))).toBe('2026-09-04');
  });

  it('MONTH は YYYY-MM を返す（月境界も JST）', () => {
    expect(usagePeriodKey('MONTH', new Date('2026-08-31T15:00:00.000Z'))).toBe('2026-09');
    expect(usagePeriodKey('MONTH', new Date('2026-08-31T14:59:59.999Z'))).toBe('2026-08');
  });

  it('不正な日時は例外にする（黙って現在時刻に落とさない）', () => {
    expect(() => usagePeriodKey('DAY', new Date('not-a-date'))).toThrow(RangeError);
  });
});

describe('previousMonthPeriodKey（T-12-17 ⑩。`Date` を生成しない文字列の算術）', () => {
  it.each([
    ['2026-09', '2026-08'],
    ['2026-01', '2025-12'],
    ['2026-12', '2026-11'],
    ['2000-01', '1999-12'],
  ])('%s の前月は %s', (key, previous) => {
    expect(previousMonthPeriodKey(key)).toBe(previous);
  });

  it('usagePeriodKey の月境界と整合する（JST 10/1 00:00 の前月キー = JST 9/30 23:59 のキー）', () => {
    const firstOfOctober = usagePeriodKey('MONTH', new Date('2026-09-30T15:00:00.000Z'));
    expect(previousMonthPeriodKey(firstOfOctober)).toBe(usagePeriodKey('MONTH', new Date('2026-09-30T14:59:59.999Z')));
  });

  it.each(['2026-9', '2026-09-01', '2026-13', '2026-00', 'not-a-key'])('%s は MONTH キーではない → RangeError', (key) => {
    expect(() => previousMonthPeriodKey(key)).toThrow(RangeError);
  });
});

// 🔴 期間が切り替わる時刻（`F-027` の `resetAt`）は `packages/db/src/usage-period.ts` にある
//    （domain は `Date` を生成できない。docs/05 §17.2 #14）。両者が同じ暦を指していることは
//    `packages/db/src/usage-period.test.ts` が本モジュールの `usagePeriodKey` と突き合わせる。
