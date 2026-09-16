// apps/web/app/api/(main)/proposals/[id]/submit/route.ts
// docs/05 §6.5 #43 `POST /api/proposals/{id}/submit`（`F-022` / `S-021` / §10.2 / §10.4 / §10.6）。T-09-06。
//
// 🔴 **このルートは送信ジョブを積むだけで、状態を動かさない。** `APPROVED → SUBMITTING` の CAS（③）・`SendAttempt` の
//    予約（④）・外部呼び出し（⑤）・確定（⑥）はすべて `apps/worker` の `send.proposal`（所有者 `SEND_JOB`）にある。
//    `castProposalToSubmitting` / `reserveSendAttempt` は `apps/web/**` から参照しない（`tests/static/auth-db-callers.test.ts`）。
// 🔴 **request は空である**（docs/05 §6.5 #43 `{ }`）。`body` スキーマを宣言しないため、宛先・本文・添付・`force` の類は
//    ハンドラに 1 バイトも届かない。送るものは行の値（ゲートを通った内容）だけである。
// 🔴 `APPROVED` 以外は 422（遷移表に無い組は `INVALID_STATE_TRANSITION` + `state.invalid_transition` の記録。#48 / #41 と同じ 3 段）。
// 🔴 認可: `OWNER` / `ADMIN` / `SALES`（ホスト）のみ。取引先は 403（`requireRole` に含まれない + `canSubmitProposal` の二重）。
//    `VIEWER` は 403。`SUSPENDED` / `CLOSING` では送信を要求しない（`requireExecutable`。`F-004 AC-7`）。
// 🔴 送信元ドメイン未検証は **422 ではなく 202 + 保留**（`sendHoldReasonKey='DOMAIN_UNVERIFIED'`。`F-022 AC-7`）。判定は
//    `requireVerifiedSendingDomain` と同じ `evaluateSendingDomain` を**ハンドラの本体**で呼ぶ（理由は `lib/proposals/submit.ts` 冒頭）。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、境界外は 404。
// 🔴 `withApiRoute` の `audit` を使わない（`proposal.submit` は `requestProposalSubmission` が書く。403 / 404 / 422 では残さない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { sendingDomainRuntime } from '../../../../../../lib/db/bootstrap';
import { requireSendProposalJobQueue } from '../../../../../../lib/jobs/send-proposal-queue';
import { PROPOSAL_SUBMIT_ROLES } from '../../../../../../lib/proposals/policy';
import { proposalParamsSchema } from '../../../../../../lib/proposals/schemas';
import { requestProposalSubmission } from '../../../../../../lib/proposals/submit';
import { evaluateSendingDomain } from '../../../../../../lib/settings/sending-domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 応答は 202（受け付けた）+ `{ outcome, attemptSeq, jobId, state, sendHoldReasonKey }`（docs/05 §6.5 #43 の決着）。
 *    **送信済みでも送信中でもない** —— 確定は送信ジョブが行い、画面は読み直して反映する。200 にすると「送った」と読めてしまう。
 */
export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/submit',
    guards: [requireRole([...PROPOSAL_SUBMIT_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    // 🔴 `body` を宣言しない（ファイル冒頭）。
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const result = await requestProposalSubmission(ctx, params.id, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
      // 🔴 enqueue 先は起動時 DI で決まっている（未登録なら例外 = 要求ごと失敗する）。
      queue: requireSendProposalJobQueue(),
      // 🔴 環境差（`sandbox` / `demo` / `development` は検証不要）は起動時に解決済み。ここで `APP_ENV` を読まない。
      resolveSendingDomain: (c) => evaluateSendingDomain(c, sendingDomainRuntime()),
    });
    return Response.json(result, { status: 202 });
  },
);
