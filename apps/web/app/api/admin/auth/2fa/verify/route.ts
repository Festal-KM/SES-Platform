// apps/web/app/api/admin/auth/2fa/verify/route.ts
// docs/05 §6.9 API-A1 `POST /api/admin/auth/2fa/verify`（`F-055` / `A-001`）。
// 認可: **一次認証済み**。
//
// 🔴 ここが「第 2 要素を提示した」ことを管理平面のセッションに刻む唯一の場所である。
//    刻まれるまで `resolvePlatformCtx` は ctx を作らない（`F-055 AC-3`）。
//
// 🔴 失敗理由を区別しない（TOTP 不一致 / リカバリコード不一致 / 競合はすべて同じ 401）。
// 🔴 例外は**試行回数の上限**（429）である。残り時間は `Retry-After` で返す。
import {
  AuthenticationError,
  TwoFactorCodeInvalidError,
  TwoFactorRequiredError,
  TwoFactorThrottledError,
  ValidationError,
  errorResponse,
} from '../../../../../../lib/api/errors';
import { twoFactorVerifyBodySchema } from '../../../../../../lib/auth/schemas';
import { loadPlatformFacts } from '../../../../../../lib/auth/platform-context';
import {
  currentPlatformClaims,
  markPlatformTwoFactorVerified,
  readPlatformRequestMeta,
} from '../../../../../../lib/auth/platform-session';
import { verifyPlatformTwoFactorCode } from '../../../../../../lib/auth/platform-two-factor';
import { ensureDbConfigured } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type PlatformTwoFactorVerifyResponse = { readonly ok: true };

export async function POST(request: Request): Promise<Response> {
  try {
    ensureDbConfigured();
    const claims = await currentPlatformClaims();
    if (claims === null) return errorResponse(new AuthenticationError());

    const raw: unknown = await request.json().catch(() => null);
    const parsed = twoFactorVerifyBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    // 🔴 無効化済みなら検証も通さない（ctx は作らないが、有効性は毎回 DB で確かめる）。
    const facts = await loadPlatformFacts(claims);
    if (facts === null) return errorResponse(new AuthenticationError());

    const result = await verifyPlatformTwoFactorCode(
      { platformUserId: claims.platformUserId },
      parsed.data.code,
      await readPlatformRequestMeta(),
    );
    if (result.outcome === 'THROTTLED') {
      return errorResponse(new TwoFactorThrottledError(result.retryAfterSeconds));
    }
    if (result.outcome === 'NOT_ENROLLED') {
      // 設定が先である（UI は設定ウィザードへ進む）。403 = 未充足（`error.2fa.required`）。
      return errorResponse(new TwoFactorRequiredError('SETUP_REQUIRED'));
    }
    if (result.outcome === 'REJECTED') return errorResponse(new TwoFactorCodeInvalidError());

    // 🔴 検証が成立した後にだけセッションへ刻む。
    await markPlatformTwoFactorVerified(claims);
    const body: PlatformTwoFactorVerifyResponse = { ok: true };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
