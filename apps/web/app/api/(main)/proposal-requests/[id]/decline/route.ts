// apps/web/app/api/(main)/proposal-requests/[id]/decline/route.ts
// docs/05 §6.5 #34 `POST /api/proposal-requests/{id}/decline`（`F-018` 処理④ / `AC-1` / `BR-57` / `S-018`）。T-08-07。
//
// 🔴 動かす遷移は `REQUESTED → DECLINED` の 1 つだけ（`CLAUDE.md` §4.2）。判定は
//    `proposalRequestMachine.transition()` + CAS（`declineProposalRequest`）。遷移表に無い要求は
//    **422 `INVALID_STATE_TRANSITION`**（サイレントに無視しない。`BR-33` / docs/05 §15.3）。
// 🔴 **辞退の理由はパートナー社内限定**（`F-018 AC-1` / `BR-57`）。行の `decline_reason` にだけ書き、
//    監査の `summary` にもホスト向けの型にも載せない。`reason` は**任意**（空でも辞退できる）。
// 🔴 認可は #33 と同じ 3 本（`requireExecutable` を掛ける —— 全実行系ルートの規律。`tests/static/execute-guard.test.ts`）。
//    所属の軸は `declineProposalRequest` の `assertPartnerContext`（ホスト文脈は 404）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は業務トランザクション内。404 / 422 では残さない）。
// 🔴 応答は **204**（docs/05 §6.5 #34）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { PROPOSAL_REQUEST_RESPONDER_ROLES } from '../../../../../../lib/proposal-requests/policy';
import {
  proposalRequestDeclineBodySchema,
  proposalRequestParamsSchema,
} from '../../../../../../lib/proposal-requests/schemas';
import { declineProposalRequest } from '../../../../../../lib/proposal-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposal-requests/{id}/decline',
    guards: [requireRole(PROPOSAL_REQUEST_RESPONDER_ROLES), requireExecutable(), requireNotViewer()],
    params: proposalRequestParamsSchema,
    body: proposalRequestDeclineBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    await declineProposalRequest(ctx, params.id, body, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return new Response(null, { status: 204 });
  },
);
