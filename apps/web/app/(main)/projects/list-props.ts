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

/** 勤務地（先頭は「すべて」）。 */
export const projectPrefectureFilterOptions: readonly ProjectFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('projects.list.search.prefectureAll') },
  ...PREFECTURE_CODES.map((value) => ({ value, label: t(PREFECTURE_MESSAGE_KEYS[value]) })),
];

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
    searchComingSoon: t('projects.list.searchComingSoon'),
    searchLegend: t('projects.list.search.legend'),
    searchQ: t('projects.list.search.q'),
    searchStatus: t('projects.list.search.status'),
    searchStartFrom: t('projects.list.search.startFrom'),
    searchPrefecture: t('projects.list.search.prefecture'),
    // ✅ 2026-10-15: 単価レンジ（人材一覧と同じ語。`engineers.list.search.price*` と同じ文言）。
    //    🔴 この 2 つは**欄ごとの読み上げの語**になった（見えるラベルは `searchPrice` の 1 つ）。
    searchPriceMin: t('projects.list.search.priceMin'),
    searchPriceMax: t('projects.list.search.priceMax'),
    // ✅ 2026-10-15（受領画像「自社案件管理_案件一覧.png」の絞り込みカード）。
    searchQPlaceholder: t('projects.list.search.qPlaceholder'),
    searchPrice: t('projects.list.search.price'),
    searchPriceMinPlaceholder: t('projects.list.search.priceMinPlaceholder'),
    searchPriceMaxPlaceholder: t('projects.list.search.priceMaxPlaceholder'),
    searchPriceRangeSeparator: t('projects.list.search.priceRangeSeparator'),
    searchPriceUnit: t('projects.list.search.priceUnit'),
    // ✅ 2026-10-16（人間の明示指示）: 稼働形態 / 募集中のみ / 単価の逆転。
    searchRemoteMode: t('projects.list.search.remoteMode'),
    // ✅ 2026-10-16（受領モック）: カテゴリ / 案件区分 / 並行可否 / 開始時期。
    searchCategory: t('projects.list.search.category'),
    searchSourceKind: t('projects.list.search.sourceKind'),
    searchParallelOk: t('projects.list.search.parallelOk'),
    searchStartWithin: t('projects.list.search.startWithin'),
    searchRecruitingOnly: t('projects.list.search.recruitingOnly'),
    searchPriceInverted: t('projects.list.search.priceInverted'),
    searchSubmit: t('projects.list.search.submit'),
    searchClear: t('projects.list.search.clear'),
    register: t('projects.list.register'),
    readOnlyNote: t('projects.list.readOnlyNote'),
    columnName: t('projects.list.column.name'),
    columnStatus: t('projects.list.column.status'),
    columnMustRequirements: t('projects.list.column.mustRequirements'),
    columnUnitPrice: t('projects.list.column.unitPrice'),
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
    edit: t('projects.list.panel.edit'),
    candidates: t('projects.list.panel.candidates'),
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
