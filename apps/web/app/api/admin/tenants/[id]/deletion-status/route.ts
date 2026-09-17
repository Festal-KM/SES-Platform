// apps/web/app/api/admin/tenants/[id]/deletion-status/route.ts
// docs/05 §6.9 API-A12 `GET /api/admin/tenants/{id}/deletion-status`（`F-062 AC-7` / `F-064 AC-2` / `A-010` セクション 4）。
// 認可: `PO` / `PP`（閲覧のみ。`F-062 AC-7`「閲覧は PLATFORM_SUPPORT にも許される」）。T-10-10。
//
// 🔴 **削除完了の確認を返す唯一の API**（docs/04 program-design 申し送り 15 / `tests/static/deletion-status-single-route.test.ts`）。
//    `A-003`（API-A3）/ `A-013` / `S-042` / `A-005`（API-A8。失敗のみ）にこの応答を写さない。
// 🔴 応答は `{ tenantId, lifecycleState, purgeRuns: { cause, status, startedAt, completedAt, counts }[] }` だけ。
//    `failureReason`（`A-005` にも出さない自由文）・削除された内容・返却データの `object_key` へ到達する導線を持たない（`BR-40`）。
// 🔴 本ファイルは `GET` のみを export する（`BR-37`。`tests/static/admin-tenants-read-only.test.ts`）。
import { readDeletionStatus } from '@ses/db/platform';
import { z } from 'zod';
import { errorResponse, requireFound, ValidationError } from '../../../../../../lib/api/errors';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../../../lib/auth/platform-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requirePlatformCtx();

    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    const meta = await readPlatformRequestMeta();
    const view = await readDeletionStatus(ctx, parsed.data.id, { ipAddress: meta.ipAddress });
    return Response.json(requireFound(view), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
