// apps/web/app/api/(main)/skill-sheets/[id]/latest/route.ts
// 版の切替（最新版フラグの付け替え）。`F-011` 処理③ / `AC-4` / `S-008`。T-05-06。
//
// ⚠️ docs/05 §6.4 の表には当初この行が無かった（#18 / #19 / #20 / #21 / #22 のみ）。しかし
//    `F-011` は「**`CLEAN` になった版のみ最新版フラグを持てる**」（処理③）と
//    「**版の切替が監査ログに残る**」（`AC-4`）を要求し、docs/05 §8.5.1 は
//    「スキャン結果の適用が `is_latest` を立てることは無い（**版の切替は #19 の責務**）」と
//    書いている。確定（#19）は `SCANNING` の行を作るだけなので **`is_latest` を立てられない**
//    （DB の `skill_sheets_latest_clean_check` が拒否する）。したがって切替は
//    「`CLEAN` になった後の、利用者の明示操作」でしかありえず、そのための経路をここに置いた
//    （docs/05 §6.4 に #19b として追記済み。`CLAUDE.md` §8.7）。
//
// 🔴 `POST` にする（`PUT /api/skill-sheets/{id}` のような「行の更新」にしない）。この操作は
//    対象の版だけでなく**同じエンジニアの他の版のフラグも落とす**ため、部分更新の意味論に
//    乗せると「何が変わるのか」が読めなくなる（`#13` の `/suspend` / `/resume` と同じ規律）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { SKILL_SHEET_MANAGER_ROLES } from '../../../../../../lib/skill-sheets/policy';
import { setLatestSkillSheet } from '../../../../../../lib/skill-sheets/service';
import { skillSheetParamsSchema } from '../../../../../../lib/skill-sheets/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 認可は `#18` / `#19` と同じ（`docs/02` `F-011` 関連ロール）。`VIEWER` は 403。
 * 🔴 監査（`skill_sheet.update` + `summary.operation='SET_LATEST'`）は
 *    `setLatestSkillSheet` の業務トランザクション内で書く。ここに `audit` オプションを
 *    置かないのは、**すでに最新版だった場合（冪等な no-op）まで記録に残る**からである。
 */
export const POST = withApiRoute(
  {
    label: 'POST /api/skill-sheets/{id}/latest',
    guards: [
      requireRole(SKILL_SHEET_MANAGER_ROLES),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: skillSheetParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    await setLatestSkillSheet(ctx, params.id, { ipAddress: meta.ipAddress });
    return new Response(null, { status: 204 });
  },
);
