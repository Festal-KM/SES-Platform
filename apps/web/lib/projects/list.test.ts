// apps/web/lib/projects/list.test.ts
// `GET /api/projects`（#25）のうち、**`apps/web` に残った部分**（一覧が読む列と要約の件数）。
// T-06-03 → T-06-05。
//
// 🔴 **検索述語（`projectSearchWhere`）と既定の並び（`PROJECT_LIST_ORDER_BY`）の検証は
//    `packages/db/src/search/projects.test.ts` へ移した**（T-06-05 で実装ごと `@ses/db` の
//    `search/**` に移したため）。境界キーが述語に現れないことは
//    `apps/web/lib/api/search-isolation.test.ts` が固定する。
// 🔴 実 DB での並び（照合順序）と `total` の母集団は `tests/isolation/projects.test.ts` が固定する。
import { describe, expect, it } from 'vitest';
import { MUST_REQUIREMENT_SUMMARY_LIMIT, PROJECT_LIST_SELECT_KEYS } from './list';

describe('🔴 一覧が読む列（`F-013 AC-2` の一覧側）', () => {
  it('商流情報の 2 列を `select` に持たない（SQL としても取得しない）', () => {
    expect(PROJECT_LIST_SELECT_KEYS).not.toContain('endClientName');
    expect(PROJECT_LIST_SELECT_KEYS).not.toContain('internalUnitPrice');
  });

  it('読む列は `docs/04` §S-010 の結果テーブルに出るものだけである', () => {
    expect([...PROJECT_LIST_SELECT_KEYS].sort()).toEqual([
      'headcount',
      'id',
      'name',
      'prefecture',
      'remoteMode',
      'startDate',
      'status',
      'unitPriceMax',
      'unitPriceMin',
      'updatedAt',
    ]);
  });

  it('必須要件の要約は上位 3 件（docs/04 §11 の省略方針）', () => {
    expect(MUST_REQUIREMENT_SUMMARY_LIMIT).toBe(3);
  });
});
