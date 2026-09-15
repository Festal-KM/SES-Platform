// apps/web/app/api/(main)/proposals/route.ts
// docs/05 §6.5 #36 `POST /api/proposals`（`F-019` / `S-020`。「T-09-01 の決着」）。T-09-01。
//
// 🔴 **作成の実体は `createProposal` → `createProposalDraft`（`@ses/db`）の 1 実装**である。#33（応諾）と同じ
//    関数が凍結（`EngineerSnapshot`）・`ProposalEvent`・`proposal.create` を書く。ここに凍結を書かない。
// 🔴 **提案先の 2 列を必須入力に含める**（経路 4 由来だけが「後から埋める」形。docs/04 §S-020 改訂 10）。
// 🔴 認可は 3 本: `requireRole(PROPOSAL_EDITOR_ROLES)`（`VIEWER` は 403）+ `requireExecutable`（提案の**新規作成**。
//    `SUSPENDED` / `CLOSING` では作れない。`F-004 AC-7` / `AC-8`。取引先企業の停止もここで落ちる）+ `requireNotViewer`。
//    **所属の軸**（ホストは自社所有、取引先は自社所属のエンジニアだけ）はロールではなく RLS（`engineers` の C3 /
//    `projects` の C4）が決め、見えなければ 404（docs/05 §4.8）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は `createProposalDraft` の業務トランザクション内。404 では残さない）。
// 🔴 応答は **201 `{ id, snapshot: { frozenAt, careerCount } }`**（docs/05 §6.5 #36）。凍結した値そのものは返さない。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../lib/auth/session';
import { PROPOSAL_EDITOR_ROLES } from '../../../../lib/proposals/policy';
import { createProposalBodySchema } from '../../../../lib/proposals/schemas';
import { createProposal } from '../../../../lib/proposals/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposals',
    guards: [requireRole([...PROPOSAL_EDITOR_ROLES]), requireExecutable(), requireNotViewer()],
    body: createProposalBodySchema,
  },
  async ({ ctx, body }) => {
    const meta = await readRequestMeta();
    const result = await createProposal(ctx, body, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return Response.json(
      { id: result.id, snapshot: { frozenAt: result.snapshot.frozenAt.toISOString(), careerCount: result.snapshot.careerCount } },
      { status: 201 },
    );
  },
);
