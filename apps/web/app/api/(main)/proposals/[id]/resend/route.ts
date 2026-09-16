// apps/web/app/api/(main)/proposals/[id]/resend/route.ts
// docs/05 §6.5 #44 `POST /api/proposals/{id}/resend`（`F-023` / `S-022` / §10.6 / §12.5）。T-09-08。
//
// 🔴 **`SUBMIT_FAILED → APPROVED`（所有者 `RESEND`）を起こせるのは、このルートが呼ぶ `requestProposalResend`
//    （`lib/proposals/resend.ts`）だけである**（`CLAUDE.md` §4.2「`SUBMIT_FAILED` からの復帰は人間の操作に限る」/ docs/05 §10.6）。
//    `tests/static/proposal-resend-human-only.test.ts` が、この遷移を起こすコードが上記 2 ファイル以外（特に `apps/worker/**`）
//    に無いことを固定する。**再送を自動的に起動する仕組み・設定・ジョブは存在しない**（`F-023 AC-1` / docs/05 §6.8）。
// 🔴 body は `{ acknowledged: true, reason }`。`acknowledged` が `true` でなければ **400 `RESEND_NOT_ACKNOWLEDGED`**
//    （`F-023 AC-2`。「届いている可能性がある」旨の確認を経ないと呼べない）。欠落は 400 `VALIDATION`。
// 🔴 `SUBMIT_FAILED` 以外は 422（遷移表に無い組は `INVALID_STATE_TRANSITION` + `state.invalid_transition` の記録 /
//    `APPROVAL_PENDING → APPROVED` は `APPROVE` の専有 = 422 `PROPOSAL_TRANSITION_RESERVED`。#41 / #43 / #48 と同じ 3 段）。
// 🔴 認可: `OWNER` / `ADMIN` / `SALES`（ホスト）のみ。取引先は 403（`requireRole` に含まれない + `canResendProposal` の二重）。
//    `VIEWER` は 403。`SUSPENDED` / `CLOSING` では再送しない（`requireExecutable`。`F-004 AC-7`）。
// 🔴 送信元ドメイン未検証は #43 と同じく **202 + 保留**（`sendHoldReasonKey='DOMAIN_UNVERIFIED'`。状態は `APPROVED`）。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、境界外は 404。
// 🔴 `withApiRoute` の `audit` を使わない（`proposal.resend` / `proposal.submit` は `requestProposalResend` が業務トランザクションの
//    中と後で書く。400 / 403 / 404 / 422 では残さない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { sendingDomainRuntime } from '../../../../../../lib/db/bootstrap';
import { requireSendProposalJobQueue } from '../../../../../../lib/jobs/send-proposal-queue';
import { PROPOSAL_RESEND_ROLES } from '../../../../../../lib/proposals/policy';
import { requestProposalResend } from '../../../../../../lib/proposals/resend';
import { proposalParamsSchema, resendProposalBodySchema } from '../../../../../../lib/proposals/schemas';
import { evaluateSendingDomain } from '../../../../../../lib/settings/sending-domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 応答は 202（受け付けた）+ `{ outcome, attemptSeq, jobId, state: 'APPROVED', sendHoldReasonKey }`（#43 と同じ形）。
 *    **送信済みでも送信中でもない** —— 確定は送信ジョブが行い、`S-021` が読み直して反映する。200 にすると「送った」と読めてしまう。
 */
export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/resend',
    guards: [requireRole([...PROPOSAL_RESEND_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    body: resendProposalBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const result = await requestProposalResend(ctx, params.id, body, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
      // 🔴 enqueue 先は起動時 DI で決まっている（未登録なら例外 = 要求ごと失敗する）。
      queue: requireSendProposalJobQueue(),
      // 🔴 環境差は起動時に解決済み。ここで `APP_ENV` を読まない。
      resolveSendingDomain: (c) => evaluateSendingDomain(c, sendingDomainRuntime()),
    });
    return Response.json(result, { status: 202 });
  },
);
