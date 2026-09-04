// apps/web/lib/auth/platform.ts
// 🔴 管理平面の Auth.js インスタンス（docs/03 §4.9「2 系統の分離」/ docs/05 §5.1 / API-A1）。
//
// 🔴 主平面（`lib/auth/main.ts`）とは次がすべて別である（`BR-36` / `F-055 AC-1` / `AC-2`）:
//   ①インスタンス ②Cookie 名（`__Host-ses-admin.session`）③署名鍵（`AUTH_PLATFORM_SECRET`）
//   ④主体（`PlatformUser`）⑤DB の接続プールと DB ロール（`app_platform_write`）
//   **①〜③のどれか 1 つだけでも成立していれば片方向は塞げるが、5 つとも別にする。**
//
// ============================================================================
// 🔴 Cookie の `path` と接頭辞について（T-03-07 のレビューで確定。2026-09-04）
// ============================================================================
// docs/05 §5.1 は当初 `path: '/admin'` と書いていたが、**そのままでは管理平面が機能しない**。
// RFC 6265 のパス照合は「リクエストパスが Cookie の path と一致するか、その配下であること」を
// 要求する。管理平面の API は docs/05 §6.9 のとおり **`/api/admin/...`** にあり、これは
// `/admin` の配下ではない（`/api/admin/auth/2fa/verify` は `/admin` で始まらない）。
// したがって `path='/admin'` にすると、ブラウザは 2FA 検証以降のすべての管理平面 API に
// Cookie を送らず、`A-001` のセクション 3 から先へ進めない。**`path: '/'` にする。**
//
// 🔴 `path: '/'` が確定したことで、`__Host-` 接頭辞（**`Secure` かつ `Domain` 属性なし かつ
//    `Path=/`** をブラウザ側で強制する）の要件と両立するようになった。したがって
//    Cookie 名は `__Secure-` ではなく **`__Host-ses-admin.session`** を使う。
//    `__Host-` の方が強い理由: `Domain` 属性を付けられず、**サブドメインから上書き設定できない**
//    （`__Secure-` は同一サイトの別サブドメインから被せられる。運営者セッションの固定化を防ぐ）。
//
// `F-055 AC-2`（相互に到達不能）は Cookie 名 + **別署名鍵**（`AUTH_PLATFORM_SECRET`）+
// 別インスタンス + 別 DB ロールで担保する（主平面のインスタンスは管理平面の JWT を検証できず、
// 逆も同じ。`tests/isolation/platform-auth.test.ts` が両方向を実証する）。
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { classifyDeviceKind } from './device';
import { authenticatePlatformCredentials } from './platform-credentials';
import {
  isPlatformTwoFactorVerifiedUpdate,
  parsePlatformSessionClaims,
} from './platform-claims';
import { ensureDbConfigured, platformAuthSecret } from '../db/bootstrap';

/**
 * 🔴 主平面の `__Host-ses.session` と取り違えられない名前にする（docs/05 §5.1）。
 *    `__Host-` 接頭辞は「`Secure` かつ `Domain` 属性なし かつ `Path=/`」を**ブラウザ側で強制**する
 *    （上のコメント参照。`path: '/'` の確定により両立する）。
 */
const SESSION_COOKIE_NAME = '__Host-ses-admin.session';

/**
 * セッションの有効期間。
 * ⚠️ 暫定値（8 時間）。主平面（12 時間）より短くする —— 運営者のセッションは
 *    テナント横断の閲覧経路（T-03-08）に繋がるため、失効を早くする。
 *    恒久値は `packages/config` の設定項目にする（`code-reviewer` / `pm` への申し送り）。
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function firstForwardedFor(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(',')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

// 🔴 `handlers` を取り出さない = **Auth.js の既定ルートをマウントしない**（主平面と同じ方針）。
//    公開する管理平面の認証エンドポイントは API-A1 の 3 本 + signout だけである。
// 🔴 設定を関数で渡すのは、署名鍵を `packages/config` の検証済み値から取るためである
//    （`process.env` を直接読まない。CLAUDE.md §3.5）。
export const {
  auth: platformAuth,
  signIn: platformSignIn,
  signOut: platformSignOut,
  unstable_update: platformUpdate,
} = NextAuth(() => ({
  trustHost: true,
  // 🔴 主平面の AUTH_SECRET とは別の鍵（同値なら packages/config が起動時に落とす）。
  secret: platformAuthSecret(),
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  // 🔴 `A-001` は自前の画面。Auth.js の既定サインインページを使わない。
  pages: { signIn: '/admin/signin', error: '/admin/signin' },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        // 🔴 上のコメント参照（`/api/admin/**` に Cookie を届かせるため `/`）。
        path: '/',
        secure: true,
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'email', type: 'email' },
        password: { label: 'password', type: 'password' },
      },
      async authorize(credentials, request) {
        ensureDbConfigured();
        const email = credentials['email'];
        const password = credentials['password'];
        if (typeof email !== 'string' || typeof password !== 'string') return null;

        const headers = request.headers;
        const result = await authenticatePlatformCredentials(
          { email, password },
          {
            deviceKind: classifyDeviceKind(headers.get('user-agent')),
            ipAddress: firstForwardedFor(headers.get('x-forwarded-for')),
          },
        );
        if (result.outcome !== 'AUTHENTICATED') return null;
        return { id: result.claims.platformUserId, platformUserId: result.claims.platformUserId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user !== undefined) {
        token.platformUserId = user.platformUserId;
        // 🔴 サインイン直後は必ず未検証から始める（第 2 要素はまだ提示されていない）。
        token.platformTwoFactorVerified = false;
      }
      // 🔴 更新で受け付けるのは「2 要素認証を検証した」の 1 ビットだけである。
      //    主体（platformUserId）は更新経路では一切書き換えない。
      if (trigger === 'update' && isPlatformTwoFactorVerifiedUpdate(session)) {
        token.platformTwoFactorVerified = true;
      }
      return token;
    },
    session({ session, token }) {
      // 🔴 JWT の中身の検証は `parsePlatformSessionClaims` の 1 本に集約する（fail-closed）。
      session.platformClaims = parsePlatformSessionClaims(token);
      return session;
    },
  },
}));
