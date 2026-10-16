// packages/db/src/search/start-window.test.ts
// ✅ 開始時期の区分 → 開始日の範囲（2026-10-16。受領モックの「開始時期」）。
//
// 🔴 **現在時刻を引数で受け取る設計の価値がここに出る** —— 月をまたぐ瞬間・年をまたぐ瞬間の
//    挙動を、時計をいじらずに固定できる（`start-window.ts` 冒頭の 🔴）。
import { describe, expect, it } from 'vitest';
import { PROJECT_START_WINDOWS, resolveStartWindow, startWindowDates } from './start-window.js';

/** 2026-10-16（木）。月の途中であり、「今月」の下端が月初ではなく**今日**になることを見る。 */
const MID_MONTH = new Date('2026-10-16T05:00:00.000Z');

describe('開始時期の区分 → 開始日の範囲', () => {
  it('即日: 今日を含む（過去日の案件も「もう始められる」として残す）', () => {
    // 🔴 上端は**翌日の 0 時未満** = 今日を含む。下端は無い（過去日を落とさない）。
    expect(resolveStartWindow('IMMEDIATE', MID_MONTH)).toEqual({ startTo: '2026-10-17' });
  });

  it('今月: 今日 〜 今月末（🔴 下端は月初ではなく今日）', () => {
    // 月初にすると「もう過ぎた日付の案件」が今月に出て、即日と重なる。
    expect(resolveStartWindow('THIS_MONTH', MID_MONTH)).toEqual({
      startFrom: '2026-10-16',
      startTo: '2026-11-01',
    });
  });

  it('来月: 来月 1 日 〜 来月末', () => {
    expect(resolveStartWindow('NEXT_MONTH', MID_MONTH)).toEqual({
      startFrom: '2026-11-01',
      startTo: '2026-12-01',
    });
  });

  it('再来月以降: 再来月 1 日 以降（上端は無い）', () => {
    expect(resolveStartWindow('LATER', MID_MONTH)).toEqual({ startFrom: '2026-12-01' });
  });

  it('🔴 年をまたぐ（12 月に「来月」「再来月以降」を選ぶ）', () => {
    const december = new Date('2026-12-20T00:00:00.000Z');
    expect(resolveStartWindow('NEXT_MONTH', december)).toEqual({
      startFrom: '2027-01-01',
      startTo: '2027-02-01',
    });
    expect(resolveStartWindow('LATER', december)).toEqual({ startFrom: '2027-02-01' });
  });

  it('🔴 月末日に「即日」を選んでも翌日へ繰り上がる（10/31 → 11/01）', () => {
    expect(resolveStartWindow('IMMEDIATE', new Date('2026-10-31T23:00:00.000Z'))).toEqual({
      startTo: '2026-11-01',
    });
  });

  it('🔴 区分が重ならない（即日の上端 ≦ 今月の下端 < 来月の下端 < 再来月の下端）', () => {
    const immediate = resolveStartWindow('IMMEDIATE', MID_MONTH);
    const thisMonth = resolveStartWindow('THIS_MONTH', MID_MONTH);
    const nextMonth = resolveStartWindow('NEXT_MONTH', MID_MONTH);
    const later = resolveStartWindow('LATER', MID_MONTH);
    // 「今月」の下端（今日）は「即日」の上端（明日）より前だが、**同じ日を二重に数えない**のは
    // 即日が `lt`（明日未満 = 今日まで）で、今月が `gte`（今日から）だからである。
    expect(thisMonth.startTo).toBe(nextMonth.startFrom);
    expect(nextMonth.startTo).toBe(later.startFrom);
    expect(immediate.startFrom).toBeUndefined();
    expect(later.startTo).toBeUndefined();
  });

  it('値集合の 4 つすべてが範囲を返す（区分を足したら落ちる）', () => {
    for (const window of PROJECT_START_WINDOWS) {
      const range = resolveStartWindow(window, MID_MONTH);
      expect(Object.keys(range).length, window).toBeGreaterThan(0);
    }
  });
});

describe('`startWindowDates`（`YYYY-MM-DD` → `Date`）', () => {
  it('両端がある区分は `gte` と `lt` の両方になる', () => {
    const dates = startWindowDates(resolveStartWindow('NEXT_MONTH', MID_MONTH));
    expect(dates.gte?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(dates.lt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('端が無い区分はキーごと現れない（`undefined` を述語に混ぜない）', () => {
    expect(startWindowDates(resolveStartWindow('LATER', MID_MONTH))).toEqual({
      gte: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(startWindowDates(resolveStartWindow('IMMEDIATE', MID_MONTH))).toEqual({
      lt: new Date('2026-10-17T00:00:00.000Z'),
    });
  });
});
