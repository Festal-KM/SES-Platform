// packages/domain/src/usage/unit-cost-ratio.test.ts
// T-11-02: 「件数 × 1 件あたり標準原価」に対する実原価の倍率（docs/02 `F-063 AC-5` / docs/03 §7.6.1）。
import { describe, expect, it } from 'vitest';
import { AI_UNIT_STANDARD_COST_USD_V1, computeUnitCostRatio } from './unit-cost-ratio.js';

describe('AI_UNIT_STANDARD_COST_USD_V1', () => {
  it('docs/03 §7.6.1 の表と一致する（xlsx / docx 基準。gate-inspector の単位は無い）', () => {
    expect(AI_UNIT_STANDARD_COST_USD_V1).toEqual({
      AI_UNIT_SHEET_PARSE: '0.033',
      AI_UNIT_MATCH_RATIONALE: '0.004',
      AI_UNIT_PROPOSAL_DRAFT: '0.021',
      AI_UNIT_RENEWAL_SUMMARY: '0.017',
    });
  });
});

describe('computeUnitCostRatio', () => {
  it('標準どおりの原価なら 1.0（基準ユニット: 60 / 2,000 / 60 / 8 件 = $11.38）', () => {
    const ratio = computeUnitCostRatio({
      unitCounts: {
        AI_UNIT_SHEET_PARSE: 60,
        AI_UNIT_MATCH_RATIONALE: 2000,
        AI_UNIT_PROPOSAL_DRAFT: 60,
        AI_UNIT_RENEWAL_SUMMARY: 8,
      },
      costByRoleUsd: {
        'sheet-parser': '1.620000',
        'skill-normalizer': '0.360000',
        'match-explainer': '8.000000',
        'proposal-drafter': '1.260000',
        'renewal-advisor': '0.136000',
        // 🔴 gate-inspector は単位を持たない。分子にも分母にも入らない（入れば 1.0 にならない）。
        'gate-inspector': '1.440000',
      },
    });
    expect(ratio.standardMicros).toBe(11_376_000n);
    expect(ratio.actualMicros).toBe(11_376_000n);
    expect(ratio.ratio).toBe(1);
  });

  it('実原価が標準の 1.5 倍なら 1.5（1 件あたり標準原価の改定が要る合図）', () => {
    const ratio = computeUnitCostRatio({
      unitCounts: { AI_UNIT_PROPOSAL_DRAFT: 10 },
      costByRoleUsd: { 'proposal-drafter': '0.315000' },
    });
    expect(ratio.standardMicros).toBe(210_000n);
    expect(ratio.ratio).toBeCloseTo(1.5, 10);
  });

  it('🔴 件数 0 のときは null（0 割りを 0 倍にしない）。原価だけあっても null', () => {
    expect(computeUnitCostRatio({ unitCounts: {}, costByRoleUsd: {} }).ratio).toBeNull();
    expect(computeUnitCostRatio({ unitCounts: {}, costByRoleUsd: { 'sheet-parser': '0.500000' } }).ratio).toBeNull();
  });

  it('件数が負・非整数なら例外', () => {
    expect(() => computeUnitCostRatio({ unitCounts: { AI_UNIT_SHEET_PARSE: -1 }, costByRoleUsd: {} })).toThrow(RangeError);
    expect(() => computeUnitCostRatio({ unitCounts: { AI_UNIT_SHEET_PARSE: 1.5 }, costByRoleUsd: {} })).toThrow(RangeError);
  });

  it('標準原価の表を差し替えられる（版を上げたときに呼び出し側が渡す）', () => {
    const ratio = computeUnitCostRatio({
      unitCounts: { AI_UNIT_SHEET_PARSE: 10 },
      costByRoleUsd: { 'sheet-parser': '0.400000' },
      standardCostUsd: { ...AI_UNIT_STANDARD_COST_USD_V1, AI_UNIT_SHEET_PARSE: '0.040' },
    });
    expect(ratio.ratio).toBe(1);
  });
});
