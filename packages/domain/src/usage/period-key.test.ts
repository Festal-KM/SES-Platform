// packages/domain/src/usage/period-key.test.ts
// 🔴 日境界（JST）で切れていることを固定する。UTC で切ると JST の 00:00〜08:59 が
//    前日の集計に落ち、`usage.gap-check`（docs/05 §9.8 / `F-026 AC-4`）が
//    「欠測」と「1 日ずれ」を区別できなくなる。
import { describe, expect, it } from 'vitest';
import { usagePeriodKey } from './period-key.js';

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
