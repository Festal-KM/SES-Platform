// apps/web/app/(main)/projects/[id]/candidates/candidate-screen.render.test.tsx
// `CandidateScreen`（`S-016`）の状態別描画テスト。T-08-05。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//    ①匿名候補の行に実名・稼働状況が描かれず、表示名は「共有候補」の一語だけ（`F-017 AC-1`）
//    ②取引先視点で種別列そのものが消える（`docs/04` §S-016 権限差分 / `F-017 AC-5`）
//    ③スコア・順位・重みに相当する入力欄・列が無い（`F-017 AC-7` / `F-009 AC-2` / `F-030 AC-4`）
//    ④匿名候補の件数を別に描かない（総件数の 1 行だけ）
//    ⑤右パネルは初期状態で「行を選ぶと…」だけであり、提案依頼・提案作成のボタンが無い（提案作成は SP-09 送り）
//    ⑥🔴 T-08-06: 共有候補の右パネル（`AnonymousDetail`）の提案依頼フォームに**単価に関する入力欄が無い**
//      （`F-017 AC-4` / `BR-58`）。入力はメッセージと期限の 2 つだけ。`canRequest=false` なら導線そのものが無い
//      （`docs/04` §S-016 権限差分）。5 項目以外の値（実名・所属・社内 ID）はどの枝でも描かれない。
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（新規依存を増やさない。他の render テストと同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CandidateRowView } from '../../../../../lib/candidates/list-rows';
import type { EngineerListFilterValues } from '../../../engineers/engineer-ledger-screen';
import {
  AnonymousDetail,
  CandidateScreen,
  type CandidateRequestProps,
  type CandidateScreenMessages,
  type CandidateScreenProps,
} from './candidate-screen';

const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const ENGINEER = '01930000-0000-7000-8000-0000000000e1';
const REF = 'yM2RkvynFUQclwUcbLMLXw';
const SKILL_JAVA = '01930000-0000-7000-8000-0000000000a1';

const ownRow: CandidateRowView = {
  kind: 'OWN',
  key: ENGINEER,
  id: ENGINEER,
  displayName: '架空 太郎',
  skills: ['Java', 'AWS', 'React'],
  moreSkills: '+2',
  years: '7 年',
  unitPrice: '600,000〜750,000 円',
  availableFrom: '2026-11-01',
  location: '東京都・一部リモート可',
  availabilityStatus: '稼働中',
  updatedOn: '2026-09-05',
};

const anonymousRow: CandidateRowView = {
  kind: 'ANONYMOUS',
  key: REF,
  candidateRef: REF,
  skills: ['TypeScript', 'Go', 'AWS'],
  moreSkills: '+2',
  allSkills: ['TypeScript', 'Go', 'AWS', 'Docker', 'Terraform'],
  years: '5〜10 年',
  unitPrice: '60〜70 万円',
  availableFrom: '翌月',
  location: '東京都・一部リモート可',
  updatedOn: '2026-09-08',
};

const messages: CandidateScreenMessages = {
  lead: 'この一覧には自社台帳の人材と共有候補が並びます。',
  sectionProject: '対象案件の要件',
  sectionDetail: '選択した候補',
  projectOpen: '案件詳細を開く',
  requirementHeadingMust: '必須要件',
  requirementHeadingNice: '尚可要件',
  requirementEmptyMust: '必須要件はありません。',
  requirementEmptyNice: '尚可要件はありません。',
  requirementColumnRequirement: '要件',
  requirementColumnYears: '年数',
  populationLabel: '候補 2 件（自社台帳と共有候補）',
  orderNote: '更新日の新しい順に表示しています。',
  anonymousFilterNote: '共有候補には開示 5 項目の条件だけが丸めた区分で効きます。',
  searchLegend: '検索条件',
  searchQ: 'フリーワード',
  searchSkills: 'スキル',
  searchSkillsHint: '辞書から選択します。',
  searchSkillMode: 'スキルの組み合わせ',
  searchYearsMin: '経験年数（この年数以上）',
  searchPriceMin: '単価（下限）',
  searchPriceMax: '単価（上限）',
  searchAvailableBy: '稼働可能時期（この日まで）',
  searchPrefecture: '勤務地（都道府県）',
  searchRemote: 'リモート可否',
  searchAvailability: '稼働状況',
  searchOnlyInTime: '開始日に間に合う人だけ',
  searchOnlyCommutable: '通勤可能な人だけ',
  searchCheckboxNote: 'この 2 つは既定でオフです。',
  searchSubmit: '検索',
  searchReset: '案件の要件に戻す',
  activeFiltersTitle: 'いま効いている条件',
  removeFilterSuffix: 'を外す',
  columnKind: '種別',
  columnName: '表示名',
  columnSkills: 'スキル',
  columnYears: '経験年数',
  columnUnitPrice: '単価レンジ',
  columnAvailability: '稼働可能時期',
  columnLocation: '勤務地・リモート',
  columnUpdatedOn: '更新日',
  kindOwn: '自社',
  kindAnonymous: '共有候補',
  emptyTitle: '候補になる人材が登録されていません。',
  emptyLead: '人材を登録すると、この一覧から探せるようになります。',
  emptyRegister: '人材を登録',
  emptyCheckboxNotice: null,
  detailSelect: '行を選ぶと、ここに候補の詳細を表示します。',
  detailOpenEngineer: '人材の詳細を開く',
  detailProposalComingSoon: '提案の作成は後続のリリース。',
  detailAnonymousNote: '共有候補は丸めた 5 項目のみが開示されています。',
  requestOpen: '提案依頼を送る',
  requestTitle: '提案依頼',
  requestLead: '取引先が応諾すると提案（下書き）が作成されます。',
  requestMessageLabel: '依頼メッセージ',
  requestMessageHint: '単価・エンド企業名は書けません。',
  requestExpiresAtLabel: '返答期限',
  requestExpiresAtHint: '最長 30 日。',
  requestSubmit: '依頼を送る',
  requestSubmitting: '送信しています…',
  requestCancel: 'やめる',
  requestSent: '提案依頼を送りました。',
  requestOpenList: '提案依頼の一覧を開く',
  requestErrorNotFound: '共有が解除されたか、一覧が古くなっています。',
  requestErrorExpiresAt: '返答期限は現在より後、かつ 30 日以内。',
  requestErrorCommerce: '単価またはエンド企業名と読める記述が含まれています。',
  requestErrorAlreadyExists: '既に提案依頼があります。',
  requestErrorGeneric: '提案依頼を送れませんでした。',
  fieldSkills: 'スキル',
  fieldYears: '経験年数',
  fieldPrice: '単価レンジ',
  fieldAvailability: '稼働可能時期',
  fieldLocation: '勤務地・リモート可否',
  fieldUpdatedOn: '更新日',
  fieldAvailabilityStatus: '稼働状況',
  valueNone: '—',
  nextPage: '次のページ',
  firstPage: '最初のページに戻る',
};

const filters: EngineerListFilterValues = {
  q: '',
  skills: [SKILL_JAVA],
  skillMode: 'AND',
  yearsMin: '',
  priceMin: '600000',
  priceMax: '800000',
  availableBy: '2026-11-01',
  prefecture: '13',
  remote: '',
  availability: '',
  onlyInTime: false,
  onlyCommutable: false,
};

const request: CandidateRequestProps = {
  canRequest: true,
  unavailableMessage: null,
  expiry: { defaultDay: '2026-09-22', minDay: '2026-09-15', maxDay: '2026-10-14' },
  listHref: '/proposal-requests',
  showListLink: true,
};

function render(overrides: Partial<CandidateScreenProps> = {}): string {
  const props: CandidateScreenProps = {
    projectId: PROJECT,
    projectName: '架空案件',
    headlineRows: [{ key: 'status', label: '状態', value: '募集中' }],
    conditionRows: [{ key: 'unitPrice', label: '単価レンジ', value: '600,000〜800,000 円' }],
    mustRows: [{ key: 'MUST-0', requirement: 'Java', years: '5 年' }],
    niceRows: [],
    rows: [ownRow, anonymousRow],
    filters,
    skillOptions: [{ value: SKILL_JAVA, label: 'Java' }],
    skillModeOptions: [
      { value: 'AND', label: 'すべて持つ' },
      { value: 'OR', label: 'いずれかを持つ' },
    ],
    prefectureOptions: [
      { value: '', label: 'すべて' },
      { value: '13', label: '東京都' },
    ],
    remoteOptions: [{ value: '', label: 'すべて' }],
    availabilityOptions: [{ value: '', label: 'すべて' }],
    activeFilters: [],
    showKindColumn: true,
    resetHref: `/projects/${PROJECT}/candidates`,
    registerHref: '/engineers/new',
    nextPageHref: null,
    firstPageHref: null,
    request,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(CandidateScreen, props));
}

/** 共有候補の右パネル（行の選択後にしか現れないため、直接描く）。 */
function renderAnonymousDetail(overrides: Partial<CandidateRequestProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AnonymousDetail, {
      row: anonymousRow as Extract<CandidateRowView, { readonly kind: 'ANONYMOUS' }>,
      projectId: PROJECT,
      request: { ...request, ...overrides },
      messages,
    }),
  );
}

describe('🔴 F-017 AC-1: 匿名候補の行に実名・稼働状況が無く、表示名は「共有候補」の一語', () => {
  it('匿名候補の行が種別「共有候補」で描かれ、5 項目（丸め後）だけを出す', () => {
    const html = render();
    expect(html).toContain(`data-testid="candidate-list-row-${REF}"`);
    expect(html).toContain('data-candidate-kind="ANONYMOUS"');
    expect(html).toMatch(new RegExp(`data-testid="candidate-list-name-${REF}"[^>]*>共有候補<`));
    expect(html).toContain('5〜10 年');
    expect(html).toContain('60〜70 万円');
    expect(html).toContain('翌月');
    // 匿名候補の行に稼働状況（自社候補にだけ在る値）が現れない。「稼働中」は自社の行の右パネル用であり、
    // 初期状態（未選択）ではどの行にも描かれない。
    expect(html).not.toContain('稼働中');
  });

  it('自社候補の行は実名で描かれ、匿名候補の行に実名が混ざらない', () => {
    const html = render();
    expect(html).toMatch(new RegExp(`data-testid="candidate-list-name-${ENGINEER}"[^>]*>架空 太郎<`));
    expect(html.match(/架空 太郎/g)?.length).toBe(1);
  });

  it('🔴 匿名候補だけの一覧に、氏名・稼働状況・人材詳細への導線が 1 つも無い', () => {
    const html = render({ rows: [anonymousRow] });
    expect(html).not.toContain('架空 太郎');
    expect(html).not.toContain('/engineers/');
    expect(html).not.toContain('稼働中');
    expect(html).toContain('共有候補');
  });
});

describe('🔴 F-017 AC-5: 取引先視点では種別列そのものが消える', () => {
  it('showKindColumn=false で種別の見出しとセルが描かれない', () => {
    const html = render({
      showKindColumn: false,
      rows: [ownRow],
      messages: { ...messages, anonymousFilterNote: null },
    });
    expect(html).not.toContain('>種別<');
    expect(html).not.toContain('candidate-list-kind-');
  });

  it('ホスト視点では種別列がある', () => {
    const html = render();
    expect(html).toContain('>種別<');
    expect(html).toContain(`data-testid="candidate-list-kind-${ENGINEER}"`);
    expect(html).toMatch(new RegExp(`data-testid="candidate-list-kind-${REF}"[^>]*>共有候補<`));
  });
});

describe('🔴 F-017 AC-7 / F-009 AC-2 / F-030 AC-4: スコア・順位・重みが無い', () => {
  it('検索フォームの入力名は S-005 と同じ 12 個であり、重みに相当する入力が無い', () => {
    const html = render();
    const names = [...html.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
    expect([...new Set(names)]).toEqual(
      [
        'availability',
        'availableBy',
        'onlyCommutable',
        'onlyInTime',
        'prefecture',
        'priceMax',
        'priceMin',
        'q',
        'remote',
        'skillMode',
        'skills',
        'yearsMin',
      ].sort(),
    );
    for (const word of ['weight', 'score', 'rank', 'スコア', '順位', '重み', '一致度']) {
      expect(html).not.toContain(word);
    }
  });

  it('並び順の説明が 1 行だけ描かれ、母集団は混在した総件数の 1 行だけ（共有候補の件数を別に出さない）', () => {
    const html = render();
    expect(html).toContain('data-testid="candidate-list-order-note"');
    expect(html).toContain('候補 2 件（自社台帳と共有候補）');
    expect(html).not.toMatch(/共有候補\s*\d+\s*件/);
  });
});

describe('右パネル・空状態・導線', () => {
  it('初期状態では「行を選ぶと…」だけで、提案依頼・提案作成のボタンが無い', () => {
    const html = render();
    expect(html).toContain('data-testid="candidate-detail-empty"');
    expect(html).not.toContain('candidate-detail-anonymous');
    expect(html).not.toContain('提案依頼を送る');
    expect(html).not.toContain('提案を作成');
  });

  it('ホストにだけ共有候補への条件の効き方の注記が出る', () => {
    expect(render()).toContain('data-testid="candidate-list-anonymous-filter-note"');
    expect(render({ messages: { ...messages, anonymousFilterNote: null } })).not.toContain(
      'candidate-list-anonymous-filter-note',
    );
  });

  it('初回空は登録導線つき、絞込 0 件は条件の解除導線つき', () => {
    const initial = render({ rows: [] });
    expect(initial).toContain('data-testid="candidate-list-empty"');
    expect(initial).toContain('data-testid="candidate-list-register"');
    expect(initial).not.toContain('candidate-list-table');

    const filtered = render({
      rows: [],
      activeFilters: [{ key: `skill-${SKILL_JAVA}`, label: 'スキル: Java', href: `/projects/${PROJECT}/candidates` }],
      messages: { ...messages, emptyRegister: null, emptyTitle: '条件に一致する候補はいません。' },
    });
    expect(filtered).toContain('条件に一致する候補はいません。');
    expect(filtered).not.toContain('candidate-list-register');
    expect(filtered).toContain(`data-testid="candidate-list-remove-filter-skill-${SKILL_JAVA}"`);
  });

  it('「案件の要件に戻す」は素の URL、ページングは検索条件つきの URL を指す', () => {
    const html = render({
      nextPageHref: `/projects/${PROJECT}/candidates?prefecture=13&cursor=0%3A2026-09-08%3A${REF}`,
      firstPageHref: `/projects/${PROJECT}/candidates?prefecture=13`,
    });
    expect(html).toContain(`href="/projects/${PROJECT}/candidates"`);
    expect(html).toContain('data-testid="candidate-list-next"');
    expect(html).toContain('data-testid="candidate-list-first"');
    // 🔴 「全 N ページ中 M ページ目」を描かない（docs/05 §4.8）。
    expect(html).not.toMatch(/ページ目/);
  });

  it('案件の要件サマリが折りたたまれずに描かれ、案件詳細への導線がある', () => {
    const html = render();
    expect(html).toContain('data-testid="candidate-project-summary"');
    expect(html).toContain('data-testid="candidate-project-requirements-must"');
    expect(html).toContain('>Java<');
    expect(html).toContain(`href="/projects/${PROJECT}"`);
    expect(html).not.toContain('<details');
  });
});

describe('🔴 T-08-06: 共有候補の右パネルと提案依頼の導線（F-018 / F-017 AC-4 / docs/04 §S-016 権限差分）', () => {
  it('発行できるロールには「提案依頼を送る」が描かれ、実名・所属会社名・社内 ID・単価の入力欄は無い', () => {
    const html = renderAnonymousDetail();
    expect(html).toContain('data-testid="candidate-request-open"');
    expect(html).toContain('>提案依頼を送る<');
    // 5 項目（丸め後）は全部読める（判断材料を隠さない。CLAUDE.md §13.3）。
    for (const value of ['TypeScript / Go / AWS / Docker / Terraform', '5〜10 年', '60〜70 万円', '翌月', '東京都・一部リモート可']) {
      expect(html).toContain(value);
    }
    // 🔴 実名・稼働状況・人材詳細への導線が無い（型に無いので描けない）。
    expect(html).not.toContain('架空 太郎');
    expect(html).not.toContain('稼働中');
    expect(html).not.toContain('/engineers/');
    // 🔴 初期状態（IDLE）ではフォームも入力欄も無い。
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<textarea');
  });

  it('🔴 canRequest=false（VIEWER / 停止中）では導線そのものが無く、理由だけが描かれる', () => {
    const html = renderAnonymousDetail({ canRequest: false, unavailableMessage: '営業担当・管理者のみ。' });
    expect(html).not.toContain('candidate-request-open');
    expect(html).not.toContain('提案依頼を送る');
    expect(html).toContain('data-testid="candidate-request-unavailable"');
    expect(html).toContain('営業担当・管理者のみ。');
  });

  it('🔴 取引先（unavailableMessage=null）には導線も理由も描かれない', () => {
    const html = renderAnonymousDetail({ canRequest: false, unavailableMessage: null });
    expect(html).not.toContain('candidate-request-open');
    expect(html).not.toContain('candidate-request-unavailable');
    expect(html).toContain('data-testid="candidate-detail-anonymous"');
  });

  it('S-017 への導線はホスト（showListLink）にだけ出る', () => {
    expect(render()).toContain('data-testid="candidate-list-open-requests"');
    expect(render({ request: { ...request, showListLink: false } })).not.toContain('candidate-list-open-requests');
  });

  it('文言に単価の交渉・見積・値引きに相当する語が無い（F-017 AC-4 / BR-58）', () => {
    const html = renderAnonymousDetail();
    for (const word of ['希望単価', '見積', '値引', '確定単価', 'name="unitPrice"', 'name="price"']) {
      expect(html).not.toContain(word);
    }
  });
});
