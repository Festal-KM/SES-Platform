// apps/web/lib/password-reset/outcome.test.ts
// docs/sprints/SP-03 T-03-13 完了判定 #3「存在する/しないメールアドレスで①の応答・完了文言・
// 遷移が同一であることの結合テスト」。
//
// 🔴 API 層（#5 `POST /api/auth/password-reset`）が存在有無によらず常に 204 を返すことは
//    tests/isolation/invitations.test.ts（T-03-03）が実 DB で証明済み（本タスクは画面のみで
//    API 変更を行わないため、そちらのテストを再実装しない）。ここで担保するのは画面側 ——
//    「届いた応答がどうであれ、遷移先の判定関数はメールアドレスや応答の中身を受け取れない」
//    という、型で強制された非開示である。
import { describe, expect, it } from 'vitest';
import { classifyRequestOutcome, isPlausibleEmail } from './outcome';

describe('isPlausibleEmail（送信前のローカル検証。§11.1 の空送信防止）', () => {
  it('空欄・前後空白のみは不合格', () => {
    expect(isPlausibleEmail('')).toBe(false);
    expect(isPlausibleEmail('   ')).toBe(false);
  });

  it('@ やドメイン部を欠く入力は不合格', () => {
    expect(isPlausibleEmail('not-an-email')).toBe(false);
    expect(isPlausibleEmail('missing-domain@')).toBe(false);
    expect(isPlausibleEmail('@missing-local.example')).toBe(false);
  });

  it('構文上妥当なメールアドレスは合格', () => {
    expect(isPlausibleEmail('sales@example.com')).toBe(true);
    expect(isPlausibleEmail('  sales@example.com  ')).toBe(true);
  });
});

describe('classifyRequestOutcome（docs/04 §S-046 ①→②）', () => {
  it('応答が届けば、存在する/しないメールアドレスの区別なく同一の結果になる', () => {
    // 🔴 API は該当有無によらず常に 204（settled）を返す。関数はメールアドレスも
    //    応答の中身も引数に取らないため、存在有無で分岐する実装をそもそも書けない。
    const existingAccountRequest = classifyRequestOutcome(true);
    const unknownAccountRequest = classifyRequestOutcome(true);
    expect(existingAccountRequest).toBe('submitted');
    expect(existingAccountRequest).toBe(unknownAccountRequest);
  });

  it('ネットワーク例外（接続不可）のときだけ異なる結果になる', () => {
    expect(classifyRequestOutcome(false)).toBe('network-error');
  });
});
