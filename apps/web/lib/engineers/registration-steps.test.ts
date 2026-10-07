// apps/web/lib/engineers/registration-steps.test.ts
// `S-007` 縦ステッパーの状態（`registration-steps.ts`）。2026-10-05。
//
// 🔴 ここで固定するのは 3 つである:
//   ① **`CURRENT` はちょうど 1 段**（2 段に出るとステッパーが飾りになる）
//   ② 🔴 **任意の段に「未入力」を出さない**（`documents` / `conditions` は常に `OPTIONAL`。
//      `docs/04` §S-007 は任意の入力に警告・注意色・保存の抑止を作らないと定めている）
//   ③ 🔴 **`CREATE` では書類を取り込めない**（既存の API は版をエンジニアに紐づけて採番する。
//      登録前の経路を作れば新しいアップロード API になる）
import { describe, expect, it } from 'vitest';
import {
  canImportDocuments,
  registrationSteps,
  REGISTRATION_STEP_KEYS,
  type RegistrationStepKey,
  type RegistrationStepState,
} from './registration-steps';

function stateOf(
  steps: readonly { readonly key: RegistrationStepKey; readonly state: RegistrationStepState }[],
  key: RegistrationStepKey,
): RegistrationStepState {
  const found = steps.find((step) => step.key === key);
  if (found === undefined) throw new Error(`step ${key} が無い`);
  return found.state;
}

describe('4 段の骨格', () => {
  it('段は 4 つで、順序と通し番号が一致する', () => {
    const steps = registrationSteps({ mode: 'CREATE', displayName: '' });
    expect(steps.map((step) => step.key)).toEqual([...REGISTRATION_STEP_KEYS]);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
  });

  it.each([
    ['CREATE' as const, ''],
    ['CREATE' as const, '合成 太郎'],
    ['EDIT' as const, ''],
    ['EDIT' as const, '合成 太郎'],
  ])('🔴 `CURRENT` はちょうど 1 段である（mode=%s / 氏名=%s）', (mode, displayName) => {
    const steps = registrationSteps({ mode, displayName });
    expect(steps.filter((step) => step.state === 'CURRENT')).toHaveLength(1);
  });

  it('🔴 任意の段（書類 / 諸条件）は常に `OPTIONAL` で、「未入力」側の状態を取らない', () => {
    for (const mode of ['CREATE', 'EDIT'] as const) {
      for (const displayName of ['', '合成 太郎']) {
        const steps = registrationSteps({ mode, displayName });
        expect(stateOf(steps, 'documents')).toBe('OPTIONAL');
        expect(stateOf(steps, 'conditions')).toBe('OPTIONAL');
      }
    }
  });
});

describe('氏名（唯一の必須項目）が現在地を決める', () => {
  it('氏名が空 → 基本情報が `CURRENT`、確認は `TODO`', () => {
    const steps = registrationSteps({ mode: 'CREATE', displayName: '' });
    expect(stateOf(steps, 'profile')).toBe('CURRENT');
    expect(stateOf(steps, 'review')).toBe('TODO');
  });

  it('氏名が入った → 基本情報が `DONE`、確認が `CURRENT`', () => {
    const steps = registrationSteps({ mode: 'EDIT', displayName: '合成 太郎' });
    expect(stateOf(steps, 'profile')).toBe('DONE');
    expect(stateOf(steps, 'review')).toBe('CURRENT');
  });

  it('空白だけの氏名は未入力として扱う（`trim()` 後で判定する）', () => {
    const steps = registrationSteps({ mode: 'CREATE', displayName: '   ' });
    expect(stateOf(steps, 'profile')).toBe('CURRENT');
  });
});

describe('🔴 書類の取り込みは編集のときだけできる', () => {
  it('新規（登録前）はできない —— 版をエンジニアに紐づけて採番する API しか無い', () => {
    expect(canImportDocuments('CREATE', null)).toBe(false);
    // 🔴 `CREATE` で ID が渡っていても開けない（モードが先に決める）。
    expect(canImportDocuments('CREATE', '01930000-0000-7000-8000-0000000000e1')).toBe(false);
  });

  it('編集で ID があるときだけできる', () => {
    expect(canImportDocuments('EDIT', '01930000-0000-7000-8000-0000000000e1')).toBe(true);
    expect(canImportDocuments('EDIT', null)).toBe(false);
  });
});
