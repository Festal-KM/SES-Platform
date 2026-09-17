// apps/web/lib/usage/format.test.ts
// `S-038` の表示用の単位換算（T-10-04）。金額の換算が存在しないことは `tests/static/tenant-usage-no-money.test.ts` が
// 走査で固定する。ここは値の正しさだけを見る。
import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatGigabytes,
  formatJpy,
  formatRemaining,
  formatUsedOfLimit,
  percentUsed,
} from './format.js';

const GIB = 1024n * 1024n * 1024n;

describe('formatGigabytes', () => {
  it('GiB を小数 1 桁で表す（切り捨て。3 桁区切り）', () => {
    expect(formatGigabytes(0n)).toBe('0.0');
    expect(formatGigabytes(50n * GIB)).toBe('50.0');
    expect(formatGigabytes(12n * GIB + GIB / 4n)).toBe('12.2'); // 12.25 → 12.2（切り捨て）
    expect(formatGigabytes((1024n * GIB).toString())).toBe('1,024.0');
  });

  it('🔴 `Number` の安全整数を超えるバイト数でも桁を落とさない', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    expect(formatGigabytes(huge)).toBe('8,388,608.0');
  });

  it('数字以外の文字列は例外（黙って 0 にしない）', () => {
    expect(() => formatGigabytes('12GB')).toThrow(RangeError);
  });
});

describe('percentUsed / clampPercent', () => {
  it('整数に切り捨て。上限超過は 100 を超えて返す（バーの幅は clampPercent が丸める）', () => {
    expect(percentUsed(118, 180)).toBe(65);
    expect(percentUsed(144, 180)).toBe(80);
    expect(percentUsed(25, 20)).toBe(125);
    expect(clampPercent(125)).toBe(100);
    expect(clampPercent(65)).toBe(65);
  });

  it('上限 0 以下・使用 0 は 0（表示で例外を出さない）', () => {
    expect(percentUsed(0, 180)).toBe(0);
    expect(percentUsed(10, 0)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(-3)).toBe(0);
  });

  it('bigint（バイト数）も同じ式', () => {
    expect(percentUsed(45n * GIB, 50n * GIB)).toBe(90);
  });
});

describe('formatRemaining / formatUsedOfLimit', () => {
  it('docs/04 §S-038 の形「あと 62 件 / 180 件」。0 も隠さない', () => {
    expect(formatRemaining(62, 180, { prefix: 'あと', unit: '件' })).toBe('あと 62 件 / 180 件');
    expect(formatRemaining(1_240, 6_200, { prefix: 'あと', unit: '件' })).toBe('あと 1,240 件 / 6,200 件');
    expect(formatRemaining(0, 20, { prefix: 'あと', unit: '件' })).toBe('あと 0 件 / 20 件');
  });

  it('使用 / 上限', () => {
    expect(formatUsedOfLimit(118, 500, '通')).toBe('118 / 500 通');
  });
});

describe('formatJpy', () => {
  it('整数文字列を 3 桁区切り + 単位に', () => {
    expect(formatJpy('12400', '円')).toBe('12,400 円');
    expect(formatJpy('0', '円')).toBe('0 円');
  });

  it('整数でなければそのまま出す（握りつぶさない）', () => {
    expect(formatJpy('12,400.5', '円')).toBe('12,400.5 円');
  });
});
