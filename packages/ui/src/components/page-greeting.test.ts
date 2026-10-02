// packages/ui/src/components/page-greeting.test.ts
// 🔴 **時間帯の判定の境界を固定する**（`greetingSlotOf`）。2026-10-02 の人間のブリーフ。
//
// なぜ要るか: ブリーフは「時間帯で挨拶を変える」と「🔴 日付と挨拶はサーバで決める」の 2 つを
// 同時に求めている。そのため**判定だけを純粋関数に切り出した**（部品は時計を持たない）。
// 🔴 **境界が 1 箇所であることが、画面ごとに `hour < 12` と `hour <= 11` が混ざらない条件**であり、
//    境界そのものはここでしか検証できない（部品を描いても時刻は入ってこない）。
import { describe, expect, it } from 'vitest';
import { GREETING_SLOTS, greetingSlotOf } from './page-greeting.js';

describe('greetingSlotOf（時間帯の区分）', () => {
  it('🔴 区分は 3 つだけである（深夜の 4 区分目を作らない）', () => {
    expect([...GREETING_SLOTS]).toEqual(['MORNING', 'AFTERNOON', 'EVENING']);
  });

  it('🔴 境界（4/5 時・10/11 時・17/18 時）が定めどおりである', () => {
    expect(greetingSlotOf(4)).toBe('EVENING');
    expect(greetingSlotOf(5)).toBe('MORNING');
    expect(greetingSlotOf(10)).toBe('MORNING');
    expect(greetingSlotOf(11)).toBe('AFTERNOON');
    expect(greetingSlotOf(17)).toBe('AFTERNOON');
    expect(greetingSlotOf(18)).toBe('EVENING');
  });

  it('0〜23 時のすべてがいずれかの区分に入る（穴が無い）', () => {
    for (let hour = 0; hour <= 23; hour += 1) {
      expect(GREETING_SLOTS).toContain(greetingSlotOf(hour));
    }
  });

  it('🔴 範囲外・非整数を黙って丸めない（時刻の作り方が壊れていることに気づける）', () => {
    // 🔴 `-1` / `24` を `EVENING` として描くと、**呼び出し側のタイムゾーンの扱いが壊れていても
    //    画面は正常に見える**（気づけない壊れ方を作らない）。
    expect(() => greetingSlotOf(-1)).toThrow(/0〜23/);
    expect(() => greetingSlotOf(24)).toThrow(/0〜23/);
    expect(() => greetingSlotOf(9.5)).toThrow(/0〜23/);
    expect(() => greetingSlotOf(Number.NaN)).toThrow(/0〜23/);
  });
});
