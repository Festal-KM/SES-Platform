// apps/web/app/api/(main)/proposals/[id]/route.ts
// docs/05 §6.5 #37 `PATCH /api/proposals/{id}`（`F-019` / `S-020`。「T-09-01 の決着」）。T-09-01。
//
// 🔴 **`DRAFT` のみ。他状態は 422 `PROPOSAL_NOT_EDITABLE`**（docs/05 §6.5 #37）。判定と CAS は `updateProposalDraft`。
//    `GATE_RUNNING` 以降の内容を書き換える経路を作らない（検査した内容と送る内容が食い違う。§11.5）。
// 🔴 **提案先の 2 列は設定・変更できるが空にはできない**（`updateProposalBodySchema`）。経路 4 由来の `DRAFT`
//    （提案先が空）はここで埋め、#39 が通るようになる。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、
//    境界外の ID は 404（docs/05 §4.8）。**行を読んでから** `canEditProposal`（作成者 / ホストの営業・管理者）。
// 🔴 認可は #36 と同じ 3 本（`VIEWER` は 403。`SUSPENDED` / `CLOSING` では編集できない）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は業務トランザクション内。403 / 404 / 409 / 422 では残さない）。
// ⚠️ `GET /api/proposals/{id}`（#46。`S-023`）は T-09-09 が同じファイルに足す。`S-020` はサーバコンポーネントから
//    `readProposalEditor` を直接読む（自己 fetch しない。`S-018` と同じ）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { PROPOSAL_EDITOR_ROLES } from '../../../../../lib/proposals/policy';
import { proposalParamsSchema, updateProposalBodySchema } from '../../../../../lib/proposals/schemas';
import { updateProposalDraft } from '../../../../../lib/proposals/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/proposals/{id}',
    guards: [requireRole([...PROPOSAL_EDITOR_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    body: updateProposalBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await updateProposalDraft(ctx, params.id, body, {
        now: () => new Date(),
        meta: { ipAddress: meta.ipAddress },
      }),
    );
  },
);
