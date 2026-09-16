// apps/web/app/(main)/proposals/(list)/list-props.ts
// `S-019` の文言の組み立て（`ProposalListScreen` の props）。T-09-09。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `t()` を呼ばない
//    （`request-props.ts` / `failure-props.ts` と同じ規律。render テストが文言の実体に依存しない）。
import { t } from '@ses/i18n';
import type { ProposalListScreenMessages } from './proposal-list-screen';

export function proposalListScreenMessages(params: { readonly filtered: boolean }): ProposalListScreenMessages {
  return {
    filterLegend: t('proposals.list.filter.legend'),
    filterStates: t('proposals.list.filter.states'),
    filterQ: t('proposals.list.filter.q'),
    filterApply: t('proposals.list.filter.apply'),
    filterClear: t('proposals.list.filter.clear'),
    filterCountPrefix: t('proposals.list.filter.countPrefix'),
    filterCountSuffix: t('proposals.list.filter.countSuffix'),
    requestsTitle: t('proposals.list.requests.title'),
    requestsLead: t('proposals.list.requests.lead'),
    requestsOpen: t('proposals.list.requests.open'),
    columnRecipient: t('proposals.list.column.recipient'),
    columnEngineer: t('proposals.list.column.engineer'),
    columnProject: t('proposals.list.column.project'),
    columnState: t('proposals.list.column.state'),
    columnUnitPrice: t('proposals.list.column.unitPrice'),
    columnCreatedBy: t('proposals.list.column.createdBy'),
    columnUpdatedAt: t('proposals.list.column.updatedAt'),
    columnElapsed: t('proposals.list.column.elapsed'),
    inProgress: t('proposals.list.inProgress'),
    stuckSubmitting: t('proposals.list.stuckSubmitting'),
    // 🔴 `docs/04` §S-019 空状態: 初回空は導線つき、絞り込み 0 件は条件の解除だけ。
    emptyTitle: params.filtered ? t('proposals.list.filtered.empty') : t('proposals.list.empty'),
    emptyLead: params.filtered ? null : t('proposals.list.empty.lead'),
    emptyOpenProjects: params.filtered ? null : t('proposals.list.empty.openProjects'),
    nextPage: t('proposals.list.nextPage'),
    firstPage: t('proposals.list.firstPage'),
  };
}
