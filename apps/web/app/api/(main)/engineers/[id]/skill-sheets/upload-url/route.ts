// apps/web/app/api/(main)/engineers/[id]/skill-sheets/upload-url/route.ts
// docs/05 §6.4 #18 `POST /api/engineers/{id}/skill-sheets/upload-url`（`F-011` / `S-008`）。T-05-04。
//
// 🔴 発行の前提条件（docs/05 §14.2）のうち、ルートが持つのは ①`requireExecutable`
//    ②`VIEWER` でない の 2 つである。③ストレージ上限 ④`Content-Length` は
//    `issueSkillSheetUploadUrl`（サービス層）が持つ —— 画面（`S-008`）も同じ関数を通るため、
//    **判定の経路が 1 本**になる（`issueDownloadUrl` と同じ規律）。
//
// 🔴 `audit` オプションを置かない。ここでは行が 1 つも作られず、外部にも何も渡らない
//    （docs/05 §16.1 に本 API の行は無い）。記録するのは確定（#19。`skill_sheet.upload`）と
//    ダウンロード（#20。`skill_sheet.download`）である。**「署名を出した」だけの記録を足すと、
//    `S-041` の操作種別フィルタに、実際には何も起きていない行が混ざる。**
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../lib/api/withApiRoute';
import { objectStore, storageRuntime } from '../../../../../../../lib/db/bootstrap';
import { issueSkillSheetUploadUrl } from '../../../../../../../lib/skill-sheets/service';
import {
  skillSheetUploadUrlBodySchema,
  skillSheetUploadUrlParamsSchema,
} from '../../../../../../../lib/skill-sheets/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 認可は `F-011` の関連ロール（`docs/02` §F-011「関連ロール」）。**取引先も自社エンジニア分の
 *    スキルシートを登録する**ため `PARTNER_ADMIN` / `PARTNER_SALES` を含む。見える対象は
 *    `engineers` の RLS（C3）が絞るので、他社のエンジニアを指定しても 404 になる。
 * 🔴 `VIEWER` は 403（`BR-31` / `F-004 AC-6`）。`requireRole` の列挙から外すだけにしない ——
 *    `requireNotViewer` を明示して `tests/static/execute-guard.test.ts` の走査対象に載せる。
 */
export const POST = withApiRoute(
  {
    label: 'POST /api/engineers/{id}/skill-sheets/upload-url',
    guards: [
      requireRole(['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES']),
      requireExecutable(),
      requireNotViewer(),
    ],
    params: skillSheetUploadUrlParamsSchema,
    body: skillSheetUploadUrlBodySchema,
  },
  async ({ ctx, params, body }) => {
    const runtimeConfig = storageRuntime();
    return Response.json(
      await issueSkillSheetUploadUrl(ctx, params.id, body, {
        objectStore: objectStore(),
        uploadMaxBytes: runtimeConfig.uploadMaxBytes,
        storageLimitBytes: runtimeConfig.storageLimitBytes,
        now: () => new Date(),
      }),
      { status: 201 },
    );
  },
);
