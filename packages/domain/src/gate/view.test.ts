// packages/domain/src/gate/view.test.ts
// 🔴 画面へ渡す形（docs/05 §11.7 / `F-027 AC-5` / docs/04 申し送り 11）。T-07-06。
import { describe, expect, it } from 'vitest';
import type { GateFinding } from './types.js';
import {
  runningGateResultView,
  toGateResultView,
  type GateHeldView,
  type PersistedGateResult,
} from './view.js';

const HASH = 'a'.repeat(64);

const PII_FINDING: GateFinding = {
  layer: 'PII',
  kind: 'FULL_NAME',
  field: 'body',
  offsetStart: 3,
  offsetEnd: 8,
  excerpt: '[名前]',
  severity: 'BLOCK',
};

const CONSISTENCY_FINDING: GateFinding = {
  layer: 'CONSISTENCY',
  kind: 'MUST_REQUIREMENT_MISMATCH',
  field: 'snapshot',
  offsetStart: null,
  offsetEnd: null,
  excerpt: 'React 2.0/3.0',
  severity: 'BLOCK',
};

const HELD: GateHeldView = {
  heldReasonKey: 'gate.held.aiCostLimit',
  heldSince: '2026-09-08T01:00:00.000Z',
  resetAt: '2026-09-08T15:00:00.000Z',
  limitRaise: 'PLATFORM_OPERATOR',
  rerun: { auto: true, manual: 'POST /api/proposals/{id}/gate' },
};

function done(overrides: Partial<PersistedGateResult> = {}): PersistedGateResult {
  return {
    execution: 'DONE',
    contentHash: HASH,
    piiVerdict: 'FAIL',
    commerceVerdict: 'PASS',
    consistencyVerdict: 'PASS',
    findings: [PII_FINDING],
    aiWarnings: [],
    aiFailed: false,
    ...overrides,
  };
}

describe('GateResultView（docs/05 §11.7）', () => {
  it('行が無い間は execution=RUNNING（3 層とも RUNNING）', () => {
    const view = runningGateResultView(HASH);
    expect(view.execution).toBe('RUNNING');
    expect(view.layers.pii.state).toBe('RUNNING');
    expect(view.layers.commerce.state).toBe('RUNNING');
    expect(view.layers.consistency.state).toBe('RUNNING');
    expect(view.contentHash).toBe(HASH);
  });

  it('確定した行は層ごとに判定と指摘を返す', () => {
    const view = toGateResultView(
      done({ findings: [PII_FINDING, CONSISTENCY_FINDING], consistencyVerdict: 'FAIL' }),
    );
    expect(view.execution).toBe('DONE');
    expect(view.layers.pii).toEqual({ state: 'FAIL', findings: [PII_FINDING] });
    expect(view.layers.commerce).toEqual({ state: 'PASS', findings: [] });
    expect(view.layers.consistency).toEqual({ state: 'FAIL', findings: [CONSISTENCY_FINDING] });
  });

  describe('🔴 HELD（AI の日次コスト上限。F-027 AC-5）', () => {
    const heldRow = done({
      execution: 'HELD_AI_COST_LIMIT',
      piiVerdict: null,
      commerceVerdict: null,
      consistencyVerdict: 'FAIL',
      findings: [CONSISTENCY_FINDING],
    });

    it('🔴 execution を 2 値に潰さず、PII / 商流層は HELD として返す', () => {
      const view = toGateResultView(heldRow, HELD);
      expect(view.execution).toBe('HELD_AI_COST_LIMIT');
      expect(view.layers.pii.state).toBe('HELD');
      expect(view.layers.commerce.state).toBe('HELD');
    });

    it('🔴 整合層は保留中でも確定値を返す（保持された結果が再実行に使われる）', () => {
      const view = toGateResultView(heldRow, HELD);
      expect(view.layers.consistency).toEqual({ state: 'FAIL', findings: [CONSISTENCY_FINDING] });
    });

    it('held には金額（USD）を載せない（F-027 AC-6）', () => {
      const view = toGateResultView(heldRow, HELD);
      // 🔴 項目そのものを固定する（金額の項目が増えたらここで落ちる）。
      expect(Object.keys(view.held ?? {}).sort()).toEqual([
        'heldReasonKey',
        'heldSince',
        'limitRaise',
        'rerun',
        'resetAt',
      ]);
      expect(Object.values(view.held ?? {}).some((value) => typeof value === 'number')).toBe(false);
      expect(view.held?.limitRaise).toBe('PLATFORM_OPERATOR');
      expect(view.held?.rerun).toEqual({ auto: true, manual: 'POST /api/proposals/{id}/gate' });
    });

    it('🔴 execution と held の有無が食い違ったら落とす（判別可能な合併）', () => {
      expect(() => toGateResultView(heldRow)).toThrowError(RangeError);
      expect(() => toGateResultView(done(), HELD)).toThrowError(RangeError);
    });
  });

  it('aiWarnings は findings と別のフィールドとして返る（docs/04 申し送り 5）', () => {
    const warning: GateFinding = { ...CONSISTENCY_FINDING, severity: 'WARN' };
    const view = toGateResultView(done({ aiWarnings: [warning] }));
    expect(view.aiWarnings).toEqual([warning]);
    // 🔴 警告は層の findings に混ざらない（整合層は PASS のまま）。
    expect(view.layers.consistency.findings).toEqual([]);
  });
});
