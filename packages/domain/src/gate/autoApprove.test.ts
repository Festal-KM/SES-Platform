// packages/domain/src/gate/autoApprove.test.ts
// 🔴 `shouldAutoApprove`（docs/05 §11.6 / `F-021 AC-2` `AC-3`）の分岐を全網羅で固定する。T-09-03。
import { describe, expect, it } from 'vitest';
import { AUTO_APPROVE_REASON, shouldAutoApprove, type AutoApproveInput } from './autoApprove.js';
import { GATE_VERDICTS, type GateVerdict } from './types.js';

const ALL_PASS: AutoApproveInput = { autoApproveEnabled: true, pii: 'PASS', commerce: 'PASS', consistency: 'PASS' };

describe('shouldAutoApprove（docs/05 §11.6）', () => {
  it('autoApproveEnabled かつ全層 PASS のときだけ true', () => {
    expect(shouldAutoApprove(ALL_PASS)).toBe(true);
  });

  it('🔴 F-021 AC-2: autoApproveEnabled が無効なら、全層 PASS でも false（人間の操作を要する）', () => {
    expect(shouldAutoApprove({ ...ALL_PASS, autoApproveEnabled: false })).toBe(false);
  });

  it.each([
    ['pii', { pii: 'FAIL' as const }],
    ['commerce', { commerce: 'FAIL' as const }],
    ['consistency', { consistency: 'FAIL' as const }],
  ])('🔴 F-021 AC-3: %s 層が FAIL なら autoApproveEnabled でも false', (_layer, patch) => {
    expect(shouldAutoApprove({ ...ALL_PASS, ...patch })).toBe(false);
  });

  it('🔴 全網羅: 2^3 通りの合否 × 有効/無効 のうち true になるのは 1 通りだけ', () => {
    const outcomes: boolean[] = [];
    for (const autoApproveEnabled of [true, false]) {
      for (const pii of GATE_VERDICTS) {
        for (const commerce of GATE_VERDICTS) {
          for (const consistency of GATE_VERDICTS) {
            outcomes.push(shouldAutoApprove({ autoApproveEnabled, pii, commerce, consistency }));
          }
        }
      }
    }
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it('🔴 引数の型に TenantRoleApprovalMode（AI ロール別承認モード）が無い（F-035 AC-3 / AC-6）', () => {
    // 型レベル: `AutoApproveInput` のキーは 4 つだけ。ロール別のモードを渡す入力面が存在しない。
    const keys: readonly (keyof AutoApproveInput)[] = ['autoApproveEnabled', 'pii', 'commerce', 'consistency'];
    expect(Object.keys(ALL_PASS).sort()).toEqual([...keys].sort());
  });

  it('自動承認の根拠は ALL_LAYERS_PASS の 1 語（監査の summary.reason）', () => {
    expect(AUTO_APPROVE_REASON).toBe('ALL_LAYERS_PASS');
  });

  it('GateVerdict は PASS / FAIL の 2 値（「保留」はここに無い）', () => {
    const verdicts: readonly GateVerdict[] = GATE_VERDICTS;
    expect(verdicts).toEqual(['PASS', 'FAIL']);
  });
});
