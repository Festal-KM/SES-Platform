// apps/web/lib/projects/list-rows.test.ts
// `S-010` の表示値の組み立て（`lib/projects/list-rows.ts`）。T-06-03。
//
// 🔴 ここで固定するのは「画面が何を出すか」ではなく「**出さないこと**が要件になっている値」
//    である: ①取引先の行に公開先の社数が入らない（`F-014 AC-4` / `BR-07`）②`+0` を描かない
//    ③検索条件がページングで落ちない（`docs/04` §10.1 `S-010`）。
import { describe, expect, it } from 'vitest';
import type { HostProjectView, PartnerProjectView, ProjectView } from './list';
import {
  formatMustRequirement,
  formatMustRequirementSummary,
  formatProjectLocation,
  formatVisibilityStatus,
  hasProjectListFilters,
  projectListHref,
  projectListRow,
  projectListRows,
  projectPopulationLabel,
  PROJECT_LIST_PATH,
} from './list-rows';
import type { ProjectListQuery } from './schemas';

const PROJECT_ID = '01930000-0000-7000-8000-0000000000c1';

function sharedView() {
  return {
    id: PROJECT_ID,
    name: '金融系 Web API 改修',
    status: 'OPEN' as const,
    headcount: 2,
    startDate: '2026-10-01',
    unitPriceMin: 650_000,
    unitPriceMax: 750_000,
    prefecture: '13' as const,
    remoteMode: 'PARTIAL_REMOTE' as const,
    mustRequirements: [
      { skillName: 'Java', freeText: null, requiredYears: 5 },
      { skillName: null, freeText: '要件定義の経験', requiredYears: null },
    ],
    moreMustRequirementCount: 0,
    updatedOn: '2026-09-05',
  };
}

function hostView(overrides: Partial<HostProjectView> = {}): HostProjectView {
  return { ...sharedView(), audience: 'HOST', visibleToCount: 3, ...overrides };
}

function partnerView(overrides: Partial<PartnerProjectView> = {}): PartnerProjectView {
  return { ...sharedView(), audience: 'PARTNER', ...overrides };
}

function query(overrides: Partial<ProjectListQuery> = {}): ProjectListQuery {
  return { limit: 50, ...overrides };
}

describe('必須要件の要約（docs/04 §S-010 の「必須要件の要約」列）', () => {
  it('スキル名 + 必要年数で 1 件を表す', () => {
    expect(formatMustRequirement({ skillName: 'Java', freeText: null, requiredYears: 5 })).toBe(
      'Java 5 年以上',
    );
  });

  it('辞書名が無ければ自由記述を使う', () => {
    expect(
      formatMustRequirement({ skillName: null, freeText: '要件定義の経験', requiredYears: null }),
    ).toBe('要件定義の経験');
  });

  it('必要年数が未設定なら年数を書かない（`0 年以上` にしない）', () => {
    expect(formatMustRequirement({ skillName: 'AWS', freeText: null, requiredYears: null })).toBe(
      'AWS',
    );
  });

  it('複数件を 1 セルに畳む', () => {
    expect(formatMustRequirementSummary(sharedView().mustRequirements)).toBe(
      'Java 5 年以上、要件定義の経験',
    );
  });

  it('🔴 0 件は空欄にせず `—` を置く（docs/04 §11「`null` を空文字にしない」）', () => {
    expect(formatMustRequirementSummary([])).toBe('—');
  });
});

describe('勤務地・リモート（docs/04 §S-010 の 1 列）', () => {
  it('両方あれば `・` で連ねる', () => {
    expect(formatProjectLocation('13', 'PARTIAL_REMOTE')).toBe('東京都・一部リモート可');
  });

  it('🔴 片方しか無い行を `—` に畳まない', () => {
    expect(formatProjectLocation('13', null)).toBe('東京都');
    expect(formatProjectLocation(null, 'FULL_REMOTE')).toBe('フルリモート可');
  });

  it('両方とも未設定なら `—`', () => {
    expect(formatProjectLocation(null, null)).toBe('—');
  });
});

describe('🔴 公開先の設定状況（docs/04 §S-010。ホストのみ）', () => {
  it('0 件は「0 社に公開中」ではなく状態の語（`F-014 AC-2` の既定に気づかせる）', () => {
    expect(formatVisibilityStatus(0)).toBe('未設定');
  });

  it('1 件以上は社数を出す（3 桁区切り）', () => {
    expect(formatVisibilityStatus(3)).toBe('3 社に公開中');
    expect(formatVisibilityStatus(1_200)).toBe('1,200 社に公開中');
  });
});

describe('🔴 F-014 AC-4 / BR-07: 取引先の行に公開先の情報が入らない', () => {
  it('ホストの行には公開先の設定状況が入る', () => {
    expect(projectListRow(hostView()).visibility).toBe('3 社に公開中');
  });

  it('🔴 取引先の行の `visibility` は `null`（列そのものを描かせない）', () => {
    expect(projectListRow(partnerView()).visibility).toBeNull();
  });

  it('🔴 取引先の行に商流情報・公開先を示す値が 1 つも現れない', () => {
    const row = projectListRow(partnerView());

    expect(Object.keys(row).sort()).toEqual([
      'headcount',
      'id',
      'location',
      'moreMustRequirements',
      'mustRequirements',
      'name',
      'startDate',
      'status',
      'unitPrice',
      'updatedOn',
      'visibility',
    ]);
    expect(JSON.stringify(row)).not.toContain('endClientName');
    expect(JSON.stringify(row)).not.toContain('visibleToCount');
  });
});

describe('1 行の表示値', () => {
  it('状態・単価・開始日・募集人数・更新日を文字列にする', () => {
    const row = projectListRow(hostView());

    expect(row.status).toBe('募集中');
    expect(row.unitPrice).toBe('650,000〜750,000 円');
    expect(row.startDate).toBe('2026-10-01');
    expect(row.headcount).toBe('2 名');
    expect(row.updatedOn).toBe('2026-09-05');
  });

  it('🔴 未設定の開始日は `—`（空欄にしない）', () => {
    expect(projectListRow(hostView({ startDate: null })).startDate).toBe('—');
  });

  it('🔴 超過が 0 件なら `+0` を描かない（`null` を返す）', () => {
    expect(projectListRow(hostView()).moreMustRequirements).toBeNull();
  });

  it('超過は `+N` で示す', () => {
    expect(projectListRow(hostView({ moreMustRequirementCount: 2 })).moreMustRequirements).toBe(
      '+2',
    );
  });

  it('後任募集の状態バッジが出る（`F-045` の還流が一覧で見える）', () => {
    expect(projectListRow(hostView({ status: 'SUCCESSOR_WANTED' })).status).toBe('後任募集');
  });

  it('複数行をまとめて変換できる', () => {
    const rows = projectListRows([hostView(), hostView({ id: 'x' })] as readonly ProjectView[]);
    expect(rows).toHaveLength(2);
  });
});

describe('🔴 母集団の明示（docs/04 §3.2 項目 2 / §S-010）', () => {
  it('ホストは「自社案件 N 件」', () => {
    expect(projectPopulationLabel(null, 312)).toBe('自社案件 312 件');
  });

  it('🔴 取引先は「御社に公開された案件 N 件」（母集団の語が違う）', () => {
    expect(projectPopulationLabel('01930000-0000-7000-8000-0000000000p1', 14)).toBe(
      '御社に公開された案件 14 件',
    );
  });

  it('4 桁以上は 3 桁区切り（docs/04 §11「`999+` のような丸めをしない」）', () => {
    expect(projectPopulationLabel(null, 10_000)).toBe('自社案件 10,000 件');
  });
});

describe('🔴 検索条件を保ったリンク（ページングで条件が落ちない）', () => {
  it('条件が 1 つも無ければ素のパスを返す', () => {
    expect(projectListHref(query(), null)).toBe(PROJECT_LIST_PATH);
  });

  it('条件は固定の順序で載る（同じ条件からは必ず同じ URL）', () => {
    expect(
      projectListHref(
        query({ q: '基幹', status: 'OPEN', startFrom: '2026-10-01', prefecture: '13' }),
        null,
      ),
    ).toBe('/projects?q=%E5%9F%BA%E5%B9%B9&status=OPEN&startFrom=2026-10-01&prefecture=13');
  });

  it('次ページのリンクは条件を保ったままカーソルを足す', () => {
    expect(projectListHref(query({ status: 'FILLED' }), PROJECT_ID)).toBe(
      `/projects?status=FILLED&cursor=${PROJECT_ID}`,
    );
  });

  it('🔴 先頭ページのリンクはカーソルだけを落とす（条件は残す）', () => {
    expect(projectListHref(query({ q: '基幹', cursor: PROJECT_ID }), null)).toBe(
      '/projects?q=%E5%9F%BA%E5%B9%B9',
    );
  });

  it('`limit` は既定値と違うときだけ載せる', () => {
    expect(projectListHref(query({ limit: 50 }), null)).toBe(PROJECT_LIST_PATH);
    expect(projectListHref(query({ limit: 25 }), null)).toBe('/projects?limit=25');
  });
});

describe('🔴 絞込 0 と初回空の判定（docs/04 §10.1 `S-010`）', () => {
  it('条件が無ければ「絞り込んでいない」', () => {
    expect(hasProjectListFilters(query())).toBe(false);
  });

  it('🔴 ページングと表示件数は絞り込みではない（2 ページ目の 0 件を絞込 0 にしない）', () => {
    expect(hasProjectListFilters(query({ cursor: PROJECT_ID, limit: 25 }))).toBe(false);
  });

  it.each(['q', 'status', 'startFrom', 'prefecture'] as const)(
    '%s が指定されていれば「絞り込んでいる」',
    (key) => {
      const values = {
        q: '基幹',
        status: 'OPEN',
        startFrom: '2026-10-01',
        prefecture: '13',
      } as const;
      expect(hasProjectListFilters(query({ [key]: values[key] }))).toBe(true);
    },
  );
});
