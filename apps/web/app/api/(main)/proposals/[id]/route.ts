// apps/web/app/api/(main)/proposals/[id]/route.ts
// docs/05 §6.5 #37 `PATCH /api/proposals/{id}`（`F-019` / `S-020`。「T-09-01 の決着」）。T-09-01。
// ✅ T-09-09: #46 `GET /api/proposals/{id}`（`F-024` / `F-037 AC-1` / `S-023`。「#45 / #46 / #47 の実装の決着」）を同じファイルに足した。
//
// 🔴 **`DRAFT` のみ。他状態は 422 `PROPOSAL_NOT_EDITABLE`**（docs/05 §6.5 #37）。判定と CAS は `updateProposalDraft`。
//    `GATE_RUNNING` 以降の内容を書き換える経路を作らない（検査した内容と送る内容が食い違う。§11.5）。
// 🔴 **提案先の 2 列は設定・変更できるが空にはできない**（`updateProposalBodySchema`）。経路 4 由来の `DRAFT`
//    （提案先が空）はここで埋め、#39 が通るようになる。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、
//    境界外の ID は 404（docs/05 §4.8）。**行を読んでから** `canEditProposal`（作成者 / ホストの営業・管理者）。
// 🔴 認可は #36 と同じ 3 本（`VIEWER` は 403。`SUSPENDED` / `CLOSING` では編集できない）。
// 🔴 `withApiRoute` の `audit` を使わない（記録は業務トランザクション内。403 / 404 / 409 / 422 では残さない）。
//
// 🔴 **#46 は `guards: []`（読み取り）**。応答は `HostProposalDetailView` | `PartnerProposalDetailView` そのもの（docs/05 §6.5 #46）。
//    取引先向けの型に `owner` / `sendHold` / `approval`（承認者）/ `sendAttempts`（送信試行）/ **`duplicateFindings`** は存在しない
//    （`F-037 AC-1`。`views.types.test.ts` が固定）。`snapshot.careers` は**凍結側だけ**（台帳の現在値は #46b。SP-09 の範囲外）。
//    `S-021` の送信中ポーリングはこの応答（`state` / `sendHold`）を読む（`router.refresh()` の代替。T-09-06 の申し送り 3）。
//    🔴 `AuditLog` を書かない —— 提案詳細の閲覧は `BR-27` の閲覧記録の対象（エンジニア詳細・スキルシート・案件詳細）ではない。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { readProposalDetail } from '../../../../../lib/proposals/detail';
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

export const GET = withApiRoute(
  {
    label: 'GET /api/proposals/{id}',
    guards: [],
    params: proposalParamsSchema,
  },
  async ({ ctx, params }) => {
    const screen = await readProposalDetail(ctx, params.id, { now: new Date() });
    // 🔴 応答は詳細 view そのもの（`gate` / `canAddNote` は `S-023` のサーバコンポーネントだけが使う画面の材料。API 契約に含めない）。
    return Response.json(screen.detail);
  },
);
