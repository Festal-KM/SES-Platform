// apps/web/app/api/(main)/proposals/[id]/gate/route.ts
// docs/05 §6.5 #39 `POST /api/proposals/{id}/gate` / #40 `GET /api/proposals/{id}/gate`
// （`F-020` / `F-027` / `S-020`）。T-07-08。
//
// 🔴 **このルートに `force` / `override` は存在しない**（docs/05 §6.8 / `F-020 AC-2` / `BR-18`）。
//    body も query もスキーマを持たないため、`?force=true` を付けても値はハンドラに 1 バイトも
//    届かない（`withApiRoute` は宣言されていない面を `undefined` のまま渡す）。
//    `POST /api/proposals/{id}/gate/override` に相当するルートファイルも作らない ——
//    **FAIL を上書きできるロールは存在しない。**
//
// 🔴 #39 の認可は 4 段:
//    ①`requireRole(PROPOSAL_GATE_REQUEST_ROLES)`（`VIEWER` は 403）
//    ②`requireExecutable()`（`SUSPENDED` / `CLOSING` では実行できない。`F-004 AC-7`。
//      取引先企業の停止もここで落ちる）
//    ③`requireNotViewer()`（`BR-31` / `F-004 AC-6`）
//    ④`canRequestProposalGate`（作成者 / ホストの `OWNER`・`ADMIN`・`SALES`。docs/05 §9.10 ①）
//      —— **行を読んでから**判定する（ロールだけでは他人の提案を止められない）。
//
// 🔴 #40 は読み取りなので `requireExecutable` を掛けない（`CLOSING` でも閲覧はできる。
//    `F-004 AC-8`）。母集団は `proposals` / `review_gates` の RLS（C5）が決める。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { requireGateRunJobQueue } from '../../../../../../lib/jobs/gate-run-queue';
import { readProposalGateResult, requestProposalGate } from '../../../../../../lib/proposals/gate';
import { PROPOSAL_GATE_REQUEST_ROLES } from '../../../../../../lib/proposals/policy';
import { proposalParamsSchema } from '../../../../../../lib/proposals/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 応答は `{ jobId }`（docs/05 §6.5 #39）。**合否ではない** —— ゲートは非同期であり
 *    （§12.1 のシーケンス / `docs/04` §S-020「ゲート実行は数十秒。離脱可能」）、
 *    この応答時点では判定が存在しない。確定は #40 のポーリングで取る。
 * 🔴 202（受け付けた）を返す。200 にすると「検査が終わった」と読めてしまう。
 */
export const POST = withApiRoute(
  {
    label: 'POST /api/proposals/{id}/gate',
    guards: [requireRole([...PROPOSAL_GATE_REQUEST_ROLES]), requireExecutable(), requireNotViewer()],
    params: proposalParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const result = await requestProposalGate(ctx, params.id, {
      // 🔴 enqueue 先は起動時 DI で決まっている（未登録なら例外 = 依頼ごと失敗する）。
      queue: requireGateRunJobQueue(),
      meta: { ipAddress: meta.ipAddress, now: new Date() },
    });
    return Response.json(result, { status: 202 });
  },
);

/**
 * 🔴 応答は `GateResultView`（docs/05 §11.7）。**ゲート状態は 3 値**であり、
 *    `HELD_AI_COST_LIMIT` を `RUNNING` / `DONE` に潰さない（`F-027 AC-5`）。
 */
export const GET = withApiRoute(
  {
    label: 'GET /api/proposals/{id}/gate',
    guards: [requireRole([...PROPOSAL_GATE_REQUEST_ROLES, 'VIEWER'])],
    params: proposalParamsSchema,
  },
  async ({ ctx, params }) =>
    Response.json(await readProposalGateResult(ctx, params.id, { now: new Date() })),
);
