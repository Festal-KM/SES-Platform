// packages/domain/src/gate/autoApprove.test.ts
// 🔴 `shouldAutoApprove`（docs/05 §11.6 / `F-021 AC-2` `AC-3`）の分岐を全網羅で固定する。T-09-03。
// 🔴 T-09-04: テナントの状態（`lifecycleState`）が実行可（`SANDBOX` / `ACTIVE`）のときだけ true。
import { describe, expect, it } from 'vitest';
import { TENANT_EXECUTABLE_LIFECYCLE_STATES, TENANT_LIFECYCLE_STATES } from '../state/tenant.js';
import { AUTO_APPROVE_REASON, shouldAutoApprove, type AutoApproveInput } from './autoApprove.js';
import { GATE_VERDICTS, type GateVerdict } from './types.js';

const ALL_PASS: AutoApproveInput = {
  autoApproveEnabled: true,
  lifecycleState: 'ACTIVE',
  pii: 'PASS',
  commerce: 'PASS',
  consistency: 'PASS',
};

describe('shouldAutoApprove（docs/05 §11.6）', () => {
  it('autoApproveEnabled かつ実行可のテナント状態かつ全層 PASS のときだけ true', () => {
    expect(shouldAutoApprove(ALL_PASS)).toBe(true);
    expect(shouldAutoApprove({ ...ALL_PASS, lifecycleState: 'SANDBOX' })).toBe(true);
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

  it.each(['SUSPENDED', 'CLOSING', 'PURGED'] as const)(
    '🔴 T-09-04: テナントが %s なら autoApproveEnabled かつ全層 PASS でも false（人間承認に倒す = 安全側）',
    (lifecycleState) => {
      expect(shouldAutoApprove({ ...ALL_PASS, lifecycleState })).toBe(false);
    },
  );

  it('🔴 実行可の状態の集合は SANDBOX / ACTIVE の 2 値（docs/05 §6.2 requireExecutable と同じ）', () => {
    expect([...TENANT_EXECUTABLE_LIFECYCLE_STATES]).toEqual(['SANDBOX', 'ACTIVE']);
  });

  it('🔴 全網羅: 2^3 通りの合否 × 有効/無効 × 5 状態 のうち true になるのは 2 通り（SANDBOX / ACTIVE の全層 PASS）だけ', () => {
    const outcomes: boolean[] = [];
    for (const autoApproveEnabled of [true, false]) {
      for (const lifecycleState of TENANT_LIFECYCLE_STATES) {
        for (const pii of GATE_VERDICTS) {
          for (const commerce of GATE_VERDICTS) {
            for (const consistency of GATE_VERDICTS) {
              outcomes.push(shouldAutoApprove({ autoApproveEnabled, lifecycleState, pii, commerce, consistency }));
            }
          }
        }
      }
    }
    expect(outcomes.filter(Boolean)).toHaveLength(TENANT_EXECUTABLE_LIFECYCLE_STATES.length);
  });

  it('🔴 引数の型に TenantRoleApprovalMode（AI ロール別承認モード）が無い（F-035 AC-3 / AC-6）', () => {
    // 型レベル: `AutoApproveInput` のキーは 5 つだけ。ロール別のモードを渡す入力面が存在しない。
    const keys: readonly (keyof AutoApproveInput)[] = ['autoApproveEnabled', 'lifecycleState', 'pii', 'commerce', 'consistency'];
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
