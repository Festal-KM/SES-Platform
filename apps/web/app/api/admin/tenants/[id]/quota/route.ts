// apps/web/app/api/admin/tenants/[id]/quota/route.ts
// docs/05 §6.9 API-A6 `PUT /api/admin/tenants/{id}/quota`（`F-057` 処理③〜⑤ / `AC-2`〜`AC-4` / `A-004`）。T-11-02。
//
// 🔴 認可: **`PLATFORM_OWNER` のみ**（`requirePlatformOwnerCtx`。`F-057 AC-2` / `BR-44` / `CLAUDE.md` §10.1「`PLATFORM_SUPPORT` は
//    課金設定の変更不可」）。`PLATFORM_SUPPORT` は**ルート自体が 403**である（画面に導線が無いだけでは足りない）。
// 🔴 書き込みは `tenant_quota_overrides` への INSERT だけ（`setTenantQuotaOverride` = `withPlatformWrite(domain='QUOTA')`。
//    docs/05 §5.2 の 4 表目。`CLAUDE.md` §10.5 が最初から認める「クォータ」への書き込み）。テナントの業務データには触れない。
// 🔴 `F-057 AC-3`: 引き下げは **適用日が翌日以降 + `notifyTenantAdmins: true`** が必須（`decideQuotaChange` → 400
//    `QUOTA_CHANGE_REJECTED`）。即時反映のみの操作は存在しない。通知（`QUOTA_LOWERED`）はワーカーの `usage.limit-check` が
//    `email.dispatch` の単一経路で積む（管理平面は `EmailDispatch` を書かない）。引き上げは当日から適用できる。
// 🔴 `F-057 AC-4`: 実施者・対象・変更前後の値・適用日は `withPlatformWrite` が**ハンドラの前に** `AuditLog(admin.quota.change)` に
//    書く。`reason` の本文は載せない（長さだけ）。
// 🔴 テナントは URL のパスで選ぶ。body に `tenantId` は無い（`parseQuotaChangeBody` が構築時に固定）。
// 🔴 `process.env` を読まない。既定値は `adminUsageRuntime()`（起動時 DI）から受ける。
import { QuotaOverrideTenantNotFoundError, setTenantQuotaOverride } from '@ses/db/platform';
import { z } from 'zod';
import { parseQuotaChangeBody } from '../../../../../../lib/admin-usage/schemas';
import { errorResponse, NotFoundError, ValidationError } from '../../../../../../lib/api/errors';
import { readPlatformRequestMeta, requirePlatformOwnerCtx } from '../../../../../../lib/auth/platform-session';
import { adminUsageRuntime } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.uuid() });

/**
 * 応答（201）。🔴 `limit` は十進の整数文字列（バイト数を `Number` に落とさない）。`reason` は返さない。
 */
export type QuotaChangeResponse = {
  readonly overrideId: string;
  readonly metric: string;
  readonly kind: 'RAISE' | 'LOWER' | 'UNCHANGED';
  readonly from: string;
  readonly to: string;
  readonly effectiveFrom: string;
  /** 🔴 `LOWER` のとき常に `true`（通知しない引き下げは存在しない）。 */
  readonly notifyTenantAdmins: boolean;
};

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    // 🔴 認証・認可が先（`PLATFORM_SUPPORT` / 未認証の呼び出しに body スキーマの形を教えない）。
    const ctx = await requirePlatformOwnerCtx();

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return errorResponse(new ValidationError(parsedParams.error.issues.map((issue) => issue.path.join('.'))));
    }
    const parsedBody = parseQuotaChangeBody(await request.json().catch(() => null));
    if (!parsedBody.ok) return errorResponse(new ValidationError(parsedBody.issues));

    const meta = await readPlatformRequestMeta();
    const result = await setTenantQuotaOverride(
      ctx,
      {
        tenantId: parsedParams.data.id,
        metric: parsedBody.value.metric,
        limit: parsedBody.value.limit,
        effectiveFrom: parsedBody.value.effectiveFrom,
        notifyTenantAdmins: parsedBody.value.notifyTenantAdmins,
        reason: parsedBody.value.reason,
      },
      { ipAddress: meta.ipAddress, now: new Date(), defaults: adminUsageRuntime().defaults },
    );

    const body: QuotaChangeResponse = {
      overrideId: result.overrideId,
      metric: result.decision.metric,
      kind: result.decision.kind,
      from: result.decision.from.toString(),
      to: result.decision.to.toString(),
      effectiveFrom: result.decision.effectiveFrom,
      notifyTenantAdmins: result.decision.notifyTenantAdmins,
    };
    return Response.json(body, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    // 🔴 `@ses/db/platform` の例外を §15.2 の応答へ写像する（`apps/web/lib/api/errors.ts` は管理平面のサブパスを import
    //    できないため、ここで畳む。API-A4 と同じ）。存在しないテナントは 404（docs/05 §4.8）。
    if (error instanceof QuotaOverrideTenantNotFoundError) return errorResponse(new NotFoundError());
    return errorResponse(error);
  }
}
