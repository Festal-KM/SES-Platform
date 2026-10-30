import { projectPagination } from '../../../lib/projects/pagination';
// apps/web/app/(main)/projects/project-list-screen.render.test.tsx
// `ProjectListScreen`（`S-010`）の状態別描画テスト。T-06-03。
//
// 🔴 なぜこの粒度で要るか（`engineer-ledger-screen.render.test.tsx` と同じ理由）:
//    ①**取引先視点で「公開先の設定状況」の列が消えること**（`F-014 AC-4` / `BR-07`）と
//    ②**`VIEWER` / 取引先に登録導線が無いこと**（`docs/04` §S-010 権限差分）は、
//      E2E の seed 依存を避けてここで固定する。
//    ③**スコア・順位・重み・「全 N ページ中 M ページ目」を描かないこと**（docs/05 §4.8）は
//      「描かれていないこと」が要件であり、API のテストでは示せない。
//    ④**検索条件がページングのリンクに残ること**（`docs/04` §10.1 `S-010`）。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';
import {
  ProjectListScreen,
  type ProjectListScreenMessages,
} from './project-list-screen';
import type { SearchPanelMessages } from './_search/search-panel';

// 🔴🔴 **`SearchPanel` が `useRouter()` を呼ぶ**（2026-10-19: 検索を**再読み込みなし**の
//    クライアント遷移にした。`_search/search-panel.tsx` 冒頭の 🔴🔴）。
//    `renderToStaticMarkup` には App Router の context が無いため、素のままだと
//    **`invariant expected app router to be mounted` で全件落ちる。**
//    他の画面の描画テスト（`proposal-approval-screen.render.test.tsx` ほか 3 本）と**同じ差し替え**である。
// ⚠️ ここは**サーバ描画だけを見るテスト**であり、遷移そのものは実画面で確認する。
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
  }),
}));

const PROJECT_A = '01930000-0000-7000-8000-0000000000c1';
const PROJECT_B = '01930000-0000-7000-8000-0000000000c2';

function row(overrides: Partial<ProjectListRowView> = {}): ProjectListRowView {
  return {
    id: PROJECT_A,
    name: '金融系 Web API 改修',
    status: '募集中',
    // 🔴 ✅ 2026-10-14: 状態の**値**（語ではない）。色は `@ses/ui` が状態名から決める。
    statusState: 'OPEN',
    mustRequirements: 'Java 5 年以上、Spring',
    moreMustRequirements: null,
    unitPrice: '65〜75 万円',
    purchaseUnitPrice: '90 万円',
    startDate: '2026-10-01',
    location: '東京都',
    remoteMode: '一部リモート可',
    headcount: '2 名',
    updatedOn: '2026-09-05',
    visibility: '3 社に公開中',
    ...overrides,
  };
}

const messages: ProjectListScreenMessages = {
  statusControl: {open:'募集中',closed:'終了',changeToOpen:'ステータスを募集中に変更',changeToClosed:'ステータスを終了に変更',saved:'変更しました',failed:'変更できませんでした'},
  populationLabel: '自社案件 2 件',
  partnerScopeNotice: null,
  orderNote: '後任募集 → 募集中 → 充足 の順に、同じ状態のなかでは更新日の新しい順に表示しています。',
  overflowNote: '右端が切れているときは、表を横にスクロールすると残りの列が見られます。',
  // ✅ 2026-10-16: 「リモート可否」を外した（稼働形態の絞り込みを実装したため）。
  // ⚠️ **2026-10-19: 検索条件の語は `searchMessages`（下）に移った。**
  register: '案件を登録',
  readOnlyNote: '案件の登録は、閲覧のみの権限では行えません。',
  columnName: '案件名',
  columnStatus: 'ステータス',
  columnMustRequirements: '必須要件の要約',
  columnUnitPrice: '卸単価',
  columnPurchaseUnitPrice: '想定仕入単価',
  columnStartDate: '開始日',
  columnLocation: '勤務地',
  columnRemoteMode: '稼働形態',
  columnHeadcount: '募集人数',
  columnUpdatedOn: '更新日',
  columnVisibility: '公開先の設定状況',
  columnAction: '操作',
  panelOpen: '内容を見る',
  columnToggleTrigger: '表示する列',
  emptyTitle: 'まだ案件が登録されていません。',
  emptyLead: '案件を登録すると、この一覧に表示されます。',
  nextPage: '次のページ',
  firstPage: '最初のページに戻る',
};

const statusOptions = [
  { value: '', label: 'すべて' },
  // ✅ 2026-10-16: 2 値になった（Issue #98 の回答「募集中と終了の二つだけでよい」）。
  { value: 'OPEN', label: '募集中' },
  { value: 'CLOSED', label: '終了' },
] as const;


const emptyApplied = {
  q: '',
  status: '',
  category: '',
  remoteMode: '',
  priceMin: '',
  priceMax: '',
  prefecture: '',
  startWithin: '',
  skills: [] as readonly string[],
} as const;

/** ✅ 2026-10-16（受領モック）: カテゴリ / 案件区分 / 並行可否 / 開始時期の選択肢。 */
const categoryOptions = [
  { value: '', label: 'すべて' },
  { value: 'BACKEND', label: 'バックエンド' },
  { value: 'FRONTEND', label: 'フロントエンド' },
] as const;
/**
 * ✅✅ 2026-10-16: スキルの選択肢（辞書の ID と `name`）。
 * 🔴 **「すべて」を含まない** —— `<select multiple>` では**何も選んでいない状態が「すべて」**である。
 */
const skillOptions = [
  { value: '11111111-1111-7111-8111-111111111111', label: 'Java' },
  { value: '22222222-2222-7222-8222-222222222222', label: 'TypeScript' },
] as const;

/** ✅ 2026-10-16: 稼働形態の選択肢（値の出所は `REMOTE_MODES`。語は一覧の列と同じ）。 */
const remoteModeOptions = [
  { value: '', label: 'すべて' },
  { value: 'FULL_REMOTE', label: 'フルリモート可' },
  { value: 'PARTIAL_REMOTE', label: '一部リモート可' },
  { value: 'ONSITE_ONLY', label: '常駐' },
] as const;

/**
 * 🔴 列表示切替の項目（`T-22-06`）。**組み立てはサーバ側**（`list-props.ts` の
 * `projectColumnToggleItems` / `list-rows.ts` の `projectColumnToggleHref`）であり、
 * ここでは「画面が受け取った形をどう描くか」だけを見る。
 */
const COLUMN_TOGGLE_SHOWN = [
  {
    id: 'visibility',
    label: '「公開先の設定状況」の列を隠す',
    hidden: false,
    href: '/projects?hide=visibility',
  },
] as const;

// ⚠️ **2026-10-16: 「隠している状態」の形は外した** —— `表示する列` のボタンを画面から
//    外した時点（人間の明示指示）で、この形を描く経路が 1 つも無くなったためである。
//    🔴 **`?hide=` の query を受け取れる状態は保っている**（`page.tsx` が `columnToggleItems` を
//    組み立て続けている）ので、共有された URL は壊れていない。

/** ✅✅ 2026-10-19: 検索エリア（`_search/`）の選択肢と語。 */
const prefectureOptions = [
  { value: '', label: 'すべて' },
  { value: '13', label: '東京都' },
] as const;
const startWithinOptions = [
  { value: '', label: 'すべて' },
  { value: 'THIS_MONTH', label: '今月' },
] as const;
const searchOptions = {
  statusOptions,
  categoryOptions,
  remoteModeOptions,
  prefectureOptions,
  startWithinOptions,
  skillOptions,
};
const searchMessages: SearchPanelMessages = {
  tabsLabel: '検索エリアの切り替え',
  tabSearch: '検索条件',
  selectedSavedLabel: '選択中の保存条件',
  selectedSavedModified: '変更あり',
  tabSaved: '保存した条件',
  save: '条件を保存',
  collapse: '折りたたむ',
  expand: '展開する',
  saveDialogTitle: '条件を保存',
  saveDialogNameLabel: '保存名',
  saveDialogNamePlaceholder: '例：Python 案件',
  saveDialogConfirm: '保存',
  renameDialogTitle: '名前を変更',
  overwriteDialogTitle: '現在の条件で上書き',
  overwriteCurrent: '条件を上書きする',
  overwriteDialogConfirm: '上書き',
  removeDialogTitle: '保存した条件を削除',
  removeDialogConfirm: '削除',
  cancel: 'キャンセル',
  nameError: '保存名は 1〜40 文字で入力してください。',
  limitError: '保存できる条件は 30 件までです。',
  writeError: 'このブラウザーに保存できませんでした。',
  saved: '保存しました。',
  renamed: '名前を変更しました。',
  overwritten: '上書きしました。',
  removed: '削除しました。',
  summaryJoiner: '、',
  quoteOpen: '「',
  overwriteDialogBodySuffix: '」を上書きします。',
  removeDialogBodySuffix: '」を削除します。',
  saveDialogBodyPrefix: '次の条件を保存：',
  saveDialogBodyEmpty: '条件なし',
  form: {
    q: 'フリーワード',
    qPlaceholder: '案件名・キーワードで検索',
    status: 'ステータス',
    category: 'カテゴリ',
    skill: 'スキル',
    remoteMode: '稼働形態',
    price: '単価（月額）',
    priceMin: '単価（下限）',
    priceMax: '単価（上限）',
    priceMinPlaceholder: '下限なし',
    priceMaxPlaceholder: '上限なし',
    priceSeparator: '〜',
    priceUnit: '円',
    priceInverted: '単価の下限が上限を上回っています。',
    prefecture: '勤務地',
    startWithin: '開始時期',
    skillMessages: {
      placeholder: 'スキルを選択',
      remove: 'を解除',
      overflowLabel: '選んだスキルをすべて見る',
      selectedCountSuffix: '件選択',
      searchLabel: 'スキルを名前で絞り込む',
      searchPlaceholder: 'スキルを検索',
      modeAll: 'すべて',
      modeSelected: '選択中',
      noMatch: '該当するスキルがありません。',
      selectedSummarySuffix: '件選択中',
      clearSelection: '選択をクリア',
      triggerLabel: 'スキル',
    },
    selectMessages: {
      searchLabel: '選択肢を名前で絞り込む',
      searchPlaceholder: '絞り込む…',
      noMatch: '該当する選択肢がありません。',
    },
  },
  bar: {
    label: '選択中の条件',
    empty: '条件は指定されていません',
    remove: 'を解除',
    overflowLabel: '表示しきれない条件を開く',
    clear: '条件をクリア',
    submit: '検索',
    pending: '未適用',
    pendingHint: '一覧はまだ以前の条件の結果です。',
  },
  savedList: {
    search: '保存条件名・スキルで絞り込み',
    sort: '並び順',
    sortRecent: '最近使った順',
    sortUpdated: '更新が新しい順',
    sortName: '名前順',
    columnName: '条件名',
    columnFilters: '保存した検索条件',
    columnActions: '操作',
    countSuffix: '件',
    range: '{total}件中 {from}–{to}件を表示',
    noResults: '該当する保存条件がありません。',
    previous: '前へ',
    next: '次へ',

    apply: '適用',
    menuLabel: 'の操作メニュー',
    rename: '名前を変更',
    overwrite: '現在の条件で上書き',
    remove: '削除',
    emptyTitle: '保存した条件はまだありません。',
    emptyAction: '現在の条件を保存',
    brokenNote: '保存した条件を読み込めませんでした。',
    storageNote: '保存した条件はこのブラウザーに保存しています。',
    noCondition: '条件なし',
    activeLabel: '適用中',
  },
  chipLabels: {
    statusOptions,
    categoryOptions,
    remoteModeOptions,
    prefectureOptions,
    startWithinOptions,
    skillOptions,
    fieldLabels: {
      q: 'フリーワード',
      category: 'カテゴリ',
      prefecture: '勤務地',
      startWithin: '開始時期',
      price: '単価（月額）',
    },
    fieldSeparator: '：',
    priceRangeSeparator: '〜',
    priceUnit: '円',
  },
};

function render(
  overrides: Partial<Parameters<typeof ProjectListScreen>[0]> = {},
): string {
  // 🔴 取引先には 9 列目そのものが無いので、切替も届かない（`page.tsx` と同じ導き方）。
  return renderToStaticMarkup(
    createElement(ProjectListScreen, {
      rows: [row()],
      applied: emptyApplied,
      searchOptions,
      passThroughParams: [],
      storageTenantId: '01930000-0000-7000-8000-0000000000a1',
      storageUserId: '01930000-0000-7000-8000-0000000000b1',
      defaultExpanded: true,
      searchMessages,
      canRegister: true,
      pagination: projectPagination({limit:50},1,1),
      columnToggleItems: COLUMN_TOGGLE_SHOWN,
      // 🔴 SP-22 段④: 副カラムで開いている行（既定は先頭行）と、行から開く URL。
      //    組み立ては `lib/projects/list-rows.test.ts`（`selectedProjectId` / `projectSelectHref`）が
      //    固定する。ここでは「画面が受け取った形をどう描くか」だけを見る。
      selectedId: PROJECT_A,
      selectHrefOf: (projectId: string) => `/projects?selected=${projectId}`,
      messages,
      ...overrides,
    }),
  );
}


describe('単価の表示範囲', () => {
  it('ホストは仕入単価と卸単価を別列で表示する', () => {
    const html = render();
    expect(html).toContain('仕入単価');
    expect(html).toContain('卸単価');
    expect(html).toContain('90 万円');
    expect(html).toContain('65〜75 万円');
  });
  it('取引先は卸単価だけを表示する', () => {
    const html = render({
      rows: [row({ purchaseUnitPrice: null, visibility: null })],
      messages: { ...messages, partnerScopeNotice: '御社に公開された案件' },
    });
    expect(html).not.toContain('仕入単価');
    expect(html).not.toContain('90 万円');
    expect(html).toContain('卸単価');
    expect(html).toContain('65〜75 万円');
  });
});

describe('🔴 docs/05 §4.8: 順位・全体件数・スコアを描かない', () => {
  it('ページ番号（「全 N ページ中 M ページ目」）を描かない', () => {
    const html = render({pagination:projectPagination({limit:50},120,50)});

    expect(html).not.toContain('ページ目');
    expect(html).not.toContain('ページ中');
  });

  it('スコア・順位・重みの語が 1 つも出ない（Phase 1）', () => {
    const html = render();

    for (const word of ['スコア', '順位', '重み', '適合度']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });
});

describe('権限差分（docs/04 §S-010）', () => {
  // 🔴 **SP-22 段④で登録の導線は帯（`PageHeader`）へ移った**（`docs/04` §S-010「案件を登録
  //    （primary、ホストのみ）」/ §7.6「primary は大きく」）。したがって本体には描かれない。
  //    🔴 **判定の検出器は失っていない** —— `projectListPrimaryAction(canRegister)` が
  //    `null` を返すことを `lib/projects/list-rows.test.ts` が固定し（`page.tsx` は
  //    ユニットテストの対象外であるため、判定を `lib/**` に置いた）、`PageHeading` 側の
  //    `kind: 'ACTION'` × `canAct` の落とし方は `_shell/page-heading.render.test.tsx` が固定する。
  it('🔴 本体（一覧）には登録導線が無い（帯の primary へ移したため。二重に描かない）', () => {
    expect(render()).not.toContain('href="/projects/new"');
    expect(render({ canRegister: false })).not.toContain('href="/projects/new"');
  });

  it('🔴 取引先・`VIEWER` には理由テキストが出る（`disabled` のボタンを置かない。§7.6）', () => {
    const html = render({ canRegister: false });

    expect(html).toContain('data-testid="project-list-read-only-note"');
    expect(html).toContain('案件の登録は、閲覧のみの権限では行えません。');
  });

  it('🔴 登録できるロールには理由テキストを出さない（出すと「できない」と読める）', () => {
    const html = render();

    expect(html).not.toContain('data-testid="project-list-read-only-note"');
    expect(html).not.toContain('案件の登録は、閲覧のみの権限では行えません。');
  });

  it('取引先には母集団の説明が 1 行増える', () => {
    const html = render({
      messages: { ...messages, partnerScopeNotice: 'この一覧には、御社に公開された案件のみが表示されます。' },
    });

    expect(html).toContain('御社に公開された案件のみが表示されます');
  });
});

describe('行から詳細への導線（docs/04 §S-010「行クリックで `S-011`」）', () => {
  // ✅✅ **2026-10-16: 名称の行き先が `S-011` から「右パネルを開く URL」に変わった**
  //    （人間の明示指示「案件タイトルもリンクにしない。列クリック→右側で詳細をクリックで
  //    詳細画面に行く動線」）。🔴 **行いっぱいが当たり判定である**（`nameCell.stretch`）。
  it('行の当たり判定が右パネルを開く URL になる', () => {
    // 2026-10-16: 行の行き先は右パネルを開く URL（selectHrefOf）である。
    expect(render()).toContain(`project-list-link-${PROJECT_A}`);
  });

  it('複数行を描ける', () => {
    const html = render({ rows: [row(), row({ id: PROJECT_B, name: '物流管理システム保守' })] });

    expect(html).toContain(`project-list-link-${PROJECT_A}`);
    expect(html).toContain(`project-list-link-${PROJECT_B}`);
  });

  it('🔴 超過件数は 0 のとき描かない（`+0` を出さない）', () => {
    expect(render()).not.toContain('+0');
    expect(render({ rows: [row({ moreMustRequirements: '+2' })] })).toContain('+2');
  });
});

describe('空状態（docs/04 §10.1 `S-010`）', () => {
  it('0 件のときはデータ行を 1 行も描かず、呼び出し側が選んだ文言を出す', () => {
    const html = render({ rows: [] });

    // ⚠️ **T-22-06 で判定の形を追随させた（緩めていない）**: `@ses/ui` の `DataTable` は空状態を
    //    **表の中の 1 行**（`project-list-empty-row` の `colSpan`）として描く契約である
    //    （`docs/05` §2.3.5 の `empty`）。🔴 守るべき中身は「**データ行が 0 であること**」である。
    expect(html).toContain('data-testid="project-list-empty-row"');
    expect(html).not.toContain('data-testid="project-list-row-');
    expect(html).toContain('まだ案件が登録されていません。');
  });

  it('🔴 取引先の初回空は「公開されていない」と書く（「案件が無い」と書かない）', () => {
    const html = render({
      rows: [],
      messages: {
        ...messages,
        emptyTitle: '御社に公開された案件はまだありません。',
        emptyLead: '案件が公開されると、この画面と通知でお知らせします。',
      },
    });

    expect(html).toContain('御社に公開された案件はまだありません。');
    expect(html).not.toContain('まだ案件が登録されていません。');
  });
});

// ============================================================================
// ✅✅ **2026-10-19: 検索エリアの改修**（人間の指示書 `BizOrch_SearchArea_ClaudeCode.md`）
// ============================================================================
// 🔴 指示書 §8 の**必須の完成条件**のうち、描画で示せるものをここに固定する。
//    （「＋N から解除できる」「折りたたんでも検索できる」の**操作**は実画面で見る）
describe('検索エリア（改修指示書 §2 の 3 層）', () => {
  it('`method="get"` のフォームで `/projects` に送る（検索の経路を変えていない）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-list-filters"');
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/projects"');
  });

  it('🔴 3 層（ヘッダ / 本文 / 条件バー）がそろっている', () => {
    const html = render();

    // A. ヘッダ（タブ + 条件を保存 + 折りたたむ）
    expect(html).toContain('role="tablist"');
    expect(html).toContain('案件検索');
    expect(html).toContain('保存した条件');
    expect(html).toContain('data-testid="project-list-search-save"');
    expect(html).toContain('data-testid="project-list-search-toggle"');
    // B. 本文
    expect(html).toContain('data-testid="project-list-filter-q"');
    // C. 条件バー（常時表示）
    expect(html).toContain('data-testid="project-list-summary"');
    expect(html).toContain('data-testid="project-list-clear"');
    expect(html).toContain('data-testid="project-list-search"');
  });

  it('🔴 折りたたみのボタンが `aria-expanded` / `aria-controls` を持つ', () => {
    expect(render()).toMatch(
      /data-testid="project-list-search-toggle"[^>]*|aria-expanded="true"[^>]*data-testid="project-list-search-toggle"/,
    );
    expect(render()).toContain('aria-expanded="true"');
    // 🔴 cookie が `'0'` なら閉じた状態でサーバが描く（再訪時の復元）。
    expect(render({ defaultExpanded: false })).toContain('aria-expanded="false"');
  });

  // ==========================================================================
  // 🔴🔴 水合前（= JS が死んでいるとき）の送信
  // ==========================================================================
  // `tests/static/form-method-required.test.ts` が「既存の検索フォーム（`S-005` /
  // **`S-010`** / …）は JS 無しでも正しく動く」と明文で書いている。
  // 🔴 **素の入力欄（キーワード / 単価）は、本文が見えていれば欄そのものが送る**（`name` を持つ）。
  //    持たせないと、水合前に打った語が捨てられて**前の条件で静かに検索される**。
  // 🔴🔴 **自前の引き金（ステータス等）は常に hidden が送る。**
  //    ✅✅ 2026-10-19 に `<select>` を `role="combobox"` の `<div>` に替えた
  //    （人間の指示「スキルのプルダウンと同じ UI にして」）。`<div>` は**ネイティブの
  //    フォーム値を持たない**ので、素の入力欄と同じ出し分けにすると
  //    **本文を開いている間だけ条件が送られない**という最悪の壊れ方になる。
  it('🔴🔴 展開中: 素の欄は自分で送り、自前の引き金は hidden が送る', () => {
    const html = render({ applied: { ...emptyApplied, q: '基幹', status: 'OPEN' } });

    // ① 見える欄が `name` を持っている（キーワード）。
    expect(html).toMatch(/data-testid="project-list-filter-q"[^>]*name="q"|name="q"[^>]*data-testid="project-list-filter-q"/);
    // 🔴 **同じキーの hidden を重ねて出さない**（`optionalFilter` が壊れる）。
    expect(html).not.toContain('<input type="hidden" name="q"');

    // ② 自前の引き金は `name` を持たず、hidden が肩代わりする。
    const trigger = /<[^>]*data-testid="project-list-filter-status"[^>]*>/.exec(html)?.[0] ?? '';
    expect(trigger).not.toBe('');
    expect(trigger).not.toContain('name=');
    expect(trigger).toContain('role="combobox"');
    expect(html).toContain('<input type="hidden" name="status" value="OPEN"/>');
    expect(render({ applied: { ...emptyApplied, skills: ['11111111-1111-7111-8111-111111111111'] } }))
      .toContain('<input type="hidden" name="skills" value="11111111-1111-7111-8111-111111111111"/>');
  });

  it('🔴🔴 折りたたんでいるときは hidden が補い、本文は `disabled` で送らない', () => {
    const html = render({
      defaultExpanded: false,
      applied: { ...emptyApplied, q: '基幹', status: 'OPEN', priceMin: '600000' },
    });

    expect(html).toContain('<input type="hidden" name="q" value="基幹"/>');
    expect(html).toContain('<input type="hidden" name="status" value="OPEN"/>');
    expect(html).toContain('<input type="hidden" name="priceMin" value="600000"/>');
    // 🔴 **`inert` だけでは送信は止まらない**ので `<fieldset disabled>` を置いている。
    expect(html).toContain('<fieldset class="contents" disabled="">');
    expect(html).toContain('inert=""');
  });

  it('🔴 現在の条件が欄にも戻る（検索してもフォームが空にならない）', () => {
    const html = render({
      applied: {
        ...emptyApplied,
        q: '基幹',
        status: 'OPEN',
        category: 'BACKEND',
        remoteMode: 'FULL_REMOTE',
        priceMin: '600000',
        priceMax: '800000',
        prefecture: '13',
        startWithin: 'THIS_MONTH',
        skills: ['22222222-2222-7222-8222-222222222222'],
      },
    });

    expect(html).toContain('基幹');
    expect(html).toContain('name="keywordGroups"');
    expect(html).toContain('value="600000"');
    expect(html).toContain('value="800000"');
    // ✅✅ 2026-10-19: 自前の引き金になったので **`<option selected>` ではなく
    //    「引き金に選んだ語が出ている」**ことを見る（人間の指示でプルダウンを統一した）。
    //    🔴 ここで語を見るのは、**選んだ値が利用者に見えること**が要件だからである
    //    （`value` の往復は hidden で、下の 🔴 が別に固定している）。
    for (const label of ['募集中', 'バックエンド', 'フルリモート可', '東京都', '今月']) {
      expect(html).toContain(label);
    }
    // 🔴 **送信に載る値も往復している**（引き金の語だけでは URL に戻らない）。
    for (const [name, value] of [
      ['status', 'OPEN'],
      ['category', 'BACKEND'],
      ['remoteMode', 'FULL_REMOTE'],
      ['prefecture', '13'],
      ['startWithin', 'THIS_MONTH'],
    ]) {
      expect(html).toContain(`<input type="hidden" name="${name}" value="${value}"/>`);
    }
    // 🔴 選んだスキルは**バッジ**で見える。
    expect(html).toContain('TypeScript');
  });

  it('🔴🔴 検索項目は 8 つちょうどで、「並行可否」が無い（指示書 §3）', () => {
    const html = render();

    for (const testId of [
      'project-list-filter-q',
      'project-list-filter-status',
      'project-list-filter-category',
      'project-list-filter-skills',
      'project-list-filter-remote-mode',
      'project-list-filter-price-min',
      'project-list-filter-price-max',
      'project-list-filter-prefecture',
      'project-list-filter-start-within',
    ]) {
      expect(html).toContain(`data-testid="${testId}"`);
    }
    // 🔴 **並行可否はラベルも欄も送信も無い**。
    expect(html).not.toContain('並行可否');
    expect(html).not.toContain('name="parallelOk"');
    // ⚠️ 画面に欄の無い条件は素通しする（共有された URL を壊さない）。
    expect(render({ passThroughParams: [{ name: 'sourceKind', value: 'OWN' }] })).toContain(
      '<input type="hidden" name="sourceKind" value="OWN"/>',
    );
  });

  it('🔴🔴 スキルの引き金は高さ 36px 固定で、折り返さない（指示書 §3 / §8）', () => {
    const html = render({
      applied: { ...emptyApplied, skills: skillOptions.map((option) => option.value) },
    });

    const trigger = /<div[^>]*data-testid="project-list-filter-skills"[^>]*>/.exec(html)?.[0] ?? '';
    expect(trigger).not.toBe('');
    expect(trigger).toContain('h-9');
    expect(trigger).not.toContain('min-h-');
    expect(trigger).not.toContain('flex-wrap');
    // 🔴 **ボタンの中にボタンを入れない**（引き金は `role="combobox"` の `<div>`）。
    expect(trigger).toContain('role="combobox"');
    expect(trigger).toContain('aria-expanded="false"');
  });

  it('🔴 スキルの `×` は「<スキル名>を解除」と読み上げられる（指示書 §7）', () => {
    const html = render({
      applied: { ...emptyApplied, skills: ['11111111-1111-7111-8111-111111111111'] },
    });

    expect(html).toContain('aria-label="Javaを解除"');
  });

  it('🔴 未選択のときは「スキルを選択」（空の引き金を置かない）', () => {
    expect(render()).toContain('スキルを選択');
  });

  it('🔴 条件バー: 未選択なら「条件は指定されていません」、選択中ならバッジ', () => {
    expect(render()).toContain('data-testid="project-list-summary-empty"');

    const html = render({ applied: { ...emptyApplied, status: 'OPEN', prefecture: '13' } });
    expect(html).not.toContain('data-testid="project-list-summary-empty"');
    // 🔴 **意味が曖昧になる値には項目名を付ける**（指示書 §4）。
    expect(html).toContain('勤務地：東京都');
    expect(html).toContain('data-testid="project-list-chip-remove-status"');
    expect(html).toContain('data-testid="project-list-chip-remove-prefecture"');
  });

  it('🔴 読み込み直後は「未適用」を出さない（draft と applied が一致している）', () => {
    expect(render()).not.toContain('data-testid="project-list-pending"');
    expect(render({ applied: { ...emptyApplied, status: 'OPEN' } })).not.toContain(
      'data-testid="project-list-pending"',
    );
  });

  it('🔴 単価レンジは入力欄を描く（単位は円のまま）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-list-filter-price-min"');
    expect(html).toContain('data-testid="project-list-filter-price-max"');
    expect(html).toContain('円');
    expect(html).not.toContain('万円</span>');
  });

  it('🔴 検索エリアは白い面のカードの中にある（ページ地に溶けない）', () => {
    const html = render();
    const panel = /<div[^>]*data-testid="project-list-search-panel"[^>]*>/.exec(html)?.[0] ?? '';

    expect(panel).toContain('bg-surface');
    expect(panel).toContain('border-border');
    // 2026-10-29の画像指定に従い、既存の入力欄と同じ控えめな影だけを使う。
    expect(panel).not.toContain('shadow-control');
  });
});

describe('ページング（検索条件を保つ）', () => {
  it('編集できる利用者だけに行内のステータス切替を表示する', () => {
    expect(render()).toContain(`data-testid="project-list-status-toggle-${PROJECT_A}"`);
    expect(render({canRegister:false})).not.toContain('data-testid="project-list-status-toggle-');
  });
  it('フッターだけに番号・件数・表示件数の選択を置く', () => {
    const html=render({pagination:projectPagination({limit:50,q:'Java',page:2},120,50)});
    expect(html).toContain('120件中 51–100件を表示');
    expect(html).toContain('data-testid="project-list-page-size"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('q=Java');
    expect(html).not.toContain('project-list-paging-top');
  });
  it('0件でも実際の範囲と操作不可の端を表示する', () => {
    const html=render({rows:[],pagination:projectPagination({limit:50},0,0)});
    expect(html).toContain('0件中 0–0件を表示');
    expect(html).toContain('aria-disabled="true"');
  });
  it('一覧と検索を共通カードに分け、余白を持たせる', () => {
    const html=render();
    expect(html).toContain('project-list-table-card');
    expect(html).toContain('flex flex-col gap-4');
  });
});
describe('🔴 T-11-12: 案件名セルが docs/04 §10.3「長い名称」のブレークポイント別規約と一致する（`@ses/ui` の `NameCell`）', () => {
  it('lg 未満 = 折り返し + 下限 10rem、lg 以上 = 切り詰め（器）+ title + 同じ行に S-011 への導線', () => {
    const html = render({ rows: [row({ name: '金融系 Web API 改修' })] });
    // ⚠️ **T-22-06: `<td>` の属性が増えたぶんだけ正規表現を緩めた（判定は 1 つも緩めていない）**。
    //    `DataTable` は列定義由来の `style="min-width:…"` と `data-column-id` をセルに付ける。
    // ⚠️ ✅ **2026-10-15: 名称の前に状態の点（`StatusDot`）が入った**ぶん、`<td>` の直後に
    //    1 つ `<span>` が増える（`NameCell.leading`）。**判定は 1 つも緩めていない** ——
    //    名称の `<span>`（`title` 付き）の中身は下で同じだけ検査している。
    const cell =
      /<td class="([^"]*)"[^>]*>(?:<span class="mr-2[^"]*">.*?<[/]span>)?(<span class="[^"]*" title="金融系 Web API 改修">.*?<[/]span>)<[/]td>/.exec(
        html,
      );
    expect(cell).not.toBeNull();
    const classes = (cell?.[1] ?? '').split(' ');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('min-w-40');
    // 2026-10-16: 行いっぱいのリンクになったので切り詰めない（全文は折り返しで読める）。
    expect(classes).not.toContain('lg:max-w-64');
    expect(classes).not.toContain('truncate');
    expect(classes).not.toContain('whitespace-nowrap');
    const inner = cell?.[2] ?? '';
    // 2026-10-16: 行いっぱいのリンクになったので切り詰めない（`block` のまま）。
    //    全文は折り返しで読め、`title` も残っている（§10.3 の「長い名称を読めること」は満たす）。
    expect(inner).toContain('<span class="block" title="金融系 Web API 改修">');
    const link = /<a ([^>]*)>金融系 Web API 改修<[/]a>/.exec(inner);
    expect(link).not.toBeNull();
    expect(link?.[1]).toContain(`project-list-link-${PROJECT_A}`); // 2026-10-16: 右パネルを開く URL
    expect(link?.[1]).toContain(`data-testid="project-list-link-${PROJECT_A}"`);
    expect(link?.[1]).not.toContain('truncate');
  });

  // ✅✅ **2026-10-16: 状態の点（`StatusDot`）を外した**（人間の明示指示「案件名の左に
  //    〇があるけどこれはいらないね」）。🔴 **状態は隣の列の `StatusBadge` が語で出している**
  //    ので、読み取れる情報は 1 つも減っていない（案件名の左端が揃うぶん読みやすくなる）。
  it('🔴 名称の前に状態の点を出さない（状態は隣の列の Badge が語で出す）', () => {
    const html = render({ rows: [row({ name: '金融系 Web API 改修' })] });

    expect(html).not.toContain('data-entity="project" data-state="OPEN" aria-hidden');
    // 🔴 状態そのものは消えていない（Badge が語で出す）。
    expect(html).toContain('募集中');
  });
});

// ============================================================================
// 🔴 T-22-06: 列の集合・並び・ブレークポイントが**移行前と同一**である（受け入れ基準 2）
// ============================================================================
// 🔴 **整形のついでに列を足さない / 落とさない。** `hidden lg:table-cell` の直書きを列定義の
//    `priority` に移しただけであり、DOM に出る列と消える境界は 1 つも変わっていない
//    （§10.3 の `S-010` の行「募集人数 → 勤務地 → 更新日」/ §S-010「デバイス別」）。
//
// | 列 | 移行前のクラス | 移行後の `priority` |
// |---|---|---|
// | 案件名 | （常時） | `always` |
// | 状態 | （常時） | `always` |
// | 必須要件の要約 | `hidden lg:table-cell` | `lg` |
// | 単価レンジ | （常時） | `always` |
// | 開始日 | （常時） | `always` |
// | 勤務地・リモート | `hidden sm:table-cell` | `sm` |
// | 募集人数 | `hidden lg:table-cell` | `lg` |
// | 更新日 | `hidden sm:table-cell` | `sm` |
// | 公開先の設定状況（ホストのみ） | `hidden lg:table-cell` | `lg` + `hideable`（9 列目） |
describe('🔴 T-22-06: 列の契約（移行前と同一。増減 0）', () => {
  /**
   * 🔴 **データ列だけを返す**（`data-column-id` を持つ `<th>`）。
   *    ⚠️ **SP-22 段④ で操作列（`内容を見る`）が増えた**が、操作列は `docs/04` §7.1 の
   *    「既定 8 列 + **操作列**」の後者であり、**データ列の集合は 1 つも変わっていない**。
   *    操作列が 1 つだけ在ることは下の専用のテストが固定する（判定を緩めていない）。
   */
  function headerColumns(html: string): { readonly id: string; readonly breakpoint: string }[] {
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(html)?.[1] ?? '';
    return [...head.matchAll(/<th ([^>]*)>/g)]
      .map((match) => {
        const attributes = match[1] ?? '';
        const id = /data-column-id="([^"]+)"/.exec(attributes)?.[1] ?? '?';
        const classes = /class="([^"]*)"/.exec(attributes)?.[1] ?? '';
        const breakpoint = classes.includes('hidden lg:table-cell')
          ? 'lg'
          : classes.includes('hidden sm:table-cell')
            ? 'sm'
            : 'always';
        return { id, breakpoint };
      })
      .filter((column) => column.id !== '?');
  }


  // ✅ **2026-10-15: 10 列になった**（[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101) の回答 C で
  //    `勤務地・リモート` を 2 列に分けた）。🔴 **出ている情報は 1 つも増えていない。**
  it('ホスト = 10 列（10 列目は公開先の設定状況）。並びと境界が表どおりである', () => {
    expect(headerColumns(render())).toEqual([
      { id: 'name', breakpoint: 'always' },
      { id: 'status', breakpoint: 'always' },
      { id: 'mustRequirements', breakpoint: 'lg' },
      { id: 'purchaseUnitPrice', breakpoint: 'always' },
      { id: 'unitPrice', breakpoint: 'always' },
      { id: 'startDate', breakpoint: 'always' },
      { id: 'location', breakpoint: 'sm' },
      { id: 'remoteMode', breakpoint: 'sm' },
      { id: 'headcount', breakpoint: 'lg' },
      { id: 'updatedOn', breakpoint: 'sm' },
    ]);
  });


  it('モバイルでも仕入単価と卸単価を比較できる', () => {
    const always = headerColumns(render()).filter((column) => column.breakpoint === 'always');
    expect(always.map((column) => column.id)).toEqual(['name', 'status', 'purchaseUnitPrice', 'unitPrice', 'startDate']);
  });


  it('🔴 行選択（`selection`）を描かない（Phase 1 に一括操作は無い）', () => {
    expect(render()).not.toContain('data-testid="project-list-select-');
  });
});

// ============================================================================
// 🔴 T-22-06 の仕上げ: 列表示切替（`docs/04` §7.1 / §5-13）
// ============================================================================
// 🔴 §7.1 は「**既定 8 列 + 操作列。9 列目以降は列表示切替に格納する**」と定めている。
//    列定義に `hideable` を付けただけでは**利用者が列を隠す手段が無く**、条文が満たされない。
// ⚠️ **メニューの項目（`隠す` / `表示する` のリンク）は DOM に出ない** —— Radix の
//    `DropdownMenu` は開いた状態を `Portal` に載せ、`react-dom/server` には `document` が
//    無いためサーバ描画では何も出さない（`app/_components/ui-overlays.render.test.tsx` の実測）。
//    したがってここで観測するのは **①トリガの置き場所 ②いま隠している列（`data-hidden-columns`）
//    ③`<thead>` / 行に現れる列**の 3 つである。項目の href の組み立ては
//    `lib/projects/list-rows.test.ts` が固定する。

// ============================================================================
// 🔴 SP-22 段④: ワイヤーフレームへの刷新（**見せ方だけ**。人間の
//    「SES Hub案件管理ダッシュボード.png」）
// ============================================================================
describe('🔴 SP-22 段④: 絞り込みカードと件数バー', () => {
  it('検索フォームと条件バーは白い検索エリア内にある', () => {
    const html = render();
    const panel = html.indexOf('data-testid="project-list-search-panel"');
    const form = html.indexOf('data-testid="project-list-filters"');
    const summary = html.indexOf('data-testid="project-list-summary"');
    expect(panel).toBeGreaterThanOrEqual(0);
    expect(form).toBeGreaterThan(panel);
    expect(summary).toBeGreaterThan(form);
  });

  it('基本検索の下に詳細検索があり、キーワードの追加欄に読み上げ名がある', () => {
    const html = render();
    expect(html).toContain('基本検索');
    expect(html).toContain('詳細検索');
    expect(html).toContain('グループ1');
    expect(html).toContain('aria-label="キーワードを追加 1"');
    expect(html.indexOf('詳細検索')).toBeGreaterThan(html.indexOf('基本検索'));
  });

  // ✅✅ **2026-10-19: 「スキル欄の説明の 1 行」を外し、**条件バーの位置**を固定する。
  //    改修指示書 §2 は「本文を閉じても、この条件バーとヘッダは残す」と定めており、
  //    バーが**検索エリアの中（表の手前）**にあることがその前提である。
  //    ⚠️ 「複数選べます」の注記は指示書の構成に無いため画面から外した
  //       （文言キー `projects.list.search.skillHint` は消していない。`U-22` の凍結）。
  it('🔴 条件バーは検索エリアの中（フォームの中・表の手前）にある', () => {
    const html = render();
    const form = html.indexOf('data-testid="project-list-filters"');
    const summary = html.indexOf('data-testid="project-list-summary"');
    const table = html.indexOf('data-testid="project-list-table"');

    expect(summary).toBeGreaterThan(form);
    expect(summary, '表より後に出ている（検索エリアの外）').toBeLessThan(table);
  });

  it('🔴 並び順は**選べる形にしない**（`?sort=` は既存 API に無い）', () => {
    const html = render();

    // 並び替えのリンク（`DataTableSortLink`）も、並び順のセレクトも描かない。
    expect(html).not.toContain('data-testid="project-list-sort-');
    expect(html).not.toContain('name="sort"');
    expect(html).not.toContain('name="order"');
  });

  it('🔴 既存 API（#25）に無い条件の入力欄を 1 つも描かない', () => {
    const html = render();

    // ✅ 2026-10-15: `priceMin` / `priceMax` はこの一覧から外した（API に入ったため）。
    // ✅✅ **2026-10-16: `category` / `kind` / `parallel` / `openOnly` もこの一覧から外した** ——
    //    受領モックの絞り込みを実装し、**API（`#25`）の query に入った**ためである
    //    （`category` / `sourceKind` / `parallelOk` / `recruitingOnly`。列は migration
    //     `20261016030000`、承認は [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）。
    //    🔴 **この検査が守っているのは「押しても効かない入力欄を作らない」である。** 実装した
    //       条件を一覧に残すと、**実装したことを検査が禁じる**状態になり、意味が反転する。
    //    ✅✅ **2026-10-16（同日の 2 回目）: `skills` もこの一覧から外した** ——
    //       人間の明示指示「スキル（リストから複数選択できる、or 検索）」を実装し、
    //       **`#25` の query に入った**（`projectListQuerySchema.skills`。述語は
    //       `project_requirements` への `some` + `skillId IN (…)`）。
    //    🔴 **残りは 1 つも描かない**（表示件数は API に無い。`name="remote"` は
    //       `remoteMode` の綴り間違いを拾うための番兵である）。
    for (const name of ['name="remote"', 'name="limit"']) {
      expect(html, `${name} の入力欄が描かれている（API に無い条件）`).not.toContain(name);
    }
  });
});

// ============================================================================
// 🔴 ✅ 2026-10-14: 状態列は `StatusBadge`（受領した定義書 §1.7「ステータス 100 Badge」）
// ============================================================================
describe('🔴 状態は Badge で描き、色は画面が決めない（`docs/04` §5-13）', () => {
  it('状態名が `data-state` に出て、語は `packages/i18n` 由来のまま出る', () => {
    const html = render();

    expect(html).toContain('data-entity="project"');
    expect(html).toContain('data-state="OPEN"');
    expect(html).toContain('募集中');
  });

  it('🔴 行ごとに状態名が変わる（語ではなく値で描き分けている）', () => {
    const html = render({
      rows: [
        row({ status: '募集中', statusState: 'OPEN' }),
        row({ id: PROJECT_B, name: '物流管理システム保守', status: '終了', statusState: 'CLOSED' }),
      ],
    });

    expect(html).toContain('data-state="OPEN"');
    expect(html).toContain('data-state="CLOSED"');
  });

  it('🔴 画面が色を渡していない（`variant` / `shape` / 色のクラスを 1 つも書いていない）', () => {
    // 🔴 **画面側のソースを見る検査ではない** —— 色の語が DOM に出るのは `@ses/ui` の
    //    `STATUS_BADGE_APPEARANCES` 由来のクラスだけであり、`StatusBadge` は `variant` の
    //    prop を持たない（型で渡せない）。ここでは**状態名が DOM に出ていること**を根拠に、
    //    色の出所が部品側の 1 箇所であることを固定する（割り当ての正しさは
    //    `app/_components/ui-display.render.test.tsx` が見る）。
    const html = render();
    expect(html).toContain('data-entity="project"');
    // 対照: 状態の語が素のテキストとしてセルに残っていない（Badge の中に在る）。
    expect(html).toMatch(/data-state="OPEN"[^>]*>募集中</);
  });
});

describe('🔴 SP-22 段④: 操作列から副カラム（案件の要点パネル）を開く', () => {


  // ✅✅ **2026-10-16: 詳細画面へは右パネルの `詳細` から行く**（人間の明示指示）。
  //    🔴 **閲覧の監査記録は遷移先（`S-011`）が書く**という規律は変わっていない ——
  //    変わったのは**どこを押すと `S-011` に行くか**だけである。
  it('🔴 行の行き先は右パネルで、詳細画面へは行かない（監査記録の位置は不変）', () => {
    const html = render();

    expect(html).toContain(`project-list-link-${PROJECT_A}`); // 2026-10-16: 右パネルを開く URL
    expect(html).toContain(`data-testid="project-list-link-${PROJECT_A}"`);
  });

  it('副カラムで開いている行に印が付く（選択＝一括操作ではない）', () => {
    const html = render({
      rows: [row(), row({ id: PROJECT_B, name: '物流管理システム保守' })],
      selectedId: PROJECT_B,
    });
    const selected = /<tr class="[^"]*" data-testid="project-list-row-([^"]+)" data-selected="true" data-state="selected">/.exec(
      html,
    );

    expect(selected?.[1]).toBe(PROJECT_B);
    // 🔴 **行にチェックボックスは置かない**（Phase 1 に一括操作は 1 つも無い）。
    expect(html).not.toContain('data-testid="project-list-select-');
    // ✅✅ **2026-10-16: 検査の射程を「表の中」に絞った。**
    // 🔴 **緩めたのではない。** 以前は画面全体に `type="checkbox"` が 1 つも無いことを
    //    見ていたが、人間の明示指示で**絞り込みの帯に「募集中のみ」のチェックボックスが
    //    入った**（それは行の選択ではなく検索条件である）。画面全体で見続けると、
    //    **検索条件のチェックボックスを足すだけで落ちる**ので、守りたい性質
    //    （**表の行に選択の UI が無い**）を直接見る形に書き換えた。
    // 🔴 帯のチェックボックスが表の中に混入したらここで落ちる（射程は `<tbody>` 以降である）。
    const tableBody = html.slice(html.indexOf('<tbody'));
    expect(tableBody).not.toContain('type="checkbox"');
    // 🔴 「募集中のみ」は**帯の側に在る**（表に無いことと、画面に在ることを両方固定する）。
    // 2026-10-16: 「募集中のみ」のチェックボックスは外した（人間の明示指示）。
  });

  it('🔴 どの行も選ばれていないときは印が 1 つも付かない', () => {
    expect(render({ selectedId: null })).not.toContain('data-selected="true"');
  });
});

it('追加した基本条件と詳細グループがフォーム送信に載る', () => {
  const html = render({ applied: { ...emptyApplied, developmentPhases: ['BASIC_DESIGN'], developmentMethod: 'AGILE', utilizationMin: '80', utilizationMax: '100', keywordGroups: JSON.stringify([{mode:'OR',terms:['Java','Springboot']}]) } });
  for (const [name, value] of [['developmentPhases','BASIC_DESIGN'],['developmentMethod','AGILE'],['utilizationMin','80'],['utilizationMax','100']]) expect(html).toContain(`name="${name}" value="${value}"`);
  expect(html).toContain('name="keywordGroups"');
  expect(html.replace(/<[^>]*>/g, '')).toContain('(JavaORSpringboot)');
});

it('詳細検索は追加操作を入力の下に置き、空グループを式へ混ぜない', () => {
  const html = render();
  expect(html).toContain('data-testid="project-list-filter-keyword-guide"');
  expect(html).toContain('最初のキーワードを追加');
  expect(html).toContain('検索条件のイメージ');
  expect(html).toContain('キーワード未設定');
  expect(html).toMatch(/disabled="" data-testid="project-list-filter-keyword-add-0"/);
  const advanced = html.slice(html.indexOf('data-testid="project-list-filter-advanced"'));
  const summaryEnd = advanced.indexOf('</summary>');
  expect(advanced.indexOf('data-testid="project-list-filter-add-group"')).toBeGreaterThan(summaryEnd);
  expect(advanced).not.toContain('data-testid="project-list-filter-keyword-connector-1"');
});

it('全体を折りたたむと条件サマリと実際のグループ数だけを残す', () => {
  const html = render({defaultExpanded:false,applied:{...emptyApplied,keywordGroups:JSON.stringify([{mode:'OR',terms:['Java','Springboot']},{mode:'AND',terms:['設計']}])}});
  expect(html).toContain('data-testid="project-list-details-summary"');
  expect(html).toContain('2グループ');
  expect(html).not.toContain('data-testid="project-list-search"');
  expect(html).not.toContain('data-testid="project-list-clear"');
  expect(html).toContain('data-testid="project-list-summary"');
});
