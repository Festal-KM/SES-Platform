// apps/web/app/api/(main)/auth/signout/route.ts
// docs/05 §6.3 #4 `POST /api/auth/signout`（`F-003 AC-3`）。応答は 204。
//
// 🔴 監査ログ（`auth.logout`）を**先に**書く。書き込みに失敗したらセッションを破棄せず 500 を返す
//    （F-005 / F-012 AC-2「記録に失敗したら操作を成立させない」。T-03-05 の本則の先取り）。
// 🔴 未認証の呼び出しでも 204 を返す（セッションの有無を漏らさない。docs/05 §4.8）。
import { errorResponse } from '../../../../../lib/api/errors';
import { recordSignOut } from '../../../../../lib/auth/credentials';
import { clearSession, currentClaims, readRequestMeta } from '../../../../../lib/auth/session';
import { ensureDbConfigured } from '../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    ensureDbConfigured();
    const claims = await currentClaims();
    if (claims !== null) {
      await recordSignOut(claims, await readRequestMeta());
    }
    await clearSession();
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
