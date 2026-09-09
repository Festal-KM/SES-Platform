// apps/web/app/api/(main)/projects/[id]/visibility/route.ts
// docs/05 §6.4 #28 `PUT /api/projects/{id}/visibility`（`F-014` / `S-013`）。T-06-06。
//
// 🔴 **越境経路 1 を動かす唯一の API である。** 認可は 4 段:
//    ①`requireRole(PROJECT_EDITOR_ROLES)`（`OWNER` / `ADMIN` / `SALES`。取引先は 403）
//    ②`requireExecutable()`（`SUSPENDED` / `CLOSING` では公開できない。`F-004 AC-7`。
//      `docs/04` §S-013 権限差分「公開操作の導線が無く、理由が表示される」の**本体**）
//    ③`requireNotViewer()`（`BR-31` / `F-004 AC-6`）
//    ④`updateProjectVisibility` の `requireHost` と `project_visibilities` の RLS（C2）
//
// 🔴 **`audit` オプションを使わない**（`#24` / `#84` と同じ形）。`F-014 AC-5` は
//    「実施者・**変更前後の公開先**」を要求しており、変更前の公開先は**行を読むまで分からない**。
//    加えて `audit` はハンドラの前に別トランザクションで書くため、**起きなかった変更**
//    （404 / 400）まで記録に残る。記録は `updateProjectVisibility` の業務トランザクション内で書く。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { requireGateRunJobQueue } from '../../../../../../lib/jobs/gate-run-queue';
import { PROJECT_EDITOR_ROLES } from '../../../../../../lib/projects/policy';
import { createProjectPublishGate } from '../../../../../../lib/projects/publish-gate';
import { updateProjectVisibility } from '../../../../../../lib/projects/visibility';
import {
  projectParamsSchema,
  projectVisibilityBodySchema,
} from '../../../../../../lib/projects/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 応答は `{ reviewGateId, verdict }`（docs/05 §6.4 #28）。
 *    **`verdict` は「公開が成立したか」ではない** —— ゲートは非同期であり（§12.1 のシーケンス）、
 *    この応答時点では合否が存在しない。`PENDING_GATE` は「公開の要求をゲートに預けた ＝
 *    **まだ公開されていない**」を意味する（`lib/projects/visibility.ts`）。
 */
export const PUT = withApiRoute(
  {
    label: 'PUT /api/projects/{id}/visibility',
    guards: [requireRole([...PROJECT_EDITOR_ROLES]), requireExecutable(), requireNotViewer()],
    params: projectParamsSchema,
    body: projectVisibilityBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const now = new Date();
    return Response.json(
      await updateProjectVisibility(
        ctx,
        params.id,
        body,
        { ipAddress: meta.ipAddress, now },
        // 🔴 T-07-09: 実装の選択は起動時 DI の 1 箇所（`lib/db/bootstrap.ts`）で終わっている。
        //    未登録なら `requireGateRunJobQueue()` が例外を投げ、**公開要求ごと失敗する** ——
        //    黙って保留にすると「公開したのに永久に届かない」状態になる（`CLAUDE.md` §11.1）。
        { gate: createProjectPublishGate({ queue: requireGateRunJobQueue(), now }) },
      ),
    );
  },
);
