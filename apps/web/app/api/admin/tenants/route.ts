// apps/web/app/api/admin/tenants/route.ts
// docs/05 §6.9 API-A2 `GET /api/admin/tenants`（`F-056` / `A-002`）。認可: `PO`/`PP`（閲覧のみ）。
//
// docs/05 §6.9 API-A4 `POST /api/admin/tenants`（`F-001` / `A-014`）。T-03-10。
// 🔴 認可: **`PLATFORM_OWNER` のみ**。`PLATFORM_SUPPORT` は**ルート自体が 403**である。
//
// 🔴 表示するのは件数・状態・日時のみ（`F-056 AC-1` / `BR-40`）。応答は必ず
//    `listPlatformTenants`（`@ses/db/platform`）の View を返す。DB の行を直接返さない
//    （docs/05 §5.5 第 2 層）。
// 🔴 運営者はテナントの**業務データ**を作成・更新・削除できない（`F-056 AC-3` / `BR-37`）。
//    本ファイルが持つ書き込みは API-A4（テナントの器の作成）だけであり、これは
//    `CLAUDE.md` §10.5 が運営者に認めた「契約」への書き込みである（docs/05 §5.2 / `P-A-13`）。
//    エンジニア・案件・提案・チャット・契約の表には DB 権限としても到達できない。
// 🔴 閲覧そのものが `AuditLog` に記録される（`listPlatformTenants` が `withPlatformRead` 経由で
//    ハンドラ本体の前に書く。`F-056 AC-4` / `BR-41`）。
// 🔴 異常度順の並び替えは Phase 1（SP-11）。ここでは決定的な `createdAt` 降順のみ。
// 🔴 `cursor` はテナント ID（uuid(7)）そのもの。不正な形の値を Prisma のカーソル句へ渡すと
//    `uuid` 型キャストの Postgres エラーで未捕捉のまま 500 になるため、`parseAdminTenantListQuery`
//    （`apps/web/lib/admin-tenants/schemas.ts`）で UUID 形状を検証してから渡す（400 に畳む）。
import {
  listPlatformTenants,
  provisionTenant,
  TenantProvisioningInputError,
  TenantProvisioningRequestConflictError,
} from '@ses/db/platform';
import {
  parseAdminTenantListQuery,
  parseCreateTenantBody,
} from '../../../../lib/admin-tenants/schemas';
import {
  errorResponse,
  TenantProvisioningConflictError,
  TenantProvisioningInvalidError,
  ValidationError,
} from '../../../../lib/api/errors';
import { searchParamsToObject } from '../../../../lib/api/withApiRoute';
import {
  readPlatformRequestMeta,
  requirePlatformCtx,
  requirePlatformOwnerCtx,
} from '../../../../lib/auth/platform-session';
import { sandboxTrialDays } from '../../../../lib/db/bootstrap';

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

/**
 * API-A4（テナントの開設。`A-014` / `F-001`）。
 *
 * 🔴 **API-A5（初期 `OWNER` 招待）と分離している**（docs/05 §10.7 / `docs/04` 申し送り 14）。
 *    招待メールの失敗で開設をやり直させない —— やり直すと重複テナントが生まれ、
 *    分離が正しく効いたまま業務が 2 つに割れる。
 * 🔴 応答は `{ id, lifecycleState, sendingDomainRegistered }` だけである
 *    （`app_platform_write` は `tenants` の 2 列しか `SELECT` できない。Issue #24 の決定）。
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // 🔴 認証・認可が先（未認証・権限不足の呼び出しに body スキーマの形を教えない）。
    const ctx = await requirePlatformOwnerCtx();

    const parsed = parseCreateTenantBody(await request.json().catch(() => null));
    if (!parsed.ok) return errorResponse(new ValidationError(parsed.issues));

    const meta = await readPlatformRequestMeta();
    const result = await provisionTenant(
      ctx,
      {
        name: parsed.value.name,
        environment: parsed.value.environment,
        lifecycleState: parsed.value.lifecycleState,
        planId: parsed.value.planId,
        provisioningRequestId: parsed.value.provisioningRequestId,
        sendingDomain: parsed.value.sendingDomain ?? null,
        // 🔴 日数の出所は `packages/config`（`SANDBOX_TRIAL_DAYS`）。ここにベタ書きしない。
        sandboxTrialDays: sandboxTrialDays(),
      },
      { ipAddress: meta.ipAddress, now: new Date() },
    );

    return Response.json(result, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    // 🔴 `@ses/db/platform` の例外を §15.2 の応答へ写像する。`apps/web/lib/api/errors.ts` は
    //    管理平面のサブパスを import できない（ESLint の ADMIN_PLANE_ZONE）ため、
    //    この 2 つだけは管理平面のルート側で畳む。
    if (error instanceof TenantProvisioningRequestConflictError) {
      return errorResponse(new TenantProvisioningConflictError());
    }
    if (error instanceof TenantProvisioningInputError) {
      return errorResponse(new TenantProvisioningInvalidError());
    }
    return errorResponse(error);
  }
}
