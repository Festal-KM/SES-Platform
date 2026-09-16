// apps/web/app/api/(main)/proposals/[id]/events/route.ts
// docs/05 §6.5 #47 `POST /api/proposals/{id}/events`（`F-024` / `S-023`。「#45 / #46 / #47 の実装の決着」）。T-09-09。
//
// 🔴 **人間のメモ（`kind='NOTE'`）だけを受け、状態を動かさない**（`ProposalEvent` の `fromState = toState = 現在の状態`。
//    `proposals` は UPDATE しない）。`STATE` / `ATTACHMENT` を書ける入力面は無い（body の `kind` は `'NOTE'` の 1 値。400）。
//    遷移の経路は #39 / #41 / #42 / #43 / #44 / #48 とジョブだけであり、`CLAUDE.md` §4.2 の遷移表に無い書き込みをここから作らない。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、境界外の ID は 404
//    （docs/05 §4.8）。**行を読んでから** `canAddProposalNote`（作成者 / ホストの `OWNER`・`ADMIN`・`SALES`。外れたら 403）。
// 🔴 認可は #36 / #37 / #48 と同じ 3 本（`VIEWER` は 403。`SUSPENDED` / `CLOSING` ではメモも書かない —— 新規作成であり、
//    `CLOSING` は「新規作成ができず、エクスポートのみ可能」。`CLAUDE.md` §4.2）。
// 🔴 `withApiRoute` の `audit` を使わない（`AuditLog(proposal_event.create, summary = { kind })` は業務トランザクション内。403 / 404 では残さない。
//    🔴 `summary` に `note` を載せない。§16.2）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { createProposalNote } from '../../../../../../lib/proposals/notes';
import { PROPOSAL_NOTE_ROLES } from '../../../../../../lib/proposals/policy';
import { createProposalEventBodySchema, proposalParamsSchema } from '../../../../../../lib/proposals/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/events',
    guards: [requireRole([...PROPOSAL_NOTE_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    body: createProposalEventBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const created = await createProposalNote(ctx, params.id, body, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return Response.json(created, { status: 201 });
  },
);
