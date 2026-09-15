// apps/web/app/(main)/proposals/_editor/editor-props.ts
// `S-020` の文言の組み立て（`ProposalEditor` の props）。T-09-01。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`respond-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { ProposalEditorMessages } from './proposal-editor';

/** `S-016` の候補検索。 */
export const PROPOSAL_EDITOR_HOME_PATH = '/';

export function proposalEditorMessages(): ProposalEditorMessages {
  return {
    sectionTarget: t('proposals.editor.section.target'),
    sectionTerms: t('proposals.editor.section.terms'),
    sectionContent: t('proposals.editor.section.content'),
    sectionAttachment: t('proposals.editor.section.attachment'),
    sectionGate: t('proposals.editor.section.gate'),
    sectionSendingDomain: t('proposals.editor.section.sendingDomain'),
    fieldProject: t('proposals.editor.field.project'),
    fieldEngineer: t('proposals.editor.field.engineer'),
    fieldAffiliation: t('proposals.editor.field.affiliation'),
    fieldOwner: t('proposals.editor.field.owner'),
    fieldSkills: t('proposals.editor.field.skills'),
    fieldUnitPriceRange: t('proposals.editor.field.unitPriceRange'),
    fieldAvailableFrom: t('proposals.editor.field.availableFrom'),
    fieldCareerCount: t('proposals.editor.field.careerCount'),
    fieldState: t('proposals.editor.field.state'),
    fieldRecipientCompanyName: t('proposals.editor.field.recipientCompanyName'),
    fieldRecipientEmail: t('proposals.editor.field.recipientEmail'),
    fieldOfferedUnitPrice: t('proposals.editor.field.offeredUnitPrice'),
    fieldOfferedStartDate: t('proposals.editor.field.offeredStartDate'),
    fieldWorkStyle: t('proposals.editor.field.workStyle'),
    fieldSubject: t('proposals.editor.field.subject'),
    fieldBody: t('proposals.editor.field.body'),
    required: t('proposals.editor.required'),
    projectNotShared: t('proposals.editor.project.notShared'),
    recipientMissing: t('proposals.editor.recipient.missing'),
    recipientNote: t('proposals.editor.recipient.note'),
    bodyOriginLabel: t('proposals.editor.body.originLabel'),
    bodyOriginManual: t('proposals.editor.body.origin.manual'),
    bodyMobileNote: t('proposals.editor.body.mobileNote'),
    attachmentNone: t('proposals.editor.attachment.none'),
    attachmentOpenSheets: t('proposals.editor.attachment.openSheets'),
    attachmentFrozenNone: t('proposals.editor.attachment.frozenNone'),
    openEngineer: t('proposals.editor.openEngineer'),
    create: t('proposals.editor.create'),
    creating: t('proposals.editor.creating'),
    save: t('proposals.editor.save'),
    saving: t('proposals.editor.saving'),
    saved: t('proposals.editor.saved'),
    requestGate: t('proposals.editor.requestGate'),
    requestingGate: t('proposals.editor.requestingGate'),
    gateRequested: t('proposals.editor.gateRequested'),
    unsavedNote: t('proposals.editor.unsavedNote'),
    viewerNotice: t('proposals.editor.viewerNotice'),
    deniedTitle: t('proposals.editor.deniedTitle'),
    errorValidation: t('proposals.editor.error.validation'),
    errorNotEditable: t('proposals.editor.error.notEditable'),
    errorGeneric: t('proposals.editor.error.generic'),
    errorNotClean: t('proposals.editor.error.notClean'),
    errorGateAlreadyCompleted: t('proposals.editor.error.gateAlreadyCompleted'),
    // 🔴 API の `messageKey`（`error.proposal.recipientMissing`）と同じ文言を出す（サーバの判定に画面の語を揃える）。
    errorRecipientMissing: t('error.proposal.recipientMissing'),
    gateNotRequested: t('proposals.editor.gate.notRequested'),
    gateRunning: t('proposals.editor.gate.running'),
    gateHeld: t('proposals.editor.gate.held'),
    gateHeldResetAtPrefix: t('proposals.editor.gate.heldResetAtPrefix'),
    gateLayerPii: t('proposals.editor.gate.layer.pii'),
    gateLayerCommerce: t('proposals.editor.gate.layer.commerce'),
    gateLayerConsistency: t('proposals.editor.gate.layer.consistency'),
    gateVerdict: {
      PASS: t('proposals.editor.gate.verdict.PASS'),
      FAIL: t('proposals.editor.gate.verdict.FAIL'),
      RUNNING: t('proposals.editor.gate.verdict.RUNNING'),
      // 🔴 HELD は「検査中」の語で描く（失敗ではない。`F-027 AC-5`）。理由は `gateHeld` が別に出す。
      HELD: t('proposals.editor.gate.verdict.RUNNING'),
    },
    gateAiFailed: t('proposals.editor.gate.aiFailed'),
    gateFindingsTitle: t('proposals.editor.gate.findingsTitle'),
    gateWarningsTitle: t('proposals.editor.gate.warningsTitle'),
    gateWarningLabel: t('proposals.editor.gate.warningLabel'),
    gateFindingsEmpty: t('proposals.editor.gate.findingsEmpty'),
    gateField: {
      subject: t('proposals.editor.gate.field.subject'),
      body: t('proposals.editor.gate.field.body'),
      snapshot: t('proposals.editor.gate.field.snapshot'),
      attachment: t('proposals.editor.gate.field.attachment'),
      public_summary: t('proposals.editor.gate.field.public_summary'),
      project_name: t('proposals.editor.gate.field.project_name'),
      requirement: t('proposals.editor.gate.field.requirement'),
      contract_document: t('proposals.editor.gate.field.contract_document'),
    },
    gateFailedLead: t('proposals.editor.gate.failedLead'),
    gatePassedLead: t('proposals.editor.gate.passedLead'),
  };
}
