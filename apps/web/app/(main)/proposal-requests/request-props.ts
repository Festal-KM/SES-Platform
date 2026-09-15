// apps/web/app/(main)/proposal-requests/request-props.ts
// `S-017` の文言の組み立て（`ProposalRequestScreen` の props）。T-08-06。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`candidate-props.ts` / `share-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import { remainingLabels } from '../../../lib/proposal-requests/list-rows';
import type { ProposalRequestScreenMessages } from './proposal-request-screen';

export function proposalRequestScreenMessages(params: {
  readonly audience: 'HOST' | 'PARTNER';
  /** 状態フィルタが効いているか（空状態の文言が変わる）。 */
  readonly filtered: boolean;
}): ProposalRequestScreenMessages {
  const { audience, filtered } = params;
  const isHost = audience === 'HOST';
  return {
    lead: isHost ? t('proposalRequests.lead.host') : t('proposalRequests.lead.partner'),
    filterLegend: t('proposalRequests.filter.legend'),
    filterState: t('proposalRequests.column.state'),
    filterApply: t('proposalRequests.filter.apply'),
    columnProject: t('proposalRequests.column.project'),
    columnCandidate: t('proposalRequests.column.candidate'),
    columnCreatedAt: t('proposalRequests.column.createdAt'),
    columnRemaining: t('proposalRequests.column.remaining'),
    columnState: t('proposalRequests.column.state'),
    columnUpdatedAt: t('proposalRequests.column.updatedAt'),
    // 🔴 `docs/04` §S-017 空状態: ホスト初回空 → `S-016` への導線 / 取引先 → 「0 件が正常」/ 絞込 0 件 → 別文言。
    emptyTitle: filtered
      ? t('proposalRequests.filtered.empty')
      : isHost
        ? t('proposalRequests.empty.host')
        : t('proposalRequests.empty.partner'),
    emptyLead: !filtered && isHost ? t('proposalRequests.empty.hostLead') : null,
    emptyOpenProjects: !filtered && isHost ? t('proposalRequests.empty.openProjects') : null,
    detailTitle: t('proposalRequests.detail.title'),
    detailSelect: t('proposalRequests.detail.select'),
    detailMessage: t('proposalRequests.detail.message'),
    detailExpiresAt: t('proposalRequests.detail.expiresAt'),
    detailCreatedAt: t('proposalRequests.detail.createdAt'),
    detailUpdatedAt: t('proposalRequests.column.updatedAt'),
    detailOpenProject: t('candidates.project.open'),
    partnerRespond: t('proposalRequests.detail.partnerRespond'),
    withdraw: t('proposalRequests.withdraw'),
    withdrawConfirmTitle: t('proposalRequests.withdraw.confirmTitle'),
    withdrawConfirmLead: t('proposalRequests.withdraw.confirmLead'),
    withdrawConfirmSubmit: t('proposalRequests.withdraw.confirmSubmit'),
    withdrawConfirmCancel: t('proposalRequests.withdraw.confirmCancel'),
    withdrawSubmitting: t('proposalRequests.withdraw.submitting'),
    withdrawError: t('proposalRequests.withdraw.error'),
    withdrawErrorState: t('proposalRequests.withdraw.error.state'),
    deniedTitle: t('proposalRequests.deniedTitle'),
    remaining: remainingLabels(),
    remainingNone: t('proposalRequests.remaining.none'),
    nextPage: t('proposalRequests.nextPage'),
    firstPage: t('proposalRequests.firstPage'),
  };
}
