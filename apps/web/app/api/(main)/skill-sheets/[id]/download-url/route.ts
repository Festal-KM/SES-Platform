// apps/web/app/api/(main)/skill-sheets/[id]/download-url/route.ts
// `GET /api/skill-sheets/{id}/download-url`（docs/05 §6.4 #20 / §14.2）。`F-012`。T-05-07。
//
// ============================================================================
// 🔴 K-7（`CLAUDE.md` §7「スキルシートの閲覧・DL で監査ログが欠落した件数 = 0 件」）
// ============================================================================
// 🔴 **`scanStatus='CLEAN'` かつ `AuditLog` の書き込みが成功した後にのみ発行する**
//    （`F-012 AC-2` / `BR-26`）。判定も記録も `issueDownloadUrl`（docs/05 §14.2 が定める
//    唯一の発行経路）の内側にあり、**このルートには条件式が 1 つも無い** ——
//    デスクトップ・モバイル・共有 URL のどの経路も同じ関数を通るので、記録が漏れる経路が
//    存在しない（`BR-28`）。
// 🔴 `withApiRoute` の `audit` オプションを使わない。あちらはハンドラの**前**に別トランザクションで
//    書くため、**404（境界外・不存在）や 409（非 `CLEAN`）でも「ダウンロードした」記録が残る**。
//
// 🔴 認可（`F-012 AC-3` / `BR-31`）: `VIEWER` は 403。閲覧（#21）はできる。
// 🔴 **`requireExecutable` を掛けない。** `CLOSING`（解約手続き中）でも「閲覧と返却
//    （エクスポート）のみ実行できる」（`F-004 AC-8` / docs/05 §6.2 の 🔴）。自社のスキルシートを
//    取り出せなくすることは、解約時のデータ返却（§9-8）を止めることに等しい。
//    docs/05 §14.2 の DL 行の前提条件にも `requireExecutable` は無い（アップロード行には有る）。
import { requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { objectStore } from '../../../../../../lib/db/bootstrap';
import { SKILL_SHEET_DOWNLOADER_ROLES } from '../../../../../../lib/skill-sheets/policy';
import { issueSkillSheetDownloadUrl } from '../../../../../../lib/skill-sheets/service';
import { skillSheetParamsSchema } from '../../../../../../lib/skill-sheets/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/skill-sheets/{id}/download-url',
    // 🔴 ロールの集合は画面（`S-008` の導線）と**同じ定数**である（`policy.ts`）。
    guards: [requireRole(SKILL_SHEET_DOWNLOADER_ROLES), requireNotViewer()],
    params: skillSheetParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const ticket = await issueSkillSheetDownloadUrl(
      ctx,
      params.id,
      { objectStore: objectStore() },
      { ipAddress: meta.ipAddress },
    );
    return Response.json(ticket);
  },
);
