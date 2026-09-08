// packages/domain/src/ai/units.test.ts
// 🔴 `ROLE_UNIT` の写像（SP-07 §5「ユニット: `ROLE_UNIT` の写像」/ `P-A-18` / docs/03 §7.6.1）。T-07-03。
//
// 🔴 「`units.ts` が単価表を import しない」ことの機械検証は `packages/domain` に置けない
//    （domain のゾーンは node の I/O を禁じており、ソースを読む検査を書けない）。
//    `tests/static/ai-usage-cost-single-path.test.ts` が担う。
import { describe, expect, it } from 'vitest';
import { AI_ROLES } from './roles.js';
import {
  AI_UNIT_METRICS,
  MATCH_EXPLAINER_RATIONALES_FIELD,
  resolveAiUnitCount,
  ROLE_UNIT,
} from './units.js';

describe('ROLE_UNIT（docs/05 §7.6 / docs/03 §7.6.1）', () => {
  it('6 ロールすべてが表に現れる（書き忘れを型と実測の両方で塞ぐ）', () => {
    expect(Object.keys(ROLE_UNIT).sort()).toEqual([...AI_ROLES].sort());
  });

  it('🔴 skill-normalizer を数えない（スキルシート解析 1 件の二重計上になる）', () => {
    expect(ROLE_UNIT['skill-normalizer']).toBeNull();
    expect(resolveAiUnitCount('skill-normalizer', { results: [] })).toBeNull();
  });

  it('🔴 gate-inspector を数えない（F-026 AC-6 / F-027 AC-7。記録はするが分母・分子に入れない）', () => {
    expect(ROLE_UNIT['gate-inspector']).toBeNull();
    expect(resolveAiUnitCount('gate-inspector', { pii: { verdict: 'PASS' } })).toBeNull();
  });

  it('スキルシート解析は sheet-parser の実行 1 回 = 1 件', () => {
    expect(resolveAiUnitCount('sheet-parser', { careers: [], skills: [], unextracted: [] })).toEqual({
      metric: 'AI_UNIT_SHEET_PARSE',
      quantity: 1,
    });
  });

  it.each([
    ['proposal-drafter', 'AI_UNIT_PROPOSAL_DRAFT'],
    ['renewal-advisor', 'AI_UNIT_RENEWAL_SUMMARY'],
  ] as const)('%s は実行 1 回 = 1 件', (role, metric) => {
    expect(resolveAiUnitCount(role, {})).toEqual({ metric, quantity: 1 });
  });

  it('🔴 根拠文は「根拠文が付いた候補の数」で数える（10 候補を 1 リクエストにまとめても 10 件）', () => {
    const output = { rationales: Array.from({ length: 10 }, (_, i) => ({ ref: `c${i}` })) };
    expect(resolveAiUnitCount('match-explainer', output)).toEqual({
      metric: 'AI_UNIT_MATCH_RATIONALE',
      quantity: 10,
    });
  });

  it('根拠文が 0 件なら 0 件（カウンタを動かさない材料になる）', () => {
    expect(resolveAiUnitCount('match-explainer', { rationales: [] })).toEqual({
      metric: 'AI_UNIT_MATCH_RATIONALE',
      quantity: 0,
    });
  });

  it.each([null, undefined, 42, {}, { rationales: 3 }, { rationales: null }])(
    '🔴 根拠文の配列が読めない出力 %s は 0 件で通さず例外にする',
    (output) => {
      expect(() => resolveAiUnitCount('match-explainer', output)).toThrow(TypeError);
    },
  );

  it('metric は UsageCounter の AI_UNIT_* 4 種だけを使う', () => {
    const used = Object.values(ROLE_UNIT)
      .filter((definition) => definition !== null)
      .map((definition) => definition.metric)
      .sort();
    expect(used).toEqual([...AI_UNIT_METRICS].sort());
  });

  it('match-explainer の出力フィールド名が docs/05 §7.1 の出力スキーマと一致している', () => {
    expect(MATCH_EXPLAINER_RATIONALES_FIELD).toBe('rationales');
  });
});

describe('🔴 件数を金額から割り戻さない（F-026 AC-6 / docs/03 §7.6.3-1）', () => {
  it('件数の算出に単価・コストが 1 つも入力されない（引数はロールと出力だけ）', () => {
    expect(resolveAiUnitCount.length).toBe(2);
  });

  it('同じ出力なら、モデルや原価がどう変わっても件数は同じ（決定的）', () => {
    const output = { rationales: [{ ref: 'a' }, { ref: 'b' }] };
    const first = resolveAiUnitCount('match-explainer', output);
    for (let i = 0; i < 50; i += 1) {
      expect(resolveAiUnitCount('match-explainer', output)).toEqual(first);
    }
  });
});
