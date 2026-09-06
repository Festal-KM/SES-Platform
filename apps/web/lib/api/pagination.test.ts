// apps/web/lib/api/pagination.test.ts
// docs/05 §6.1（カーソル方式・既定 50・最大 200）/ §4.8（見えない ＝ 存在しない）。T-03-04。
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@ses/config';
import {
  buildCursorPage,
  cursorPageQuerySchema,
  idCursorPageQuerySchema,
  takeForCursorPage,
} from './pagination';

describe('cursorPageQuerySchema（docs/05 §6.1）', () => {
  it('未指定なら既定 50 件', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: PAGE_SIZE_DEFAULT });
  });

  it('クエリ文字列（文字列）を数値として受ける', () => {
    expect(cursorPageQuerySchema.parse({ limit: '25', cursor: 'abc' })).toEqual({
      limit: 25,
      cursor: 'abc',
    });
  });

  it('上限 200 は通る', () => {
    expect(cursorPageQuerySchema.parse({ limit: String(PAGE_SIZE_MAX) }).limit).toBe(PAGE_SIZE_MAX);
  });

  it('🔴 上限超過は黙って丸めず失敗する（400 になる）', () => {
    expect(cursorPageQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  });

  it.each(['0', '-1', '1.5', 'abc'])('不正な limit（%s）は失敗する', (limit) => {
    expect(cursorPageQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('🔴 分離キーをキーとして持たない', () => {
    expect(Object.keys(cursorPageQuerySchema.shape).sort()).toEqual(['cursor', 'limit']);
  });
});

describe('idCursorPageQuerySchema（カーソルが行の ID である一覧。T-05-09）', () => {
  const ID = '01930000-0000-7000-8000-0000000000a1';

  it('UUID のカーソルは通る', () => {
    expect(idCursorPageQuerySchema.parse({ cursor: ID })).toEqual({
      cursor: ID,
      limit: PAGE_SIZE_DEFAULT,
    });
  });

  it('未指定でも通る（1 ページ目）', () => {
    expect(idCursorPageQuerySchema.parse({})).toEqual({ limit: PAGE_SIZE_DEFAULT });
  });

  it.each(['abc', '', '01930000-0000-7000-8000', `${ID} `, "'; DROP TABLE engineers; --"])(
    '🔴 UUID でないカーソル（%s）は 400 になる（Prisma の uuid キャストまで届かせない）',
    (cursor) => {
      expect(idCursorPageQuerySchema.safeParse({ cursor }).success).toBe(false);
    },
  );

  it('🔴 分離キーをキーとして持たない', () => {
    expect(Object.keys(idCursorPageQuerySchema.shape).sort()).toEqual(['cursor', 'limit']);
  });

  it('limit の制約は共通スキーマと同じ（片方だけ緩まない）', () => {
    expect(idCursorPageQuerySchema.safeParse({ limit: String(PAGE_SIZE_MAX + 1) }).success).toBe(
      false,
    );
  });
});

describe('buildCursorPage（次ページの判定は +1 件読みで行う）', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const toCursor = (row: { id: string }): string => row.id;

  it('take は limit + 1', () => {
    expect(takeForCursorPage(50)).toBe(51);
  });

  it('limit より多く読めていれば nextCursor は最後の 1 件手前の ID', () => {
    expect(buildCursorPage(rows, 2, toCursor)).toEqual({
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'b',
    });
  });

  it('ちょうど limit 件なら nextCursor は null', () => {
    expect(buildCursorPage(rows, 3, toCursor)).toEqual({ items: rows, nextCursor: null });
  });

  it('0 件でも壊れない', () => {
    expect(buildCursorPage([], 50, toCursor)).toEqual({ items: [], nextCursor: null });
  });

  it('🔴 残件数を返さない（境界外の行の存在を漏らさない。docs/05 §4.8）', () => {
    expect(Object.keys(buildCursorPage(rows, 2, toCursor)).sort()).toEqual([
      'items',
      'nextCursor',
    ]);
  });
});
