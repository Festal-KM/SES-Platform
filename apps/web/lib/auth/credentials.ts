// apps/web/lib/auth/credentials.ts
// docs/05 §6.3 #1（`POST /api/auth/signin`）の中核。Auth.js の Credentials プロバイダの
// `authorize()` から呼ばれる（docs/03 §4.9 / docs/05 §16.1「Auth.js のコールバック」）。
//
// 🔴 メール照合は `withAuthLookup(email)`（docs/05 §4.4.2）で**該当 1 行だけ**を可視にする。
//    テナントが確定する前に `users` を全件走査する経路を作らない（SP-03 T-03-01）。
//
// 🔴 失敗理由を呼び出し側に返さない（docs/04 §S-001「メールアドレスが存在しないと
//    パスワードが違うを区別しない」）。理由は `AuditLog.summary.reason` にだけ残す。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` と argon2 のみ）。
//    結合テスト（tests/isolation）がサーバを立てずに同じ経路を実行できるようにするため。
import { recordAuthAuditLog, withAuthLookup, type DeviceKind, type TenantIdentity } from '@ses/db';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password';
import type { TenantSessionClaims } from './claims';

/** docs/05 §16.1 のうち本タスクが書き込む 3 種。 */
export const AUTH_AUDIT_ACTIONS = {
  login: 'auth.login',
  logout: 'auth.logout',
  loginFailed: 'auth.login_failed',
} as const;

/**
 * `auth.login_failed` の `summary.reason`。🔴 利用者への応答では区別しない。
 *
 * 🔴 「該当する `users` 行が無い」は**この一覧に無い**。テナントが確定しないため
 *    `AuditLog` に行を作れないからである（下の `authenticateCredentials` の説明を参照）。
 *    値だけ用意して実際には書かれない、という状態を作らない。
 */
export const LOGIN_FAILURE_REASONS = ['PASSWORD_MISMATCH', 'USER_DISABLED'] as const;

export type LoginFailureReason = (typeof LOGIN_FAILURE_REASONS)[number];

export type AuthAttemptMeta = {
  readonly deviceKind: DeviceKind;
  /** 監査ログに残す接続元。取得できない場合は null。 */
  readonly ipAddress: string | null;
};

export type CredentialsAuthResult =
  | { readonly outcome: 'AUTHENTICATED'; readonly claims: TenantSessionClaims }
  | { readonly outcome: 'REJECTED' };

const REJECTED: CredentialsAuthResult = { outcome: 'REJECTED' };

async function recordFailure(
  identity: TenantIdentity,
  reason: LoginFailureReason,
  meta: AuthAttemptMeta,
): Promise<void> {
  await recordAuthAuditLog(identity, {
    action: AUTH_AUDIT_ACTIONS.loginFailed,
    actorKind: 'USER',
    actorId: identity.userId,
    targetType: 'User',
    targetId: identity.userId,
    // 🔴 メールアドレスを summary に入れない（PII。docs/05 §16.2）。
    summary: { reason },
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  });
}

/**
 * 資格情報を検証し、成功したらセッションに載せる主張（分離キー + 利用者 ID）を返す。
 *
 * 監査（F-003 AC-3）:
 *   - 成功 → `auth.login`
 *   - パスワード不一致 / 無効化済み → `auth.login_failed`（テナントが確定しているので記録できる）
 *   - 🔴 **該当する `users` 行が無い場合は `AuditLog` に行を作らない。**
 *     `AuditLog` はテナントに属する表（RLS の C1）であり、テナントが確定していない試行を
 *     書ける経路は存在しない。ここで書けるようにするには「テナント文脈を持たない書き込み」を
 *     新設する必要があり、それは docs/05 §4.4.2 が明示的に禁じている
 *     （`AuditLog` に `tenant_id IS NULL` の行を作れる経路は、越境書き込みの入口になる）。
 *     存在しないアカウントへの試行は構造化ログ（pino / SP-11 の `A-005` 監視）で扱う。
 *
 * 🔴 応答の等化（docs/04 §S-001「失敗理由を区別しない」）:
 *   - 戻り値は 3 分岐とも `REJECTED` の 1 種類だけで、理由を持たない。
 *   - **Argon2id の検証を 3 分岐とも必ず 1 回だけ実行する**（未知アカウントは
 *     `DUMMY_PASSWORD_HASH` に対して行う）。検証は本経路で最も支配的なコストであり、
 *     ここを揃えないと応答時間からアカウントの存在が推測できる。
 *   - 残差: 未知アカウントだけ `AuditLog` の INSERT が無いぶん、わずかに速い（実測で
 *     中央値 51ms 対 71ms。支配項の Argon2id は等しい）。これは「テナント未確定では
 *     `AuditLog` に書けない」という上記の構造的制約から来るもので、書き込みを足して
 *     揃えることはできない（越境書き込みの経路を新設することになる）。
 */
export async function authenticateCredentials(
  input: { readonly email: string; readonly password: string },
  meta: AuthAttemptMeta,
): Promise<CredentialsAuthResult> {
  // 🔴 該当 1 行だけが可視になる限定スコープ（docs/05 §4.4.2）。
  const user = await withAuthLookup(input.email);
  if (user === null) {
    // 🔴 存在しないアカウントでも Argon2id の検証を 1 回走らせる（`DUMMY_PASSWORD_HASH`）。
    //    ここだけ検証を省くと、応答時間の差で「そのメールアドレスは登録されている」ことが
    //    観測できてしまい、docs/04 §S-001「失敗理由を区別しない」が実質的に破れる。
    //    3 分岐（未知 / 不一致 / 無効化）の検証回数を 1 回に揃えるのが本行の目的である。
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    return REJECTED;
  }

  const identity: TenantIdentity = {
    tenantId: user.tenantId,
    partnerCompanyId: user.partnerCompanyId,
    userId: user.userId,
  };

  if (user.disabledAt !== null) {
    // 🔴 パスワードを検証してから拒否する（有効なアカウントとの応答時間差を作らない）。
    await verifyPassword(input.password, user.passwordHash);
    await recordFailure(identity, 'USER_DISABLED', meta);
    return REJECTED;
  }

  const matched = await verifyPassword(input.password, user.passwordHash);
  if (!matched) {
    await recordFailure(identity, 'PASSWORD_MISMATCH', meta);
    return REJECTED;
  }

  // 🔴 記録が成功した後にだけ認証成立とする（記録に失敗したら例外が伝播し、
  //    セッションは発行されない。F-005 / F-012 AC-2 の先取り）。
  await recordAuthAuditLog(identity, {
    action: AUTH_AUDIT_ACTIONS.login,
    actorKind: 'USER',
    actorId: identity.userId,
    targetType: 'User',
    targetId: identity.userId,
    summary: { method: 'credentials' },
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  });

  return { outcome: 'AUTHENTICATED', claims: identity };
}

/** サインアウトを監査ログに記録する（docs/05 §6.3 #4 / §16.1 / F-003 AC-3）。 */
export async function recordSignOut(
  claims: TenantSessionClaims,
  meta: AuthAttemptMeta,
): Promise<void> {
  await recordAuthAuditLog(claims, {
    action: AUTH_AUDIT_ACTIONS.logout,
    actorKind: 'USER',
    actorId: claims.userId,
    targetType: 'User',
    targetId: claims.userId,
    summary: {},
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  });
}
