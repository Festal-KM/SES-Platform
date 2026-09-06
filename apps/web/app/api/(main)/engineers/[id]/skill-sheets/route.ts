// apps/web/app/api/(main)/engineers/[id]/skill-sheets/route.ts
// docs/05 §6.4 #19 `POST /api/engineers/{id}/skill-sheets`（アップロードの確定。`F-011` / `S-008`）。
// T-05-06。
//
// 🔴 この API が成立させるのは「ブラウザ → S3 に置いた実体を、台帳の版として確定する」ことだけで
//    ある。**共有はしない**（`CLEAN` になるまで共有 URL は発行されない。`F-011 AC-1` / `BR-26`）。
//    行は `scan_status='SCANNING'` / `is_latest=false` で生まれ、状態を動かせるのは
//    スキャン結果の適用（T-05-05）と、利用者の明示的な版の切替だけである。
//
// 🔴 `audit` オプションを置かない。記録（`skill_sheet.create`）は
//    `confirmSkillSheetUpload` の**業務トランザクションの内側**で書く（docs/05 §16.1 /
//    `F-011 AC-4`）—— `audit` オプションはハンドラの前に別トランザクションで書くため、
//    **起きなかったアップロード**（404 / 409 / 競合）まで記録に残る（`skill_alias.update`
//    と同じ判断）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { objectStore } from '../../../../../../lib/db/bootstrap';
import { SKILL_SHEET_MANAGER_ROLES } from '../../../../../../lib/skill-sheets/policy';
import { confirmSkillSheetUpload } from '../../../../../../lib/skill-sheets/service';
import {
  skillSheetConfirmBodySchema,
  skillSheetEngineerParamsSchema,
} from '../../../../../../lib/skill-sheets/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 認可は `#18`（署名の発行）と**同じ**である（`docs/02` `F-011` 関連ロール）。片方だけ広い /
 *    狭いという状態を作らない —— 署名を出せる人だけが確定でき、確定できる人だけが署名を出せる。
 * 🔴 `VIEWER` は 403（`BR-31` / `F-004 AC-6`）。`requireRole` の列挙から外すだけにせず、
 *    `requireNotViewer` を明示して `tests/static/execute-guard.test.ts` の走査対象に載せる。
 */
export const POST = withApiRoute(
  {
    label: 'POST /api/engineers/{id}/skill-sheets',
    guards: [
      requireRole(SKILL_SHEET_MANAGER_ROLES),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: skillSheetEngineerParamsSchema,
    body: skillSheetConfirmBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const result = await confirmSkillSheetUpload(
      ctx,
      params.id,
      body,
      { objectStore: objectStore(), now: () => new Date() },
      { ipAddress: meta.ipAddress },
    );
    return Response.json(result, { status: 201 });
  },
);
