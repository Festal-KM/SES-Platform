// apps/web/app/api/(main)/proposals/[id]/approve/route.ts
// docs/05 §6.5 #41 `POST /api/proposals/{id}/approve`（`F-021` / `S-021` / §10.3 / §11.5 手順 3）。T-09-03。
//
// 🔴 **request は空である（ゲート結果を引数に取らない）。** `body` スキーマを宣言しないため、`{ gate: … }` / `{ force: true }` /
//    `{ reviewGateId }` のような入力は**ハンドラに 1 バイトも届かない**（`withApiRoute` はスキーマの無い面を読まない）。
//    承認の根拠になるゲート結果は `approveProposal`（`@ses/db`）が**現在の内容のハッシュ**で `review_gates` から引く。
//    承認側がゲート結果を持ち込める構造にしない（`docs/04` 申し送り 4 / `F-020 AC-2` / `CLAUDE.md` §3.3）。
// 🔴 `APPROVAL_PENDING` 以外は 422（遷移表に無い組は `INVALID_STATE_TRANSITION` + 記録、`SUBMIT_FAILED → APPROVED` は
//    #44 の専有なので `PROPOSAL_TRANSITION_RESERVED`）。内容が変わった / 検査していない / FAIL / HELD は 409 `GATE_STALE`。
// 🔴 認可: `OWNER` / `ADMIN` / `SALES`（ホスト）のみ。`VIEWER` は 403（`requireRole` + `requireNotViewer` の二重）。
//    取引先のロールは `requireRole` に含まれない。`SUSPENDED` / `CLOSING` では承認しない（`requireExecutable`。
//    `F-004 AC-7`「実行系〔承認〕は一切できない」）。
// 🔴 `{id}` は操作対象の指定であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が決め、境界外は 404。
// 🔴 `withApiRoute` の `audit` を使わない（`proposal.approve` は `approveProposal` が業務トランザクション内で書く。
//    403 / 404 / 409 / 422 では残さない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { approveProposalByUser } from '../../../../../../lib/proposals/approval';
import { PROPOSAL_APPROVAL_ROLES } from '../../../../../../lib/proposals/policy';
import { proposalParamsSchema } from '../../../../../../lib/proposals/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/approve',
    guards: [requireRole([...PROPOSAL_APPROVAL_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
    // 🔴 `body` を宣言しない（ファイル冒頭）。
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await approveProposalByUser(ctx, params.id, {
        now: () => new Date(),
        meta: { ipAddress: meta.ipAddress },
      }),
    );
  },
);
