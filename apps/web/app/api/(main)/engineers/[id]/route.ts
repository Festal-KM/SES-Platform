// apps/web/app/api/(main)/engineers/[id]/route.ts
// docs/05 §6.4 #16 `PATCH /api/engineers/{id}`（`F-008` / `S-007`。T-05-01）と
// #17 `GET /api/engineers/{id}`（`F-008` / `S-006`。T-05-02）。
//
// 🔴 `{id}` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS の C3 が決め、
//    境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。したがって
//    ホスト所属の利用者が他パートナーのエンジニア ID を直接叩いても、GET も PATCH も 404 で
//    あり、**実名・所属会社名に到達できない**（`F-008 AC-3`）。
// 🔴 所有パートナーは**この経路では変えられない**。body にキーが無く（`schemas.ts`）、
//    `data` にも載せず（`service.ts`）、DB の `engineers_freeze_owner` トリガが
//    BEFORE UPDATE で変更を拒否する（migration 20260903070000）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import {
  ENGINEER_AUDIT_ACTIONS,
  readEngineerDetail,
  updateEngineer,
} from '../../../../../lib/engineers/service';
import {
  engineerParamsSchema,
  updateEngineerBodySchema,
} from '../../../../../lib/engineers/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/engineers/{id}`（docs/05 §6.4 #17 / `F-008` / `S-006`）。T-05-02。
 *
 * 🔴 **閲覧の `AuditLog` は `readEngineerDetail` の中（業務トランザクション）で書く**
 *    （`BR-27` / `F-008 AC-4`。docs/05 §6.4「#17 の実装の決着」）。ここに `audit` オプションを
 *    置かないのは、①`S-006` の画面（サーバコンポーネント）は Route Handler を通らないため
 *    ルート側に置くと**画面経路だけ記録が漏れる** ②`audit` オプションはハンドラの前に
 *    別トランザクションで書くため、**404（境界外・不存在）でも「閲覧した」記録が残る**
 *    —— の 2 点による。記録が唯一の経路（`readEngineerDetail`）にあることで、
 *    デスクトップ・モバイル・API 直叩きのいずれでも欠落しない（`BR-28` と同じ形）。
 * 🔴 読み取り専用なので `requireExecutable` / `requireNotViewer` を掛けない
 *    （`CLOSING` でも閲覧できる = `F-004 AC-8`。`VIEWER` は閲覧のみ可 = `F-012 AC-3`）。
 *    全ロールが到達するが、**見える行は RLS が決める**（`guards: []` は「掛け忘れ」ではない）。
 */
export const GET = withApiRoute(
  { label: 'GET /api/engineers/{id}', guards: [], params: engineerParamsSchema },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    return Response.json(await readEngineerDetail(ctx, params.id, { ipAddress: meta.ipAddress }));
  },
);

/** 監査ログに残す「どの項目を更新したか」（🔴 値ではなくキー名。PII を残さない）。 */
function changedFieldsOf(body: Record<string, unknown>): string {
  return Object.keys(body)
    .filter((key) => body[key] !== undefined)
    .sort()
    .join(',');
}

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/engineers/{id}',
    guards: [
      requireRole(['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES']),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: engineerParamsSchema,
    body: updateEngineerBodySchema,
    // 🔴 `F-008` 処理④。ハンドラ本体の**前**に書く（記録できなければ更新しない）。
    //    更新は対象 ID が確定しているので `targetId` を残せる（作成との違い）。
    audit: {
      action: ENGINEER_AUDIT_ACTIONS.update,
      resolve: ({ params, body }) => ({
        targetType: 'Engineer',
        targetId: params.id,
        summary: {
          fields: changedFieldsOf(body),
          skillCount: body.skills === undefined ? null : body.skills.length,
          newSkillLabelCount: body.newSkillLabels === undefined ? 0 : body.newSkillLabels.length,
        },
      }),
    },
  },
  async ({ ctx, params, body }) => Response.json(await updateEngineer(ctx, params.id, body)),
);
