// packages/domain/src/usage/usd.test.ts
// 🔴 金額の変換（T-07-04）。単価計算・上限判定・予約と補正が同じ 1 実装を使うため、
//    ここがずれるとすべてがずれる。
import { describe, expect, it } from 'vitest';
import { formatUsdMicros, parseUsdMicros, USD_MICRO_SCALE } from './usd.js';

describe('parseUsdMicros', () => {
  it('十進文字列を micro-USD の整数にする（`number` を経由しない）', () => {
    expect(parseUsdMicros('0')).toBe(0n);
    expect(parseUsdMicros('1')).toBe(USD_MICRO_SCALE);
    expect(parseUsdMicros('0.000001')).toBe(1n);
    expect(parseUsdMicros('12.345678')).toBe(12_345_678n);
  });

  it('小数部の桁を補う（`0.1` は 100,000 micro-USD）', () => {
    expect(parseUsdMicros('0.1')).toBe(100_000n);
    expect(parseUsdMicros('0.10')).toBe(100_000n);
  });

  it('負の値も扱える（補正で差分を戻す経路が使う）', () => {
    expect(parseUsdMicros('-0.5')).toBe(-500_000n);
  });

  it('🔴 書式が不正なら例外にする（0 として扱わない）', () => {
    expect(() => parseUsdMicros('')).toThrow(RangeError);
    expect(() => parseUsdMicros('1e-7')).toThrow(RangeError);
    expect(() => parseUsdMicros('0.0000001')).toThrow(RangeError); // 7 桁は表現できない
    expect(() => parseUsdMicros('1); DROP TABLE usage_counters; --')).toThrow(RangeError);
  });
});

describe('formatUsdMicros', () => {
  it('常に小数 6 桁で返す（`Decimal(_,6)` にそのまま入る形）', () => {
    expect(formatUsdMicros(0n)).toBe('0.000000');
    expect(formatUsdMicros(1n)).toBe('0.000001');
    expect(formatUsdMicros(USD_MICRO_SCALE)).toBe('1.000000');
    expect(formatUsdMicros(-500_000n)).toBe('-0.500000');
  });

  it('🔴 往復して値が変わらない（予約 → 証 → 補正で額が失われない）', () => {
    for (const value of ['0.000000', '0.031500', '15.000000', '99999.999999']) {
      expect(formatUsdMicros(parseUsdMicros(value))).toBe(value);
    }
  });
});
