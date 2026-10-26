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
  formatProjectRemoteMode,
  formatVisibilityStatus,
  hasProjectListFilters,
  parseHiddenProjectColumns,
  PROJECT_DEFAULT_HIDDEN_COLUMN_IDS,
  projectColumnToggleHref,
  projectListHref,
  projectListPrimaryAction,
  projectListRow,
  projectListRows,
  projectPopulationLabel,
  projectSelectHref,
  selectedProjectId,
  PROJECT_HIDEABLE_COLUMN_IDS,
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
  // 🔴 T-12-10: 公開状況（3 値）はホストの枝の必須項目である（`docs/04` §S-010）。
  return {
    ...sharedView(),
    audience: 'HOST',
    internalUnitPrice: 900_000,
    visibleToCount: 3,
    publishStatus: 'PUBLISHED',
    ...overrides,
  };
}

function partnerView(overrides: Partial<PartnerProjectView> = {}): PartnerProjectView {
  return { ...sharedView(), audience: 'PARTNER', ...overrides };
}

function query(overrides: Partial<ProjectListQuery> = {}): ProjectListQuery {
  return { limit: 50, ...overrides };
}

describe('仕入単価と卸単価', () => {
  it('ホストは内部単価と外部公開レンジを別々に表示する', () => {
    const row = projectListRow(hostView());
    expect(row.purchaseUnitPrice).toBe('90 万円');
    expect(row.unitPrice).toBe('65 万円');
    expect(projectListRow(hostView({ internalUnitPrice: null })).purchaseUnitPrice).toBe('—');
    expect(projectListRow(hostView({ internalUnitPrice: 0 })).purchaseUnitPrice).toBe('0 万円');
  });
  it('取引先の表示値に仕入単価を入れない', () => {
    const row = projectListRow(partnerView());
    expect(row.purchaseUnitPrice).toBeNull();
    expect(row.unitPrice).toBe('65 万円');
  });
});

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

// ✅ **2026-10-15: 1 列 → 2 列に分けた**（[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101)
//    の回答 C「勤務地と稼働形態を分けて `埼玉` + Badge」）。
describe('勤務地 / 稼働形態（docs/04 §S-010 の 2 列）', () => {
  it('勤務地は都道府県だけである', () => {
    expect(formatProjectLocation('13')).toBe('東京都');
  });

  it('勤務地が未設定なら `—`（空欄にしない）', () => {
    expect(formatProjectLocation(null)).toBe('—');
  });

  it('🔴 稼働形態の未設定は `null`（`—` ではない = 空の Badge を描かない）', () => {
    expect(formatProjectRemoteMode('FULL_REMOTE')).toBe('フルリモート可');
    expect(formatProjectRemoteMode(null)).toBeNull();
  });
});

describe('🔴 公開先の設定状況（docs/04 §S-010。ホストのみ。**T-12-10 で 3 値**）', () => {
  it('0 件は「0 社に公開中」ではなく状態の語（`F-014 AC-2` の既定に気づかせる）', () => {
    expect(formatVisibilityStatus(0, 'UNSET')).toBe('未設定');
  });

  it('1 件以上は社数を出す（3 桁区切り）', () => {
    expect(formatVisibilityStatus(3, 'PUBLISHED')).toBe('3 社に公開中');
    expect(formatVisibilityStatus(1_200, 'PUBLISHED')).toBe('1,200 社に公開中');
  });

  // 🔴 T-12-10（`docs/04` 改訂 14 §S-010 / `F-014 AC-9`）: 同じ 0 社を `未設定` と別の語で出す。
  it('🔴 再検査で自動解除された 0 件は `未設定` と別の語である（原因に辿り着けるようにする）', () => {
    expect(formatVisibilityStatus(0, 'AUTO_REVOKED')).toBe('公開を解除（検査）');
    expect(formatVisibilityStatus(0, 'AUTO_REVOKED')).not.toBe(
      formatVisibilityStatus(0, 'UNSET'),
    );
  });

  it('🔴 理由・原因の欄・指摘を列に出さない（1 語だけ）', () => {
    const label = formatVisibilityStatus(0, 'AUTO_REVOKED');
    expect(label).not.toContain('案件名');
    expect(label).not.toContain('外部公開用');
    expect(label.length).toBeLessThanOrEqual(12);
  });

  it('🔴 保留（上限到達）は一覧で区別しない（公開は維持されているので社数のまま）', () => {
    expect(formatVisibilityStatus(2, 'PUBLISHED')).toBe('2 社に公開中');
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
      'purchaseUnitPrice',
      // ✅ 2026-10-15: `稼働形態` を `勤務地` から分けた（`#101` の C）。**値は元から出ていたもの**であり、
      //    取引先に新しく見えるものは 1 つも無い（商流情報ではない）。
      'remoteMode',
      'startDate',
      'status',
      // 🔴 ✅ 2026-10-14: 状態の**値**（`StatusBadge` に渡す状態名）。語（`status`）と 2 本持ちに
      //    なるが、色を部品の 1 箇所で決めるための形である（`list-rows.ts` の 🔴）。
      //    **商流情報ではない**（`projects.status` は取引先にも見える列である）。
      'statusState',
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
    // ✅ 2026-10-15: 一覧の表は万円表記（`#101` の C）。詳細・承認は円のままである。
    expect(row.unitPrice).toBe('65 万円');
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

  // ✅ **2026-10-16（[Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98)）: 2 値。**
  // 🔴 `F-045` の還流で起こした案件は `OPEN`（募集中）で生まれる —— **後任募集であるという
  //    事実は `originAssignmentId` に残る**（状態からは読めなくなった）。
  it('終了の状態バッジが出る（値ではなく語で描いている）', () => {
    expect(projectListRow(hostView({ status: 'CLOSED' })).status).toBe('終了');
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
        query({
          q: '基幹',
          status: 'OPEN',
          startFrom: '2026-10-01',
          prefecture: '13',
          // ✅ 2026-10-15: 単価レンジも**位置が決まっている**（ページング・列切替・行選択の
          //    リンクはすべてこの 1 関数を通るので、ここが崩れると URL が揺れる）。
          priceMin: 600_000,
          priceMax: 800_000,
        }),
        null,
      ),
    ).toBe(
      '/projects?q=%E5%9F%BA%E5%B9%B9&status=OPEN&startFrom=2026-10-01&prefecture=13' +
        '&priceMin=600000&priceMax=800000',
    );
  });

  it('✅ 2026-10-15: 単価レンジは次ページでも落ちない（片側だけの指定も保つ）', () => {
    expect(projectListHref(query({ priceMin: 700_000 }), PROJECT_ID)).toBe(
      `/projects?priceMin=700000&cursor=${PROJECT_ID}`,
    );
    expect(projectListHref(query({ priceMax: 900_000 }), null)).toBe('/projects?priceMax=900000');
  });

  it('次ページのリンクは条件を保ったままカーソルを足す', () => {
    expect(projectListHref(query({ status: 'CLOSED' }), PROJECT_ID)).toBe(
      `/projects?status=CLOSED&cursor=${PROJECT_ID}`,
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

  // ✅ 2026-10-15: `priceMin` / `priceMax` を足した。🔴 **絞り込みの軸が増えたらここも増やす**
  //    —— 漏れると「条件に一致する案件はありません」と「まだ 1 件も登録されていません」が
  //    入れ替わる（`docs/04` §10.1 `S-010`）。
  it.each(['q', 'status', 'startFrom', 'prefecture', 'priceMin', 'priceMax'] as const)(
    '%s が指定されていれば「絞り込んでいる」',
    (key) => {
      const values = {
        q: '基幹',
        status: 'OPEN',
        startFrom: '2026-10-01',
        prefecture: '13',
        priceMin: 600_000,
        priceMax: 800_000,
      } as const;
      expect(hasProjectListFilters(query({ [key]: values[key] }))).toBe(true);
    },
  );
});

// ============================================================================
// 🔴 T-22-06: 列表示切替の URL（`docs/04` §7.1「9 列目以降は列表示切替に格納する」）
// ============================================================================
// 🔴 状態は URL だけが持つ。したがって固定するのは次の 3 点である:
//    ①既定（何も隠していない）では URL に痕跡が 1 文字も増えない
//    ②切替のリンクは**検索条件といま見ているページ（`cursor`）を保つ**
//    ③許可リスト外の値は効かない（URL 直打ちで壊れない）
describe('🔴 列表示切替の対象（格納できる列）', () => {
  it('✅ 2026-10-15: 外せるのは `必須要件の要約` と `公開先の設定状況` の 2 列である', () => {
    expect(PROJECT_HIDEABLE_COLUMN_IDS).toEqual(['mustRequirements', 'visibility']);
  });

  // ✅✅ **2026-10-15（同日の 2 回目）: 既定で格納する列は無くなった**—— [Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101)
  //    の回答が **C「値の表記を短くする」**だったので、幅を値側で作り、列を格納しなくても入るようになった。
  it('🔴 既定で格納する列は 1 つも無い（格納の仕組み自体は残っている）', () => {
    expect(PROJECT_DEFAULT_HIDDEN_COLUMN_IDS).toEqual([]);
  });

  it('🔴 URL の値を読む（許可リスト外は捨てる）', () => {
    // 🔴 **キーが無い ＝ 既定**（いまの既定は「1 つも隠さない」）。
    expect(parseHiddenProjectColumns(undefined)).toEqual([]);
    // 🔴 **空文字 ＝ 利用者が全部表示に戻した**（既定と区別する仕組みは残す。次に既定を置くときに要る）。
    expect(parseHiddenProjectColumns('')).toEqual([]);
    expect(parseHiddenProjectColumns('visibility')).toEqual(['visibility']);
    // 列として実在しない id（`unitPrice` は `hideable` ではない）は効かない。
    expect(parseHiddenProjectColumns('unitPrice')).toEqual([]);
  });
});

describe('🔴 列表示切替のリンク（条件とページの位置を保つ）', () => {
  it('🔴 既定の見え方の URL は素のパスである（既定からの差分だけが載る）', () => {
    expect(projectListHref(query(), null)).toBe(PROJECT_LIST_PATH);
    expect(projectListHref(query(), null, PROJECT_DEFAULT_HIDDEN_COLUMN_IDS)).toBe(PROJECT_LIST_PATH);
  });

  it('✅✅ 2026-10-15（同日の 2 回目）: 既定が空に戻ったので、全部表示は素のパスである', () => {
    expect(projectListHref(query(), null, [])).toBe(PROJECT_LIST_PATH);
  });

  it('隠す列は最後に載る（`hide=` は条件・カーソルの後ろ）', () => {
    expect(projectListHref(query({ status: 'OPEN' }), PROJECT_ID, ['visibility'])).toBe(
      `/projects?status=OPEN&cursor=${PROJECT_ID}&hide=visibility`,
    );
  });

  it('🔴 表示中の列を押すと「隠す」URL になる（条件と `cursor` は保つ）', () => {
    expect(
      projectColumnToggleHref(query({ q: '基幹', cursor: PROJECT_ID }), PROJECT_ID, [], 'visibility'),
    ).toBe(`/projects?q=%E5%9F%BA%E5%B9%B9&cursor=${PROJECT_ID}&hide=visibility`);
  });

  it('🔴 隠している列を押すと「戻す」URL になる（その列が `hide` から消える）', () => {
    // ✅✅ 2026-10-15（同日の 2 回目）: 既定が空なので、最後の 1 列を戻すと素のパスに戻る。
    expect(projectColumnToggleHref(query({ q: '基幹' }), null, ['visibility'], 'visibility')).toBe(
      '/projects?q=%E5%9F%BA%E5%B9%B9',
    );
    // 2 列隠している状態から 1 列だけ戻すと、もう片方は残る。
    expect(
      projectColumnToggleHref(query({ q: '基幹' }), null, PROJECT_HIDEABLE_COLUMN_IDS, 'visibility'),
    ).toBe('/projects?q=%E5%9F%BA%E5%B9%B9&hide=mustRequirements');
  });

  it('🔴 ページングのリンクでも列の表示状態が落ちない', () => {
    expect(projectListHref(query({ q: '基幹' }), PROJECT_ID, ['visibility'])).toBe(
      `/projects?q=%E5%9F%BA%E5%B9%B9&cursor=${PROJECT_ID}&hide=visibility`,
    );
    // 先頭ページへ戻すリンクはカーソルだけを落とす（列の状態は残る）。
    expect(projectListHref(query({ q: '基幹', cursor: PROJECT_ID }), null, ['visibility'])).toBe(
      '/projects?q=%E5%9F%BA%E5%B9%B9&hide=visibility',
    );
  });
});

// ============================================================================
// 🔴 SP-22 段④: 帯の primary と、副カラムで開く行
// ============================================================================
describe('🔴 帯の primary（docs/04 §S-010「案件を登録（primary、ホストのみ）」/ §7.6）', () => {
  it('登録できるロールには `S-012` への `ACTION` を返す', () => {
    expect(projectListPrimaryAction(true)).toEqual({
      labelKey: 'projects.list.register',
      href: '/projects/new',
      kind: 'ACTION',
      // 2026-10-16: 人間の明示指示「＋アイコンもつけて」。
      icon: 'plus',
    });
  });

  it('🔴 取引先・`VIEWER` には `null` を返す（押しても戻されるだけの導線を描かない）', () => {
    expect(projectListPrimaryAction(false)).toBeNull();
  });

  it('🔴 `kind` は `ACTION` である（帯の `canAct` で落ちる側に倒す。`NAVIGATION` にしない）', () => {
    expect(projectListPrimaryAction(true)?.kind).toBe('ACTION');
  });
});

describe('🔴 副カラムで開く行（`?selected=`。SP-22 段④）', () => {
  const rowA = projectListRow(hostView() as ProjectView);
  const rowB = projectListRow(hostView({ id: '01930000-0000-7000-8000-0000000000c2' }) as ProjectView);
  const rows = [rowA, rowB];

  it('指定が無ければ先頭行（パネルを空で置かない）', () => {
    expect(selectedProjectId(undefined, rows)).toBe(rowA.id);
  });

  it('いまのページに在る ID はそのまま使う', () => {
    expect(selectedProjectId(rowB.id, rows)).toBe(rowB.id);
  });

  it('🔴 いまのページに無い ID は先頭行に落とす（URL 直打ちでパネルが空にならない）', () => {
    expect(selectedProjectId('01930000-0000-7000-8000-0000000000ff', rows)).toBe(rowA.id);
    expect(selectedProjectId('not-a-uuid', rows)).toBe(rowA.id);
  });

  it('🔴 行が 1 件も無いページでは `null`（存在しない行を指さない）', () => {
    expect(selectedProjectId(rowA.id, [])).toBeNull();
    expect(selectedProjectId(undefined, [])).toBeNull();
  });

  it('同じキーが 2 つ来たら先頭だけを読む（URL 直打ちで壊れない）', () => {
    expect(selectedProjectId([rowB.id, rowA.id], rows)).toBe(rowB.id);
  });

  it('🔴 開く URL は検索条件・ページの位置・列の表示状態を保つ', () => {
    expect(projectSelectHref(query({ q: '基幹' }), PROJECT_ID, ['visibility'], rowB.id)).toBe(
      `/projects?q=%E5%9F%BA%E5%B9%B9&cursor=${PROJECT_ID}&hide=visibility&selected=${rowB.id}`,
    );
  });

  it('🔴 列の出し入れでもパネルが閉じない（`selected` を引き継ぐ）', () => {
    expect(projectColumnToggleHref(query(), null, [], 'visibility', rowA.id)).toBe(
      `/projects?hide=visibility&selected=${rowA.id}`,
    );
  });

  it('🔴 `selected` を渡さなければ URL に 1 文字も足さない（既定の URL を汚さない）', () => {
    expect(projectListHref(query(), null, PROJECT_DEFAULT_HIDDEN_COLUMN_IDS)).toBe(PROJECT_LIST_PATH);
    // ✅✅ 2026-10-15（同日の 2 回目）: 既定（空）から `visibility` を押すと「隠す」側になる。
    expect(
      projectColumnToggleHref(query(), null, PROJECT_DEFAULT_HIDDEN_COLUMN_IDS, 'visibility'),
    ).toBe('/projects?hide=visibility');
  });
});
