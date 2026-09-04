// apps/web/app/api/admin/tenants/[id]/route.ts
// docs/05 §6.9 API-A3 `GET /api/admin/tenants/{id}`（`F-056` / `A-003`）。認可: `PO`/`PP`（閲覧のみ）。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。エンジニアの氏名・
//    スキルシートの内容・案件の内容・提案の本文・チャット本文へ到達する導線を持たない
//    （応答は `getPlatformTenantDetail` の View のみで、他エンティティの詳細取得 API を
//    本ファイルから呼ばない）。
// 🔴 `PURGED` はライフサイクル状態のみを返す（削除件数を含めない。docs/04 program-design
//    申し送り 15 / `F-062 AC-7`）。削除完了の確認は API-A12（`A-010`）の 1 本のみ。
// 🔴 本ファイルは `GET` のみを export する（`F-056 AC-3` / `BR-37`）。
import { getPlatformTenantDetail } from '@ses/db/platform';
import { z } from 'zod';
import { errorResponse, requireFound, ValidationError } from '../../../../../lib/api/errors';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../../lib/auth/platform-session';

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
    const detail = await getPlatformTenantDetail(ctx, parsed.data.id, {
      ipAddress: meta.ipAddress,
    });
    return Response.json(requireFound(detail), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
