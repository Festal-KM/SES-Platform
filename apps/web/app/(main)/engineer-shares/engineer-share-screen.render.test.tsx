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
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`visibility-screen.render.test.tsx` と同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EngineerShareScreen,
  type EngineerShareRowView,
  type EngineerShareScreenMessages,
  type EngineerShareScreenProps,
} from './engineer-share-screen';

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
  loadMoreRetry: '再試行',
  previewSelect: '人材を選ぶと、ホストに表示される内容をここで確認できます。',
  previewNote: 'ホストに表示されるのは次の 5 項目だけです。',
  previewCareersNote: '経歴は開示されません。',
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
  shareConfirmCancel: 'やめる',
  shareSubmitting: '設定しています…',
  revoke: '共有を解除する',
  revokeConfirmTitle: '共有を解除しますか',
  revokeConfirmLead: '解除した時点で、ホストの候補一覧に表示されなくなります。',
  revokeConfirmSubmit: '解除する',
  revokeConfirmCancel: 'やめる',
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
});
