// apps/web/app/api/admin/tenants/route.ts
// docs/05 §6.9 API-A2 `GET /api/admin/tenants`（`F-056` / `A-002`）。認可: `PO`/`PP`（閲覧のみ）。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。応答は必ず
//    `listPlatformTenants`（`@ses/db/platform`）の View を返す。DB の行を直接返さない
//    （docs/05 §5.5 第 2 層）。
// 🔴 運営者はテナントの業務データを作成・更新・削除できない（`F-056 AC-3` / `BR-37`）。
//    本ファイルは `GET` のみを export する（書き込みハンドラを持たない）。
// 🔴 閲覧そのものが `AuditLog` に記録される（`listPlatformTenants` が `withPlatformRead` 経由で
//    ハンドラ本体の前に書く。`F-056 AC-4` / `BR-41`）。
// 🔴 異常度順の並び替えは Phase 1（SP-11）。ここでは決定的な `createdAt` 降順のみ。
// 🔴 `cursor` はテナント ID（uuid(7)）そのもの。不正な形の値を Prisma のカーソル句へ渡すと
//    `uuid` 型キャストの Postgres エラーで未捕捉のまま 500 になるため、`parseAdminTenantListQuery`
//    （`apps/web/lib/admin-tenants/schemas.ts`）で UUID 形状を検証してから渡す（400 に畳む）。
import { listPlatformTenants } from '@ses/db/platform';
import { parseAdminTenantListQuery } from '../../../../lib/admin-tenants/schemas';
import { errorResponse, ValidationError } from '../../../../lib/api/errors';
import { searchParamsToObject } from '../../../../lib/api/withApiRoute';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../lib/auth/platform-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requirePlatformCtx();

    const parsed = parseAdminTenantListQuery(
      searchParamsToObject(new URL(request.url).searchParams),
    );
    if (!parsed.ok) return errorResponse(new ValidationError(parsed.issues));

    const meta = await readPlatformRequestMeta();
    const page = await listPlatformTenants(ctx, parsed.value, { ipAddress: meta.ipAddress });
    return Response.json(page, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
