// apps/web/app/api/admin/auth/signout/route.ts
// API-A1 の対（`F-055 AC-4`「運営者のログイン・ログアウト・画面閲覧が監査ログに記録される」）。
// 応答は 204。
//
// 🔴 監査ログ（`auth.logout`）を**先に**書く。書き込みに失敗したらセッションを破棄せず 500 を返す
//    （`BR-41` / `F-005`「記録に失敗したら操作を成立させない」）。
// 🔴 未認証の呼び出しでも 204 を返す（セッションの有無を漏らさない。docs/05 §4.8）。
import { errorResponse } from '../../../../../lib/api/errors';
import { recordPlatformSignOut } from '../../../../../lib/auth/platform-credentials';
import {
  clearPlatformSession,
  currentPlatformClaims,
  readPlatformRequestMeta,
} from '../../../../../lib/auth/platform-session';
import { ensureDbConfigured } from '../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    ensureDbConfigured();
    const claims = await currentPlatformClaims();
    if (claims !== null) {
      await recordPlatformSignOut(claims, await readPlatformRequestMeta());
    }
    await clearPlatformSession();
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
