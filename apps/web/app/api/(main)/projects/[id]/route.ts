// apps/web/app/api/(main)/projects/[id]/route.ts
// docs/05 §6.4 #26 `PATCH /api/projects/{id}`（`F-013` / `S-012`）。T-06-01。
//
// 🔴 `{id}` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS が決め、
//    境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
// 🔴 認可は `PROJECT_EDITOR_ROLES`（`OWNER` / `ADMIN` / `SALES`）。パートナーは 403 であり、
//    かつ `projects` の RLS（C2 の UPDATE。`app_is_host()`）が DB でも拒否する。
//
// ⚠️ **`GET /api/projects/{id}`（#27。`HostProjectDetailView` / `PartnerProjectDetailView` の
//    射影）は T-06-02 が足す。** 本タスクで export しない —— 商流情報の射影を分ける設計が
//    T-06-02 の中核であり、先に「ホスト用だけ返す GET」を置くと、パートナー向けの型を
//    後から**削る**作業になる（`docs/sprints/SP-06` T-06-02 の 🔴）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { PROJECT_EDITOR_ROLES } from '../../../../../lib/projects/policy';
import {
  PROJECT_AUDIT_ACTIONS,
  requirementCounts,
  updateProject,
} from '../../../../../lib/projects/service';
import {
  projectParamsSchema,
  updateProjectBodySchema,
} from '../../../../../lib/projects/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 監査ログに残す「どの項目を更新したか」（🔴 値ではなくキー名。商流情報の値を残さない）。 */
function changedFieldsOf(body: Record<string, unknown>): string {
  return Object.keys(body)
    .filter((key) => body[key] !== undefined)
    .sort()
    .join(',');
}

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/projects/{id}',
    guards: [
      requireRole([...PROJECT_EDITOR_ROLES]),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: projectParamsSchema,
    body: updateProjectBodySchema,
    // 🔴 `F-013` 処理④。ハンドラ本体の**前**に書く（記録できなければ更新しない）。
    //    更新は対象 ID が確定しているので `targetId` を残せる（作成との違い）。
    // 🔴 `summary` に載せるのはキー名・列挙値・件数だけである（docs/05 §16.2）。
    //    `endClientName` は**キー名としてだけ**現れ、値は 1 文字も残らない。
    audit: {
      action: PROJECT_AUDIT_ACTIONS.update,
      resolve: ({ params, body }) => ({
        targetType: 'Project',
        targetId: params.id,
        summary: {
          fields: changedFieldsOf(body),
          status: body.status ?? null,
          ...requirementCounts(body.requirements),
        },
      }),
    },
  },
  async ({ ctx, params, body }) => Response.json(await updateProject(ctx, params.id, body)),
);
