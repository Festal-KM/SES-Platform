// apps/web/app/(main)/proposals/send-failures/failure-props.ts
// `S-022` の文言の組み立て（`SendFailureScreen` の props）。T-09-08。
//
// 🔴 文言は `packages/i18n` の 1 か所から引く（`CLAUDE.md` §3.5）。画面本体（`.tsx`）は `'use client'` であり
//    `t()` を呼ばせない（`request-props.ts` / `approval-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { SendFailureScreenMessages } from './send-failure-screen';

export function sendFailureScreenMessages(): SendFailureScreenMessages {
  return {
    lead: t('sendFailures.lead'),
    columnRecipient: t('sendFailures.column.recipient'),
    columnEngineer: t('sendFailures.column.engineer'),
    columnProject: t('sendFailures.column.project'),
    columnFailureKind: t('sendFailures.column.failureKind'),
    columnLastAttemptAt: t('sendFailures.column.lastAttemptAt'),
    columnElapsed: t('sendFailures.column.elapsed'),
    columnAttemptCount: t('sendFailures.column.attemptCount'),
    // ✅ SP-22 段④: 操作列と件数バーの並び順の説明。
    columnAction: t('sendFailures.column.action'),
    panelOpen: t('sendFailures.panel.open'),
    orderNote: t('sendFailures.orderNote'),
    // 🔴 母集団の 1 行には件数を入れない（件数は `summary.countLabel` が `note` の側で持つ）。
    population: t('sendFailures.population'),
    // 🔴 `docs/04` §S-022 空状態: 「空であることが正常」と分かる文言。
    emptyTitle: t('sendFailures.empty'),
    emptyLead: t('sendFailures.empty.lead'),
    detailTitle: t('sendFailures.detail.title'),
    detailSelect: t('sendFailures.detail.select'),
    detailFailureKind: t('sendFailures.detail.failureKind'),
    detailFailureKindRaw: t('sendFailures.detail.failureKindRaw'),
    detailLastAttemptAt: t('sendFailures.detail.lastAttemptAt'),
    detailAttemptCount: t('sendFailures.detail.attemptCount'),
    detailUnitPrice: t('sendFailures.detail.unitPrice'),
    detailAttemptsTitle: t('sendFailures.attempt.title'),
    detailOpenApproval: t('sendFailures.detail.openApproval'),
    detailOpenDetail: t('sendFailures.detail.openDetail'),
    detailOpenSendingDomain: t('sendFailures.detail.openSendingDomain'),
    resend: t('sendFailures.resend'),
    resendConfirmTitle: t('sendFailures.resend.confirmTitle'),
    resendConfirmLead: t('sendFailures.resend.confirmLead'),
    resendAcknowledge: t('sendFailures.resend.acknowledge'),
    resendReasonLabel: t('sendFailures.resend.reasonLabel'),
    resendConfirmSubmit: t('sendFailures.resend.confirmSubmit'),
    resendConfirmCancel: t('sendFailures.resend.confirmCancel'),
    resendSubmitting: t('sendFailures.resend.submitting'),
    resendErrorValidation: t('sendFailures.resend.error.validation'),
    resendErrorState: t('sendFailures.resend.error.state'),
    resendErrorForbidden: t('sendFailures.resend.error.forbidden'),
    resendErrorSendBlocked: t('sendFailures.resend.error.sendBlocked'),
    resendErrorGeneric: t('sendFailures.resend.error.generic'),
    viewerNotice: t('sendFailures.viewerNotice'),
    deniedTitle: t('sendFailures.deniedTitle'),
  };
}
