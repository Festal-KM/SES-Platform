// apps/web/app/(main)/engineers/list-props.ts
// `S-005` の文言と選択肢の組み立て（`EngineerLedgerScreen` の props）。T-06-04。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）に
//    `t()` を散らさない（`projects/list-props.ts` / `_form/form-props.ts` と同じ形）。
// 🔴 選択肢の**値の出所は値集合（`@ses/db` / `@ses/domain`）**であり、ここに文字列を並べない
//    （値集合が増減したとき、選択肢だけが古いまま残らないようにする）。
import { ENGINEER_AVAILABILITIES, REMOTE_MODES } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { t } from '@ses/i18n';
import { PREFECTURE_MESSAGE_KEYS } from '../../../lib/format/prefectures';
import {
  ENGINEER_AVAILABILITY_MESSAGE_KEYS,
  REMOTE_MODE_MESSAGE_KEYS,
} from '../../../lib/engineers/labels';
import { ENGINEER_SKILL_MODES } from '../../../lib/engineers/schemas';
import type {
  EngineerFilterOption,
  EngineerLedgerScreenMessages,
} from './engineer-ledger-screen';

/**
 * 「すべて」を表す選択肢の値。
 * 🔴 **空文字である。** 素の `<form method="get">` は未選択の欄も `?prefecture=` として送るため、
 *    空文字を「指定なし」に畳むのは `optionalFilter`（`lib/api/query-filters.ts`）の責務である。
 *    ここに `'ALL'` のような番兵を作らない —— 作ると、番兵を業務値として書き込む経路が生える。
 */
export const FILTER_ALL_VALUE = '';

export const engineerPrefectureFilterOptions: readonly EngineerFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('engineers.list.search.prefectureAll') },
  ...PREFECTURE_CODES.map((value) => ({ value, label: t(PREFECTURE_MESSAGE_KEYS[value]) })),
];

export const engineerRemoteFilterOptions: readonly EngineerFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('engineers.list.search.remoteAll') },
  ...REMOTE_MODES.map((value) => ({ value, label: t(REMOTE_MODE_MESSAGE_KEYS[value]) })),
];

export const engineerAvailabilityFilterOptions: readonly EngineerFilterOption[] = [
  { value: FILTER_ALL_VALUE, label: t('engineers.list.search.availabilityAll') },
  ...ENGINEER_AVAILABILITIES.map((value) => ({
    value,
    label: t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[value]),
  })),
];

/**
 * スキルの AND / OR（`docs/02` `F-009` 入力）。
 * 🔴 **「すべて」の選択肢を置かない** —— 組み合わせ方は必ずどちらかであり、既定は `AND` である
 *    （`ENGINEER_SKILL_MODE_DEFAULT`）。
 */
export const engineerSkillModeOptions: readonly EngineerFilterOption[] = ENGINEER_SKILL_MODES.map(
  (value) => ({
    value,
    label:
      value === 'AND'
        ? t('engineers.list.search.skillMode.AND')
        : t('engineers.list.search.skillMode.OR'),
  }),
);

export function engineerLedgerScreenMessages(params: {
  readonly populationLabel: string;
  readonly isPartner: boolean;
  /** 絞り込みが効いているか（`docs/04` §10.1 `S-005`: 初回空と絞込 0 件で文言が違う）。 */
  readonly filtered: boolean;
  /**
   * 🔴 並びの第 1 キー（適合）が効いているか。効いていないときに「条件に合う人材を先に」と
   *    書くと**説明が実態とずれる**（`docs/04` §S-005「並び順の説明を上部に 1 行で書く」）。
   */
  readonly ordersByFit: boolean;
  /** 🔴 絞り込みチェックボックスがオンか（`docs/04` §10.1 `S-005` の絞込 0 件の注意）。 */
  readonly checkboxOn: boolean;
}): EngineerLedgerScreenMessages {
  const { populationLabel, isPartner, filtered, ordersByFit, checkboxOn } = params;
  return {
    populationLabel,
    partnerScopeNotice: isPartner ? t('engineers.list.partnerScopeNotice') : null,
    orderNote: ordersByFit ? t('engineers.list.orderNote.fit') : t('engineers.list.orderNote'),
    searchComingSoon: t('engineers.list.searchComingSoon'),
    experienceComingSoon: t('engineers.list.experienceComingSoon'),
    searchLegend: t('engineers.list.search.legend'),
    searchQ: t('engineers.list.search.q'),
    searchSkills: t('engineers.list.search.skills'),
    searchSkillsHint: t('engineers.list.search.skillsHint'),
    searchSkillMode: t('engineers.list.search.skillMode'),
    searchYearsMin: t('engineers.list.search.yearsMin'),
    searchPriceMin: t('engineers.list.search.priceMin'),
    searchPriceMax: t('engineers.list.search.priceMax'),
    searchAvailableBy: t('engineers.list.search.availableBy'),
    searchPrefecture: t('engineers.list.search.prefecture'),
    searchRemote: t('engineers.list.search.remote'),
    searchAvailability: t('engineers.list.search.availability'),
    searchOnlyInTime: t('engineers.list.search.onlyInTime'),
    searchOnlyCommutable: t('engineers.list.search.onlyCommutable'),
    searchCheckboxNote: t('engineers.list.search.checkboxNote'),
    searchSubmit: t('engineers.list.search.submit'),
    searchClear: t('engineers.list.search.clear'),
    activeFiltersTitle: t('engineers.list.filtered.activeTitle'),
    removeFilterSuffix: t('engineers.list.filtered.remove'),
    register: t('engineers.list.register'),
    readOnlyNote: t('engineers.list.readOnlyNote'),
    columnName: t('engineers.list.column.name'),
    columnOwnership: t('engineers.list.column.ownership'),
    columnSkills: t('engineers.list.column.skills'),
    columnUnitPrice: t('engineers.list.column.unitPrice'),
    columnAvailableFrom: t('engineers.list.column.availableFrom'),
    columnLocation: t('engineers.list.column.location'),
    columnAvailability: t('engineers.list.column.availability'),
    columnUpdatedOn: t('engineers.list.column.updatedOn'),
    // 🔴 2 通りある（絞込 0 / 初回空）。docs/04 §10.1 `S-005`。**文言も導線も別物**である。
    emptyTitle: filtered
      ? t('engineers.list.filtered.empty.title')
      : t('engineers.list.empty.title'),
    emptyLead: filtered ? t('engineers.list.filtered.empty.lead') : t('engineers.list.empty.lead'),
    // 🔴 絞り込みチェックボックスがオンのときだけ出す注意（同上）。
    emptyCheckboxNotice:
      filtered && checkboxOn ? t('engineers.list.filtered.checkboxNotice') : null,
    nextPage: t('engineers.list.nextPage'),
    firstPage: t('engineers.list.firstPage'),
    valueNone: t('engineers.detail.valueNone'),
  };
}
