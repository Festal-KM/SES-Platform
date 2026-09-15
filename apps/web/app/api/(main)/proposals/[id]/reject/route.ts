// apps/web/app/api/(main)/proposals/[id]/reject/route.ts
// docs/05 §6.5 #42 `POST /api/proposals/{id}/reject`（`F-021` / `S-021`）。T-09-03。
//
// 🔴 却下（差し戻し）は `APPROVAL_PENDING → DRAFT`（所有者 `REJECT` = #42 の専有。T-09-02）。理由は必須で
//    `ProposalEvent.note` に書き、監査（`proposal.reject`）の `summary` には載せない（自由入力。docs/05 §16.2）。
// 🔴 `GATE_FAILED → DRAFT`（修正のための差し戻し。所有者 `MANUAL` = #48）はここから起こせない
//    （422 `PROPOSAL_TRANSITION_RESERVED`）。遷移表に無い状態からは 422 `INVALID_STATE_TRANSITION` + 記録。
// 🔴 認可・境界・監査の規律は #41 と同じ（`approve/route.ts` の冒頭）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { rejectProposal } from '../../../../../../lib/proposals/approval';
import { PROPOSAL_APPROVAL_ROLES } from '../../../../../../lib/proposals/policy';
import { proposalParamsSchema, rejectProposalBodySchema } from '../../../../../../lib/proposals/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/reject',
    guards: [requireRole([...PROPOSAL_APPROVAL_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    body: rejectProposalBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await rejectProposal(ctx, params.id, body, {
        now: () => new Date(),
        meta: { ipAddress: meta.ipAddress },
      }),
    );
  },
);
