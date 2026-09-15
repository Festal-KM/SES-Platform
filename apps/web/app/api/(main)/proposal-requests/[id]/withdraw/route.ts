// apps/web/app/api/(main)/proposal-requests/[id]/withdraw/route.ts
// docs/05 §6.5 #35 `POST /api/proposal-requests/{id}/withdraw`（`F-018` 処理⑤ / `S-017`）。T-08-06。
//
// 🔴 動かす遷移は `REQUESTED → WITHDRAWN_BY_HOST` の 1 つだけ（`CLAUDE.md` §4.2）。判定は
//    `proposalRequestMachine.transition()` + CAS（`withdrawProposalRequest`）。遷移表に無い要求は
//    **422 `INVALID_STATE_TRANSITION`**（サイレントに無視しない。`BR-33` / docs/05 §15.3）。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposal_requests` の RLS（C5）が
//    決め、境界外の ID は 404（docs/05 §4.8）。
// 🔴 認可は #31 と同じ 3 本。`requireExecutable` を掛ける —— 取り下げは取引先に見えている依頼を消す
//    実行系である（`SUSPENDED` / `CLOSING` では実行系を止める。`F-004 AC-7` / `AC-8`）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は業務トランザクション内。404 / 422 では残さない）。
// 🔴 応答は **204**（docs/05 §6.5 #35）。取り下げ後の状態は一覧の再読込で読む。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { PROPOSAL_REQUEST_ISSUER_ROLES } from '../../../../../../lib/proposal-requests/policy';
import { proposalRequestParamsSchema } from '../../../../../../lib/proposal-requests/schemas';
import { withdrawProposalRequest } from '../../../../../../lib/proposal-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposal-requests/{id}/withdraw',
    guards: [requireRole(PROPOSAL_REQUEST_ISSUER_ROLES), requireExecutable(), requireNotViewer()],
    params: proposalRequestParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    await withdrawProposalRequest(ctx, params.id, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return new Response(null, { status: 204 });
  },
);
