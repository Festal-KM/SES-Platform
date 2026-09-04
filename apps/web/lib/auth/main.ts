// apps/web/lib/auth/main.ts
// 🔴 主平面の Auth.js インスタンス（docs/03 §4.9 / docs/05 §6.3 #1 #4）。
//
// 🔴 2 系統の分離（`F-055 AC-1` / `AC-2` / `BR-36`）: 管理平面（T-03-07）は
//    **別インスタンス・別 Cookie 名・別署名鍵（`AUTH_PLATFORM_SECRET`）** を使う。
//    本ファイルの設定を管理平面から import しない。
//
// 🔴 Auth.js の型・関数を外へ出さない。ページ / Route Handler が使うのは
//    `lib/auth/session.ts` が re-export する薄い関数だけである（docs/03 §4.9 の回避策）。
//
// 🔴 セッションが運ぶのはテナント / パートナー所属 / 利用者 ID だけ。ロールは載せない
//    （`lib/auth/claims.ts` 参照）。
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { isTwoFactorVerifiedUpdate, parseTenantSessionClaims } from './claims';
import { classifyDeviceKind } from './device';
import { authenticateCredentials } from './credentials';
import { ensureDbConfigured } from '../db/bootstrap';

/**
 * 🔴 Cookie 名は `__Host-ses.session`（docs/03 §4.9）。`__Host-` 接頭辞は
 *    「Secure かつ Domain 属性なし かつ Path=/」を**ブラウザ側で強制**する。
 *    管理平面の Cookie（`/admin` にスコープする）と取り違えられない。
 */
const SESSION_COOKIE_NAME = '__Host-ses.session';

/**
 * セッションの有効期間。
 * ⚠️ 暫定値（12 時間）。docs/03 §6.2 に該当する環境変数が無く、docs/02 / docs/05 にも
 *    規定が無い。営業が 1 日で使い切る想定に合わせた。恒久値は `packages/config` の
 *    設定項目にする（`code-reviewer` / `pm` への申し送り）。
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function firstForwardedFor(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(',')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

// 🔴 `handlers`（Auth.js の `/api/auth/*` 既定ルート）を取り出さない = **マウントしない**。
//    公開する認証エンドポイントは docs/05 §6.3 の #1 / #4（と T-03-02 の #2 / #3）だけであり、
//    Auth.js の既定ルート（`/api/auth/signin` の GET フォーム、`/api/auth/csrf` 等）を
//    生やすと「仕様に無い認証経路」が増えて §17.2 の走査対象から漏れる。
//    `auth()` / `signIn()` / `signOut()` は内部で `Auth()` を直接呼ぶため HTTP ルートを必要としない。
/**
 * 🔴 `unstable_update` は「2 要素認証を検証した」ことだけをセッションへ書き戻すために使う
 *    （`lib/auth/session.ts` の `markTwoFactorVerified`）。**それ以外の用途で使わない。**
 *    Auth.js の `/api/auth/session` ルートは**マウントしていない**ため、外部から任意の
 *    セッション更新を投げ込む経路は存在しない（`unstable_update` はプロセス内で `Auth()` を呼ぶ）。
 */
export const { auth, signIn, signOut, unstable_update } = NextAuth({
  // 🔴 自ホスト運用のため host ヘッダを信頼する（Vercel / 自前のリバースプロキシが
  //    Host を検証する構成であることが前提。Auth.js の自己ホスティング指針に従う）。
  trustHost: true,
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  // 🔴 `S-001` は自前の画面。Auth.js の既定サインインページを使わない。
  pages: { signIn: '/signin', error: '/signin' },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
      },
    },
  },
  providers: [
    Credentials({
      // 🔴 `credentials` に分離キーを持たせない（F-003 AC-1 / F-004 AC-2）。
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
        const result = await authenticateCredentials(
          { email, password },
          {
            deviceKind: classifyDeviceKind(headers.get('user-agent')),
            ipAddress: firstForwardedFor(headers.get('x-forwarded-for')),
          },
        );
        if (result.outcome !== 'AUTHENTICATED') return null;
        return {
          id: result.claims.userId,
          tenantId: result.claims.tenantId,
          partnerCompanyId: result.claims.partnerCompanyId,
        };
      },
    }),
  ],
  callbacks: {
    // 🔴 サインイン時にだけ主張を書き込む。以降のリクエストでは JWT を読むだけで、
    //    ロールやテナント状態は DB から引き直す（`loadTenantMembership`）。
    jwt({ token, user, trigger, session }) {
      if (user !== undefined) {
        token.userId = user.id;
        // 🔴 `User` は Auth.js の module augmentation で 1 つしか持てず、管理平面（T-03-07）と
        //    キーを共有するため型としては optional である。ここで値が欠けたまま書くと
        //    「テナントが確定していない JWT」が生まれるため、揃っていなければ主張を書かない。
        //    実行時の最終防御は `parseTenantSessionClaims`（UUID を要求する fail-closed）。
        token.tenantId = user.tenantId;
        token.partnerCompanyId = user.partnerCompanyId ?? null;
        // 🔴 サインイン直後は必ず未検証から始める（第 2 要素はまだ提示されていない）。
        token.twoFactorVerified = false;
      }
      // 🔴 更新で受け付けるのは「2 要素認証を検証した」の 1 ビットだけである。
      //    分離キー（tenantId / partnerCompanyId / userId）は**更新経路では一切書き換えない**
      //    （書き換えられると、セッション更新が境界の乗り換えになる。CLAUDE.md §3.1）。
      if (trigger === 'update' && isTwoFactorVerifiedUpdate(session)) {
        token.twoFactorVerified = true;
      }
      return token;
    },
    session({ session, token }) {
      // 🔴 JWT の中身の検証は `parseTenantSessionClaims` の 1 本に集約する
      //    （形が違えば `null` = 未認証扱いの fail-closed）。ここに同等の判定を書き下すと、
      //    片方だけ緩んだときに気づけない。
      session.claims = parseTenantSessionClaims(token);
      return session;
    },
  },
});
