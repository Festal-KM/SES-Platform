// apps/web/app/(main)/proposals/[id]/approve/approval-props.ts
// `S-021` の文言の組み立て（`ProposalApprovalScreen` の props）。T-09-03。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`editor-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { ProposalApprovalScreenMessages } from './proposal-approval-screen';

/** `S-003`。 */
export const PROPOSAL_APPROVAL_HOME_PATH = '/';

/** `S-041`（監査ログ横断検索）。自動承認の根拠（`proposal.approve` / `reason='ALL_LAYERS_PASS'`）を辿る導線。 */
export const PROPOSAL_APPROVAL_AUDIT_PATH = '/audit-logs';

export function proposalApprovalScreenMessages(): ProposalApprovalScreenMessages {
  return {
    sectionHeader: t('proposals.approval.section.header'),
    sectionGate: t('proposals.approval.section.gate'),
    sectionPreview: t('proposals.approval.section.preview'),
    sectionAttachment: t('proposals.approval.section.attachment'),
    sectionSendingDomain: t('proposals.approval.section.sendingDomain'),
    sectionActions: t('proposals.approval.section.actions'),
    fieldState: t('proposals.approval.field.state'),
    fieldApprover: t('proposals.approval.field.approver'),
    gateRunning: t('proposals.approval.gate.running'),
    gateHeld: t('proposals.approval.gate.held'),
    gateHeldResetAtPrefix: t('proposals.approval.gate.heldResetAtPrefix'),
    gateAiFailed: t('proposals.approval.gate.aiFailed'),
    gateFindingsTitle: t('proposals.approval.gate.findingsTitle'),
    gateFindingsEmpty: t('proposals.approval.gate.findingsEmpty'),
    gateWarningsTitle: t('proposals.approval.gate.warningsTitle'),
    gateWarningsEmpty: t('proposals.approval.gate.warningsEmpty'),
    gateWarningLabel: t('proposals.approval.gate.warningLabel'),
    gateWarningsNote: t('proposals.approval.gate.warningsNote'),
    gateNotRequested: t('proposals.approval.gate.notRequested'),
    previewLead: t('proposals.approval.preview.lead'),
    previewSubject: t('proposals.approval.preview.subject'),
    previewBody: t('proposals.approval.preview.body'),
    previewSubjectEmpty: t('proposals.approval.preview.subjectEmpty'),
    previewBodyEmpty: t('proposals.approval.preview.bodyEmpty'),
    previewAttachmentLabel: t('proposals.approval.preview.attachmentLabel'),
    previewAttachmentNone: t('proposals.approval.preview.attachmentNone'),
    previewHighlightBlock: t('proposals.approval.preview.highlightBlock'),
    previewHighlightWarn: t('proposals.approval.preview.highlightWarn'),
    previewEnd: t('proposals.approval.preview.end'),
    attachmentViewNote: t('proposals.approval.attachment.viewNote'),
    sendingDomainUnverifiedNote: t('proposals.approval.sendingDomain.unverifiedNote'),
    auditLink: t('proposals.approval.approver.auditLink'),
    approve: t('proposals.approval.action.approve'),
    approving: t('proposals.approval.action.approving'),
    approved: t('proposals.approval.action.approved'),
    reject: t('proposals.approval.action.reject'),
    rejectReasonLabel: t('proposals.approval.action.rejectReasonLabel'),
    rejectSubmit: t('proposals.approval.action.rejectSubmit'),
    rejecting: t('proposals.approval.action.rejecting'),
    rejected: t('proposals.approval.action.rejected'),
    rejectCancel: t('proposals.approval.action.rejectCancel'),
    scrollRequired: t('proposals.approval.action.scrollRequired'),
    openEditor: t('proposals.approval.action.openEditor'),
    backHome: t('proposals.approval.action.backHome'),
    viewerNotice: t('proposals.approval.viewerNotice'),
    deniedTitle: t('proposals.approval.deniedTitle'),
    errorValidation: t('proposals.approval.error.validation'),
    errorStale: t('proposals.approval.error.stale'),
    errorState: t('proposals.approval.error.state'),
    errorForbidden: t('proposals.approval.error.forbidden'),
    errorGeneric: t('proposals.approval.error.generic'),
  };
}
