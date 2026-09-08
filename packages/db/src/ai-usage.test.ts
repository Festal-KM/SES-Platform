// packages/db/src/ai-usage.test.ts
// 🔴 「パターン検出による追加マスキング」の要約（docs/03 §4.2 / docs/05 §7.10 ⑤）の畳み方。T-07-03。
//
// DB を要する部分（INSERT / RLS / 件数の実加算）は `tests/isolation/ai-usage.test.ts` が実証する。
// ここは**値の変換だけ**を見る（DB を立てずに固定できる部分を CI の毎回の実行に載せる）。
import { describe, expect, it } from 'vitest';
import { summarizePatternMaskHits } from './ai-usage.js';

describe('summarizePatternMaskHits', () => {
  it('要約が無ければ空オブジェクト（NULL にしない。「検出なし」と「記録し忘れ」を区別する）', () => {
    expect(summarizePatternMaskHits(undefined)).toEqual({});
    expect(summarizePatternMaskHits([])).toEqual({});
  });

  it('🔴 PATTERN（補助）だけを残す —— KNOWN_VALUE（主経路）は台帳の欠落の兆候ではない', () => {
    expect(
      summarizePatternMaskHits([
        { category: 'NAME', method: 'KNOWN_VALUE', count: 3 },
        { category: 'EMAIL', method: 'PATTERN', count: 2 },
      ]),
    ).toEqual({ EMAIL: 2 });
  });

  it('同じ種別が複数回現れたら合算する（複数の mask() の結果を連結して渡せる）', () => {
    expect(
      summarizePatternMaskHits([
        { category: 'PHONE', method: 'PATTERN', count: 1 },
        { category: 'PHONE', method: 'PATTERN', count: 2 },
        { category: 'EMAIL', method: 'PATTERN', count: 1 },
      ]),
    ).toEqual({ PHONE: 3, EMAIL: 1 });
  });

  it('件数 0 の要約は行に載せない（「検出したが 0 件」という状態を作らない）', () => {
    expect(summarizePatternMaskHits([{ category: 'EMAIL', method: 'PATTERN', count: 0 }])).toEqual(
      {},
    );
  });

  it('🔴 一致した文字列を持ち込む余地が無い（種別と件数だけ）', () => {
    const summary = summarizePatternMaskHits([
      { category: 'BIRTH_DATE', method: 'PATTERN', count: 1 },
    ]);
    expect(Object.values(summary).every((value) => typeof value === 'number')).toBe(true);
  });
});
