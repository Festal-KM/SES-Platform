// apps/web/app/(main)/proposal-requests/[id]/respond-props.ts
// `S-018` の文言の組み立て（`ProposalRequestRespondScreen` の props）。T-08-07。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`request-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import { disclosureItems } from '../../../../lib/proposal-requests/detail-rows';
import { remainingLabels } from '../../../../lib/proposal-requests/list-rows';
import type { ProposalRequestRespondScreenMessages } from './proposal-request-respond-screen';

export function proposalRequestRespondScreenMessages(): ProposalRequestRespondScreenMessages {
  return {
    backToList: t('proposalRequests.respond.backToList'),
    sectionRequest: t('proposalRequests.respond.section.request'),
    sectionEngineer: t('proposalRequests.respond.section.engineer'),
    sectionDisclosure: t('proposalRequests.respond.section.disclosure'),
    sectionActions: t('proposalRequests.respond.section.actions'),
    fieldProject: t('proposalRequests.respond.field.project'),
    fieldMessage: t('proposalRequests.respond.field.message'),
    fieldExpiresAt: t('proposalRequests.respond.field.expiresAt'),
    fieldCreatedAt: t('proposalRequests.respond.field.createdAt'),
    fieldRespondedAt: t('proposalRequests.respond.field.respondedAt'),
    requirementsMust: t('proposalRequests.respond.requirements.must'),
    requirementsNice: t('proposalRequests.respond.requirements.nice'),
    requirementsEmpty: t('proposalRequests.respond.requirements.empty'),
    requirementColumnRequirement: t('proposalRequests.respond.requirements.column.requirement'),
    requirementColumnYears: t('proposalRequests.respond.requirements.column.years'),
    openProject: t('proposalRequests.respond.openProject'),
    openEngineer: t('proposalRequests.respond.openEngineer'),
    engineerMissing: t('proposalRequests.respond.engineer.missing'),
    projectNotShared: t('proposalRequests.respond.project.notShared'),
    disclosureLead: t('proposalRequests.respond.disclosure.lead'),
    disclosureItems: disclosureItems(),
    accept: t('proposalRequests.respond.accept'),
    acceptConfirmTitle: t('proposalRequests.respond.accept.confirmTitle'),
    acceptConfirmLead: t('proposalRequests.respond.accept.confirmLead'),
    acceptConfirmSubmit: t('proposalRequests.respond.accept.confirmSubmit'),
    acceptConfirmCancel: t('proposalRequests.respond.accept.confirmCancel'),
    acceptSubmitting: t('proposalRequests.respond.accept.submitting'),
    acceptDone: t('proposalRequests.respond.accept.done'),
    acceptDoneProposalId: t('proposalRequests.respond.accept.doneProposalId'),
    acceptDoneNext: t('proposalRequests.respond.accept.doneNext'),
    openProposal: t('proposalRequests.respond.openProposal'),
    decline: t('proposalRequests.respond.decline'),
    declineReasonLabel: t('proposalRequests.respond.decline.reasonLabel'),
    declineReasonNote: t('proposalRequests.respond.decline.reasonNote'),
    declineSubmit: t('proposalRequests.respond.decline.submit'),
    declineCancel: t('proposalRequests.respond.decline.cancel'),
    declineSubmitting: t('proposalRequests.respond.decline.submitting'),
    declineDone: t('proposalRequests.respond.decline.done'),
    declineRecordedReason: t('proposalRequests.respond.decline.recordedReason'),
    declineRecordedReasonNone: t('proposalRequests.respond.decline.recordedReasonNone'),
    errorState: t('proposalRequests.respond.error.state'),
    errorProjectNotShared: t('proposalRequests.respond.error.projectNotShared'),
    errorGeneric: t('proposalRequests.respond.error.generic'),
    viewerNotice: t('proposalRequests.respond.viewerNotice'),
    deniedTitle: t('proposalRequests.deniedTitle'),
    remaining: remainingLabels(),
    remainingNone: t('proposalRequests.remaining.none'),
    valueNone: t('projects.detail.valueNone'),
  };
}
