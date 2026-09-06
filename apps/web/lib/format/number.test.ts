// apps/web/lib/format/number.test.ts
// 数値の表示書式（T-06-02 で `lib/engineers/detail.test.ts` から移した）。
//
// 🔴 ここで固定するのは「判断材料を落とさないこと」である（`docs/01` §1.2-2）:
//    片側だけの単価レンジを未設定に畳まない、0 と未設定を混同しない。
// 🔴 **語は渡す側の責務**であることも固定する（この関数は `packages/i18n` を知らない）。
import { describe, expect, it } from 'vitest';
import { formatThousands, formatUnitPriceRange, type UnitPriceRangeLabels } from './number';

const LABELS: UnitPriceRangeLabels = {
  unit: '<unit>',
  orMore: '<orMore>',
  orLess: '<orLess>',
  none: '<none>',
};

describe('formatThousands', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [650000, '650,000'],
    [99999999, '99,999,999'],
  ])('%s を %s にする', (value, expected) => {
    expect(formatThousands(value)).toBe(expected);
  });

  it('負値でも桁区切りの位置が崩れない', () => {
    expect(formatThousands(-1234567)).toBe('-1,234,567');
  });
});

describe('formatUnitPriceRange（🔴 片側だけの登録を畳まない）', () => {
  it('両端がある', () => {
    expect(formatUnitPriceRange(650000, 750000, LABELS)).toBe('650,000〜750,000 <unit>');
  });

  it('下限だけ', () => {
    expect(formatUnitPriceRange(600000, null, LABELS)).toBe('600,000 <orMore>');
  });

  it('上限だけ', () => {
    expect(formatUnitPriceRange(null, 700000, LABELS)).toBe('700,000 <orLess>');
  });

  it('未設定は呼び出し側が渡した記号になる', () => {
    expect(formatUnitPriceRange(null, null, LABELS)).toBe('<none>');
  });

  it('🔴 0 を未設定として畳まない（無償の合意も情報である）', () => {
    expect(formatUnitPriceRange(0, 0, LABELS)).toBe('0〜0 <unit>');
  });
});
