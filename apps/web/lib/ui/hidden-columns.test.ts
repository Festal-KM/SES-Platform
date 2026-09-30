// apps/web/lib/ui/hidden-columns.test.ts
// 🔴 列表示切替の状態を URL のクエリで持つ（`T-22-06`。`./hidden-columns.ts`）。
//
// なぜこの粒度で要るか: **URL は利用者が直接編集できる入力**である。許可リスト外の値・重複・
// 空値・同名キーの複数指定が来ても、①壊れない ②同じ見え方が同じ URL になる（正規形）ことを
// ここで固定する。画面（`*.render.test.tsx`）は「渡された形をどう描くか」しか見られない。
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_COLUMNS_PARAM,
  hiddenColumnsParamValue,
  parseHiddenColumns,
  toggleHiddenColumn,
} from './hidden-columns';

/** 許可リスト（並びが URL の正規形を決める）。 */
const ALLOWED = ['visibility', 'plan', 'seats'] as const;

describe('クエリのキー', () => {
  it('🔴 1 つだけである（列ごとのキーを増やさない）', () => {
    expect(HIDDEN_COLUMNS_PARAM).toBe('hide');
  });
});

describe('parseHiddenColumns（URL → 隠す列）', () => {
  it('未指定なら空（既定は「何も隠していない」）', () => {
    expect(parseHiddenColumns(undefined, ALLOWED)).toEqual([]);
  });

  it('1 件・複数件（カンマ区切り）を読む', () => {
    expect(parseHiddenColumns('visibility', ALLOWED)).toEqual(['visibility']);
    expect(parseHiddenColumns('visibility,seats', ALLOWED)).toEqual(['visibility', 'seats']);
  });

  it('🔴 並びは許可リストの順に正規化する（押した順で URL が変わらない）', () => {
    expect(parseHiddenColumns('seats,visibility', ALLOWED)).toEqual(['visibility', 'seats']);
  });

  it('🔴 許可リストに無い値は捨てる（URL 直打ちで壊れない）', () => {
    expect(parseHiddenColumns('unitPrice', ALLOWED)).toEqual([]);
    expect(parseHiddenColumns('unitPrice,visibility', ALLOWED)).toEqual(['visibility']);
  });

  it('重複・空値・空白を畳む', () => {
    expect(parseHiddenColumns('visibility,visibility', ALLOWED)).toEqual(['visibility']);
    expect(parseHiddenColumns('', ALLOWED)).toEqual([]);
    expect(parseHiddenColumns(' visibility , ', ALLOWED)).toEqual(['visibility']);
  });

  it('⚠️ 同名キーが複数（`?hide=a&hide=b`）でも片方を捨てない', () => {
    expect(parseHiddenColumns(['visibility', 'seats'], ALLOWED)).toEqual(['visibility', 'seats']);
    expect(parseHiddenColumns(['seats,visibility', 'plan'], ALLOWED)).toEqual([
      'visibility',
      'plan',
      'seats',
    ]);
  });
});

describe('toggleHiddenColumn（1 列の反転）', () => {
  it('表示中 → 隠す / 隠している → 戻す', () => {
    expect(toggleHiddenColumn([], ALLOWED, 'visibility')).toEqual(['visibility']);
    expect(toggleHiddenColumn(['visibility'], ALLOWED, 'visibility')).toEqual([]);
  });

  it('他の列の状態は動かさない', () => {
    expect(toggleHiddenColumn(['visibility'], ALLOWED, 'seats')).toEqual(['visibility', 'seats']);
    expect(toggleHiddenColumn(['visibility', 'seats'], ALLOWED, 'visibility')).toEqual(['seats']);
  });

  it('🔴 結果も許可リストの順（正規形）である', () => {
    expect(toggleHiddenColumn(['seats'], ALLOWED, 'visibility')).toEqual(['visibility', 'seats']);
  });
});

describe('hiddenColumnsParamValue（隠す列 → クエリの値）', () => {
  it('🔴 何も隠していなければ `null`（`?hide=` の空値を作らない）', () => {
    expect(hiddenColumnsParamValue([])).toBeNull();
  });

  it('カンマ区切りで連ねる', () => {
    expect(hiddenColumnsParamValue(['visibility'])).toBe('visibility');
    expect(hiddenColumnsParamValue(['visibility', 'seats'])).toBe('visibility,seats');
  });
});
