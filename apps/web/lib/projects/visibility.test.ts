// apps/web/lib/projects/visibility.test.ts
// `#28`（公開範囲の設定）のうち、**DB を要しない規則**。T-06-06。
//
// 🔴 実 DB + RLS での挙動（`F-014 AC-1` / `AC-2`、ゲート保留、監査ログ、認可）は
//    `tests/isolation/project-visibility.test.ts` が固定する。**片方だけにしない。**
import { describe, expect, it } from 'vitest';
import {
  diffProjectVisibility,
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
