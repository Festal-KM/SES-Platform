// apps/web/app/(main)/projects/list-props.ts
// `S-010` の文言と選択肢の組み立て（`ProjectListScreen` の props）。T-06-03。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）に
//    `t()` を散らさない（`[id]/detail-props.ts` / `_form/form-props.ts` と同じ形）。
// 🔴 **母集団はホストと取引先で違う**（`docs/04` §3.2 項目 2 / §10.1 `S-010`）。空文言も
//    「案件が未登録」/「まだ公開されていない」で書き分ける —— 取引先に「案件が無い」と
//    伝えると、ホストに案件があるかどうかを推測させる材料になる（`F-014 AC-4` / `BR-07`）。
import { PROJECT_STATUSES } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { t } from '@ses/i18n';
import { PREFECTURE_MESSAGE_KEYS } from '../../../lib/format/prefectures';
import { PROJECT_STATUS_MESSAGE_KEYS } from '../../../lib/projects/labels';
import type {
  ProjectFilterOption,
  ProjectListScreenMessages,
} from './project-list-screen';

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
    searchComingSoon: t('projects.list.searchComingSoon'),
    searchLegend: t('projects.list.search.legend'),
    searchQ: t('projects.list.search.q'),
    searchStatus: t('projects.list.search.status'),
    searchStartFrom: t('projects.list.search.startFrom'),
    searchPrefecture: t('projects.list.search.prefecture'),
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
    columnHeadcount: t('projects.list.column.headcount'),
    columnUpdatedOn: t('projects.list.column.updatedOn'),
    columnVisibility: t('projects.list.column.visibility'),
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
