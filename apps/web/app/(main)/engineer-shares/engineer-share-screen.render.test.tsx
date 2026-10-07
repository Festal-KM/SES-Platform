// apps/web/app/(main)/engineer-shares/engineer-share-screen.render.test.tsx
// `EngineerShareScreen`（`S-015`）の描画テスト。T-08-02 → T-11-11（1 表 + 検索 3 条件 + 共有状態フィルタ +
// カーソルページング。`docs/04` 改訂 12 / docs/05 §6.4「#29 の改訂」）。
//
// 🔴 ここで固定するのは「**描かれていないこと**」が中心である（`F-016 AC-1` / `BR-53` /
//    `docs/04` §S-015）:
//    ① 🔴 **「一括で共有可にする」に相当する操作が 1 つも無い**（行の選択チェックボックス・全選択も無い）
//    ② 🔴 **空状態が煽っていない**（「共有すると…」に相当する誘導が無い）。**4 通り**を出し分ける
//    ③ 🔴 **丸める前の値（`7 年` / `65 万円` / `渋谷区` / 具体的な稼働開始日）が現れない**
//    ④ 🔴 **「反映まで数分かかります」に相当する表示が無い**（即時反映が要件）
//    ⑤ 停止中（`denialMessage`）のとき、操作ボタンを描かない（`F-004 AC-7`）
//    ⑥ 🔴 **総件数・残件数に相当する表示が無い**（`docs/05` §4.8。「次の 50 件」はボタンだけ）
//    ⑦ 🔴 **検索 3 条件がモバイルでも省略されない**（フォームの入力欄に `hidden` が付かない。`CLAUDE.md` §13.3）
//    ⑧ 共有状態フィルタの 3 状態で、1 表の testid が母集団を示す
//    ⑨ T-12-17 ①: 削除済み（`DELETED`）の行は、`sm` 未満で隠れる共有状態の列だけでなく**操作セルにも理由が在る**
//    ⑩ T-12-17 ④: 氏名セルは `@ses/ui` の `NameCell`（導線が無い = どのブレークポイントでも切り詰めない）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`visibility-screen.render.test.tsx` と同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RoundedAnonymousAttributes } from '@ses/domain';
import {
  EngineerSharePreviewCard,
  EngineerShareScreen,
  EngineerShareTableRow,
  type EngineerShareRowMark,
  type EngineerShareRowView,
  type EngineerShareScreenMessages,
  type EngineerShareScreenProps,
} from './engineer-share-screen';
// 🔴 **公開プレビューの中身を「匿名化の実装」に突き合わせる**ための import（下の最後の describe）。
//    フィクスチャの手書きではなく、`engineerShareRow`（本番の組み立て）と
//    `ANONYMIZED_ATTRIBUTE_ROW_KEYS`（丸めの型のキー集合）を通した値で検査する。
import { ANONYMIZED_ATTRIBUTE_ROW_KEYS } from '../../../lib/anonymize/labels-core';
import { engineerShareRow } from '../../../lib/engineer-shares/row-view';

const SHARED_ROW: EngineerShareRowView = {
  engineerId: '01930000-0000-7000-8000-0000000000a1',
  displayName: '合成 太郎',
  shared: true,
  sharedOn: '2026-09-01',
  proposalRequestCount: '0 件',
  availability: '翌月',
  preview: {
    skills: ['Java', 'AWS'],
    yearsBand: '5〜10 年',
    priceBand: '60〜70 万円',
    availabilityBand: '翌月',
    location: '東京都・一部リモート可',
    updatedOn: '2026-09-08',
  },
};

const NOT_SHARED_ROW: EngineerShareRowView = {
  engineerId: '01930000-0000-7000-8000-0000000000a2',
  displayName: '合成 次郎',
  shared: false,
  sharedOn: '—',
  proposalRequestCount: '0 件',
  availability: '即日',
  preview: {
    skills: [],
    yearsBand: '—',
    priceBand: '—',
    availabilityBand: '即日',
    location: '—',
    updatedOn: '2026-09-07',
  },
};

const messages: EngineerShareScreenMessages = {
  lead: '共有可にすると、ホストの候補一覧に匿名で表示されます。',
  // 🔴 SP-22 段④: 件数バーの 2 語。**`population` に件数を含めない**（`docs/04` §S-015 / `docs/05` §4.8）。
  population: '御社が登録した人材',
  orderNote: '共有開始日の新しい順に表示しています。',
  searchLegend: '検索条件',
  searchQ: '氏名',
  searchAvailableBy: '稼働可能時期（この日までに稼働可能）',
  searchShared: '共有状態',
  searchSubmit: '検索',
  searchClear: '条件を解除',
  sectionList: '人材の一覧',
  sectionPreview: '開示プレビュー',
  columnName: '氏名（貴社内の表示）',
  columnState: '共有状態',
  columnSharedOn: '共有開始日',
  columnProposalRequestCount: '受け取った提案依頼',
  columnAvailability: '稼働可能時期',
  columnAction: '操作',
  stateShared: '共有中',
  stateNotShared: '未共有',
  stateRevokedNow: '解除しました',
  stateDeleted: '削除済み',
  sharedEmpty: '共有している人材はいません。',
  sharedEmptyShowNotShared: '共有していない人材を表示',
  notSharedEmpty: '登録されている人材はすべて共有中です。',
  filteredEmpty: '条件に一致する人材はいません。',
  activeFiltersTitle: '効いている条件',
  removeFilterSuffix: 'を外す',
  ledgerEmpty: '人材がまだ登録されていません。',
  ledgerRegister: '人材を登録する',
  loadMore: '次の 50 件',
  loadMoreLoading: '取得しています…',
  loadMoreError: '続きを取得できませんでした。',
  loadMoreRetry: 'もう一度試す',
  previewSelect: '人材を選ぶと、ホストに表示される内容をここで確認できます。',
  previewNote: 'ホストに表示されるのは次の 5 項目だけです。',
  previewCareersNote: '経歴は開示されません。',
  previewStateShared: 'ホストにはいま、次のように表示されています。',
  previewStateNotShared:
    'この人材はまだ共有していません。共有可にすると、ホストには次のように表示されます。',
  fieldSkills: 'スキル',
  fieldYears: '経験年数',
  fieldPrice: '単価レンジ',
  fieldAvailability: '稼働可能時期',
  fieldLocation: '勤務地・リモート可否',
  fieldUpdatedOn: '更新日',
  valueNone: '—',
  share: '共有可にする',
  shareConfirmTitle: 'この内容がホストに表示されます',
  shareConfirmSubmit: '共有可にする',
  shareConfirmCancel: 'キャンセル',
  shareSubmitting: '設定しています…',
  revoke: '共有を解除する',
  revokeConfirmTitle: '共有を解除しますか',
  revokeConfirmLead: '解除した時点で、ホストの候補一覧に表示されなくなります。',
  revokeConfirmSubmit: '解除する',
  revokeConfirmCancel: 'キャンセル',
  revokeSubmitting: '解除しています…',
  errorSave: '設定を変更できませんでした。',
  errorRetryNote: '設定は変わっていません。もう一度お試しください。',
  deniedTitle: '共有の設定を変更できません。',
};

const FILTER_OPTIONS = [
  { value: 'true', label: '共有中' },
  { value: 'false', label: '共有していない' },
  { value: 'all', label: 'すべて' },
] as const;

const BASE_PROPS: EngineerShareScreenProps = {
  rows: [SHARED_ROW, NOT_SHARED_ROW],
  nextCursor: null,
  filters: { q: '', availableBy: '', shared: 'all' },
  filterOptions: FILTER_OPTIONS,
  activeFilters: [],
  emptyState: null,
  showNotSharedHref: '/engineer-shares?shared=false',
  clearHref: '/engineer-shares',
  apiSearch: '',
  registerHref: '/engineers/new',
  denialMessage: null,
  rowLabels: { catalog: {}, valueNone: '—', countUnit: '件' },
  messages,
};

function render(overrides: Partial<EngineerShareScreenProps> = {}): string {
  return renderToStaticMarkup(createElement(EngineerShareScreen, { ...BASE_PROPS, ...overrides }));
}

/** 1 行だけを静的に描く（`DELETED` の印は 404 応答でしか付かず、画面本体の props からは注入できない）。 */
function renderRow(row: EngineerShareRowView, mark: EngineerShareRowMark | undefined): string {
  return renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        createElement(EngineerShareTableRow, {
          row,
          mark,
          canExecute: true,
          busy: false,
          messages,
          onSelect: () => undefined,
          onAsk: () => undefined,
        }),
      ),
    ),
  );
}

function rowCells(html: string, engineerId: string): readonly string[] {
  const start = html.indexOf(`engineer-share-row-${engineerId}`);
  return html.slice(start, html.indexOf('</tr>', start)).split('<td').slice(1);
}

describe('S-015 の骨格（docs/04 §S-015 のセクション 1〜5）', () => {
  it('説明ブロック・検索条件・一覧（1 表）・プレビューが出る', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-share-lead"');
    expect(html).toContain('data-testid="engineer-share-filters"');
    expect(html).toContain('data-testid="engineer-share-list"');
    expect(html).toContain('data-testid="engineer-share-table"');
    expect(html).toContain('data-testid="engineer-share-preview"');
  });

  it('🔴 一覧は 1 表である（共有中 / 共有していないの 2 表に分けない。`docs/04` §11-13）', () => {
    const html = render();
    expect(html.match(/<table/g) ?? []).toHaveLength(1);
    // 共有中と未共有の行が同じ表に並ぶ（グループ分けもしない ＝ props の順序のまま）。
    const shared = html.indexOf(`engineer-share-row-${SHARED_ROW.engineerId}`);
    const notShared = html.indexOf(`engineer-share-row-${NOT_SHARED_ROW.engineerId}`);
    expect(shared).toBeGreaterThan(-1);
    expect(notShared).toBeGreaterThan(shared);
  });

  it('共有中の行には解除、未共有の行には共有可にする操作が 1 件ずつ付く（両方を並べない）', () => {
    const html = render();
    expect(html).toContain(`data-testid="engineer-share-revoke-${SHARED_ROW.engineerId}"`);
    expect(html).toContain(`data-testid="engineer-share-share-${NOT_SHARED_ROW.engineerId}"`);
    expect(html).not.toContain(`data-testid="engineer-share-share-${SHARED_ROW.engineerId}"`);
    expect(html).not.toContain(`data-testid="engineer-share-revoke-${NOT_SHARED_ROW.engineerId}"`);
  });

  it('共有状態の列は文字で状態を示す（共有中 / 未共有）', () => {
    const html = render();
    expect(html).toContain(`data-testid="engineer-share-state-${SHARED_ROW.engineerId}"`);
    expect(html).toContain('>共有中<');
    expect(html).toContain('>未共有<');
  });

  it('プレビューは選択するまで出ない（`docs/04` §S-015 ローディング「一覧を先に」）', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-share-preview-placeholder"');
    expect(html).not.toContain(`data-testid="engineer-share-preview-${SHARED_ROW.engineerId}"`);
  });
});

describe('🔴 検索条件フォーム（氏名 / 稼働可能時期 / 共有状態。`docs/04` §S-015）', () => {
  it('3 条件の入力欄と検索ボタンがあり、素の GET フォームである（条件が URL になる）', () => {
    const html = render();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/engineer-shares"');
    expect(html).toContain('data-testid="engineer-share-filter-q"');
    expect(html).toContain('data-testid="engineer-share-filter-available-by"');
    expect(html).toContain('data-testid="engineer-share-filter-shared"');
    expect(html).toContain('data-testid="engineer-share-search"');
  });

  it('🔴 3 条件が最小で最大（スキル・単価・勤務地の入力欄が無い）', () => {
    const html = render();
    for (const name of ['skills', 'skillMode', 'yearsMin', 'priceMin', 'priceMax', 'prefecture', 'remote']) {
      expect(html).not.toContain(`name="${name}"`);
    }
  });

  it('共有状態フィルタは 3 値で、URL の値が選択されている', () => {
    const html = render({ filters: { q: '', availableBy: '', shared: 'false' } });
    expect(html).toContain('value="true"');
    expect(html).toContain('value="false"');
    expect(html).toContain('value="all"');
    expect(html).toMatch(/<option[^>]*selected[^>]*value="false"|<option[^>]*value="false"[^>]*selected/);
  });

  it('条件が効いているときだけ「条件を解除」が出る', () => {
    expect(render()).not.toContain('data-testid="engineer-share-clear"');
    expect(
      render({ activeFilters: [{ key: 'q', label: '氏名: 合成', href: '/engineer-shares' }] }),
    ).toContain('data-testid="engineer-share-clear"');
  });

  it('🔴 モバイルでも 3 条件を省略しない（入力欄に `hidden` が付かない。`CLAUDE.md` §13.3）', () => {
    const html = render();
    const form = html.slice(html.indexOf('data-testid="engineer-share-filters"'), html.indexOf('</form>'));
    expect(form).not.toContain('hidden');
    expect(form).not.toContain('<details');
  });
});

describe('🔴 共有状態フィルタの 3 状態で、1 表の testid が母集団を示す', () => {
  it('`共有中` → engineer-share-shared / engineer-share-shared-table', () => {
    const html = render({ rows: [SHARED_ROW], filters: { q: '', availableBy: '', shared: 'true' } });
    expect(html).toContain('data-testid="engineer-share-shared"');
    expect(html).toContain('data-testid="engineer-share-shared-table"');
    expect(html).not.toContain('data-testid="engineer-share-not-shared-table"');
  });

  it('`共有していない` → engineer-share-not-shared / engineer-share-not-shared-table', () => {
    const html = render({ rows: [NOT_SHARED_ROW], filters: { q: '', availableBy: '', shared: 'false' } });
    expect(html).toContain('data-testid="engineer-share-not-shared"');
    expect(html).toContain('data-testid="engineer-share-not-shared-table"');
    expect(html).not.toContain('data-testid="engineer-share-shared-table"');
  });

  it('`すべて` → engineer-share-list / engineer-share-table', () => {
    const html = render();
    expect(html).toContain('data-testid="engineer-share-list"');
    expect(html).toContain('data-testid="engineer-share-table"');
  });
});

describe('🔴 一括で全件をオンにする操作が存在しない（`F-016 AC-1` / `BR-53`）', () => {
  it('チェックボックス（複数選択の起点）を 1 つも描かない', () => {
    const html = render();
    expect(html).not.toContain('type="checkbox"');
  });

  it('操作ボタンの数は行数と一致する（まとめて動かす追加のボタンが無い）', () => {
    const html = render();
    const shareButtons = html.match(/data-testid="engineer-share-share-/g) ?? [];
    const revokeButtons = html.match(/data-testid="engineer-share-revoke-/g) ?? [];
    expect(shareButtons).toHaveLength(1);
    expect(revokeButtons).toHaveLength(1);
  });

  it('「すべて共有」「すべて解除」に相当する語が無い', () => {
    const html = render({ nextCursor: 's:0001757000000000:01930000-0000-7000-8000-0000000000a1' });
    expect(html).not.toContain('すべて共有');
    expect(html).not.toContain('すべて解除');
    expect(html).not.toContain('一括');
  });

  /**
   * 🔴 T-22-07（`docs/05` §6.11.4 の 2 つの 🔴 / `SP-22` `T-22-07` 受け入れ基準 2）。
   *
   * `docs/05` §2.3.5 は「行選択は `selection` を渡した画面にだけ現れ、省略が既定」と定めており、
   * 本画面はそれを**部品の既定に頼らず自前の表で**満たしている（`DataTable` へ移していない理由は
   * 画面ファイル冒頭の 🔴）。したがって **「選択列が無い」「操作列がどの幅でも在る」の 2 つは、
   * この画面の描画そのもので固定する**。
   */
  it('🔴 選択列（行選択・全選択）が 1 列も無い —— ヘッダの列数は 6 で、操作列がその 6 列目である', () => {
    const html = render();
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    // `<thead` を列として数えないよう `<th` の直後が空白か `>` のときだけ割る。
    const heads = head.split(/<th[\s>]/).slice(1);
    expect(heads).toHaveLength(6);
    // 選択の起点（チェックボックス・`aria-label` の全選択）がヘッダにも本文にも無い。
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('role="checkbox"');
    // 6 列目が操作列（ヘッダの語が `columnAction`）。
    expect(heads[5]).toContain(messages.columnAction);
  });

  it('🔴 操作列はどのブレークポイントでも隠さない（ヘッダ・セルの両方に `hidden` が付かない）', () => {
    const html = render({ rows: [SHARED_ROW, NOT_SHARED_ROW] });
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const actionHead = head.split(/<th[\s>]/).slice(1)[5] ?? '';
    expect(actionHead).not.toContain('hidden');
    for (const row of [SHARED_ROW, NOT_SHARED_ROW]) {
      const cells = rowCells(html, row.engineerId);
      expect(cells).toHaveLength(6);
      expect(cells[5]).not.toContain('hidden');
    }
    // 🔴 独自ブレークポイントも打ち消し方向（`max-sm:`）も使わない（`CLAUDE.md` §13.3）。
    expect(html).not.toMatch(/max-(?:sm|md|lg|xl):/);
  });
});

describe('🔴 空状態は 4 通りで、煽らない（`docs/04` §S-015）', () => {
  it('台帳 0 件 → `S-007` への導線（行き止まりにしない）。一覧・プレビューのセクションごと出さない', () => {
    const html = render({ rows: [], emptyState: 'LEDGER' });
    expect(html).toContain('data-testid="engineer-share-ledger-empty"');
    expect(html).toContain('href="/engineers/new"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('data-testid="engineer-share-preview"');
    // 🔴 検索条件は台帳 0 件でも出したままにする（評価対象が無いだけで、条件を隠す理由にはならない）。
    expect(html).toContain('data-testid="engineer-share-filters"');
  });

  it('`共有中`・条件なし・0 件 → 事実だけを述べ、`共有していない` への切替の導線を置く', () => {
    const html = render({
      rows: [],
      emptyState: 'SHARED_NONE',
      filters: { q: '', availableBy: '', shared: 'true' },
    });
    expect(html).toContain('data-testid="engineer-share-shared-empty"');
    expect(html).toContain('共有している人材はいません。');
    expect(html).toContain('data-testid="engineer-share-show-not-shared"');
    expect(html).toContain('href="/engineer-shares?shared=false"');
  });

  it('`共有していない`・条件なし・0 件 → 「登録されている人材はすべて共有中です」（事実のみ）', () => {
    const html = render({
      rows: [],
      emptyState: 'ALL_SHARED',
      filters: { q: '', availableBy: '', shared: 'false' },
    });
    expect(html).toContain('data-testid="engineer-share-not-shared-empty"');
    expect(html).toContain('登録されている人材はすべて共有中です。');
  });

  it('条件あり・0 件 → 効いている条件を 1 つずつ外せる導線（共有状態も条件の 1 つ）', () => {
    const html = render({
      rows: [],
      emptyState: 'FILTERED',
      filters: { q: '合成', availableBy: '', shared: 'true' },
      activeFilters: [
        { key: 'q', label: '氏名: 合成', href: '/engineer-shares' },
        { key: 'shared', label: '共有状態: 共有中', href: '/engineer-shares?q=%E5%90%88%E6%88%90&shared=all' },
      ],
    });
    expect(html).toContain('data-testid="engineer-share-filtered-empty"');
    expect(html).toContain('条件に一致する人材はいません。');
    expect(html).toContain('data-testid="engineer-share-remove-filter-q"');
    expect(html).toContain('data-testid="engineer-share-remove-filter-shared"');
  });

  it('🔴 どの空状態にも「共有すると…」に相当する誘導が無い', () => {
    for (const emptyState of ['LEDGER', 'SHARED_NONE', 'ALL_SHARED', 'FILTERED'] as const) {
      const html = render({ rows: [], emptyState });
      expect(html).not.toContain('共有すると');
      expect(html).not.toContain('見つかりやすく');
      expect(html).not.toContain('機会');
    }
  });
});

describe('🔴 カーソルページング（`docs/04` §S-015 / docs/05 §4.8）', () => {
  it('`nextCursor` があるときだけ「次の 50 件」ボタンが出る', () => {
    expect(render()).not.toContain('data-testid="engineer-share-load-more"');
    expect(
      render({ nextCursor: 's:0001757000000000:01930000-0000-7000-8000-0000000000a1' }),
    ).toContain('data-testid="engineer-share-load-more"');
  });

  it('🔴 総件数・残件数・「あと N 件」に相当する表示が無い', () => {
    const html = render({ nextCursor: 'u:0001757000000000:01930000-0000-7000-8000-0000000000a2' });
    expect(html).not.toMatch(/件中/);
    expect(html).not.toMatch(/あと\s*\d/);
    expect(html).not.toMatch(/残り/);
    expect(html).not.toMatch(/全\s*\d+\s*件/);
  });

  it('カーソルの値そのものを画面に描かない（ボタンの位置だけ）', () => {
    const cursor = 's:0001757000000000:01930000-0000-7000-8000-0000000000a1';
    expect(render({ nextCursor: cursor })).not.toContain(cursor);
  });
});

describe('🔴 丸める前の値が画面に現れない（`F-017 AC-3` / `docs/04` §5-2）', () => {
  it.each([
    ['経験年数の実数', '7 年'],
    ['単価の実額', '65 万円'],
    ['単価の円表記', '650,000'],
    ['市区町村', '渋谷区'],
    ['稼働開始日（日付）', '2026-09-16'],
  ])('%s（%s）が出ない', (_label, forbidden) => {
    expect(render()).not.toContain(forbidden);
  });

  it('一覧の「稼働可能時期」列はプレビューと同じ丸めた区分である', () => {
    expect(SHARED_ROW.availability).toBe(SHARED_ROW.preview.availabilityBand);
  });
});

describe('🔴 即時反映（`F-016 AC-2`）を裏切る表示が無い', () => {
  it('「反映まで」「数分」に相当する語を持たない', () => {
    const html = render();
    expect(html).not.toContain('反映まで');
    expect(html).not.toContain('数分');
  });
});

describe('🔴 停止中・解約手続き中は操作を描かない（`F-004 AC-7`）', () => {
  it('理由を出し、共有・解除のボタンを 1 つも描かない。閲覧（一覧・検索）は遮断しない', () => {
    const html = render({ denialMessage: '契約が停止中のため、実行系の操作はできません。' });
    expect(html).toContain('data-testid="engineer-share-denied"');
    expect(html).not.toContain('data-testid="engineer-share-share-');
    expect(html).not.toContain('data-testid="engineer-share-revoke-');
    expect(html).toContain('data-testid="engineer-share-table"');
    expect(html).toContain('data-testid="engineer-share-filters"');
  });
});

describe('🔴 モバイルで判断材料を隠さない（`CLAUDE.md` §13.3 / `docs/04` §S-015 デバイス別）', () => {
  it('間引くのは 共有状態 / 共有開始日（sm 未満）と 受け取った提案依頼（lg 未満）だけ', () => {
    const html = render();
    // ヘッダ 2 + 本文 2 行 × 2 = 6 箇所（共有状態 / 共有開始日）。
    expect(html.match(/hidden sm:table-cell/g) ?? []).toHaveLength(6);
    // ヘッダ 1 + 本文 2 行 × 1 = 3 箇所（受け取った提案依頼）。
    expect(html.match(/hidden lg:table-cell/g) ?? []).toHaveLength(3);
  });

  it('🔴 氏名・稼働可能時期・操作の各セルに `hidden` が付かない', () => {
    const html = render({ rows: [SHARED_ROW] });
    const row = html.slice(html.indexOf(`engineer-share-row-${SHARED_ROW.engineerId}`), html.indexOf('</tr>', html.indexOf(`engineer-share-row-${SHARED_ROW.engineerId}`)));
    const cells = row.split('<td').slice(1);
    expect(cells).toHaveLength(6);
    // 1 列目（氏名）・5 列目（稼働可能時期）・6 列目（操作）は隠さない。
    expect(cells[0]).not.toContain('hidden');
    expect(cells[4]).not.toContain('hidden');
    expect(cells[5]).not.toContain('hidden');
    expect(cells[5]).toContain(`engineer-share-revoke-${SHARED_ROW.engineerId}`);
  });

  it('独自ブレークポイントを使っていない（Tailwind の既定 `sm` / `lg` のみ）', () => {
    const html = render();
    expect(html).not.toMatch(/\[\d+px\]:/);
  });

  it('🔴 T-12-17 ①: 削除済みの行は操作セル（どのブレークポイントでも隠れない）に理由が在り、操作ボタンは無い', () => {
    const html = renderRow(SHARED_ROW, 'DELETED');
    const cells = rowCells(html, SHARED_ROW.engineerId);
    expect(cells).toHaveLength(6);
    // 共有状態の列（`sm` 未満で隠れる）の描画は変えない: 従来どおり `削除済み`。
    expect(cells[1]).toContain('hidden sm:table-cell');
    expect(cells[1]).toContain('>削除済み<');
    // 操作セルにも同じ理由が在る（モバイルで「ボタンが消えただけ」にならない）。
    expect(cells[5]).not.toContain('hidden');
    expect(cells[5]).toContain(`data-testid="engineer-share-deleted-${SHARED_ROW.engineerId}"`);
    expect(cells[5]).toContain('>削除済み<');
    expect(cells[5]).not.toContain('engineer-share-revoke-');
    expect(cells[5]).not.toContain('engineer-share-share-');
  });

  it('削除済みでない行の操作セルには理由の語が無い（`REVOKED_NOW` / 印なし）', () => {
    for (const mark of ['REVOKED_NOW', undefined] as const) {
      const cells = rowCells(renderRow(SHARED_ROW, mark), SHARED_ROW.engineerId);
      expect(cells[5]).not.toContain('削除済み');
      expect(cells[5]).not.toContain('engineer-share-deleted-');
    }
  });
});

describe('🔴 T-12-17 ④: 氏名セルは `NameCell`（`docs/04` §10.3 / §11-14。導線が無い名称は切り詰めない）', () => {
  it('氏名セルが `NameCell` の器（下限幅 10rem + 折り返し + `title` の全文）を持ち、プレビュー選択ボタンが載る', () => {
    const cells = rowCells(render({ rows: [SHARED_ROW] }), SHARED_ROW.engineerId);
    // `NameCell` の器: `min-w-40` + `whitespace-normal`、本文は `<span class="block" title>`。
    expect(cells[0]).toContain('min-w-40');
    expect(cells[0]).toContain('whitespace-normal');
    expect(cells[0]).toContain(`<span class="block" title="${SHARED_ROW.displayName}">`);
    // 行内の操作（プレビューの選択）はボタンのまま（testid 不変）。
    expect(cells[0]).toMatch(
      new RegExp(`<button type="button"[^>]*data-testid="engineer-share-select-${SHARED_ROW.engineerId}"[^>]*>${SHARED_ROW.displayName}</button>`),
    );
  });

  it('🔴 導線（`href`）が無いので、どのブレークポイントでも切り詰めない（`lg:truncate` / `lg:max-w-64` / `<a` が無い）', () => {
    const cells = rowCells(render({ rows: [SHARED_ROW] }), SHARED_ROW.engineerId);
    expect(cells[0]).not.toContain('truncate');
    expect(cells[0]).not.toContain('max-w-');
    expect(cells[0]).not.toContain('<a ');
  });
});

// ============================================================================
// 🔴 SP-22 段④: 絞り込みカードと件数バー（**見せ方だけ**。人間の
//    「SES Hub社内外向け人材管理ダッシュボード.png」右＝他社公開用）
// ============================================================================
// 🔴 **本画面は経路 4 の入口である**（`CLAUDE.md` §3.1）。したがってここで固定するのは
//    見た目の形だけでなく、**開示項目が 1 つも増えていないこと**である:
//      ①プレビューの行は **5 項目 + 丸めた更新日**（`anonymizedAttributeRowsWith` の戻り）だけ
//      ②件数バーの母集団に**数字を入れない**（総件数・残件数の禁止。`docs/05` §4.8）
//      ③ワイヤーフレーム右側にある **`掲載元`（自社 / A社 / B社…）を描く枝が無い**
//        —— これは他社の存在と人数をパートナーに見せることであり、§3.1 の 🔴
//        「パートナー同士が相互に参照できる経路を 1 つも作らない」に正面から反する
describe('🔴 SP-22 段④: 絞り込みカードと件数バー', () => {
  it('🔴 絞り込みは白い面のカード（`@ses/ui` の `Card`）の中にある（ページ地に溶けない）', () => {
    const html = render();
    const card = html.indexOf('rounded-md border border-border');
    const form = html.indexOf('data-testid="engineer-share-filters"');

    expect(card, '絞り込みカードの面が描かれていない').toBeGreaterThanOrEqual(0);
    expect(form, '検索フォームがカードの外にある').toBeGreaterThan(card);
  });

  it('🔴 氏名の条件は全幅である（モバイルの用途が「名前で探して解除する」であるため）', () => {
    const html = render();
    const label = /<label class="([^"]*)"[^>]*>\s*<span[^>]*>氏名/.exec(html);

    expect(label, '氏名の欄が見つからない').not.toBeNull();
    const classes = (label?.[1] ?? '').split(' ');
    expect(classes).toContain('sm:col-span-2');
    expect(classes).toContain('lg:col-span-3');
    expect(classes).toContain('xl:col-span-4');
  });

  it('🔴 検索条件の集合は 3 つのまま（`#29` の query に無い条件を描かない）', () => {
    const html = render();

    expect(html).toContain('name="q"');
    expect(html).toContain('name="availableBy"');
    expect(html).toContain('name="shared"');
    for (const name of ['name="skills"', 'name="priceMin"', 'name="priceMax"', 'name="prefecture"', 'name="remote"', 'name="sort"']) {
      expect(html, `${name} の入力欄が描かれている`).not.toContain(name);
    }
  });

  it('🔴 件数バー: 母集団の 1 行と並び順の説明が同じ段にあり、**母集団に数字が無い**', () => {
    const html = render();
    const population = html.indexOf('data-testid="engineer-share-toolbar-population"');
    const note = html.indexOf('data-testid="engineer-share-toolbar-note"');
    const orderNote = html.indexOf('data-testid="engineer-share-order-note"');
    const table = html.indexOf('data-testid="engineer-share-table"');

    expect(population).toBeGreaterThanOrEqual(0);
    expect(note).toBeGreaterThan(population);
    expect(orderNote).toBeGreaterThan(note);
    expect(orderNote, '並び順の説明が表より後に出ている').toBeLessThan(table);

    // 🔴 **母集団の語に数字が 1 文字も無い**（総件数・残件数・「あと N 件」の禁止。
    //    `docs/04` §S-015 / `docs/05` §4.8）。語そのものを切り出して見る。
    const populationText = /data-testid="engineer-share-toolbar-population"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(populationText).toBe('御社が登録した人材');
    expect(populationText).not.toMatch(/[0-9０-９]/);
    expect(html).not.toContain('あと');
    expect(html).not.toContain('ページ目');
  });

  it('🔴 ワイヤーフレーム右側の `掲載元` を描かない（他社の存在と人数の露出。§3.1 の 🔴）', () => {
    const html = render();

    for (const word of ['掲載元', '所属会社', '所属区分', '他社']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });

  it('🔴 ワイヤーフレーム右側の 5 項目外の列を描かない（`BR-54` の上限を越えない）', () => {
    const html = render();

    for (const word of ['性別', '年齢', 'PR ポイント', 'PRポイント', '並行状況', '最寄']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });

  it('🔴 一覧・カードの表示切替を置かない（§7.2「同型データはテーブル。カードで並べない」）', () => {
    const html = render();

    expect(html).not.toContain('data-testid="engineer-share-view-mode');
    expect(html).not.toContain('カード表示');
  });
});

// ============================================================================
// 🔴 SP-22 段④: 開示プレビューの項目が 1 つも増えていない（経路 4 の上限）
// ============================================================================
// ⚠️ プレビューは**選択後**にしか描かれない（`renderToStaticMarkup` では選択が起こせず、
//    既定では `engineer-share-preview-placeholder` が出る —— それは上の「ローディング」の検査が
//    固定している）。したがってここでは **行が持てる開示の形**を直接見る ——
//    画面は `row.preview` の 6 行をそのまま描くだけであり、**行に無い値は描けない**。
describe('🔴 行が持つ開示の形は 5 項目 + 丸めた更新日だけである（`BR-54` / `U-06`）', () => {
  it('`preview` のキーが 6 個ちょうどで、5 項目 + 丸めた更新日である', () => {
    expect(Object.keys(SHARED_ROW.preview).sort()).toEqual([
      'availabilityBand',
      'location',
      'priceBand',
      'skills',
      'updatedOn',
      'yearsBand',
    ]);
  });

  it('🔴 `preview` に氏名・所属会社・経歴・社内 ID のキーが無い（型に無いものは描けない）', () => {
    const keys = Object.keys(SHARED_ROW.preview);
    for (const forbidden of [
      'displayName',
      'name',
      'partnerCompanyId',
      'partnerCompanyName',
      'careers',
      'career',
      'engineerId',
      'city',
      'unitPriceMin',
      'unitPriceMax',
      'availableFrom',
    ]) {
      expect(keys, `${forbidden} が開示の形に在る`).not.toContain(forbidden);
    }
  });

  it('🔴 一覧の稼働可能時期は**丸めた区分**であり、生の日付を並置しない（`docs/04` §5-2）', () => {
    // 行の `availability` は `preview.availabilityBand` と同一の値である（`row-view.ts`）。
    expect(SHARED_ROW.availability).toBe(SHARED_ROW.preview.availabilityBand);
    const html = render({ rows: [SHARED_ROW] });
    const cells = rowCells(html, SHARED_ROW.engineerId);
    // 稼働可能時期のセル（5 列目）に `YYYY-MM-DD` の生値が出ていない。
    expect(cells[4]).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('🔴 「経歴は開示されません」の文言キーを画面が持っている（`F-008 AC-7`）', () => {
    expect(messages.previewCareersNote).toBe('経歴は開示されません。');
  });
});

// ============================================================================
// 🔴 2026-10-05: **公開プレビューの中身が「実際にホストが見るもの」と一致する**
//    （[Issue #88] / `CLAUDE.md` §3.1 経路 4 / `docs/04` §5-2 / `BR-54` / `U-06`）
// ============================================================================
// 🔴 **フィクスチャの手書きを信用しない。** 上の `SHARED_ROW.preview` は手で書いた値であり、
//    「6 キーである」ことを手書きの表に対して確かめても、**匿名化の実装が変わったときに
//    追随しない**（画面だけが古いまま緑になる）。ここでは
//      ① `RoundedAnonymousAttributes`（丸めの出力の型）から
//      ② `engineerShareRow`（本番の組み立て。`anonymizedAttributeRowsWith` を通る）で行を作り
//      ③ `EngineerSharePreviewCard` を描いて
//      ④ 出た行が `ANONYMIZED_ATTRIBUTE_ROW_KEYS`（= 丸めの型のキー集合）とちょうど一致する
//    ことを見る。🔴 **丸めにフィールドが増えれば ④ が落ちる。**
describe('🔴 公開プレビューは匿名 5 項目 + 丸めた更新日とちょうど一致する（[Issue #88]）', () => {
  /** `F-017 AC-3` の例（経験年数 7 年 / 単価 65 万円 / 東京都渋谷区 / 2026-09-16 稼働開始）を丸めた後の値。 */
  const ROUNDED: RoundedAnonymousAttributes = {
    skills: [{ name: 'Java' }, { name: 'AWS' }],
    yearsBand: 'Y5_10',
    priceBand: { kind: 'RANGE', fromManYen: 60, toManYen: 70 },
    availabilityBand: 'NEXT_MONTH',
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    updatedOn: '2026-09-08',
  };

  /** 🔴 文言の表は**キー名をそのまま返す**（`lookupFromCatalog({})` と同じ）。値の出所を見分けるため。 */
  const LABELS = { catalog: {}, valueNone: '—', countUnit: '件' } as const;

  function previewRow(shared: boolean): EngineerShareRowView {
    return engineerShareRow(
      {
        engineerId: '01930000-0000-7000-8000-0000000000b1',
        displayName: '合成 三郎',
        shared,
        sharedOn: shared ? '2026-09-01' : null,
        proposalRequestCount: 0,
        previewedFields: ROUNDED,
      },
      LABELS,
    );
  }

  function renderPreviewCard(shared: boolean): string {
    return renderToStaticMarkup(
      createElement(EngineerSharePreviewCard, { row: previewRow(shared), messages }),
    );
  }

  it('🔴 描かれる行は丸めの型のキー集合とちょうど一致する（1 つ多くも少なくもない）', () => {
    const html = renderPreviewCard(true);
    const rendered = [...html.matchAll(/data-testid="engineer-share-preview-field-([a-zA-Z]+)"/g)].map(
      (match) => match[1] as string,
    );
    // 🔴 件数が丸めの型のフィールド数と一致する（増えたら落ちる / 減ったら落ちる）。
    expect(rendered).toHaveLength(ANONYMIZED_ATTRIBUTE_ROW_KEYS.length);
    // 🔴 testid の接尾辞は凍結済みの値であり、丸めのフィールド名とは別である（改名していない）。
    expect(rendered).toEqual(['skills', 'years', 'price', 'availability', 'location', 'updatedOn']);
  });

  it('🔴 値は `row.preview`（匿名化の戻り）からしか来ない —— 全フィールドが行の値と一致する', () => {
    const row = previewRow(true);
    const html = renderPreviewCard(true);
    const expected: readonly [string, string][] = [
      ['skills', row.preview.skills.join('・')],
      ['years', row.preview.yearsBand],
      ['price', row.preview.priceBand],
      ['availability', row.preview.availabilityBand],
      ['location', row.preview.location],
      ['updatedOn', row.preview.updatedOn],
    ];
    for (const [testId, value] of expected) {
      const block = html.slice(html.indexOf(`engineer-share-preview-field-${testId}"`));
      expect(block.slice(0, block.indexOf('</div>')), `${testId} の値が行と違う`).toContain(value);
    }
  });

  it('🔴 丸める前の値がプレビューに 1 つも出ない（`F-017 AC-3`）', () => {
    const html = renderPreviewCard(true);
    for (const forbidden of ['7 年', '65 万円', '650,000', '渋谷区', '2026-09-16']) {
      expect(html, `${forbidden} が出ている`).not.toContain(forbidden);
    }
  });

  it('🔴 ワイヤーフレーム右側の 5 項目外（`掲載元` ほか）を 1 つも描かない', () => {
    for (const shared of [true, false]) {
      const html = renderPreviewCard(shared);
      for (const word of [
        '掲載元',
        '所属会社',
        '所属区分',
        '他社',
        '性別',
        '年齢',
        'PR ポイント',
        'PRポイント',
        '並行状況',
        '最寄',
        'イニシャル',
      ]) {
        expect(html, `${word} が描かれている`).not.toContain(word);
      }
    }
  });

  it('🔴 共有していない人材のプレビューを「公開されている」と読める形にしない（[Issue #88]）', () => {
    const notShared = renderPreviewCard(false);
    expect(notShared).toContain(messages.previewStateNotShared);
    expect(notShared).not.toContain(messages.previewStateShared);
    // 🔴 「表示されています」（現在形の断定）が未共有の側に出ない。
    expect(notShared).not.toContain('次のように表示されています');

    const shared = renderPreviewCard(true);
    expect(shared).toContain(messages.previewStateShared);
    expect(shared).not.toContain(messages.previewStateNotShared);
  });

  it('🔴 プレビューの器は実行系を持たない（共有・解除のボタンは呼び出し側に在る）', () => {
    for (const shared of [true, false]) {
      const html = renderPreviewCard(shared);
      expect(html).not.toContain('<button');
      expect(html).not.toContain('engineer-share-confirm-submit');
    }
  });

  it('経歴が開示されないことを本文で明示する（`F-008 AC-7`）', () => {
    expect(renderPreviewCard(true)).toContain('data-testid="engineer-share-preview-careers-note"');
  });
});
