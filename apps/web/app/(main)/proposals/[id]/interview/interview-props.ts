// apps/web/app/(main)/proposals/[id]/interview/interview-props.ts
// `S-024` の文言の組み立て（`ProposalInterviewScreen` の props）。T-09-10。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり `t()` を呼ばせない
//    （`approval-props.ts` / `detail-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { ProposalInterviewNoteLabels } from '../../../../../lib/proposals/interview-note';
import type { ProposalInterviewScreenMessages } from './proposal-interview-screen';

/** 🔴 #48 の `note` を組む語（`interview-note.ts` の `buildProposalInterviewNote` が使う）。 */
export function proposalInterviewNoteLabels(): ProposalInterviewNoteLabels {
  return {
    scheduled: t('proposals.interview.note.scheduled'),
    interviewed: t('proposals.interview.note.interviewed'),
    won: t('proposals.interview.note.won'),
    lost: t('proposals.interview.note.lost'),
    withdrawn: t('proposals.interview.note.withdrawn'),
    separator: t('proposals.interview.note.separator'),
    reasonOpen: t('proposals.interview.note.reasonOpen'),
    reasonClose: t('proposals.interview.note.reasonClose'),
  };
}

export function proposalInterviewScreenMessages(): ProposalInterviewScreenMessages {
  return {
    lead: t('proposals.interview.lead'),
    sectionSummary: t('proposals.interview.section.summary'),
    sectionRecent: t('proposals.interview.section.recent'),
    sectionOperations: t('proposals.interview.section.operations'),
    fieldState: t('proposals.interview.field.state'),
    recentEmpty: t('proposals.interview.recent.empty'),
    recentOpenDetail: t('proposals.interview.recent.openDetail'),
    backToDetail: t('proposals.interview.backToDetail'),
    inputScheduledAt: t('proposals.interview.input.scheduledAt'),
    inputInterviewedOn: t('proposals.interview.input.interviewedOn'),
    inputMemo: t('proposals.interview.input.memo'),
    inputReason: t('proposals.interview.input.reason'),
    inputMemoHint: t('proposals.interview.input.memoHint'),
    notePreview: t('proposals.interview.notePreview'),
    notePreviewNone: t('proposals.interview.notePreview.none'),
    submit: t('proposals.interview.submit'),
    submitting: t('proposals.interview.submitting'),
    cancel: t('proposals.interview.cancel'),
    confirmTitle: t('proposals.interview.confirm.title'),
    confirmSubmit: t('proposals.interview.confirm.submit'),
    confirmCancel: t('proposals.interview.confirm.cancel'),
    recorded: t('proposals.interview.recorded'),
    recordedStatePrefix: t('proposals.interview.recorded.statePrefix'),
    operationsNone: t('proposals.interview.operations.none'),
    viewerNotice: t('proposals.interview.viewerNotice'),
    deniedTitle: t('proposals.interview.deniedTitle'),
    errorValidation: t('proposals.interview.error.validation'),
    errorStatePrefix: t('proposals.interview.error.state.prefix'),
    errorStateSuffix: t('proposals.interview.error.state.suffix'),
    errorForbidden: t('proposals.interview.error.forbidden'),
    errorConflict: t('proposals.interview.error.conflict'),
    errorGeneric: t('proposals.interview.error.generic'),
  };
}
