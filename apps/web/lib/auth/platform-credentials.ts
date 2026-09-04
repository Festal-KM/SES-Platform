// apps/web/lib/auth/platform-credentials.ts
// API-A1（`POST /api/admin/auth/signin`）の中核（`F-055` / `A-001`）。
// Auth.js の**管理平面インスタンス**の Credentials プロバイダの `authorize()` から呼ばれる。
//
// 🔴 メール照合は `withPlatformAuthLookup(email)` で**該当 1 行だけ**を可視にする
//    （主平面の `withAuthLookup` と同じ形。`platform_users` を全件走査する経路を作らない）。
//
// 🔴 失敗理由を呼び出し側に返さない（docs/04 `A-001`「認証失敗は主平面と同じく理由を区別しない」。
//    **テナント利用者の認証情報では到達できない旨をエラーに書かない** —— 存在の示唆を避ける）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` と argon2 のみ）。
//    結合テストがサーバを立てずに同じ経路を実行できるようにするため。
import {
  recordPlatformAuditLog,
  withPlatformAuthLookup,
  type PlatformIdentity,
} from '@ses/db';
import { AUTH_AUDIT_ACTIONS } from './credentials';
import type { AuthAttemptMeta } from './credentials';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password';
import type { PlatformSessionClaims } from './platform-claims';

/**
 * `auth.login_failed` の `summary.reason`。🔴 運営者への応答では区別しない。
 *
 * 🔴 「該当する `platform_users` 行が無い」は**この一覧に無い**。主体が確定しないため
 *    `AuditLog` に行を作れないからである（`audit_logs_platform_auth_insert` は
 *    `actor_id = current_setting('app.platform_auth_subject_id')` を要求する）。
 *    存在しないアカウントへの試行は構造化ログ（SP-11 の `A-005` 監視）で扱う。
 */
export const PLATFORM_LOGIN_FAILURE_REASONS = ['PASSWORD_MISMATCH', 'USER_DISABLED'] as const;

export type PlatformLoginFailureReason = (typeof PLATFORM_LOGIN_FAILURE_REASONS)[number];

export type PlatformCredentialsAuthResult =
  | { readonly outcome: 'AUTHENTICATED'; readonly claims: PlatformSessionClaims }
  | { readonly outcome: 'REJECTED' };

const REJECTED: PlatformCredentialsAuthResult = { outcome: 'REJECTED' };

async function recordFailure(
  identity: PlatformIdentity,
  reason: PlatformLoginFailureReason,
  meta: AuthAttemptMeta,
): Promise<void> {
  await recordPlatformAuditLog(identity, {
    action: AUTH_AUDIT_ACTIONS.loginFailed,
    actorKind: 'PLATFORM_USER',
    actorId: identity.platformUserId,
    targetType: 'PlatformUser',
    targetId: identity.platformUserId,
    // 🔴 メールアドレスを summary に入れない（PII。docs/05 §16.2）。
    summary: { reason },
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  });
}

/**
 * 運営者の資格情報を検証し、成功したらセッションに載せる主張（主体 ID）を返す。
 *
 * 監査（`F-055 AC-4`）: 成功 → `auth.login`（`last_login_at` の更新と同一トランザクション）/
 * パスワード不一致・無効化済み → `auth.login_failed`。
 *
 * 🔴 応答の等化（docs/04 `A-001`）: 戻り値は 3 分岐とも `REJECTED` の 1 種類で理由を持たない。
 *    **Argon2id の検証を 3 分岐とも必ず 1 回だけ実行する**（未知アカウントは
 *    `DUMMY_PASSWORD_HASH` に対して行う）。ここを揃えないと応答時間から
 *    「その運営者アカウントは実在する」ことが推測できる。
 */
export async function authenticatePlatformCredentials(
  input: { readonly email: string; readonly password: string },
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<PlatformCredentialsAuthResult> {
  const user = await withPlatformAuthLookup(input.email);
  if (user === null) {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    return REJECTED;
  }

  const identity: PlatformIdentity = { platformUserId: user.platformUserId };

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
  //    セッションは発行されない。`F-055 AC-4` / `BR-41`）。
  await recordPlatformAuditLog(
    identity,
    {
      action: AUTH_AUDIT_ACTIONS.login,
      actorKind: 'PLATFORM_USER',
      actorId: identity.platformUserId,
      targetType: 'PlatformUser',
      targetId: identity.platformUserId,
      summary: { method: 'credentials' },
      ipAddress: meta.ipAddress,
      deviceKind: meta.deviceKind,
    },
    { lastLoginAt: now },
  );

  return { outcome: 'AUTHENTICATED', claims: { platformUserId: identity.platformUserId } };
}

/** サインアウトを監査ログに記録する（`F-055 AC-4`）。 */
export async function recordPlatformSignOut(
  claims: PlatformSessionClaims,
  meta: AuthAttemptMeta,
): Promise<void> {
  await recordPlatformAuditLog(
    { platformUserId: claims.platformUserId },
    {
      action: AUTH_AUDIT_ACTIONS.logout,
      actorKind: 'PLATFORM_USER',
      actorId: claims.platformUserId,
      targetType: 'PlatformUser',
      targetId: claims.platformUserId,
      summary: {},
      ipAddress: meta.ipAddress,
      deviceKind: meta.deviceKind,
    },
  );
}
