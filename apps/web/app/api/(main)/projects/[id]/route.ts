// apps/web/app/api/(main)/projects/[id]/route.ts
// docs/05 §6.4 #26 `PATCH /api/projects/{id}`（`F-013` / `S-012`。T-06-01）と
// #27 `GET /api/projects/{id}`（`F-013` / `S-011`。T-06-02）。
//
// 🔴 `{id}` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS が決め、
//    境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
// 🔴 PATCH の認可は `PROJECT_EDITOR_ROLES`（`OWNER` / `ADMIN` / `SALES`）。パートナーは 403 であり、
//    かつ `projects` の RLS（C2 の UPDATE。`app_is_host()`）が DB でも拒否する。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { requireGateRunJobQueue } from '../../../../../lib/jobs/gate-run-queue';
import { PROJECT_EDITOR_ROLES } from '../../../../../lib/projects/policy';
import { createProjectPublishGate } from '../../../../../lib/projects/publish-gate';
import {
  PROJECT_AUDIT_ACTIONS,
  readProjectDetail,
  requirementCounts,
  updateProject,
} from '../../../../../lib/projects/service';
import {
  projectParamsSchema,
  updateProjectBodySchema,
} from '../../../../../lib/projects/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/projects/{id}`（docs/05 §6.4 #27 / `F-013` / `S-011`）。T-06-02。
 *
 * 🔴 **応答の型はホストと取引先で違う**（`HostProjectDetailView` / `PartnerProjectDetailView`）。
 *    分けているのは**取得時の射影**であり（`readProjectDetail`）、このハンドラは受け取った
 *    view をそのまま返す。**ここでフィールドを落とす後処理を書かない**（書いた時点で
 *    「取得後に隠す」実装に戻る。`docs/sprints/SP-06` T-06-02 の 🔴）。
 * 🔴 **閲覧の `AuditLog` は `readProjectDetail` の中（業務トランザクション）で書く**
 *    （`BR-27` / `F-013 AC-3`。`#17` と同じ判断）。ここに `audit` オプションを置かないのは、
 *    ①`S-011` の画面（サーバコンポーネント）は Route Handler を通らないためルート側に置くと
 *    **画面経路だけ記録が漏れる** ②`audit` はハンドラの前に別トランザクションで書くため、
 *    **404（境界外・不存在）でも「閲覧した」記録が残る** —— の 2 点による。
 * 🔴 読み取り専用なので `requireExecutable` / `requireNotViewer` を掛けない
 *    （`CLOSING` でも閲覧できる = `F-004 AC-8`。`VIEWER` は閲覧のみ可 = `F-004 AC-6`）。
 *    全ロールが到達するが、**見える行は RLS の C4 が決める**（`guards: []` は「掛け忘れ」ではない）。
 */
export const GET = withApiRoute(
  { label: 'GET /api/projects/{id}', guards: [], params: projectParamsSchema },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    // 🔴 T-12-10: 公開の状態（`publishState`）は保留の再開時刻を含むため現在時刻を渡す。
    return Response.json(
      await readProjectDetail(ctx, params.id, { ipAddress: meta.ipAddress, now: new Date() }),
    );
  },
);

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
  async ({ ctx, params, body }) => {
    // 🔴 T-12-10: 公開中の案件で公開欄 3 欄が実際に変わった保存は、コミット後に
    //    `gate.run{ PROJECT_PUBLISH, kind='RECHECK' }` を積む（`F-014 AC-6`。docs/05 §11.11
    //    「T-12-10 の実装の決着」③）。実装の選択は起動時 DI の 1 箇所（`lib/db/bootstrap.ts`）で
    //    終わっており、未登録なら `requireGateRunJobQueue()` が例外を投げる ——
    //    🔴 **黙って「再検査しない」に倒さない**（`CLAUDE.md` §11.1。それは T-12-10 が塞ぐ穴そのもの）。
    const now = new Date();
    return Response.json(
      await updateProject(ctx, params.id, body, {
        gate: createProjectPublishGate({ queue: requireGateRunJobQueue(), now }),
      }),
    );
  },
);
