import { PROJECT_DEVELOPMENT_PHASES } from '@ses/domain';
// apps/web/app/(main)/projects/list-props.ts
// `S-010` の文言と選択肢の組み立て（`ProjectListScreen` の props）。T-06-03。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）に
//    `t()` を散らさない（`[id]/detail-props.ts` / `_form/form-props.ts` と同じ形）。
// 🔴 **母集団はホストと取引先で違う**（`docs/04` §3.2 項目 2 / §10.1 `S-010`）。空文言も
//    「案件が未登録」/「まだ公開されていない」で書き分ける —— 取引先に「案件が無い」と
//    伝えると、ホストに案件があるかどうかを推測させる材料になる（`F-014 AC-4` / `BR-07`）。
import {
  PROJECT_CATEGORIES,
  PROJECT_SOURCE_KINDS,
  PROJECT_START_WINDOWS,
  PROJECT_STATUSES,
  REMOTE_MODES,
} from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { t, type MessageKey } from '@ses/i18n';
import { PREFECTURE_MESSAGE_KEYS } from '../../../lib/format/prefectures';
import {
  PROJECT_CATEGORY_MESSAGE_KEYS,
  PROJECT_REMOTE_MODE_MESSAGE_KEYS,
  PROJECT_SOURCE_KIND_MESSAGE_KEYS,
  PROJECT_START_WINDOW_MESSAGE_KEYS,
  PROJECT_STATUS_MESSAGE_KEYS,
} from '../../../lib/projects/labels';
import {
  PROJECT_HIDEABLE_COLUMN_IDS,
  type ProjectHideableColumnId,
} from '../../../lib/projects/list-rows';
import type { ColumnToggleItem } from '../../_components/column-toggle';
import type {
  ProjectFilterOption,
  ProjectListScreenMessages,
} from './project-list-screen';
import type { SearchPanelMessages } from './_search/search-panel';
import type { SearchFilterFormOptions } from './_search/search-filter-form';
import type { ProjectSearchDraft } from './_search/filters';
import type { ProjectSummaryPanelMessages } from './project-summary-panel';

/**
 * 「すべて」を表す選択肢の値。
 * 🔴 **空文字である。** 素の `<form method="get">` は未入力の欄も `?status=` として送るため、
 *    空文字を「指定なし」に畳むのは `projectListQuerySchema`（`optionalFilter`）の責務である。
 *    ここに `'ALL'` のような番兵を作らない —— 作ると、番兵を業務値として書き込む経路が生える。
 */
export const FILTER_ALL_VALUE = '';

/** 案件の状態（先頭は「すべて」）。値の出所は `@ses/db` の `PROJECT_STATUSES` である。 */
export const projectStatusFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.statusAll') },
  ...PROJECT_STATUSES.map((value) => ({ value, label: t(PROJECT_STATUS_MESSAGE_KEYS[value]) })),
];

/**
 * 勤務地（先頭は「すべて」）。
 * ⚠️ **2026-10-16: 検索パネルからは外した**（人間の明示指示の 6 項目に無い）。query と述語は
 *    残しているので、共有済みの URL は従来どおり効く。選択肢の定義も**消さない**
 *    —— 戻すときにここを作り直すことになる（`PROJECT_HIDEABLE_COLUMN_IDS` と同じ扱い）。
 */
export const projectPrefectureFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.prefectureAll') },
  ...PREFECTURE_CODES.map((value) => ({ value, label: t(PREFECTURE_MESSAGE_KEYS[value]) })),
];

/**
 * ✅✅ **スキル（2026-10-16。人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。**
 *
 * 🔴 **「すべて」の選択肢を持たない。** これは `<select multiple>` であり、**何も選ばない
 *    状態が「すべて」**である（番兵を置くと「すべて」を選んだまま 1 つ足した状態が作れてしまう）。
 * 🔴 **値はグローバル辞書（`Skill`）の ID** である（`F-010`）。語は辞書の `name` であり、
 *    `packages/i18n` には無い —— **辞書はデータであって文言ではない**
 *    （テナントが足した別名も含め、`t()` の対象にできない）。
 * 🔴 **並びは呼び出し側（`listSkills`）が決めた順をそのまま使う**（`sortKey` 昇順 → `id`。
 *    決定的である）。ここで並べ替えない。
 * 🔴 **テナントの境界に触れない。** `skills` は `CLAUDE.md` §3.1 の射程外の 4 表の 1 つ
 *    （グローバルなマスタ）であり、誰が見ても同じ辞書である。
 */
export function projectSkillFilterOptions(
  skills: readonly { readonly id: string; readonly name: string }[],
): readonly ProjectFilterOption[] {
  return skills.map((skill) => ({ value: skill.id, label: skill.name }));
}

/**
 * ✅ **稼働形態（先頭は「すべて」）。2026-10-16（人間の明示指示「稼働形態」）。**
 *
 * 🔴 **値の出所は `@ses/db` の `REMOTE_MODES`（3 値）であり、語は一覧の `稼働形態` 列と
 *    同じ `PROJECT_REMOTE_MODE_MESSAGE_KEYS` である** —— 絞り込みと列で語が違うと、
 *    選んだ値がどの列に効いたのか分からない。
 * ⚠️ 人間の指示は 4 値（フルリモート / リモート中心 / ハイブリッド / 常駐）だったが、
 *    列の値集合は 3 値である。4 値に割るのは DB の値集合の変更にあたり、
 *    [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)「設計から改訂して」の
 *    範囲である。**押しても絞れない選択肢を先に並べない**ほうを採った。
 */
/**
 * ✅✅ **カテゴリ / 案件区分 / 並行可否 / 開始時期（先頭は「すべて」）。2026-10-16。**
 *
 * 🔴 **値の出所は `@ses/db` の値集合である**（`PROJECT_CATEGORIES` / `PROJECT_SOURCE_KINDS` /
 *    `PROJECT_START_WINDOWS`）。受領モック `デザインモック/自社案件管理_案件一覧.png` の
 *    絞り込みをそのまま実装したものであり、列は migration `20261016030000` で足した
 *    （[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)「設計から改訂して」が承認）。
 * 🔴 **並行可否だけ値集合が DB に無い**（`boolean` の列である）。`'1'` / `'0'` を送る ——
 *    `z.coerce.boolean()` は空文字以外をすべて true にするので、「不可」を選んだのに
 *    「可」で絞られる（`schemas.ts` の 🔴）。
 */
export const projectCategoryFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.categoryAll') },
  ...PROJECT_CATEGORIES.map((value) => ({
    value,
    label: t(PROJECT_CATEGORY_MESSAGE_KEYS[value]),
  })),
];

export const projectSourceKindFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.sourceKindAll') },
  ...PROJECT_SOURCE_KINDS.map((value) => ({
    value,
    label: t(PROJECT_SOURCE_KIND_MESSAGE_KEYS[value]),
  })),
];

export const projectParallelOkFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.parallelOkAll') },
  { value: '1', label: t('projects.parallelOk.true') },
  { value: '0', label: t('projects.parallelOk.false') },
];

export const projectStartWithinFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.startWithinAll') },
  ...PROJECT_START_WINDOWS.map((value) => ({
    value,
    label: t(PROJECT_START_WINDOW_MESSAGE_KEYS[value]),
  })),
];

export const projectRemoteModeFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.remoteModeAll') },
  ...REMOTE_MODES.map((value) => ({
    value,
    label: t(PROJECT_REMOTE_MODE_MESSAGE_KEYS[value]),
  })),
];

export function projectListScreenMessages(params: {
  readonly populationLabel: string;
  readonly isPartner: boolean;
  /** 絞り込みが効いているか（`docs/04` §10.1 `S-010`: 初回空と絞込 0 で文言が違う）。 */
  readonly filtered: boolean;
}): ProjectListScreenMessages {
  const { populationLabel, isPartner, filtered } = params;
  return {
    populationLabel,
    partnerScopeNotice: isPartner ? t('projects.list.partnerScopeNotice') : null,
    orderNote: t('projects.list.orderNote'),
    // 🔴 ✅ 2026-10-03: 表が器に収まらない幅での 1 行（語は全画面で同じ 1 キー）。
    overflowNote: t('ui.tableOverflowNote'),
    // ⚠️ **2026-10-19: 検索条件の語はここに無い。**下の
    //    `projectSearchPanelMessages()` が組み立てる（検索エリアが
    //    `_search/search-panel.tsx` の島に移ったため）。
    // 🔴 **文言キーは 1 つも消していない**（`U-22` の凍結）。
    register: t('projects.list.register'),
    readOnlyNote: t('projects.list.readOnlyNote'),
    columnName: t('projects.list.column.name'),
    columnStatus: t('projects.list.column.status'),
    columnMustRequirements: t('projects.list.column.mustRequirements'),
    columnUnitPrice: t('projects.list.column.wholesaleUnitPrice'),
    columnPurchaseUnitPrice: t('projects.list.column.purchaseUnitPrice'),
    columnStartDate: t('projects.list.column.startDate'),
    columnLocation: t('projects.list.column.location'),
    // ✅ 2026-10-15: 稼働形態（`#101` の C）。
    columnRemoteMode: t('projects.list.column.remoteMode'),
    columnHeadcount: t('projects.list.column.headcount'),
    columnUpdatedOn: t('projects.list.column.updatedOn'),
    columnVisibility: t('projects.list.column.visibility'),
    columnAction: t('projects.list.column.action'),
    panelOpen: t('projects.list.panel.open'),
    columnToggleTrigger: t('projects.list.columnToggle.trigger'),
    // 🔴 3 通りある（絞込 0 / ホストの初回空 / 取引先の初回空）。docs/04 §10.1 `S-010`。
    emptyTitle: filtered
      ? t('projects.list.filtered.empty.title')
      : isPartner
        ? t('projects.list.empty.partner.title')
        : t('projects.list.empty.host.title'),
    emptyLead: filtered
      ? t('projects.list.filtered.empty.lead')
      : isPartner
        ? t('projects.list.empty.partner.lead')
        : t('projects.list.empty.host.lead'),
    nextPage: t('projects.list.nextPage'),
    firstPage: t('projects.list.firstPage'),
  };
}

/**
 * 🔴 **帯の説明 1 行**（SP-22 段④。`docs/04` §3.1 のレイアウト図「説明 1 行」）。
 *    **母集団が違うので文も違う**（§3.2 項目 2 / `F-015 AC-1`）。出所は `ctx.partnerCompanyId`。
 */
export function projectListDescription(isPartner: boolean): string {
  return isPartner
    ? t('projects.list.description.partner')
    : t('projects.list.description.host');
}

/**
 * 🔴 **副カラム（案件の要点パネル）の語**（SP-22 段④）。
 *
 * 🔴 **キーバリューのラベルは一覧の列見出しと同じキーを引く** —— 同じ値に 2 つの名前を
 *    作らない（表で「単価レンジ」、パネルで「単価」になると、同じ数字を 2 回探すことになる）。
 */
export function projectSummaryPanelMessages(): ProjectSummaryPanelMessages {
  return {
    title: t('projects.list.panel.title'),
    empty: t('projects.list.panel.empty'),
    detail: t('projects.list.panel.detail'),
    // ✅✅ **2026-10-16: タブの語**（人間の明示指示「タイル内にタブを設置して、
    //    基本情報とコピペ用サマリ」）。
    tabBasic: t('projects.list.panel.tab.basic'),
    tabCopy: t('projects.list.panel.tab.copy'),
    copyHint: t('projects.list.panel.copy.hint'),
    copyAction: t('projects.list.panel.copy.action'),
    copyCopied: t('projects.list.panel.copy.copied'),
    copyFailed: t('projects.list.panel.copy.failed'),
    statusControl: {
      open: t('projects.status.OPEN'), closed: t('projects.status.CLOSED'),
      changeToOpen: t('projects.list.panel.status.changeToOpen'),
      changeToClosed: t('projects.list.panel.status.changeToClosed'),
      saved: t('projects.list.panel.status.saved'), failed: t('projects.list.panel.status.failed'),
    },
    copyGeneratedNote: t('projects.list.panel.copy.generatedNote'),
    // ⚠️ `edit` / `candidates` は**渡さない**（人間の明示指示「案件サマリのボタンは、
    //    詳細を開くだけでよい」で画面から外した。キーは `U-22` の凍結なので残っている）。
    // 🔴 ✅ 2026-10-14: **状態（`fieldStatus`）はここに無い** —— 案件名の隣の `StatusBadge` が
    //    出すようになったので、Key-Value から外した（同じ値を 1 つのパネルに 2 回描かない。
    //    `project-summary-panel.tsx` の `panelFields` の 🔴）。語のキー
    //    （`projects.list.column.status`）は**一覧の列見出しとして現に使われている**ので、
    //    キーの凍結（`docs/04` `U-22`）には触れていない。
    fieldMustRequirements: t('projects.list.column.mustRequirements'),
    fieldUnitPrice: t('projects.list.column.unitPrice'),
    fieldStartDate: t('projects.list.column.startDate'),
    fieldLocation: t('projects.list.column.location'),
    fieldRemoteMode: t('projects.list.column.remoteMode'),
    fieldHeadcount: t('projects.list.column.headcount'),
    fieldUpdatedOn: t('projects.list.column.updatedOn'),
    fieldVisibility: t('projects.list.column.visibility'),
  };
}

/**
 * 🔴 **列表示切替の項目**（`T-22-06`。`docs/04` §7.1「9 列目以降は列表示切替に格納する」）。
 *
 * 🔴 **語は「いまの状態に対する操作」である**（`隠す` / `表示する`）—— 切替の項目は
 *    `DropdownMenu` の 1 行であり、チェックの印を持たない（§5-13）。したがって
 *    **項目の語が状態を語らなければ、開いても「いまどちらか」が分からない**。
 *    `packages/i18n` に列ごとの 2 語を置き、**ここで文字列を合成しない**（`CLAUDE.md` §3.5）。
 * 🔴 **ホストにしか渡らない**（呼び出し側が取引先には空配列を渡す。9 列目そのものが無い）。
 */
const PROJECT_COLUMN_TOGGLE_MESSAGE_KEYS: Readonly<
  Record<ProjectHideableColumnId, { readonly hide: MessageKey; readonly show: MessageKey }>
> = {
  purchaseUnitPrice: {
    hide: 'projects.list.columnToggle.hide.purchaseUnitPrice',
    show: 'projects.list.columnToggle.show.purchaseUnitPrice',
  },
  // ✅ 2026-10-15: 既定で格納する（`PROJECT_DEFAULT_HIDDEN_COLUMN_IDS`）。
  mustRequirements: {
    hide: 'projects.list.columnToggle.hide.mustRequirements',
    show: 'projects.list.columnToggle.show.mustRequirements',
  },
  visibility: {
    hide: 'projects.list.columnToggle.hide.visibility',
    show: 'projects.list.columnToggle.show.visibility',
  },
};

export function projectColumnToggleItems(params: {
  /** いま隠れている列（URL 由来。`parseHiddenProjectColumns`）。 */
  readonly hidden: readonly ProjectHideableColumnId[];
  /** その列の表示 / 非表示を反転した URL（`projectColumnToggleHref`）。 */
  readonly hrefOf: (columnId: ProjectHideableColumnId) => string;
  /**
   * ✅ **2026-10-15: その利用者が実際に持っている列**（既定は全部）。
   *
   * 🔴 **取引先には `visibility` の行そのものが無い**（列が存在しない。`F-014 AC-4`）。一方で
   *    `mustRequirements` は**両方が持つ**ので、🔴 **取引先にも切替を渡さないと、既定で
   *    格納した列を戻す手段が無くなる**（到達性を落とさないことが格納の前提である）。
   */
  readonly ids?: readonly ProjectHideableColumnId[];
}): readonly ColumnToggleItem[] {
  const { hidden, hrefOf, ids = PROJECT_HIDEABLE_COLUMN_IDS } = params;
  // 🔴 並びは `PROJECT_HIDEABLE_COLUMN_IDS`（= 列の並び）で固定する（メニューの順序が動かない）。
  return PROJECT_HIDEABLE_COLUMN_IDS.filter((id) => ids.includes(id)).map((id) => {
    const isHidden = hidden.includes(id);
    const keys = PROJECT_COLUMN_TOGGLE_MESSAGE_KEYS[id];
    return {
      id,
      label: t(isHidden ? keys.show : keys.hide),
      hidden: isHidden,
      href: hrefOf(id),
    };
  });
}

// ============================================================================
// ✅✅ 2026-10-19: 検索エリア（`_search/`）の語と選択肢
//     （人間の改修指示書 `BizOrch_SearchArea_ClaudeCode.md`）
// ============================================================================
/**
 * 🔴 **選択肢は既存のものをそのまま束ねるだけである**（指示書 §3）。
 *    「選択肢、初期値、ID、単価の入力・保存単位は既存実装に合わせてください」。
 * 🔴 **「並行可否」（`projectParallelOkFilterOptions`）は渡さない**（指示書 §3 で除外）。
 *    ⚠️ **現在は未使用である**（`projectSourceKindFilterOptions` も同じ）。
 *    `S-012`（登録・編集）が使っているのは `_form/form-props.ts` の別定義
 *    （`projectParallelOkOptions`）であり、ここの 2 つではない。
 *    残してあるのは**欄を戻すときに語を組み直さないため**である。
 */
export function projectSearchFilterOptions(
  skills: Parameters<typeof projectSkillFilterOptions>[0],
): SearchFilterFormOptions {
  return {
    statusOptions: projectStatusFilterOptions,
    categoryOptions: projectCategoryFilterOptions,
    remoteModeOptions: projectRemoteModeFilterOptions,
    prefectureOptions: projectPrefectureFilterOptions,
    startWithinOptions: projectStartWithinFilterOptions,
    skillOptions: projectSkillFilterOptions(skills),
  };
}

/**
 * 検索エリアの語。
 *
 * 🔴 **文言を組み立てるのはここだけである**（島の中で `t()` を呼ばない。
 *    `CLAUDE.md` §3.5 / `tests/static/no-hardcoded-copy.test.ts`）。
 * 🔴 **数を含む語は関数で渡す** —— `t()` は差し込みを持たないので
 *    （`docs/05` §15.2 の `params` は未導入）、連結はここで行う。
 */
export function projectSearchPanelMessages(): SearchPanelMessages {
  const separator = t('projects.list.search.fieldSeparator');
  const quote = t('projects.list.search.quoteOpen');
  return {
    selectedSavedLabel: t('projects.list.search.selectedSavedLabel'),
    selectedSavedModified: t('projects.list.search.selectedSavedModified'),
    tabsLabel: t('projects.list.search.tabsLabel'),
    tabSearch: t('projects.list.search.tabSearch'),
    tabSaved: t('projects.list.search.tabSaved'),
    save: t('projects.list.search.save'),
    collapse: t('projects.list.search.collapse'),
    expand: t('projects.list.search.expand'),
    saveDialogTitle: t('projects.list.search.saveDialogTitle'),
    saveDialogNameLabel: t('projects.list.search.saveDialogNameLabel'),
    saveDialogNamePlaceholder: t('projects.list.search.saveDialogNamePlaceholder'),
    saveDialogConfirm: t('projects.list.search.saveDialogConfirm'),
    renameDialogTitle: t('projects.list.search.renameDialogTitle'),
    overwriteDialogTitle: t('projects.list.search.overwriteDialogTitle'),
    overwriteCurrent: t('projects.list.search.overwriteCurrent'),
    overwriteDialogConfirm: t('projects.list.search.overwriteDialogConfirm'),
    removeDialogTitle: t('projects.list.search.removeDialogTitle'),
    removeDialogConfirm: t('projects.list.search.removeDialogConfirm'),
    cancel: t('projects.cancel'),
    nameError: t('projects.list.search.nameError'),
    limitError: t('projects.list.search.limitError'),
    writeError: t('projects.list.search.writeError'),
    saved: t('projects.list.search.savedDone'),
    renamed: t('projects.list.search.renamedDone'),
    overwritten: t('projects.list.search.overwrittenDone'),
    removed: t('projects.list.search.removedDone'),
    summaryJoiner: t('projects.list.search.summaryJoiner'),
    // 🔴 **対象名が分かる確認**（指示書 §5）。連結は島の中で行う。
    quoteOpen: quote,
    overwriteDialogBodySuffix: t('projects.list.search.overwriteDialogBodySuffix'),
    removeDialogBodySuffix: t('projects.list.search.removeDialogBodySuffix'),
    saveDialogBodyPrefix: t('projects.list.search.saveDialogBodyPrefix'),
    saveDialogBodyEmpty: t('projects.list.search.saveDialogBodyEmpty'),
    form: {
      q: t('projects.list.search.q'),
      qPlaceholder: t('projects.list.search.qPlaceholder'),
      status: t('projects.list.search.status'),
      category: t('projects.list.search.category'),
      skill: t('projects.list.search.skill'),
      remoteMode: t('projects.list.search.remoteMode'),
      price: t('projects.list.search.price'),
      priceMin: t('projects.list.search.priceMin'),
      priceMax: t('projects.list.search.priceMax'),
      priceMinPlaceholder: t('projects.list.search.priceMinPlaceholder'),
      priceMaxPlaceholder: t('projects.list.search.priceMaxPlaceholder'),
      priceSeparator: t('projects.list.search.priceRangeSeparator'),
      priceUnit: t('projects.list.search.priceUnit'),
      priceInverted: t('projects.list.search.priceInverted'),
      prefecture: t('projects.list.search.prefecture'),
      startWithin: t('projects.list.search.startWithin'),
      skillMessages: {
        placeholder: t('projects.list.search.skillPlaceholder'),
        remove: t('projects.list.search.chipRemove'),
        overflowLabel: t('projects.list.search.skillOverflow'),
        selectedCountSuffix: t('projects.list.search.skillSelectedCount'),
        searchLabel: t('projects.list.search.skillSearchLabel'),
        searchPlaceholder: t('projects.list.search.skillSearchPlaceholder'),
        modeAll: t('projects.list.search.skillModeAll'),
        modeSelected: t('projects.list.search.skillModeSelected'),
        noMatch: t('projects.list.search.skillNoMatch'),
        selectedSummarySuffix: t('projects.list.search.skillSelectedSummary'),
        clearSelection: t('projects.list.search.skillClearSelection'),
        triggerLabel: t('projects.list.search.skill'),
      },
      // ✅✅ 2026-10-19: 単一選択のプルダウン 5 欄で**共通**の語
      //    （`filter-select.tsx`。欄の名前は `Field` のラベルが持つので、ここには入らない）。
      selectMessages: {
        searchLabel: t('projects.list.search.selectSearchLabel'),
        searchPlaceholder: t('projects.list.search.selectSearchPlaceholder'),
        noMatch: t('projects.list.search.selectNoMatch'),
      },
    },
    bar: {
      label: t('projects.list.search.selectedLabel'),
      empty: t('projects.list.search.selectedEmpty'),
      remove: t('projects.list.search.chipRemove'),
      overflowLabel: t('projects.list.search.chipOverflow'),
      clear: t('projects.list.search.clear'),
      submit: t('projects.list.search.submit'),
      pending: t('projects.list.search.pending'),
      pendingHint: t('projects.list.search.pendingHint'),
    },
    savedList: {
      search: t('projects.list.search.savedTable.search'),
      sort: t('projects.list.search.savedTable.sort'),
      sortRecent: t('projects.list.search.savedTable.sortRecent'),
      sortUpdated: t('projects.list.search.savedTable.sortUpdated'),
      sortName: t('projects.list.search.savedTable.sortName'),
      columnName: t('projects.list.search.savedTable.columnName'),
      columnFilters: t('projects.list.search.savedTable.columnFilters'),
      columnActions: t('projects.list.search.savedTable.columnActions'),
      countSuffix: t('projects.list.search.savedTable.countSuffix'),
      range: t('projects.list.search.savedTable.range'),
      noResults: t('projects.list.search.savedTable.noResults'),
      previous: t('projects.list.search.savedTable.previous'),
      next: t('projects.list.search.savedTable.next'),

      apply: t('projects.list.search.savedApply'),
      menuLabel: t('projects.list.search.savedMenu'),
      rename: t('projects.list.search.savedRename'),
      overwrite: t('projects.list.search.savedOverwrite'),
      remove: t('projects.list.search.savedRemove'),
      emptyTitle: t('projects.list.search.savedEmpty'),
      emptyAction: t('projects.list.search.savedEmptyAction'),
      brokenNote: t('projects.list.search.savedBroken'),
      storageNote: t('projects.list.search.savedStorageNote'),
      noCondition: t('projects.list.search.savedNoCondition'),
      activeLabel: t('projects.list.search.savedActive'),
    },
    chipLabels: {
      phaseOptions: PROJECT_DEVELOPMENT_PHASES.map(value => ({ value, label: t(`projects.search.phase.${value}`) })),
      extraLabels: { developmentMethod: t('projects.search.method'), utilizationMin: t('projects.search.utilizationMin'), utilizationMax: t('projects.search.utilizationMax'), keywordGroups: t('projects.search.groups'), WATERFALL: t('projects.search.method.WATERFALL'), AGILE: t('projects.search.method.AGILE') },
      statusOptions: projectStatusFilterOptions,
      categoryOptions: projectCategoryFilterOptions,
      remoteModeOptions: projectRemoteModeFilterOptions,
      prefectureOptions: projectPrefectureFilterOptions,
      startWithinOptions: projectStartWithinFilterOptions,
      // 🔴 スキルの語は**辞書のデータ**であり `packages/i18n` に無いので、
      //    呼び出し側（`page.tsx`）が差し替える。
      skillOptions: [],
      fieldLabels: {
        q: t('projects.list.search.q'),
        category: t('projects.list.search.category'),
        prefecture: t('projects.list.search.prefecture'),
        startWithin: t('projects.list.search.startWithin'),
        price: t('projects.list.search.price'),
      },
      fieldSeparator: separator,
      // 🔴 **単位は円のまま**（指示書 §3）。上下限をまとめて 1 バッジ（§4）。
      priceRangeSeparator: t('projects.list.search.priceRangeSeparator'),
      priceUnit: t('projects.list.search.priceUnit'),
    },
  };
}

/**
 * 🔴 **URL から「いま効いている条件」を組む**（`appliedFilters`。指示書 §6）。
 *
 * 🔴 **`parallelOk` を読まない** —— ここが「古い URL に並行可否があっても
 *    検索に影響しない」（指示書 §3 / §8）の入口側である。
 */
export function projectAppliedSearchDraft(query: {
  readonly developmentPhases?: readonly string[];
  readonly developmentMethod?: string;
  readonly utilizationMin?: number;
  readonly utilizationMax?: number;
  readonly keywordGroups?: string;
  readonly q?: string;
  readonly status?: string;
  readonly category?: string;
  readonly remoteMode?: string;
  readonly priceMin?: number;
  readonly priceMax?: number;
  readonly prefecture?: string;
  readonly startWithin?: string;
  readonly skills?: readonly string[];
}): ProjectSearchDraft {
  return {
    ...(query.developmentPhases?.length ? { developmentPhases: query.developmentPhases } : {}),
    ...(query.developmentMethod ? { developmentMethod: query.developmentMethod } : {}),
    ...(query.utilizationMin === undefined ? {} : { utilizationMin: String(query.utilizationMin) }),
    ...(query.utilizationMax === undefined ? {} : { utilizationMax: String(query.utilizationMax) }),
    ...(query.keywordGroups ? { keywordGroups: query.keywordGroups } : {}),
    q: query.q ?? '',
    status: query.status ?? '',
    category: query.category ?? '',
    remoteMode: query.remoteMode ?? '',
    priceMin: query.priceMin === undefined ? '' : String(query.priceMin),
    priceMax: query.priceMax === undefined ? '' : String(query.priceMax),
    prefecture: query.prefecture ?? '',
    startWithin: query.startWithin ?? '',
    skills: query.skills ?? [],
  };
}
