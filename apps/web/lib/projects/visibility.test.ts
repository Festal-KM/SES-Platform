// apps/web/lib/projects/visibility.test.ts
// `#28`（公開範囲の設定）のうち、**DB を要しない規則**。T-06-06 / T-06-07。
//
// 🔴 実 DB + RLS での挙動（`F-014 AC-1` / `AC-2` / `AC-5`、ゲート保留、公開解除、認可）は
//    `tests/isolation/project-visibility.test.ts` が固定する。**片方だけにしない。**
import { describe, expect, it } from 'vitest';
import {
  diffProjectVisibility,
  projectVisibilityAuditSummary,
  PROJECT_VISIBILITY_AUDIT_ACTION,
  PROJECT_VISIBILITY_VERDICTS,
} from './visibility';
import { AUDIT_LOG_CATEGORY_KEYS, auditLogCategoryWhere } from '../audit-logs/categories';

describe('🔴 公開先の差分（広げる操作と狭める操作を分ける）', () => {
  it('追加・維持・解除に分かれる', () => {
    expect(diffProjectVisibility(['a', 'b'], ['b', 'c'])).toEqual({
      added: ['c'],
      kept: ['b'],
      revoked: ['a'],
    });
  });

  it('同じ集合なら 3 つとも空でない側は `kept` だけ（冪等）', () => {
    expect(diffProjectVisibility(['a', 'b'], ['b', 'a'])).toEqual({
      added: [],
      kept: ['a', 'b'],
      revoked: [],
    });
  });

  it('🔴 空配列は「誰にも公開しない」＝ 全解除である（`F-014 AC-2` の既定と同じ状態へ戻す）', () => {
    expect(diffProjectVisibility(['a', 'b'], [])).toEqual({
      added: [],
      kept: [],
      revoked: ['a', 'b'],
    });
  });

  it('🔴 現在 0 件なら、選んだ相手はすべて「追加」＝ ゲートを通る側に入る', () => {
    expect(diffProjectVisibility([], ['b', 'a'])).toEqual({
      added: ['a', 'b'],
      kept: [],
      revoked: [],
    });
  });

  it('🔴 出力は入力の順序に依存しない（監査ログの `before` / `after` が揺れない）', () => {
    expect(diffProjectVisibility(['b', 'a'], ['c', 'a'])).toEqual(
      diffProjectVisibility(['a', 'b'], ['a', 'c']),
    );
  });

  it('重複した指定は 1 件として扱われる', () => {
    expect(diffProjectVisibility([], ['a', 'a'])).toEqual({ added: ['a'], kept: [], revoked: [] });
  });
});

describe('🔴 `verdict` は「公開できたか」ではなく「要求をどう扱ったか」である', () => {
  it('`PASS` / `FAIL` を持たない（ゲートは非同期であり、この応答時点に合否は無い）', () => {
    expect([...PROJECT_VISIBILITY_VERDICTS]).toEqual(['PENDING_GATE', 'NO_PUBLISH_REQUESTED']);
    expect(PROJECT_VISIBILITY_VERDICTS).not.toContain('PASS');
    expect(PROJECT_VISIBILITY_VERDICTS).not.toContain('PUBLISHED');
  });
});

describe('🔴 F-014 AC-5: 監査ログに残す「変更前後の公開先」（T-06-07）', () => {
  /** 解除のみの要求（1 社目を残し、2 社目を解除した）。 */
  const revokeOnly = projectVisibilityAuditSummary({
    before: ['a', 'b'],
    kept: ['a'],
    requested: ['a'],
    added: [],
    revoked: ['b'],
    verdict: 'NO_PUBLISH_REQUESTED',
  });

  it('`before` / `after` が変更前後の公開先である（ID の昇順の連結）', () => {
    expect(revokeOnly['before']).toBe('a,b');
    expect(revokeOnly['after']).toBe('a');
    expect(revokeOnly['revoked']).toBe('b');
  });

  it('🔴 追加は `after` に入らない（ゲートを通るまで公開は成立していない）', () => {
    const summary = projectVisibilityAuditSummary({
      before: ['a'],
      kept: ['a'],
      requested: ['a', 'c'],
      added: ['c'],
      revoked: [],
      verdict: 'PENDING_GATE',
    });

    expect(summary['after']).toBe('a');
    expect(summary['pending']).toBe('c');
    // 🔴 要求（`requested`）と成立（`after`）の差が「ゲート待ち」である。ここを畳むと、
    //    記録だけを見た人が「公開済み」と読み違える。
    expect(summary['requested']).toBe('a,c');
  });

  it('🔴 全解除でも空文字として残る（キーごと消して「記録が無い」に見せない）', () => {
    const summary = projectVisibilityAuditSummary({
      before: ['a'],
      kept: [],
      requested: [],
      added: [],
      revoked: ['a'],
      verdict: 'NO_PUBLISH_REQUESTED',
    });

    expect(summary['after']).toBe('');
    expect(summary['revoked']).toBe('a');
  });

  it('🔴 連鎖して遡れる（次の記録の `before` は前の記録の `after`）', () => {
    const next = projectVisibilityAuditSummary({
      before: ['a'],
      kept: [],
      requested: [],
      added: [],
      revoked: ['a'],
      verdict: 'NO_PUBLISH_REQUESTED',
    });

    expect(next['before']).toBe(revokeOnly['after']);
  });

  it('🔴 キーは 6 つで固定（社名・案件名を足す余地を作らない。docs/05 §16.2）', () => {
    expect(Object.keys(revokeOnly).sort()).toEqual([
      'after',
      'before',
      'pending',
      'requested',
      'revoked',
      'verdict',
    ]);
    // 🔴 値はすべて ID の連結か列挙値である（自由入力が紛れ込む型になっていない）。
    expect(Object.values(revokeOnly).every((value) => typeof value === 'string')).toBe(true);
  });
});

describe('🔴 監査ログの action（docs/05 §16.1 / `S-041` の操作種別フィルタ）', () => {
  it('`project.visibility_change` である（`project.update` に畳まない）', () => {
    expect(PROJECT_VISIBILITY_AUDIT_ACTION).toBe('project.visibility_change');
  });

  it('🔴 `S-041` の `VISIBILITY_CHANGE` で検索できる（記録されているのに出てこない状態を作らない）', () => {
    const where = auditLogCategoryWhere('VISIBILITY_CHANGE');
    expect(where).toEqual({ action: { in: [PROJECT_VISIBILITY_AUDIT_ACTION] } });
    expect(AUDIT_LOG_CATEGORY_KEYS).toContain('VISIBILITY_CHANGE');
  });
});
