// apps/web/app/api/(main)/proposals/route.ts
// docs/05 §6.5 #36 `POST /api/proposals`（`F-019` / `S-020`。「T-09-01 の決着」）。T-09-01。
// ✅ T-09-09: #45 `GET /api/proposals`（`F-024` / `S-019`。「#45 / #46 / #47 の実装の決着」）を同じファイルに足した。
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
//
// 🔴 **#45 は `guards: []`（読み取り）**。`VIEWER` / `CLOSING` でも一覧は見える（`F-004 AC-6` / `AC-8`）。応答の型は所属で分岐する
//    （`HostProposalListItem[]` / `PartnerProposalListItem[]`。取引先向けに `owner` / `sendHold` / 送信試行は存在しない）。母集団は
//    `proposals` の RLS（C5）が「取引先 = 自社が作成した行」に閉じ、🔴 **`byState` / `requestsByState` / `total` も同じ接続で数える**
//    （境界適用後。docs/05 §4.8）。`DECLINED` は `ProposalRequest` の状態であり `requestsByState` の側にだけ現れる（`F-024 AC-2`）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../lib/auth/session';
import { listProposals } from '../../../../lib/proposals/list';
import { PROPOSAL_EDITOR_ROLES } from '../../../../lib/proposals/policy';
import { createProposalBodySchema, proposalListQuerySchema } from '../../../../lib/proposals/schemas';
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

export const GET = withApiRoute(
  {
    label: 'GET /api/proposals',
    guards: [],
    query: proposalListQuerySchema,
  },
  async ({ ctx, query }) => {
    const view = await listProposals(ctx, query);
    // 🔴 契約は `{ items, total, byState, requestsByState, nextCursor }`（docs/05 §6.5 #45）。`audience` は載せない（呼び出し側は所属を知っている）。
    return Response.json({
      items: view.items,
      total: view.total,
      byState: view.byState,
      requestsByState: view.requestsByState,
      nextCursor: view.nextCursor,
    });
  },
);
