// apps/web/app/api/(main)/auth/2fa/verify/route.ts
// docs/05 §6.3 #2 `POST /api/auth/2fa/verify`（`F-003` / `S-001`）。認可: **一次認証済み**。
//
// 🔴 ここが「第 2 要素を提示した」ことをセッションに刻む唯一の場所である。
//    刻まれるまで `resolveTenantCtx` は ctx を作らない（docs/05 §6.2）ため、
//    2FA 設定済みの利用者はパスワードだけでは業務データに到達できない。
//
// 🔴 失敗理由を区別しない（TOTP 不一致 / リカバリコード不一致 / 競合はすべて同じ 401）。
//    どの要素が有効かを試行から推測させないため。理由は監査ログにだけ残る。
// 🔴 例外は**試行回数の上限**（429）である。これは「入力が違う」ではなく「今は受け付けない」
//    という別の事実であり、docs/04 §S-001 が残り時間の明示を求めている。
//    429 の応答からも、資格情報の有無やどの要素が有効かは分からない。
import {
  AuthenticationError,
  TwoFactorCodeInvalidError,
  TwoFactorRequiredError,
  TwoFactorThrottledError,
  ValidationError,
  errorResponse,
} from '../../../../../../lib/api/errors';
import { twoFactorVerifyBodySchema } from '../../../../../../lib/auth/schemas';
import {
  currentClaims,
  markTwoFactorVerified,
  readRequestMeta,
} from '../../../../../../lib/auth/session';
import { loadAuthFacts } from '../../../../../../lib/auth/tenant-context';
import { verifyTwoFactorCode } from '../../../../../../lib/auth/two-factor';
import { ensureDbConfigured } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** docs/05 §6.3 #2 の応答。 */
export type TwoFactorVerifyResponse = { readonly ok: true };

export async function POST(request: Request): Promise<Response> {
  try {
    ensureDbConfigured();
    const claims = await currentClaims();
    if (claims === null) return errorResponse(new AuthenticationError());

    const raw: unknown = await request.json().catch(() => null);
    const parsed = twoFactorVerifyBodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        new ValidationError(parsed.error.issues.map((issue) => issue.path.join('.'))),
      );
    }

    // 🔴 所属が失効していれば検証も通さない（ctx は作らないが、有効性は毎回 DB で確かめる）。
    const facts = await loadAuthFacts(claims);
    if (facts === null) return errorResponse(new AuthenticationError());

    const result = await verifyTwoFactorCode(claims, parsed.data.code, await readRequestMeta());
    if (result.outcome === 'THROTTLED') {
      // 🔴 コードは検証されていない（総当たりを止めるため）。残り時間は Retry-After で返す。
      return errorResponse(new TwoFactorThrottledError(result.retryAfterSeconds));
    }
    if (result.outcome === 'NOT_ENROLLED') {
      // 設定が先である（UI は設定ウィザードへ進む）。403 = 未充足（`error.2fa.required`）。
      return errorResponse(new TwoFactorRequiredError('SETUP_REQUIRED'));
    }
    if (result.outcome === 'REJECTED') return errorResponse(new TwoFactorCodeInvalidError());

    // 🔴 検証が成立した後にだけセッションへ刻む。
    await markTwoFactorVerified(claims);
    const body: TwoFactorVerifyResponse = { ok: true };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
