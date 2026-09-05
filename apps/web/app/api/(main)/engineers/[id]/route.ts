// apps/web/app/api/(main)/engineers/[id]/route.ts
// docs/05 §6.4 #16 `PATCH /api/engineers/{id}`（`F-008` / `S-007`）。T-05-01。
//
// 🔴 `{id}` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS の C3 が決め、
//    境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。したがって
//    ホスト所属の利用者が他パートナーのエンジニア ID を直接叩いても 404 である（`F-008 AC-3`）。
// 🔴 所有パートナーは**この経路では変えられない**。body にキーが無く（`schemas.ts`）、
//    `data` にも載せず（`service.ts`）、DB の `engineers_freeze_owner` トリガが
//    BEFORE UPDATE で変更を拒否する（migration 20260903070000）。
//
// ⚠️ `GET /api/engineers/{id}`（#17。`OwnEngineerDetailView` と `engineer.view` の記録）は
//    **T-05-02 の範囲**であり、ここには置かない。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { ENGINEER_AUDIT_ACTIONS, updateEngineer } from '../../../../../lib/engineers/service';
import {
  engineerParamsSchema,
  updateEngineerBodySchema,
} from '../../../../../lib/engineers/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
