// apps/web/app/(main)/engineers/engineer-ledger-screen.render.test.tsx
// `EngineerLedgerScreen`（`S-005`）の状態別描画テスト。T-05-09 → T-06-04（検索条件）。
//
// 🔴 なぜこの粒度で要るか（`partner-companies-screen.render.test.tsx` と同じ理由）:
//    ①**取引先視点で所属区分の列が消えること**（docs/04 §S-005 権限差分）と
//    ②**`VIEWER` に登録導線が無いこと**は、E2E の seed 依存を避けてここで固定する。
//    ③**スコア・順位・重みに相当する表示項目が無いこと**（`F-009 AC-2`）と
//    ④**「他に N 件」「N ページ中 M ページ目」を描かないこと**（docs/05 §4.8）と
//    ⑤**絞り込みチェックボックス 2 種が既定オフで描かれること**（`F-009 AC-5`）と
//    ⑥**重み設定の入力欄が 1 つも無いこと**（`F-030 AC-4`）は
//    「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  EngineerActiveFilterView,
  EngineerListRowView,
} from '../../../lib/engineers/list-rows';
import {
  EngineerLedgerScreen,
  type EngineerLedgerScreenMessages,
  type EngineerListFilterValues,
} from './engineer-ledger-screen';

const ENGINEER_A = '01930000-0000-7000-8000-0000000000e1';
const ENGINEER_B = '01930000-0000-7000-8000-0000000000e2';
const SKILL_JAVA = '01930000-0000-7000-8000-0000000000a1';

function row(overrides: Partial<EngineerListRowView> = {}): EngineerListRowView {
  return {
    id: ENGINEER_A,
    displayName: '架空 太郎',
    ownership: '自社',
    skills: ['Java', 'AWS', 'React'],
    moreSkills: '+2',
    unitPrice: '600,000〜750,000 円',
    availableFrom: '2026-11-01',
    location: '東京都・一部リモート可',
    availability: '稼働中',
    updatedOn: '2026-09-05',
    ...overrides,
  };
}

const messages: EngineerLedgerScreenMessages = {
  populationLabel: '自社台帳 2 件',
  partnerScopeNotice: null,
  orderNote: '更新日の新しい順に表示しています。',
  searchComingSoon: '列の表示切替は後続のリリースで追加されます。',
  experienceComingSoon: '「経験年数」は登録されたスキルの経験年数で判定します。',
  searchLegend: '検索条件',
  searchQ: 'フリーワード（氏名・希望条件）',
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
  searchClear: '条件をクリア',
  activeFiltersTitle: 'いま効いている条件',
  removeFilterSuffix: 'を外す',
  register: '人材を登録',
  readOnlyNote: '閲覧のみの権限のため、人材の登録は行えません。',
  columnName: '氏名',
  columnOwnership: '所属区分',
  columnSkills: '主要スキル',
  columnUnitPrice: '単価レンジ',
  columnAvailableFrom: '稼働可能時期',
  columnLocation: '勤務地・リモート',
  columnAvailability: '稼働状況',
  columnUpdatedOn: '更新日',
  emptyTitle: 'まだ人材が登録されていません。',
  emptyLead: '人材を登録すると、この一覧から探せるようになります。',
  emptyCheckboxNotice: null,
  nextPage: '次のページ',
  firstPage: '最初のページに戻る',
  valueNone: '—',
};

const filters: EngineerListFilterValues = {
  q: '',
  skills: [],
  skillMode: 'AND',
  yearsMin: '',
  priceMin: '',
  priceMax: '',
  availableBy: '',
  prefecture: '',
  remote: '',
  availability: '',
  onlyInTime: false,
  onlyCommutable: false,
};

const skillOptions = [{ value: SKILL_JAVA, label: 'Java' }];
const skillModeOptions = [
  { value: 'AND', label: '指定したスキルをすべて持つ' },
  { value: 'OR', label: '指定したスキルのいずれかを持つ' },
];
const prefectureOptions = [
  { value: '', label: 'すべて' },
  { value: '13', label: '東京都' },
];
const remoteOptions = [
  { value: '', label: 'すべて' },
  { value: 'FULL_REMOTE', label: 'フルリモート可' },
];
const availabilityOptions = [
  { value: '', label: 'すべて' },
  { value: 'STANDBY', label: '待機中' },
];

const activeFilter: EngineerActiveFilterView = {
  key: `skill-${SKILL_JAVA}`,
  label: 'スキル: Java',
  href: '/engineers',
};

type Props = Parameters<typeof EngineerLedgerScreen>[0];

function render(overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(EngineerLedgerScreen, {
      rows: [row(), row({ id: ENGINEER_B, displayName: '架空 花子' })],
      filters,
      skillOptions,
      skillModeOptions,
      prefectureOptions,
      remoteOptions,
      availabilityOptions,
      activeFilters: [],
      showOwnershipColumn: true,
      canRegister: true,
      nextPageHref: null,
      firstPageHref: null,
      messages,
      ...overrides,
    }),
  );
}

describe('一覧の骨格（docs/04 §S-005）', () => {
  it('母集団・並び順の説明・テーブルを描く', () => {
    const html = render();
    expect(html).toContain('engineer-list-population');
    expect(html).toContain('自社台帳 2 件');
    expect(html).toContain('engineer-list-order-note');
    expect(html).toContain('engineer-list-table');
  });

  it('🔴 行から詳細（`S-006`）へ辿れる（閲覧の記録は遷移先が書く）', () => {
    const html = render();
    expect(html).toContain(`href="/engineers/${ENGINEER_A}"`);
    expect(html).toContain(`href="/engineers/${ENGINEER_B}"`);
  });

  it('🔴 超過スキルは `+N`。0 件なら描かない', () => {
    expect(render()).toContain('+2');
    expect(render({ rows: [row({ moreSkills: null })] })).not.toContain(
      `engineer-list-more-skills-${ENGINEER_A}`,
    );
  });

  it('スキルが 1 件も無い行は `—` を出す（空欄にしない）', () => {
    expect(render({ rows: [row({ skills: [], moreSkills: null })] })).toContain('—');
  });

  it('🔴 スコア・順位・重みに相当する表示項目を持たない（`F-009 AC-2`）', () => {
    const html = render();
    for (const word of ['スコア', '順位', '重み', '一致度']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });

  it('🔴 「他に N 件」「N ページ中 M ページ目」を描かない（docs/05 §4.8）', () => {
    const html = render({
      nextPageHref: `/engineers?cursor=${ENGINEER_B}`,
      firstPageHref: '/engineers',
    });
    expect(html).not.toContain('ページ目');
    expect(html).not.toContain('他に');
  });

  it('未実装（列の表示切替）と経験年数の意味を隠さずに書く', () => {
    const html = render();
    expect(html).toContain('engineer-list-search-coming-soon');
    expect(html).toContain('engineer-list-experience-coming-soon');
  });
});

describe('🔴 検索条件（docs/04 §S-005 セクション 1・2 / `F-009`）', () => {
  it('検索フォームを描き、条件は GET で自画面に送る（URL に反映される）', () => {
    const html = render();
    expect(html).toContain('engineer-list-filters');
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/engineers"');
  });

  it.each([
    ['q', 'engineer-list-filter-q'],
    ['skills', 'engineer-list-filter-skills'],
    ['skillMode', 'engineer-list-filter-skill-mode'],
    ['yearsMin', 'engineer-list-filter-years-min'],
    ['priceMin', 'engineer-list-filter-price-min'],
    ['priceMax', 'engineer-list-filter-price-max'],
    ['availableBy', 'engineer-list-filter-available-by'],
    ['prefecture', 'engineer-list-filter-prefecture'],
    ['remote', 'engineer-list-filter-remote'],
    ['availability', 'engineer-list-filter-availability'],
  ])('%s の入力欄がある（モバイルでも省略しない）', (_name, testId) => {
    expect(render()).toContain(testId);
  });

  it('🔴 絞り込みチェックボックス 2 種は既定オフで描かれる（`F-009 AC-5`）', () => {
    const html = render();
    expect(html).toContain('engineer-list-filter-only-in-time');
    expect(html).toContain('engineer-list-filter-only-commutable');
    // `renderToStaticMarkup` は `checked` を属性として出す。既定では 1 つも出ない。
    expect(html).not.toContain('checked=""');
    // 🔴 オフのとき何が起きるかを画面に書く（`docs/02` A-03）。
    expect(html).toContain('engineer-list-checkbox-note');
  });

  it('オンにした状態は `defaultChecked` で戻る（URL の状態がフォームに反映される）', () => {
    const html = render({ filters: { ...filters, onlyInTime: true } });
    expect(html).toContain('checked=""');
  });

  it('🔴 重み設定の入力欄を 1 つも置かない（`F-030 AC-4`。`S-040` は Phase 2）', () => {
    const html = render();
    for (const name of ['weight', 'score', 'rank']) {
      expect(html, `${name} の入力欄がある`).not.toContain(`name="${name}"`);
    }
  });

  it('条件が効いているときだけ「条件をクリア」を出す', () => {
    expect(render()).not.toContain('engineer-list-clear');
    expect(render({ activeFilters: [activeFilter] })).toContain('engineer-list-clear');
  });
});

describe('🔴 絞込 0 件（docs/04 §10.1 `S-005`。初回空とは別物）', () => {
  it('効いている条件を 1 つずつ外せる導線を出す', () => {
    const html = render({
      rows: [],
      activeFilters: [activeFilter],
      messages: { ...messages, emptyTitle: '条件に一致する人材はいません。' },
    });
    expect(html).toContain('engineer-list-active-filters');
    expect(html).toContain(`engineer-list-remove-filter-skill-${SKILL_JAVA}`);
    expect(html).toContain('スキル: Java');
    expect(html).toContain('を外す');
  });

  it('🔴 チェックボックスがオンのときは、その注意も出す', () => {
    const html = render({
      rows: [],
      activeFilters: [activeFilter],
      messages: {
        ...messages,
        emptyCheckboxNotice: '「開始日に間に合う人だけ」がオンです。',
      },
    });
    expect(html).toContain('engineer-list-empty-checkbox-notice');
  });

  it('初回空（条件なし）では条件の一覧も注意も出さない', () => {
    const html = render({ rows: [] });
    expect(html).not.toContain('engineer-list-active-filters');
    expect(html).not.toContain('engineer-list-empty-checkbox-notice');
  });
});

describe('🔴 権限差分（docs/04 §S-005）', () => {
  it('`VIEWER` には登録導線を出さず、代わりに誰ができるかを書く', () => {
    const html = render({ canRegister: false });
    expect(html).not.toContain('href="/engineers/new"');
    expect(html).toContain('engineer-list-read-only-note');
  });

  it('登録できるロールには `S-007` への導線を出す', () => {
    expect(render()).toContain('href="/engineers/new"');
  });

  it('🔴 取引先には所属区分の列を出さない（全件が自社であるため意味がない）', () => {
    const html = render({
      showOwnershipColumn: false,
      messages: { ...messages, partnerScopeNotice: 'この一覧には、御社が登録した人材のみが表示されます。' },
    });
    expect(html).not.toContain('所属区分');
    expect(html).toContain('engineer-list-partner-scope-notice');
  });

  it('ホストには見える範囲の説明（取引先向け 1 行）を出さない', () => {
    expect(render()).not.toContain('engineer-list-partner-scope-notice');
  });
});

describe('ページング（カーソル方式。docs/05 §6.1）', () => {
  it('🔴 次ページのリンクは検索条件を保った URL である（`engineerListHref` が組み立てる）', () => {
    const html = render({ nextPageHref: `/engineers?q=Java&cursor=${ENGINEER_B}` });
    expect(html).toContain(`href="/engineers?q=Java&amp;cursor=${ENGINEER_B}"`);
  });

  it('1 ページ目では「最初のページに戻る」を出さない', () => {
    expect(render({ nextPageHref: `/engineers?cursor=${ENGINEER_B}` })).not.toContain(
      'engineer-list-first',
    );
  });

  it('2 ページ目以降では「最初のページに戻る」を出す', () => {
    expect(render({ firstPageHref: '/engineers?q=Java' })).toContain('engineer-list-first');
  });

  it('1 ページに収まるならページング領域ごと出さない', () => {
    expect(render()).not.toContain('engineer-list-paging');
  });
});

describe('🔴 初回空（docs/04 §10.1 `S-005`）', () => {
  it('0 件なら空状態と登録導線を出す（テーブルは描かない）', () => {
    const html = render({ rows: [] });
    expect(html).toContain('engineer-list-empty');
    expect(html).toContain('まだ人材が登録されていません。');
    expect(html).not.toContain('engineer-list-table');
    expect(html).toContain('href="/engineers/new"');
  });

  it('0 件でも母集団の行は出る（画面全体を空にしない）', () => {
    expect(render({ rows: [] })).toContain('engineer-list-population');
  });
});
