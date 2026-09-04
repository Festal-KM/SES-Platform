// apps/web/lib/auth/platform-session.ts
// 🔴 管理平面のページ / Route Handler が認証に触れる**唯一の入口**（主平面の `session.ts` と対）。
//    Auth.js の型・関数はここから外へ出さない（docs/03 §4.9 の回避策）。
import { headers } from 'next/headers';
import { AuthError, CredentialsSignin } from 'next-auth';
import type { AuthenticatedPlatformCtx } from '@ses/db';
import { TwoFactorRequiredError as DbTwoFactorRequiredError } from '@ses/db';
import { AuthenticationError } from '../api/errors';
import { ensureDbConfigured } from '../db/bootstrap';
import type { AuthAttemptMeta } from './credentials';
import { classifyDeviceKind } from './device';
import type { PlatformSessionClaims } from './platform-claims';
import { buildPlatformCtx } from './platform-context';
import { platformAuth, platformSignIn, platformSignOut, platformUpdate } from './platform';

export type { PlatformSessionClaims } from './platform-claims';

/** サインイン後の遷移先（`A-002` は T-03-09 が実装する）。 */
const POST_SIGNIN_PATH = '/admin';

function firstForwardedFor(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

/** リクエストヘッダから監査ログに載せるメタ情報を作る。🔴 主体の識別子は含まない。 */
export async function readPlatformRequestMeta(): Promise<AuthAttemptMeta> {
  const headerList = await headers();
  return {
    deviceKind: classifyDeviceKind(headerList.get('user-agent')),
    ipAddress: firstForwardedFor(headerList.get('x-forwarded-for')),
  };
}

/** 管理平面セッションの主張。未認証なら `null`。 */
export async function currentPlatformClaims(): Promise<PlatformSessionClaims | null> {
  const session = await platformAuth();
  return session?.platformClaims ?? null;
}

/**
 * 運営者の認証コンテキストを取得する。未認証・無効化済みなら 401。
 * 🔴 2FA 未充足なら `TwoFactorRequiredError`（403）が伝播する（`F-055 AC-3`）。
 */
export async function requirePlatformCtx(): Promise<AuthenticatedPlatformCtx> {
  ensureDbConfigured();
  const claims = await currentPlatformClaims();
  if (claims === null) throw new AuthenticationError();
  const meta = await readPlatformRequestMeta();
  const ctx = await buildPlatformCtx(claims, { deviceKind: meta.deviceKind });
  if (ctx === null) throw new AuthenticationError();
  return ctx;
}

/**
 * 認証コンテキストの解決結果（画面が遷移先を決めるために使う）。
 * 🔴 `TWO_FACTOR_REQUIRED` は「未認証」とは別物である。パスワードは通っているが、
 *    第 2 要素が未充足のため **ctx が存在しない**（= 管理平面のどの画面にも到達できない）。
 */
export type PlatformCtxOutcome =
  | { readonly status: 'AUTHENTICATED'; readonly ctx: AuthenticatedPlatformCtx }
  | { readonly status: 'UNAUTHENTICATED' }
  | { readonly status: 'TWO_FACTOR_REQUIRED' };

/**
 * ページ（Server Component）が遷移を決めるための解決。
 * 🔴 例外に頼らず分岐したいのはページだけである。**API は `requirePlatformCtx` を使い、
 *    例外のまま §15 のエラー写像に載せる**（握り潰す経路を作らない）。
 */
export async function resolvePlatformCtxOutcome(): Promise<PlatformCtxOutcome> {
  ensureDbConfigured();
  const claims = await currentPlatformClaims();
  if (claims === null) return { status: 'UNAUTHENTICATED' };
  const meta = await readPlatformRequestMeta();
  try {
    const ctx = await buildPlatformCtx(claims, { deviceKind: meta.deviceKind });
    if (ctx === null) return { status: 'UNAUTHENTICATED' };
    return { status: 'AUTHENTICATED', ctx };
  } catch (error) {
    if (error instanceof DbTwoFactorRequiredError) return { status: 'TWO_FACTOR_REQUIRED' };
    throw error;
  }
}

/**
 * 🔴 このセッションで第 2 要素を検証したことを記録する（API-A1）。
 *    書き換わるのは `platformTwoFactorVerified` の 1 ビットだけである。
 */
export async function markPlatformTwoFactorVerified(
  claims: PlatformSessionClaims,
): Promise<void> {
  await platformUpdate({ platformClaims: { ...claims, twoFactorVerified: true } });
}

export type PlatformSignInOutcome = 'AUTHENTICATED' | 'REJECTED';

/**
 * 資格情報でサインインし、管理平面のセッション Cookie を設定する（API-A1）。
 *
 * 🔴 失敗理由を返さない（`REJECTED` の 1 種類だけ）。docs/04 `A-001`。
 * 🔴 認証以外の失敗（DB 障害・監査ログの書き込み失敗）は `REJECTED` にせず例外にする
 *    （主平面の `signInWithCredentials` と同じ理由。`F-055 AC-4` の「記録に失敗したら
 *    操作を成立させない」が観測できなくなるため）。
 */
export async function signInPlatformWithCredentials(input: {
  readonly email: string;
  readonly password: string;
}): Promise<PlatformSignInOutcome> {
  ensureDbConfigured();
  let redirectUrl: string;
  try {
    redirectUrl = (await platformSignIn('credentials', {
      email: input.email,
      password: input.password,
      redirect: false,
      redirectTo: POST_SIGNIN_PATH,
    })) as string;
  } catch (error) {
    if (error instanceof CredentialsSignin) return 'REJECTED';
    throw error;
  }
  const failure = extractAuthErrorType(redirectUrl);
  if (failure === null) return 'AUTHENTICATED';
  if (failure === 'CredentialsSignin') return 'REJECTED';
  throw new AuthError(`運営者のサインイン処理が失敗しました（type=${failure}）。`);
}

/** サインイン結果の URL に載った Auth.js のエラー種別。エラーが無ければ `null`。 */
function extractAuthErrorType(redirectUrl: string): string | null {
  try {
    return new URL(redirectUrl, 'http://localhost').searchParams.get('error');
  } catch {
    return null;
  }
}

/** 管理平面のセッション Cookie を破棄する。監査ログは呼び出し側が先に書く。 */
export async function clearPlatformSession(): Promise<void> {
  await platformSignOut({ redirect: false });
}
