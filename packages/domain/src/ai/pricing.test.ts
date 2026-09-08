// packages/domain/src/ai/pricing.test.ts
// 🔴 単価表（docs/03 §3.3.1）と推定コストの算出（docs/05 §7.3 手順 6）の固定。T-07-03。
//
// ここで守るのは 3 点:
//   ① docs/03 §3.3.1 の一次情報と表の値が一致していること（表を書き換えたら落ちる）
//   ② 金額の計算に浮動小数点が現れないこと（`Decimal(12,6)` にそのまま入る十進文字列）
//   ③ 🔴 単価が引けないモデルは 0 円で記録されず**例外になる**こと
import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_PRICING,
  estimateAiCostUsd,
  resolveAiModelPrice,
  UnknownAiModelPriceError,
} from './pricing.js';

const NO_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
} as const;

describe('AI_MODEL_PRICING（docs/03 §3.3.1 の一次情報）', () => {
  it('CLAUDE.md §2 が指定する 2 つのモデル ID の単価が表に載っている', () => {
    expect(AI_MODEL_PRICING['claude-sonnet-5']).toEqual({
      inputUsdPerMTok: '2',
      outputUsdPerMTok: '10',
      cacheWrite5mUsdPerMTok: '2.50',
      cacheReadUsdPerMTok: '0.20',
    });
    expect(AI_MODEL_PRICING['claude-haiku-4-5-20251001']).toEqual({
      inputUsdPerMTok: '1',
      outputUsdPerMTok: '5',
      cacheWrite5mUsdPerMTok: '1.25',
      cacheReadUsdPerMTok: '0.10',
    });
  });

  it('🔴 キャッシュ読出は基本入力の 10%（入力と混ぜて数えていない）', () => {
    for (const price of Object.values(AI_MODEL_PRICING)) {
      expect(Number(price.cacheReadUsdPerMTok)).toBeCloseTo(Number(price.inputUsdPerMTok) * 0.1, 6);
    }
  });
});

describe('resolveAiModelPrice', () => {
  it('完全一致で引ける', () => {
    expect(resolveAiModelPrice('claude-sonnet-5').outputUsdPerMTok).toBe('10');
  });

  it('🔴 応答が固定版の ID（-YYYYMMDD）を返しても同じ単価で引ける', () => {
    expect(resolveAiModelPrice('claude-sonnet-5-20260514')).toBe(
      AI_MODEL_PRICING['claude-sonnet-5'],
    );
  });

  it('🔴 前方一致では拾わない（別料金でありうるモデルを静かに同じ単価にしない）', () => {
    expect(() => resolveAiModelPrice('claude-sonnet-5-5')).toThrow(UnknownAiModelPriceError);
    expect(() => resolveAiModelPrice('claude-sonnet-5-turbo')).toThrow(UnknownAiModelPriceError);
  });

  it('🔴 未登録のモデルは 0 円で通さず例外にする（F-027 の上限が実質無効になるため）', () => {
    expect(() => resolveAiModelPrice('gpt-4o')).toThrow(UnknownAiModelPriceError);
  });
});

describe('estimateAiCostUsd（docs/05 §3.8 AiUsage.estimatedCostUsd）', () => {
  it('docs/03 §3.3.2 の gate-inspector の見積り（入力 5,000 / 出力 1,000）が $0.020 になる', () => {
    // 5,000 × $2/MTok = $0.010、1,000 × $10/MTok = $0.010 → 合計 $0.020
    expect(
      estimateAiCostUsd({
        modelId: 'claude-sonnet-5',
        tokens: { ...NO_TOKENS, inputTokens: 5_000, outputTokens: 1_000 },
      }),
    ).toBe('0.020000');
  });

  it('docs/03 §3.3.2 の skill-normalizer の見積り（入力 2,000 / 出力 800）が $0.006 になる', () => {
    // 2,000 × $1/MTok = $0.002、800 × $5/MTok = $0.004 → 合計 $0.006
    expect(
      estimateAiCostUsd({
        modelId: 'claude-haiku-4-5-20251001',
        tokens: { ...NO_TOKENS, inputTokens: 2_000, outputTokens: 800 },
      }),
    ).toBe('0.006000');
  });

  it('キャッシュ読出・書込を別単価で計上する', () => {
    // 1,000,000 × $0.20（読出） + 1,000,000 × $2.50（5 分書込） = $2.70
    expect(
      estimateAiCostUsd({
        modelId: 'claude-sonnet-5',
        tokens: { ...NO_TOKENS, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
      }),
    ).toBe('2.700000');
  });

  it('🔴 十進文字列を返し、浮動小数点の丸め誤差を持ち込まない', () => {
    // 3 tok × $0.20/MTok = $0.0000006 → 四捨五入で 1 micro-USD
    const value = estimateAiCostUsd({
      modelId: 'claude-sonnet-5',
      tokens: { ...NO_TOKENS, cacheReadTokens: 3 },
    });
    expect(value).toBe('0.000001');
    // Decimal(12,6) にそのまま入る形（小数 6 桁固定）
    expect(value).toMatch(/^\d+\.\d{6}$/);
  });

  it('1 micro-USD 未満は四捨五入する（切り捨てで常に 0 円にならない / 切り上げで水増ししない）', () => {
    // 2 tok × $0.20/MTok = $0.0000004 → 0 micro-USD（切り捨て側）
    expect(
      estimateAiCostUsd({
        modelId: 'claude-sonnet-5',
        tokens: { ...NO_TOKENS, cacheReadTokens: 2 },
      }),
    ).toBe('0.000000');
  });

  it('トークン数 0 は $0（呼び出しが失敗して利用量が返らない試行）', () => {
    expect(estimateAiCostUsd({ modelId: 'claude-sonnet-5', tokens: NO_TOKENS })).toBe('0.000000');
  });

  it.each([
    ['inputTokens', { ...NO_TOKENS, inputTokens: -1 }],
    ['outputTokens', { ...NO_TOKENS, outputTokens: 1.5 }],
    ['cacheReadTokens', { ...NO_TOKENS, cacheReadTokens: Number.NaN }],
  ])('🔴 %s が 0 以上の整数でなければ例外にする', (_name, tokens) => {
    expect(() => estimateAiCostUsd({ modelId: 'claude-sonnet-5', tokens })).toThrow(RangeError);
  });

  it('同じ入力に対して常に同じ値を返す（決定的）', () => {
    const tokens = { inputTokens: 6_000, outputTokens: 1_500, cacheReadTokens: 700, cacheWriteTokens: 300 };
    const first = estimateAiCostUsd({ modelId: 'claude-sonnet-5', tokens });
    for (let i = 0; i < 50; i += 1) {
      expect(estimateAiCostUsd({ modelId: 'claude-sonnet-5', tokens })).toBe(first);
    }
  });
});
