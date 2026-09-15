// apps/web/app/api/(main)/proposal-requests/[id]/accept/route.ts
// docs/05 §6.5 #33 `POST /api/proposal-requests/{id}/accept`（`F-018` 処理③ / `AC-3` / `S-018`）。T-08-07。
//
// 🔴 動かす遷移は `REQUESTED → ACCEPTED` の 1 つだけ（`CLAUDE.md` §4.2）。判定は
//    `proposalRequestMachine.transition()` + CAS（`acceptProposalRequest`）。遷移表に無い要求は
//    **422 `INVALID_STATE_TRANSITION`**（サイレントに無視しない。`BR-33` / docs/05 §15.3）。
// 🔴 **`ACCEPTED` と `Proposal(DRAFT)` の生成は同一トランザクション**（`docs/02` `program-design` 申し送り 12）。
//    生成の実体は `packages/db` の `createProposalDraft`（#36 と同じ 1 実装）。
// 🔴 **ここで初めて実名・所属会社名・スキルシートがホストに開示される**（経路 2 に合流。`F-018 AC-3`）。
// 🔴 認可は 3 本: `requireRole(PARTNER_ADMIN / PARTNER_SALES)`（ホストロールは 403）+ `requireExecutable`
//    （提案の**新規作成**であり `SUSPENDED` / `CLOSING` では作れない。`F-004 AC-7` / `AC-8`）+ `requireNotViewer`。
//    所属の軸は `acceptProposalRequest` の `assertPartnerContext`（ホスト文脈は 404）。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposal_requests` の RLS（C5）が
//    決め、境界外の ID は 404（docs/05 §4.8）。
// 🔴 body を持たない（提案先を決められる主体が居ない。docs/05 §6.5「T-08-07 の決着」）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は業務トランザクション内。404 / 422 では残さない）。
// 🔴 応答は **201 `{ proposalId }`**（docs/05 §6.5 #33）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { PROPOSAL_REQUEST_RESPONDER_ROLES } from '../../../../../../lib/proposal-requests/policy';
import { proposalRequestParamsSchema } from '../../../../../../lib/proposal-requests/schemas';
import { acceptProposalRequest } from '../../../../../../lib/proposal-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposal-requests/{id}/accept',
    guards: [requireRole(PROPOSAL_REQUEST_RESPONDER_ROLES), requireExecutable(), requireNotViewer()],
    params: proposalRequestParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const accepted = await acceptProposalRequest(ctx, params.id, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return Response.json(accepted, { status: 201 });
  },
);
