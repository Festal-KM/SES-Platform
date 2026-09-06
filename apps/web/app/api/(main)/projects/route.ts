// apps/web/app/api/(main)/projects/route.ts
// docs/05 §6.4 #25 `GET /api/projects`（`F-015` / `S-010`。T-06-03）と
// #26 `POST /api/projects`（`F-013` / `S-012`。T-06-01）。
//
// 🔴 認可は docs/05 §6.4 #26 のとおり `OWNER` / `ADMIN` / `SALES`。ロールの一覧は
//    `lib/projects/policy.ts` の `PROJECT_EDITOR_ROLES` が唯一の出所であり、
//    ガード（API）と画面の到達判定（`S-012`）が**同じ定数**を見る。
// 🔴 **パートナーは案件を作成できない**（`docs/04` §S-012 権限差分）。`requireRole` が 403 に
//    するのは第 1 層であり、`projects` の RLS（C2。書込の `WITH CHECK` に `app_is_host()`）が
//    第 2 層として DB でも拒否する（二重防御。`CLAUDE.md` §3.1）。
// 🔴 `VIEWER` は `requireRole` と `requireNotViewer` の**両方**で落ちる（`BR-31` /
//    `F-004 AC-6`。片方だけにしないのは、ロール一覧を書き換えたときに `VIEWER` が
//    紛れ込んでも `requireNotViewer` が残るため）。
// 🔴 `SUSPENDED` / `CLOSING` のテナントは `requireExecutable` が拒否する（`F-004 AC-7`）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { listProjects } from '../../../../lib/projects/list';
import { PROJECT_EDITOR_ROLES } from '../../../../lib/projects/policy';
import {
  createProject,
  PROJECT_AUDIT_ACTIONS,
  requirementCounts,
} from '../../../../lib/projects/service';
import {
  createProjectBodySchema,
  projectListQuerySchema,
} from '../../../../lib/projects/schemas';

// 🔴 Node ランタイム固定（Prisma は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/projects`（docs/05 §6.4 #25 / `F-015` / `S-010`）。T-06-03。
 *
 * 🔴 **認可は `guards: []`（全ロール）**。docs/05 §6.4 #25 の「全ロール」そのものである。
 *    読み取り専用なので `requireExecutable` / `requireNotViewer` を掛けない —— `VIEWER` は
 *    閲覧のみ可（`F-004 AC-6` / `BR-31`）、`CLOSING` でも閲覧できる（`F-004 AC-8`）。
 *    **`guards: []` は「掛け忘れ」ではない**（`#15` / `#17` / `#27` と同じ判断）。
 * 🔴 **母集団を絞るのは `projects` の RLS（C4 VISIBILITY）だけ**である。ここにも
 *    `listProjects` にも `tenantId` / `partnerCompanyId` / 公開範囲の条件を書かない ——
 *    パートナーが API を直接叩いても、自社に公開されていない案件は `items` にも `total` にも
 *    現れない（`F-015 AC-1` / `F-014 AC-1` / `F-004 AC-3`）。
 * 🔴 **`audit` オプションを使わない。** `BR-27` / `F-013 AC-3` の記録対象は「案件**詳細**の
 *    閲覧」であり、一覧の記録は `docs/04` §S-010 のとおり**行クリック（→ `S-011`）**が持つ
 *    （docs/05 §16.1 / `lib/projects/list.ts` 冒頭に理由を書いた）。
 * 🔴 **不正なカーソル・未知の状態・上限超過の `limit` は 400** である
 *    （`projectListQuerySchema`）。Prisma に届かせない（`lib/api/pagination.ts` の注記）。
 */
export const GET = withApiRoute(
  { label: 'GET /api/projects', guards: [], query: projectListQuerySchema },
  async ({ ctx, query }) => Response.json(await listProjects(ctx, query)),
);

export const POST = withApiRoute(
  {
    label: 'POST /api/projects',
    guards: [
      requireRole([...PROJECT_EDITOR_ROLES]),
      requireExecutable(),
      requireNotViewer(),
    ],
    body: createProjectBodySchema,
    // 🔴 `F-013` 処理④「作成・更新・詳細閲覧を監査ログに記録する」。`withApiRoute` が
    //    ハンドラ本体の**前**に書き、記録に失敗したらハンドラを呼ばない（docs/05 §6.1 / §16.1）。
    // 🔴 `targetId` は採番前なので `null`（`engineer.create` と同じ扱い）。
    // 🔴 **`name` / `endClientName` / 単価を `summary` に載せない**（docs/05 §16.2
    //    「単価・エンド企業名を入れない」）。運営者の横断検索（`F-058`）に商流情報が出るため。
    //    残すのは列挙値（`status`）と件数だけにする —— `F-013 AC-1` の区分が保存されたことを
    //    記録の側からも後追いできる。
    audit: {
      action: PROJECT_AUDIT_ACTIONS.create,
      resolve: ({ body }) => ({
        targetType: 'Project',
        targetId: null,
        summary: {
          status: body.status,
          headcount: body.headcount,
          ...requirementCounts(body.requirements),
        },
      }),
    },
  },
  async ({ ctx, body }) => Response.json(await createProject(ctx, body), { status: 201 }),
);
