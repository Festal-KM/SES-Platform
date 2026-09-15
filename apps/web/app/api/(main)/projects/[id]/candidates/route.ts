// apps/web/app/api/(main)/projects/[id]/candidates/route.ts
// docs/05 §6.5 #30 `GET /api/projects/{id}/candidates`（`F-009` / `F-017` / `S-016`）。T-08-05。
//
// 🔴 **匿名候補（`AnonymousCandidateView`）を含むのはホストの応答だけ**（`F-017 AC-5` / `BR-56`）。
//    パートナーには 1 件も含まない —— 分岐は `listProjectCandidates` が `ctx.partnerCompanyId`
//    （認証コンテキスト）だけで行い、`withSharedCandidateScope` 自身の `requireHost` が二重に拒む。
// 🔴 `{id}` は**操作対象の指定**であって実行者のスコープではない。母集団は `projects` の RLS（C4）が
//    決め、境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
// 🔴 **認可は `guards: []`（全ロール）**。読み取り専用であり `VIEWER` も `CLOSING` も閲覧できる
//    （`F-004 AC-6` / `AC-8`。`#15` / `#27` と同じ判断）。**`guards: []` は「掛け忘れ」ではない。**
// 🔴 **閲覧の `AuditLog`（`project.view` / `summary.via = 'CANDIDATES'`）は `listProjectCandidates` の
//    業務トランザクションの内側で書く**（`docs/03` §4.13.2-5 / `BR-27`）。ここに `audit` オプションを
//    置かないのは `#27` と同じ 2 点（画面経路だけ記録が漏れる / 404 でも記録が残る）による。
// 🔴 **不正なカーソル（UUID や別の形）は 400**（`projectCandidateListQuerySchema`）。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { listProjectCandidates } from '../../../../../../lib/candidates/list';
import {
  candidateProjectParamsSchema,
  projectCandidateListQuerySchema,
} from '../../../../../../lib/candidates/schemas';
import { candidateReference } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 Phase 1 は `'P1'` 固定（docs/05 §6.5 #30。スコア列は Phase 2 の `F-029` で `'P2'` になる）。 */
const PHASE = 'P1' as const;

export const GET = withApiRoute(
  {
    label: 'GET /api/projects/{id}/candidates',
    guards: [],
    params: candidateProjectParamsSchema,
    query: projectCandidateListQuerySchema,
  },
  async ({ ctx, params, query }) => {
    const meta = await readRequestMeta();
    const view = await listProjectCandidates(ctx, params.id, { kind: 'CRITERIA', query }, {
      // 🔴 鍵そのものではなく、起動時に鍵を閉じ込めた関数を渡す（`bootstrap.ts`）。
      candidateRef: candidateReference(),
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    // 🔴 契約は `{ project, items, total, nextCursor, phase }`（docs/05 §6.5「#30 の実装の決着」）。
    //    `query`（効いた条件）は画面の初期値のためのものであり、API は要求された条件をそのまま知っている。
    return Response.json({
      project: view.project,
      items: view.items,
      total: view.total,
      nextCursor: view.nextCursor,
      phase: PHASE,
    });
  },
);
