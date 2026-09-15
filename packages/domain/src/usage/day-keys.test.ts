// packages/domain/src/usage/day-keys.test.ts
// 🔴 暦の演算が `Date` 無しで正しいことを固定する（閏年・月末・年末をまたぐ）。T-10-02。
import { describe, expect, it } from 'vitest';
import {
  compareDayKeys,
  dayRangeOfMonth,
  daysInMonth,
  enumerateDayKeys,
  monthKeyOfDay,
  parseDayKey,
  shiftDayKey,
  shiftMonthKey,
} from './day-keys.js';

describe('shiftDayKey', () => {
  it('月末・年末・閏年をまたいで進む / 戻る', () => {
    expect(shiftDayKey('2026-09-16', -1)).toBe('2026-09-15');
    expect(shiftDayKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29'); // 閏年
    expect(shiftDayKey('2027-02-28', 1)).toBe('2027-03-01'); // 平年
    expect(shiftDayKey('2100-02-28', 1)).toBe('2100-03-01'); // 100 年例外
    expect(shiftDayKey('2000-02-28', 1)).toBe('2000-02-29'); // 400 年例外
    expect(shiftDayKey('2026-09-16', 0)).toBe('2026-09-16');
  });

  it('🔴 往復して元に戻る（決定性）', () => {
    for (const key of ['1970-01-01', '2026-09-16', '2099-12-31']) {
      expect(shiftDayKey(shiftDayKey(key, 400), -400)).toBe(key);
    }
  });

  it('🔴 不正なキーは例外にする（現在日に落とさない）', () => {
    expect(() => shiftDayKey('2026-02-30', 1)).toThrow(RangeError);
    expect(() => shiftDayKey('2026-9-1', 1)).toThrow(RangeError);
    expect(() => shiftDayKey('2026-09-16', 1.5)).toThrow(RangeError);
  });
});

describe('enumerateDayKeys', () => {
  it('両端を含めて昇順に列挙する', () => {
    expect(enumerateDayKeys('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('from > to なら空', () => {
    expect(enumerateDayKeys('2026-09-02', '2026-09-01')).toEqual([]);
  });
});

describe('月キー', () => {
  it('monthKeyOfDay / shiftMonthKey / dayRangeOfMonth / daysInMonth', () => {
    expect(monthKeyOfDay('2026-09-16')).toBe('2026-09');
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-09', -13)).toBe('2025-08');
    expect(dayRangeOfMonth('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(dayRangeOfMonth('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('compareDayKeys / parseDayKey', () => {
    expect(compareDayKeys('2026-09-15', '2026-09-16')).toBeLessThan(0);
    expect(compareDayKeys('2026-09-16', '2026-09-16')).toBe(0);
    expect(parseDayKey('2026-09-16')).toEqual({ year: 2026, month: 9, day: 16 });
  });
});
