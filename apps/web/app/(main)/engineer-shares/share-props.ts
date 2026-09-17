// apps/web/app/(main)/engineer-shares/share-props.ts
// `S-015` の文言と props の組み立て（`EngineerShareScreen` の props）。T-08-02 → T-11-11。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は
//    `'use client'` であり、`t()` を呼ばせない —— 呼ばせると `*.render.test.tsx` が
//    `@ses/i18n` を読み込むことになり、「文言が無い状態の描画」を試せなくなる
//    （`visibility-props.ts` / `form-props.ts` と同じ規律）。
//
// 🔴 T-11-11: 行の組み立て（`engineerShareRow`）は `lib/engineer-shares/row-view.ts` の純関数へ移した。
//    初回ページ（ここ。サーバ）と「次の 50 件」（画面。クライアント）が**同じ関数**で行を作るためであり、
//    文言はここで `t` により表（`EngineerShareRowLabels`）に解決してから渡す。
// 🔴 **行に出せる値は `EngineerShareCandidateView` にあるものだけ**である（`row-view.ts` の注記）。
import { t } from '@ses/i18n';
import { anonymizedLabelCatalog } from '../../../lib/anonymize/labels';
import type { EngineerShareRowLabels } from '../../../lib/engineer-shares/row-view';
import {
  ENGINEER_SHARE_FILTER_MESSAGE_KEYS,
  ENGINEER_SHARE_FILTERS,
} from '../../../lib/engineer-shares/screen-query';
import type { EngineerShareFilterOption, EngineerShareScreenMessages } from './engineer-share-screen';

export { engineerShareRow, engineerShareRows } from '../../../lib/engineer-shares/row-view';

/** 行の組み立てに要る文言（`t` で解決してクライアントへ渡す。丸め前の値も 5 項目以外の語も含まない）。 */
export function engineerShareRowLabels(): EngineerShareRowLabels {
  return {
    catalog: anonymizedLabelCatalog(),
    valueNone: t('anonymousCandidate.valueNone'),
    countUnit: t('engineerShares.countUnit'),
  };
}

/** 共有状態フィルタの選択肢（`共有中` / `共有していない` / `すべて`。順序は `docs/04` §S-015 の列挙どおり）。 */
export function engineerShareFilterOptions(): readonly EngineerShareFilterOption[] {
  return ENGINEER_SHARE_FILTERS.map((value) => ({
    value,
    label: t(ENGINEER_SHARE_FILTER_MESSAGE_KEYS[value]),
  }));
}

export function engineerShareScreenMessages(): EngineerShareScreenMessages {
  return {
    lead: t('engineerShares.lead'),
    searchLegend: t('engineerShares.search.legend'),
    searchQ: t('engineerShares.search.q'),
    searchAvailableBy: t('engineerShares.search.availableBy'),
    searchShared: t('engineerShares.search.shared'),
    searchSubmit: t('engineerShares.search.submit'),
    searchClear: t('engineerShares.search.clear'),
    sectionList: t('engineerShares.section.list'),
    sectionPreview: t('engineerShares.section.preview'),
    columnName: t('engineerShares.column.name'),
    columnState: t('engineerShares.column.state'),
    columnSharedOn: t('engineerShares.column.sharedOn'),
    columnProposalRequestCount: t('engineerShares.column.proposalRequestCount'),
    columnAvailability: t('engineerShares.column.availability'),
    columnAction: t('engineerShares.column.action'),
    stateShared: t('engineerShares.state.shared'),
    stateNotShared: t('engineerShares.state.notShared'),
    stateRevokedNow: t('engineerShares.state.revokedNow'),
    stateDeleted: t('engineerShares.state.deleted'),
    sharedEmpty: t('engineerShares.shared.empty'),
    sharedEmptyShowNotShared: t('engineerShares.shared.empty.showNotShared'),
    notSharedEmpty: t('engineerShares.notShared.empty'),
    filteredEmpty: t('engineerShares.filtered.empty'),
    activeFiltersTitle: t('engineerShares.filtered.activeFilters'),
    removeFilterSuffix: t('engineerShares.filtered.removeSuffix'),
    ledgerEmpty: t('engineerShares.ledger.empty'),
    ledgerRegister: t('engineerShares.ledger.register'),
    loadMore: t('engineerShares.loadMore'),
    loadMoreLoading: t('engineerShares.loadMore.loading'),
    loadMoreError: t('engineerShares.loadMore.error'),
    loadMoreRetry: t('engineerShares.loadMore.retry'),
    previewSelect: t('engineerShares.preview.select'),
    previewNote: t('engineerShares.preview.note'),
    previewCareersNote: t('engineerShares.preview.careersNote'),
    fieldSkills: t('anonymousCandidate.field.skills'),
    fieldYears: t('anonymousCandidate.field.years'),
    fieldPrice: t('anonymousCandidate.field.price'),
    fieldAvailability: t('anonymousCandidate.field.availability'),
    fieldLocation: t('anonymousCandidate.field.location'),
    fieldUpdatedOn: t('anonymousCandidate.field.updatedOn'),
    valueNone: t('anonymousCandidate.valueNone'),
    share: t('engineerShares.share'),
    shareConfirmTitle: t('engineerShares.share.confirmTitle'),
    shareConfirmSubmit: t('engineerShares.share.confirmSubmit'),
    shareConfirmCancel: t('engineerShares.share.confirmCancel'),
    shareSubmitting: t('engineerShares.share.submitting'),
    revoke: t('engineerShares.revoke'),
    revokeConfirmTitle: t('engineerShares.revoke.confirmTitle'),
    revokeConfirmLead: t('engineerShares.revoke.confirmLead'),
    revokeConfirmSubmit: t('engineerShares.revoke.confirmSubmit'),
    revokeConfirmCancel: t('engineerShares.revoke.confirmCancel'),
    revokeSubmitting: t('engineerShares.revoke.submitting'),
    errorSave: t('engineerShares.error.save'),
    errorRetryNote: t('engineerShares.error.retryNote'),
    deniedTitle: t('engineerShares.deniedTitle'),
  };
}
