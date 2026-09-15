// apps/web/app/api/(main)/proposals/[id]/transition/route.ts
// docs/05 §6.5 #48 `POST /api/proposals/{id}/transition`（`F-024` / `F-025`。「#48 の実装の決着」）。T-09-02。
//
// 🔴 **人間の明示操作による遷移だけを受ける**（所有者 `MANUAL` の 10 本: `GATE_FAILED → DRAFT` と `SUBMITTED` 以降の
//    商談進行・結果・辞退）。レビュー依頼（#39）・ゲートジョブ・承認（#41）・却下（#42）・送信ジョブ・再送（#44）の
//    専有は、body の列挙（`to` は 7 値のみ。400）と `transitionProposal` の第 2 層（422 `PROPOSAL_TRANSITION_RESERVED`）の
//    二重で止める。**承認・送信・ゲート結果をこの API で書ける置き場所を作らない**（`CLAUDE.md` §3.3 / §3.4）。
// 🔴 `CLAUDE.md` §4.2 に無い遷移は **422 `INVALID_STATE_TRANSITION`**（状態は変化せず `state.invalid_transition` が
//    記録される。サイレントに無視しない。`BR-33` / `F-024 AC-1`）。判定は `proposalMachine.transition()` + CAS。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、
//    境界外の ID は 404（docs/05 §4.8）。**行を読んでから** `canTransitionProposal`（立場の判定。外れたら 403）。
// 🔴 認可は #36 / #37 と同じ 3 本（`VIEWER` は 403。`SUSPENDED` / `CLOSING` では状態を書かない）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は業務トランザクション内。403 / 404 / 422 では `proposal.update` を残さない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { PROPOSAL_TRANSITION_ROLES } from '../../../../../../lib/proposals/policy';
import { proposalParamsSchema, transitionProposalBodySchema } from '../../../../../../lib/proposals/schemas';
import { transitionProposal } from '../../../../../../lib/proposals/transition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/transition',
    guards: [requireRole([...PROPOSAL_TRANSITION_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    body: transitionProposalBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await transitionProposal(ctx, params.id, body, {
        now: () => new Date(),
        meta: { ipAddress: meta.ipAddress },
      }),
    );
  },
);
