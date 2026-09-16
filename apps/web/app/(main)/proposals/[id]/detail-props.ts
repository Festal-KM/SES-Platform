// apps/web/app/(main)/proposals/[id]/detail-props.ts
// `S-023` の文言の組み立て（`ProposalDetailScreen` の props）。T-09-09。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5`）。画面本体（`.tsx`）は `'use client'` であり `t()` を呼ばせない
//    （`approval-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { ProposalDetailScreenMessages } from './proposal-detail-screen';

export function proposalDetailScreenMessages(): ProposalDetailScreenMessages {
  return {
    sectionHeader: t('proposals.detail.section.header'),
    sectionHold: t('proposals.detail.section.hold'),
    sectionTimeline: t('proposals.detail.section.timeline'),
    sectionFrozen: t('proposals.detail.section.frozen'),
    sectionGate: t('proposals.detail.section.gate'),
    sectionActions: t('proposals.detail.section.actions'),
    sectionNote: t('proposals.detail.section.note'),
    fieldState: t('proposals.detail.field.state'),
    fieldApprover: t('proposals.detail.field.approver'),
    fieldSubmittedAt: t('proposals.detail.field.submittedAt'),
    fieldSendAttempts: t('proposals.detail.field.sendAttempts'),
    fieldLastFailure: t('proposals.detail.field.lastFailure'),
    sendAttemptsNone: t('proposals.detail.sendAttempts.none'),
    frozenSubject: t('proposals.detail.frozen.subject'),
    frozenBody: t('proposals.detail.frozen.body'),
    frozenAttachment: t('proposals.detail.frozen.attachment'),
    // 🔴 `S-006` セクション 8 と同じ 4 列の語（`docs/04` §S-023「同じ 4 列・同じ並び」）。
    careerColumnPeriod: t('engineers.careers.column.period'),
    careerColumnRole: t('engineers.careers.column.role'),
    careerColumnDescription: t('engineers.careers.column.description'),
    careerColumnTechnologies: t('engineers.careers.column.technologies'),
    gateNotRequested: t('proposals.approval.gate.notRequested'),
    gateWarningsTitle: t('proposals.approval.gate.warningsTitle'),
    gateFindingsTitle: t('proposals.approval.gate.findingsTitle'),
    gateFindingsEmpty: t('proposals.approval.gate.findingsEmpty'),
    gateWarningsEmpty: t('proposals.approval.gate.warningsEmpty'),
    noteLabel: t('proposals.detail.note.label'),
    noteLead: t('proposals.detail.note.lead'),
    noteSubmit: t('proposals.detail.note.submit'),
    noteSubmitting: t('proposals.detail.note.submitting'),
    noteAdded: t('proposals.detail.note.added'),
    noteViewerNotice: t('proposals.detail.note.viewerNotice'),
    noteForbiddenNotice: t('proposals.detail.note.forbiddenNotice'),
    noteErrorValidation: t('proposals.detail.note.error.validation'),
    noteErrorForbidden: t('proposals.detail.note.error.forbidden'),
    noteErrorGeneric: t('proposals.detail.note.error.generic'),
    deniedTitle: t('proposals.detail.deniedTitle'),
    backToList: t('proposals.detail.breadcrumb.list'),
  };
}
