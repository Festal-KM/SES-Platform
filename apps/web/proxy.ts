// apps/web/proxy.ts
// 🔴 主平面と管理平面で**別のミドルウェアを通す**唯一の入口（docs/05 §5.1 /
//    `CLAUDE.md` §10.5「管理平面は別ルート (`/admin`) かつ別ミドルウェアで認可する」。T-03-08）。
//
// 🔴 ファイル名について（docs/05 §5.1 は `apps/web/middleware.ts` と書いている）:
//    Next.js 16.3（`docs/03` で採用したバージョン）で **`middleware` ファイル規約は非推奨**になり、
//    `proxy` に置き換わった（ビルド時に「The "middleware" file convention is deprecated.
//    Please use "proxy" instead.」と警告が出る）。挙動・`config.matcher` の意味・Edge ランタイムで
//    動くことはいずれも同じである。**非推奨の規約を新規に足さない**ため `proxy.ts` にした
//    （docs/05 §5.1 に注記を追記した。T-03-07 が Cookie の `path` を補正したのと同型の追随）。
//
// 🔴 本ファイルは Edge ランタイムで動く。**DB・Auth.js・`packages/db` を import しない**。
//    判断材料は「パス」と「Cookie の有無」だけであり、境界の強制はしない
//    （理由と代わりの担保は `lib/middleware/planes.ts` 冒頭）。
import { NextResponse, type NextRequest } from 'next/server';
import { MAIN_SESSION_COOKIE_NAME, PLATFORM_SESSION_COOKIE_NAME } from './lib/auth/cookie-names';
import { decidePlane } from './lib/middleware/planes';

export default function proxy(request: NextRequest): NextResponse {
  const decision = decidePlane({
    pathname: request.nextUrl.pathname,
    hasPlatformSessionCookie: request.cookies.has(PLATFORM_SESSION_COOKIE_NAME),
    hasTenantSessionCookie: request.cookies.has(MAIN_SESSION_COOKIE_NAME),
  });

  if (decision.kind === 'REDIRECT') {
    return NextResponse.redirect(new URL(decision.location, request.nextUrl));
  }
  return NextResponse.next();
}

// 🔴 docs/05 §5.1 の matcher（`['/((?!admin).*)', '/admin/:path*']`）に Next.js の内部アセットの
//    除外を足したもの。**平面の呼び分けは matcher ではなく `decidePlane`（パス接頭辞）が行う** ——
//    管理平面の API は `/api/admin/**` にあり `/admin` 配下ではないためである
//    （`lib/middleware/planes.ts` 冒頭の補正の注記）。
export const config = {
  matcher: ['/((?!admin|_next/static|_next/image|favicon.ico).*)', '/admin/:path*'],
};
