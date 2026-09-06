// apps/web/app/api/(main)/skill-sheets/[id]/route.ts
// 版の削除。`F-011 AC-4`（アップロード・版の切替・**削除**が監査ログに残る）/ `S-008`。T-05-06。
//
// ⚠️ docs/05 §6.4 の表には当初この行が無かった（#19c として追記済み。`CLAUDE.md` §8.7）。
//    `F-011 AC-4` が削除の記録を要求している以上、削除の経路はどこかに存在しなければならない。
//
// 🔴 手順（`deleteSkillSheet`）は ①S3 の実体 → ②`UsageCounter` の減算（CAS）→ ③行 + 監査 の
//    順である（docs/03 §4.12）。**実体が残っているのに枠だけ空く**ことが起きない。
// 🔴 検査中（`SCANNING`）の版と、**提案に凍結添付された版**（`EngineerSnapshot` が参照する版）は
//    削除できない（409）。後者は**①より前**に止める —— FK（`ON DELETE RESTRICT`）が守るのは
//    ③の行だけで、そのときには実体が消えているためである。理由は `service.ts` の 🔴 に書いた。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { objectStore } from '../../../../../lib/db/bootstrap';
import { SKILL_SHEET_MANAGER_ROLES } from '../../../../../lib/skill-sheets/policy';
import { deleteSkillSheet } from '../../../../../lib/skill-sheets/service';
import { skillSheetParamsSchema } from '../../../../../lib/skill-sheets/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 認可は `#18` / `#19` と同じ（`docs/02` `F-011` 関連ロール）。`VIEWER` は 403。
 * 🔴 監査（`skill_sheet.delete`）は業務トランザクション内で書く（記録できなければ行も消えない）。
 *    `audit` オプションを使わないのは、**起きなかった削除**（404 / 409）まで残るからである。
 */
export const DELETE = withApiRoute(
  {
    label: 'DELETE /api/skill-sheets/{id}',
    guards: [
      requireRole(SKILL_SHEET_MANAGER_ROLES),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: skillSheetParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    await deleteSkillSheet(
      ctx,
      params.id,
      { objectStore: objectStore(), now: () => new Date() },
      { ipAddress: meta.ipAddress },
    );
    return new Response(null, { status: 204 });
  },
);
