// apps/web/lib/auth/session.ts
// 🔴 ページ / Route Handler が認証に触れる**唯一の入口**（docs/03 §4.9 の回避策）。
//    Auth.js の型・関数はここから外へ出さない。Auth.js v5（beta）の API 変更の影響を
//    このファイルに閉じる。
import { headers } from 'next/headers';
import { AuthError, CredentialsSignin } from 'next-auth';
import type { AuthenticatedTenantCtx } from '@ses/db';
import { AuthenticationError } from '../api/errors';
import { ensureDbConfigured } from '../db/bootstrap';
import type { TenantSessionClaims } from './claims';
import { classifyDeviceKind } from './device';
import { auth, signIn, signOut } from './main';
import type { AuthAttemptMeta } from './credentials';
import { buildTenantCtx } from './tenant-context';

export type { TenantSessionClaims } from './claims';
export type { AuthAttemptMeta } from './credentials';

/** サインイン後の遷移先（`S-003` / `S-004` は T-03-06 が実装する）。 */
const POST_SIGNIN_PATH = '/';

function firstForwardedFor(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

/** リクエストヘッダから ctx / 監査ログに載せるメタ情報を作る。🔴 分離キーは含まない。 */
export async function readRequestMeta(): Promise<AuthAttemptMeta> {
  const headerList = await headers();
  return {
    deviceKind: classifyDeviceKind(headerList.get('user-agent')),
    ipAddress: firstForwardedFor(headerList.get('x-forwarded-for')),
  };
}

/** セッションの主張（分離キー + 利用者 ID）。未認証なら `null`。 */
export async function currentClaims(): Promise<TenantSessionClaims | null> {
  const session = await auth();
  return session?.claims ?? null;
}

/**
 * 認証コンテキストを取得する。未認証・所属無効なら 401。
 * 🔴 ロールとテナント状態は毎回 DB から確定する（`buildTenantCtx`）。
 */
export async function requireTenantCtx(): Promise<AuthenticatedTenantCtx> {
  ensureDbConfigured();
  const claims = await currentClaims();
  if (claims === null) throw new AuthenticationError();
  const meta = await readRequestMeta();
  const ctx = await buildTenantCtx(claims, { deviceKind: meta.deviceKind });
  if (ctx === null) throw new AuthenticationError();
  return ctx;
}

export type SignInOutcome = 'AUTHENTICATED' | 'REJECTED';

/**
 * 資格情報でサインインし、セッション Cookie を設定する（docs/05 §6.3 #1）。
 *
 * 🔴 失敗理由を返さない（`REJECTED` の 1 種類だけ）。docs/04 §S-001。
 * 🔴 認証以外の失敗（DB 障害・監査ログの書き込み失敗）は `REJECTED` にせず例外にする。
 *    Auth.js は `authorize()` が投げた非 `AuthError` を「設定エラー」として
 *    `?error=Configuration` 付きの URL に畳んでしまうため、**URL を検査して例外に戻す**。
 *    ここを握りつぶすと「記録に失敗したのに、パスワード誤りとして 401 が返る」ことになり、
 *    F-005 の「記録に失敗したら操作を成立させない」が観測できなくなる。
 */
export async function signInWithCredentials(input: {
  readonly email: string;
  readonly password: string;
}): Promise<SignInOutcome> {
  ensureDbConfigured();
  let redirectUrl: string;
  try {
    redirectUrl = (await signIn('credentials', {
      email: input.email,
      password: input.password,
      redirect: false,
      redirectTo: POST_SIGNIN_PATH,
    })) as string;
  } catch (error) {
    // `authorize()` が null を返した = 資格情報の不一致（Auth.js が CredentialsSignin を投げる）。
    if (error instanceof CredentialsSignin) return 'REJECTED';
    throw error;
  }
  const failure = extractAuthErrorType(redirectUrl);
  if (failure === null) return 'AUTHENTICATED';
  if (failure === 'CredentialsSignin') return 'REJECTED';
  throw new AuthError(`サインイン処理が失敗しました（type=${failure}）。`);
}

/** サインイン結果の URL に載った Auth.js のエラー種別。エラーが無ければ `null`。 */
function extractAuthErrorType(redirectUrl: string): string | null {
  try {
    return new URL(redirectUrl, 'http://localhost').searchParams.get('error');
  } catch {
    return null;
  }
}

/** セッション Cookie を破棄する（docs/05 §6.3 #4）。監査ログは呼び出し側が先に書く。 */
export async function clearSession(): Promise<void> {
  await signOut({ redirect: false });
}
