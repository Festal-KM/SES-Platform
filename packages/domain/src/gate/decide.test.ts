// packages/domain/src/gate/decide.test.ts
// 🔴 合否の合成（docs/05 §11.4 / `F-020` 処理④ / `AC-3` / `AC-4` / `BR-61`）。T-07-06。
import { describe, expect, it } from 'vitest';
import { decideGate, type GateAiOutcome, type GateDecisionInput } from './decide.js';
import type { GateFinding, GateLayer, GateVerdict } from './types.js';

function finding(
  layer: GateLayer,
  overrides: Partial<GateFinding> = {},
): GateFinding {
  return {
    layer,
    kind: layer === 'PII' ? 'FULL_NAME' : layer === 'COMMERCE' ? 'END_CLIENT' : 'SKILL_SHEET_MISMATCH',
    field: 'body',
    offsetStart: 0,
    offsetEnd: 4,
    excerpt: '[名前]',
    severity: 'BLOCK',
    ...overrides,
  };
}

function okAi(
  pii: GateVerdict,
  commerce: GateVerdict,
  extra: Partial<Extract<GateAiOutcome, { ok: true }>> = {},
): GateAiOutcome {
  return {
    ok: true,
    pii: { verdict: pii, findings: pii === 'FAIL' ? [finding('PII')] : [] },
    commerce: { verdict: commerce, findings: commerce === 'FAIL' ? [finding('COMMERCE')] : [] },
    warnings: [],
    ...extra,
  };
}

function input(overrides: Partial<GateDecisionInput> = {}): GateDecisionInput {
  return {
    ai: okAi('PASS', 'PASS'),
    consistency: { verdict: 'PASS', findings: [] },
    mechanicalPii: [],
    mechanicalCommerce: [],
    ...overrides,
  };
}

describe('decideGate（docs/05 §11.4）', () => {
  it('3 層すべて PASS なら overall は PASS', () => {
    const decision = decideGate(input());
    expect(decision).toMatchObject({
      piiVerdict: 'PASS',
      commerceVerdict: 'PASS',
      consistencyVerdict: 'PASS',
      overall: 'PASS',
      aiFailed: false,
    });
    expect(decision.findings).toEqual([]);
  });

  it.each([
    ['PII 層', input({ ai: okAi('FAIL', 'PASS') })],
    ['商流層', input({ ai: okAi('PASS', 'FAIL') })],
    [
      '整合層',
      input({ consistency: { verdict: 'FAIL', findings: [finding('CONSISTENCY')] } }),
    ],
  ])('🔴 %s が FAIL なら overall は FAIL（1 層でも FAIL なら GATE_FAILED）', (_label, given) => {
    expect(decideGate(given).overall).toBe('FAIL');
  });

  describe('🔴 AI の失敗（F-020 の AI 利用欄 / docs/05 §7.4）', () => {
    it('PII 層・商流層は FAIL になり、PASS へフォールバックしない', () => {
      const decision = decideGate(input({ ai: { ok: false } }));
      expect(decision.piiVerdict).toBe('FAIL');
      expect(decision.commerceVerdict).toBe('FAIL');
      expect(decision.aiFailed).toBe(true);
      expect(decision.overall).toBe('FAIL');
    });

    it('🔴 整合層の合否は変わらない（F-027 AC-5 と同じ性質）', () => {
      const passing = decideGate(input({ ai: { ok: false } }));
      expect(passing.consistencyVerdict).toBe('PASS');

      const failing = decideGate(
        input({
          ai: { ok: false },
          consistency: { verdict: 'FAIL', findings: [finding('CONSISTENCY')] },
        }),
      );
      expect(failing.consistencyVerdict).toBe('FAIL');
      expect(failing.findings).toHaveLength(1);
    });

    it('警告は 1 件も返らない（AI が動いていないため）', () => {
      expect(decideGate(input({ ai: { ok: false } })).aiWarnings).toEqual([]);
    });

    it('🔴 機械的検出の指摘は AI の失敗時も findings に残る', () => {
      const decision = decideGate(
        input({ ai: { ok: false }, mechanicalPii: [finding('PII')] }),
      );
      expect(decision.findings).toHaveLength(1);
      expect(decision.findings[0]?.layer).toBe('PII');
    });
  });

  describe('🔴 AI の指摘は合否を変えない（BR-61 / F-020 AC-4）', () => {
    it('整合層の警告だけがある状態でも整合層は PASS', () => {
      const decision = decideGate(
        input({
          ai: okAi('PASS', 'PASS', { warnings: [finding('CONSISTENCY', { severity: 'WARN' })] }),
        }),
      );
      expect(decision.consistencyVerdict).toBe('PASS');
      expect(decision.overall).toBe('PASS');
      expect(decision.aiWarnings).toHaveLength(1);
      // 🔴 findings（合否の根拠）には入らない。
      expect(decision.findings).toEqual([]);
    });

    it('PII 層 / 商流層に付いた WARN も aiWarnings 側へ寄る', () => {
      const decision = decideGate(
        input({
          ai: {
            ok: true,
            pii: { verdict: 'PASS', findings: [finding('PII', { severity: 'WARN' })] },
            commerce: { verdict: 'PASS', findings: [finding('COMMERCE', { severity: 'WARN' })] },
            warnings: [],
          },
        }),
      );
      expect(decision.overall).toBe('PASS');
      expect(decision.findings).toEqual([]);
      expect(decision.aiWarnings).toHaveLength(2);
    });

    it('🔴 整合層の警告に BLOCK が混じっていたら握り潰さず落とす', () => {
      expect(() =>
        decideGate(
          input({ ai: okAi('PASS', 'PASS', { warnings: [finding('CONSISTENCY')] }) }),
        ),
      ).toThrowError(RangeError);
    });
  });

  describe('🔴 機械的検出は AI の判定を上書きする（AI の見落としに対する保険）', () => {
    it('AI が PASS でも既知 PII 値が残っていれば PII 層は FAIL（F-020 AC-5）', () => {
      const decision = decideGate(input({ mechanicalPii: [finding('PII')] }));
      expect(decision.piiVerdict).toBe('FAIL');
      expect(decision.overall).toBe('FAIL');
      expect(decision.findings[0]).toMatchObject({ layer: 'PII', kind: 'FULL_NAME' });
    });

    it('AI が PASS でも公開範囲外のエンド企業名があれば商流層は FAIL（F-020 AC-6）', () => {
      const decision = decideGate(input({ mechanicalCommerce: [finding('COMMERCE')] }));
      expect(decision.commerceVerdict).toBe('FAIL');
      expect(decision.overall).toBe('FAIL');
    });

    it('🔴 機械的検出の WARN は FAIL を作らない（BLOCK のみが FAIL を作る）', () => {
      const decision = decideGate(
        input({ mechanicalPii: [finding('PII', { severity: 'WARN' })] }),
      );
      expect(decision.piiVerdict).toBe('PASS');
      expect(decision.findings).toEqual([]);
    });
  });

  describe('層の取り違えを黙って通さない', () => {
    it.each([
      ['mechanicalPii', input({ mechanicalPii: [finding('COMMERCE')] })],
      ['mechanicalCommerce', input({ mechanicalCommerce: [finding('PII')] })],
      [
        'consistency.findings',
        input({ consistency: { verdict: 'FAIL', findings: [finding('PII')] } }),
      ],
      [
        'ai.pii.findings',
        input({
          ai: {
            ok: true,
            pii: { verdict: 'FAIL', findings: [finding('COMMERCE')] },
            commerce: { verdict: 'PASS', findings: [] },
            warnings: [],
          },
        }),
      ],
    ])('%s に別の層の指摘を渡すと RangeError', (_label, given) => {
      expect(() => decideGate(given)).toThrowError(RangeError);
    });
  });

  it('findings は層の順（PII → COMMERCE → CONSISTENCY）で決定的に並ぶ', () => {
    const decision = decideGate(
      input({
        ai: okAi('FAIL', 'FAIL'),
        consistency: { verdict: 'FAIL', findings: [finding('CONSISTENCY')] },
        mechanicalPii: [finding('PII', { kind: 'BIRTH_DATE' })],
        mechanicalCommerce: [finding('COMMERCE', { kind: 'UNIT_PRICE' })],
      }),
    );
    expect(decision.findings.map((row) => `${row.layer}:${row.kind}`)).toEqual([
      'PII:BIRTH_DATE',
      'PII:FULL_NAME',
      'COMMERCE:UNIT_PRICE',
      'COMMERCE:END_CLIENT',
      'CONSISTENCY:SKILL_SHEET_MISMATCH',
    ]);
  });

  it('🔴 同一入力で 50 回実行しても同じ結果（F-020 AC-3 の合成側）', () => {
    const given = input({
      ai: okAi('FAIL', 'PASS'),
      consistency: { verdict: 'FAIL', findings: [finding('CONSISTENCY')] },
      mechanicalPii: [finding('PII', { kind: 'CONTACT' })],
    });
    const first = JSON.stringify(decideGate(given));
    for (let i = 0; i < 49; i += 1) {
      expect(JSON.stringify(decideGate(given))).toBe(first);
    }
  });
});
