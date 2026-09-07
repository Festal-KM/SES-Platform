// packages/db/src/search/projects.test.ts
// `GET /api/projects`（#25）の**述語の組み立て**と**既定の並び**（`search/projects.ts`）。
// T-06-03 で `apps/web/lib/projects/list.test.ts` として書いたもののうち、T-06-05 の移設で
// ここへ移った部分（検索述語と `ORDER BY`）。一覧の `select` する列の検査は `apps/web` に残る。
//
// 🔴 ここで固定するのは 2 点である:
//   ①検索条件が指定されたときだけ述語が増えること（`F-015` の入力）
//   ②既定の並びが `後任募集 → 募集中 → 充足` → 更新日時 → 開始日 → id であること
//     （`docs/04` §S-010 / `F-015 AC-3`）
// 🔴 「述語に境界の条件（`tenantId` / `partnerCompanyId` / 公開範囲）が 1 つも無い」は
//    `apps/web/lib/api/search-isolation.test.ts` が固定する。
// 🔴 実 DB での並び（照合順序）と `total` の母集団は `tests/isolation/projects.test.ts` が固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_STATUSES, type ProjectStatus } from '../schema-value-sets.js';
import {
  assertStatusPriority,
  PROJECT_LIST_ORDER_BY,
  PROJECT_STATUS_LIST_PRIORITY,
  projectSearchWhere,
  type ProjectSearchCriteria,
} from './projects.js';

/** `where` を素の JSON にして「何が入っているか」を文字列として数える。 */
function whereJson(criteria: ProjectSearchCriteria = {}): string {
  return JSON.stringify(projectSearchWhere(criteria));
}

describe('検索条件 → 述語（`F-015` の入力）', () => {
  it('条件が 1 つも無ければ `where` は空である（＝ 母集団そのもの）', () => {
    expect(projectSearchWhere({})).toEqual({});
  });

  it('状態は等値で絞る', () => {
    expect(projectSearchWhere({ status: 'SUCCESSOR_WANTED' })).toEqual({
      status: 'SUCCESSOR_WANTED',
    });
  });

  it('開始日は「この日以降」で絞る', () => {
    expect(projectSearchWhere({ startFrom: '2026-10-01' })).toEqual({
      startDate: { gte: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('勤務地は等値で絞る', () => {
    expect(projectSearchWhere({ prefecture: '13' })).toEqual({ prefecture: '13' });
  });

  it('フリーワードは案件名と外部公開用の記載の 2 列だけを見る', () => {
    expect(projectSearchWhere({ q: '基幹' })).toEqual({
      OR: [
        { name: { contains: '基幹', mode: 'insensitive' } },
        { publicSummary: { contains: '基幹', mode: 'insensitive' } },
      ],
    });
  });

  it('複数条件は AND として重なる（キーが並ぶ）', () => {
    expect(Object.keys(projectSearchWhere({ status: 'OPEN', prefecture: '13' })).sort()).toEqual([
      'prefecture',
      'status',
    ]);
  });

  it('🔴 商流情報の列を検索対象にしない（ホストだけ一致する述語を作らない）', () => {
    const json = whereJson({ q: '架空エンド' });
    expect(json).not.toContain('endClientName');
    expect(json).not.toContain('internalUnitPrice');
  });
});

describe('🔴 F-015 AC-3: 既定の並びが決定的である', () => {
  it('並びは 状態 → 更新日時 → 開始日 → id の 4 段である', () => {
    expect(PROJECT_LIST_ORDER_BY).toEqual([
      { status: 'desc' },
      { updatedAt: 'desc' },
      { startDate: { sort: 'asc', nulls: 'last' } },
      { id: 'desc' },
    ]);
  });

  it('🔴 `ORDER BY` に「全体件数」「順位」「スコア」を持ち込まない（docs/05 §4.8）', () => {
    const json = JSON.stringify(PROJECT_LIST_ORDER_BY);
    expect(json).not.toContain('_count');
    expect(json).not.toContain('score');
    expect(json).not.toContain('rank');
  });

  it('🔴 後任募集が既定の並びで上位に来る（`docs/04` §S-010。`F-045` の還流）', () => {
    expect(PROJECT_STATUS_LIST_PRIORITY[0]).toBe('SUCCESSOR_WANTED');
  });

  it('🔴 状態の優先順位が `status` の降順と一致する（一致しなければ import 時に落ちる）', () => {
    // `PROJECT_LIST_ORDER_BY` の第 1 キーは `status: 'desc'` であり、DB は値の綴りで並べる。
    // 綴りの降順が優先順位と一致することが、後任募集を上位に置く実装の前提である。
    expect([...PROJECT_STATUSES].sort().reverse()).toEqual([...PROJECT_STATUS_LIST_PRIORITY]);
  });

  it('状態の値集合が優先順位と過不足なく一致する（状態を足したら気づける）', () => {
    expect([...PROJECT_STATUS_LIST_PRIORITY].sort()).toEqual([...PROJECT_STATUSES].sort());
  });

  // 🔴 上の 2 本は「いま一致していること」しか言えない。**検査そのものが落ちること**を
  //    ここで示す —— これが無いと「読み込み時に落ちる」は注釈の主張のままになる
  //    （code-reviewer 指摘、T-06-03 Iteration 2）。
  describe('🔴 `assertStatusPriority` は `PROJECT_STATUSES` と照合する（宣言の自己照合にしない）', () => {
    it('現在の宣言は通る（対照）', () => {
      expect(() => {
        assertStatusPriority(PROJECT_STATUS_LIST_PRIORITY);
      }).not.toThrow();
    });

    it('🔴 状態が増えたのに優先順位が古いままなら落ちる（欠けている ＝ 順位が未定の状態がある）', () => {
      expect(() => {
        assertStatusPriority(['SUCCESSOR_WANTED', 'OPEN']);
      }).toThrow(/PROJECT_STATUS_LIST_PRIORITY/);
    });

    it('🔴 綴りの降順と違う並びを宣言したら落ちる（後任募集が静かに沈まない）', () => {
      expect(() => {
        assertStatusPriority(['OPEN', 'SUCCESSOR_WANTED', 'FILLED']);
      }).toThrow(/PROJECT_STATUS_LIST_PRIORITY/);
    });

    it('値集合に無い状態を宣言したら落ちる', () => {
      expect(() => {
        assertStatusPriority(['SUCCESSOR_WANTED', 'OPEN', 'FILLED', 'ARCHIVED' as ProjectStatus]);
      }).toThrow(/PROJECT_STATUS_LIST_PRIORITY/);
    });
  });
});
