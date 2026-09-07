// packages/db/src/search/free-word.test.ts
// フリーワード検索の唯一の seam（`free-word.ts`）。T-06-05。
//
// 🔴 ここで固定するのは 2 点である:
//   ①**述語の形**（`contains` + `mode: 'insensitive'` ＝ `ILIKE '%…%'`）。これは
//     **`gin_trgm_ops` が演算子として受ける形**ではあるが、🔴 **本プロダクトの RLS 下では
//     索引条件に降りない**（`texticlike` が leakproof でないため。`free-word.ts` 冒頭 /
//     `docs/03` §3.7.2 懸念 4）。`tests/isolation/search-indexes.test.ts` ④ が
//     **「trigram の GIN 索引を作っても使われないこと」**を `EXPLAIN` で固定しており、
//     だからこそ索引を作らないという判断になっている。
//   ②**対象列を呼び出し側が明示する**こと（「テキスト列を全部見る」形にしない）。
import { describe, expect, it } from 'vitest';
import { freeWordFilter, freeWordOr } from './free-word.js';

describe('freeWordFilter（唯一の述語の組み立て）', () => {
  it('大文字小文字を区別しない部分一致になる（`ILIKE \'%…%\'`）', () => {
    expect(freeWordFilter('架空')).toEqual({ contains: '架空', mode: 'insensitive' });
  });

  it('🔴 入力を加工しない（前後の空白の除去・正規化は API 境界の Zod の責務）', () => {
    expect(freeWordFilter('Java 8').contains).toBe('Java 8');
  });
});

describe('freeWordOr（複数列の OR）', () => {
  it('列ごとに 1 つずつ述語を作る', () => {
    expect(freeWordOr('架空', ['displayName', 'preferenceNote'])).toEqual({
      OR: [
        { displayName: { contains: '架空', mode: 'insensitive' } },
        { preferenceNote: { contains: '架空', mode: 'insensitive' } },
      ],
    });
  });

  it('🔴 列の順序を入力どおりに保つ（述語が実行のたびに入れ替わらない）', () => {
    const { OR } = freeWordOr('x', ['name', 'publicSummary']);
    expect(OR.map((fragment) => Object.keys(fragment)[0])).toEqual(['name', 'publicSummary']);
  });

  it('1 列だけでも OR の形を保つ（呼び出し側に分岐を作らせない）', () => {
    expect(freeWordOr('x', ['name'])).toEqual({ OR: [{ name: { contains: 'x', mode: 'insensitive' } }] });
  });
});
