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
  // 🔴 **SP-22 段④で登録の導線は帯（`PageHeader`）へ移った**（`docs/04` §S-005 操作
  //    「『人材を登録』（primary）」/ §7.6「primary は大きく」）。したがって本体には描かれない。
  //    🔴 **判定の検出器は失っていない** —— `engineerListPrimaryAction(canRegister)` が
  //    `null` を返すことを `lib/engineers/list-rows.test.ts` が固定し（`page.tsx` は
  //    ユニットテストの対象外であるため判定を `lib/**` に置いた）、`PageHeading` 側の
  //    `kind: 'ACTION'` × `canAct` の落とし方は `_shell/page-heading.render.test.tsx` が固定する。
  it('`VIEWER` には登録導線を出さず、代わりに誰ができるかを書く', () => {
    const html = render({ canRegister: false });
    expect(html).not.toContain('href="/engineers/new"');
    expect(html).toContain('engineer-list-read-only-note');
  });

  it('🔴 本体（一覧）には登録導線が無い（帯の primary へ移したため。二重に描かない）', () => {
    expect(render()).not.toContain('href="/engineers/new"');
    expect(render({ canRegister: false })).not.toContain('href="/engineers/new"');
  });

  it('🔴 登録できるロールには理由テキストを出さない（出すと「できない」と読める）', () => {
    const html = render();
    expect(html).not.toContain('engineer-list-read-only-note');
    expect(html).not.toContain('閲覧のみの権限のため、人材の登録は行えません。');
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
  it('0 件なら空状態と登録導線を出す（データ行を 1 行も描かない）', () => {
    const html = render({ rows: [] });
    expect(html).toContain('engineer-list-empty');
    expect(html).toContain('まだ人材が登録されていません。');
    // ⚠️ **T-22-06 で判定の形を追随させた（緩めていない）**: `@ses/ui` の `DataTable` は空状態を
    //    **表の中の 1 行**（`engineer-list-empty-row` の `colSpan`）として描く契約である
    //    （`docs/05` §2.3.5 の `empty`）。旧実装は表そのものを描かなかったため
    //    「`engineer-list-table` が無い」を見ていた。🔴 **守るべき中身は「データ行が 0 であること」**
    //    であり、それを直接見る形にした（列ヘッダは骨格として残るのが部品の契約である）。
    expect(html).toContain('engineer-list-empty-row');
    expect(html).not.toContain('engineer-list-row-');
    // ⚠️ **SP-22 段④: 登録導線は帯（`PageHeader`）が持つ**（上の権限差分の 🔴）。
    //    初回空のときに登録へ行けることは `engineerListPrimaryAction` + `PageHeading` が担保する。
    expect(html).not.toContain('href="/engineers/new"');
  });

  it('0 件でも母集団の行は出る（画面全体を空にしない）', () => {
    expect(render({ rows: [] })).toContain('engineer-list-population');
  });
});

describe('🔴 T-11-12: 氏名セルが docs/04 §10.3「長い名称」のブレークポイント別規約と一致する（`@ses/ui` の `NameCell`）', () => {
  it('lg 未満 = 折り返し + 下限 10rem、lg 以上 = 切り詰め（器）+ title + 同じ行に S-006 への導線', () => {
    const html = render({ rows: [row({ displayName: '架空 太郎' })] });
    // ⚠️ **T-22-06: `<td>` の属性が増えたぶんだけ正規表現を緩めた（判定は 1 つも緩めていない）**。
    //    `DataTable` は列定義由来の `style="min-width:…"` と `data-column-id` をセルに付ける
    //    （`docs/05` §2.3.5 の「幅」）。**クラスに対する検査は下の 5 行でそのまま維持している。**
    const cell = /<td class="([^"]*)"[^>]*>(<span class="[^"]*" title="架空 太郎">.*?<[/]span>)<[/]td>/.exec(html);
    expect(cell).not.toBeNull();
    const classes = (cell?.[1] ?? '').split(' ');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('min-w-40');
    expect(classes).toContain('lg:max-w-64');
    expect(classes).not.toContain('truncate');
    expect(classes).not.toContain('whitespace-nowrap');
    const inner = cell?.[2] ?? '';
    // 切り詰めは `lg:` の語だけで、器（`<span>`）に掛かる。`title` に全文。
    expect(inner).toContain('<span class="block lg:truncate" title="架空 太郎">');
    const link = /<a ([^>]*)>架空 太郎<[/]a>/.exec(inner);
    expect(link).not.toBeNull();
    expect(link?.[1]).toContain(`href="/engineers/${ENGINEER_A}"`);
    expect(link?.[1]).toContain(`data-testid="engineer-list-link-${ENGINEER_A}"`);
    expect(link?.[1]).not.toContain('truncate');
  });
});

// ============================================================================
// 🔴 T-22-06: 列の集合・並び・ブレークポイントが**移行前と同一**である（受け入れ基準 2）
// ============================================================================
// 🔴 **整形のついでに列を足さない / 落とさない。** `DataTable` への移行は
//    「`hidden lg:table-cell` の直書きを列定義の `priority` に移す」だけであり、
//    **DOM に出る列とその消える境界は 1 つも変わっていない**ことをここで固定する
//    （§10.3 の `S-005` の行 / §S-005「デバイス別」）。
//
// | 列 | 移行前のクラス | 移行後の `priority` |
// |---|---|---|
// | 氏名 | （常時） | `always` |
// | 所属区分 | `hidden lg:table-cell` | `lg` |
// | 主要スキル | （常時） | `always` |
// | 単価レンジ | `hidden sm:table-cell` | `sm` |
// | 稼働可能時期 | （常時） | `always` |
// | 勤務地・リモート | `hidden lg:table-cell` | `lg` |
// | 稼働状況 | `hidden sm:table-cell` | `sm` |
// | 更新日 | `hidden lg:table-cell` | `lg` |
describe('🔴 T-22-06: 列の契約（移行前と同一。増減 0）', () => {
  /** 列ヘッダ（`<th>`）を DOM の並びのまま `id` と「消える境界」の組で読む。 */
  function headerColumns(html: string): { readonly id: string; readonly breakpoint: string }[] {
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(html)?.[1] ?? '';
    return [...head.matchAll(/<th ([^>]*)>/g)].map((match) => {
      const attributes = match[1] ?? '';
      const id = /data-column-id="([^"]+)"/.exec(attributes)?.[1] ?? '?';
      const classes = /class="([^"]*)"/.exec(attributes)?.[1] ?? '';
      const breakpoint = classes.includes('hidden lg:table-cell')
        ? 'lg'
        : classes.includes('hidden sm:table-cell')
          ? 'sm'
          : 'always';
      return { id, breakpoint };
    });
  }

  it('ホスト = 8 列。並びと境界が移行前と一致する', () => {
    expect(headerColumns(render())).toEqual([
      { id: 'name', breakpoint: 'always' },
      { id: 'ownership', breakpoint: 'lg' },
      { id: 'skills', breakpoint: 'always' },
      { id: 'unitPrice', breakpoint: 'sm' },
      { id: 'availableFrom', breakpoint: 'always' },
      { id: 'location', breakpoint: 'lg' },
      { id: 'availability', breakpoint: 'sm' },
      { id: 'updatedOn', breakpoint: 'lg' },
    ]);
  });

  it('🔴 取引先 = 7 列（所属区分の列そのものが無い。CSS で隠すのではない）', () => {
    const columns = headerColumns(render({ showOwnershipColumn: false }));
    expect(columns.map((column) => column.id)).toEqual([
      'name',
      'skills',
      'unitPrice',
      'availableFrom',
      'location',
      'availability',
      'updatedOn',
    ]);
  });

  it('🔴 モバイル（`sm` 未満）に残るのは 3 列（氏名 / 主要スキル / 稼働可能時期）', () => {
    const always = headerColumns(render()).filter((column) => column.breakpoint === 'always');
    expect(always.map((column) => column.id)).toEqual(['name', 'skills', 'availableFrom']);
  });

  it('🔴 行選択（`selection`）と操作列を描かない（Phase 1 に一括操作は無い）', () => {
    const html = render();
    expect(html).not.toContain('engineer-list-select-');
    // 操作列のヘッダが無い = `rowAction` を渡していない。
    expect(headerColumns(html).every((column) => column.id !== '?')).toBe(true);
  });
});

// ============================================================================
// 🔴 SP-22 段④: ワイヤーフレームへの刷新（**見せ方だけ**。人間の
//    「SES Hub社内外向け人材管理ダッシュボード.png」左＝社内用）
// ============================================================================
describe('🔴 SP-22 段④: 絞り込みカードと件数バー', () => {
  it('🔴 絞り込みは白い面のカード（`@ses/ui` の `Card`）の中にある（ページ地に溶けない）', () => {
    const html = render();
    // 🔴 面の語（`CARD_SURFACE_CLASSES`）は `packages/ui` にしか無いので、**ここでは
    //    その語を書かない**（書くと `tests/static/ui-shadow-and-size.test.ts` の
    //    「画面が面のクラス定数を再実装していない」に当たる）。radius + 枠線で器を掴む。
    const card = html.indexOf('rounded-md border border-border');
    const form = html.indexOf('data-testid="engineer-list-filters"');

    expect(card, '絞り込みカードの面が描かれていない').toBeGreaterThanOrEqual(0);
    expect(form, '検索フォームがカードの外にある').toBeGreaterThan(card);
  });

  it('🔴 フリーワードは全幅である（他の条件と同じ幅に並べない）', () => {
    const html = render();
    const label = /<label class="([^"]*)"[^>]*>\s*<span[^>]*>フリーワード/.exec(html);

    expect(label, 'フリーワードの欄が見つからない').not.toBeNull();
    const classes = (label?.[1] ?? '').split(' ');
    expect(classes).toContain('sm:col-span-2');
    expect(classes).toContain('lg:col-span-3');
    expect(classes).toContain('xl:col-span-4');
  });

  it('🔴 「できないこと」の 2 行は絞り込みカードの中にある（条件の群の隣で読む）', () => {
    const html = render();
    const form = html.indexOf('data-testid="engineer-list-filters"');
    const searchComingSoon = html.indexOf('data-testid="engineer-list-search-coming-soon"');
    const experienceComingSoon = html.indexOf('data-testid="engineer-list-experience-coming-soon"');
    const population = html.indexOf('data-testid="engineer-list-toolbar-population"');

    expect(searchComingSoon).toBeGreaterThan(form);
    expect(experienceComingSoon).toBeGreaterThan(searchComingSoon);
    expect(experienceComingSoon, '件数バーより後に出ている（カードの外）').toBeLessThan(population);
  });

  it('🔴 件数バー: 母集団の 1 行と並び順の説明が同じ段にある', () => {
    const html = render();
    const population = html.indexOf('data-testid="engineer-list-toolbar-population"');
    const note = html.indexOf('data-testid="engineer-list-toolbar-note"');
    const orderNote = html.indexOf('data-testid="engineer-list-order-note"');
    const table = html.indexOf('data-testid="engineer-list-table"');

    expect(population).toBeGreaterThanOrEqual(0);
    expect(note, '並び順の置き場所（`Toolbar` の `note`）が無い').toBeGreaterThan(population);
    // 🔴 凍結済みの `engineer-list-order-note` が `note` の中に在る（`U-22`）。
    expect(orderNote).toBeGreaterThan(note);
    expect(orderNote, '並び順の説明がテーブルより後に出ている').toBeLessThan(table);
    expect(html).toContain('更新日の新しい順に表示しています。');
  });

  it('🔴 並び順は**選べる形にしない**（`?sort=` は `#15` の query に無い）', () => {
    const html = render();

    expect(html).not.toContain('data-testid="engineer-list-sort-');
    expect(html).not.toContain('name="sort"');
    expect(html).not.toContain('name="order"');
  });

  it('🔴 行のチェックボックス・列表示切替を置かない（Phase 1 に一括操作も 9 列目も無い）', () => {
    const html = render();
    // ⚠️ 絞り込みチェックボックス 2 種（`onlyInTime` / `onlyCommutable`）は**条件**であり
    //    一括操作ではない（`F-009 AC-5`）。したがって見るのは**表の中**である。
    const table = /<table[^>]*>(.*?)<[/]table>/s.exec(html)?.[1] ?? '';

    expect(table, '表が描かれていない').not.toBe('');
    expect(table).not.toContain('type="checkbox"');
    expect(html).not.toContain('data-testid="engineer-list-select-');
    expect(html).not.toContain('data-testid="engineer-list-column-toggle-');
    // 対照: 条件側のチェックボックスは**残っている**（判定を緩めていないことの確認）。
    expect(html).toContain('data-testid="engineer-list-filter-only-in-time"');
  });

  it('🔴 ワイヤーフレームにあって DB・API に無い列を 1 つも描かない（`BR-52` / `#15` の射影）', () => {
    const html = render();

    for (const word of ['性別', '年齢', 'カテゴリ', 'PR ポイント', 'PRポイント', '並行状況', '最寄']) {
      expect(html, `${word} の列が描かれている`).not.toContain(word);
    }
  });

  it('🔴 画面の中にタブを作らない（第 2 階層は外枠の `SectionNav` が持つ）', () => {
    const html = render();

    expect(html).not.toContain('role="tablist"');
    for (const word of ['タレントプール', '対応履歴', 'スキル分析']) {
      expect(html, `${word} のタブが描かれている`).not.toContain(word);
    }
  });

  it('🔴 エクスポートの導線を置かない（エンジニアの書き出し API が存在しない）', () => {
    const html = render();

    expect(html).not.toContain('エクスポート');
    expect(html).not.toContain('/api/data-exports');
  });
});
