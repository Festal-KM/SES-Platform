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
// 🔴 `./lib/shell/current-path` からは import しない —— あちらは `next/headers` を持ち、
//    Edge のバンドルにサーバ側実装を引き込む（`./lib/shell/current-path-header.ts` 冒頭の 🔴）。
import { CURRENT_PATH_HEADER } from './lib/shell/current-path-header';

export default function proxy(request: NextRequest): NextResponse {
  const decision = decidePlane({
    pathname: request.nextUrl.pathname,
    hasPlatformSessionCookie: request.cookies.has(PLATFORM_SESSION_COOKIE_NAME),
    hasTenantSessionCookie: request.cookies.has(MAIN_SESSION_COOKIE_NAME),
  });

  if (decision.kind === 'REDIRECT') {
    return NextResponse.redirect(new URL(decision.location, request.nextUrl));
  }
  // 🔴 SP-22 T-22-05: **現在のパスをリクエストヘッダに添える**（追加のみ）。
  //    理由と他の選択肢を却下した根拠は `lib/shell/current-path.ts` 冒頭にある ——
  //    要点は「RSC のレイアウトはパスを受け取らず、`usePathname` を使うと外枠が
  //    `'use client'` になって**主平面の全画面**がクライアントへ移る」ことである。
  // 🔴 **判定・リダイレクト・Cookie の扱い・`matcher` は 1 行も変えていない。**
  // 🔴 **毎リクエストで上書きする**（`set`）。外部から差し込まれた同名ヘッダは残らない。
  //    それでも**認可の材料にしない**（`current-path.ts` の 🔴。用途は現在地のハイライトだけ）。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CURRENT_PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// 🔴 docs/05 §5.1 の matcher（`['/((?!admin).*)', '/admin/:path*']`）に Next.js の内部アセットの
//    除外を足したもの。**平面の呼び分けは matcher ではなく `decidePlane`（パス接頭辞）が行う** ——
//    管理平面の API は `/api/admin/**` にあり `/admin` 配下ではないためである
//    （`lib/middleware/planes.ts` 冒頭の補正の注記）。
// 🔴 2026-10-16: 除外を `_next/static` / `_next/image` から **`_next/` 全体**に広げた。
//    理由: `/_next/hmr`（Turbopack の開発サーバとの WebSocket）が matcher に当たっていた。
//    Edge のプロキシを通した時点で**アップグレードが壊れて** `ERR_INVALID_HTTP_RESPONSE` になり、
//    開発サーバのクライアント初期化がそこで止まる —— つまり **React が一度も hydration しない**。
//    結果、`onSubmit`（サインインフォームほか全画面）が付かず、`<form method="post">` の
//    ブラウザ既定の送信が走って**入力値が消えるだけ**になる（2026-10-16 に実測。§7.5 の罠）。
//    `_next/**` は枠組みの資産であって画面ではなく、`decidePlane` の判断対象でもないため
//    除外して差し支えない（本ファイル冒頭の 🔴 のとおり、ここは境界の強制をしない）。
export const config = {
  matcher: ['/((?!admin|_next/|favicon.ico).*)', '/admin/:path*'],
};
