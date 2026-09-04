// apps/web/lib/auth/platform-two-factor.ts
// API-A1 の 2FA 部分（`POST /api/admin/auth/2fa/setup` / `verify`）の**管理平面アダプタ**。
// `F-055 AC-3`（2 要素認証を設定するまで管理平面のいずれの画面にも到達できない）/ `BR-30`。
//
// 🔴 判断ロジックは `two-factor-core.ts` にある（主平面と同一実装）。本ファイルは
//    「主体 = `PlatformUser`」「保存先 = `two_factor_credentials` の
//    `subject_type='PLATFORM_USER'`（`tenant_id IS NULL`）行」を core に結線するだけである。
//
// 🔴 主平面のアダプタ（`two-factor.ts`）とは**接続プールも DB ロールも別**である
//    （`app_platform_write` / `PLATFORM_WRITE_DATABASE_URL`）。テナント利用者の 2FA 資格情報には
//    ここから 1 行も到達できない（RLS が `subject_type='PLATFORM_USER'` を課す）。
import { t } from '@ses/i18n';
import {
  confirmPlatformTwoFactorEnrollment,
  consumePlatformRecoveryCode,
  readPlatformTwoFactorCredential,
  readRecentPlatformTwoFactorFailures,
  recordPlatformAuditLog,
  startPlatformTwoFactorEnrollment,
  type PlatformIdentity,
} from '@ses/db';
import type { AuthAttemptMeta } from './credentials';
import {
  startEnrollmentCore,
  verifyTwoFactorCodeCore,
  type StartEnrollmentResult,
  type TwoFactorStore,
  type TwoFactorSubject,
  type VerifyTwoFactorResult,
} from './two-factor-core';

/**
 * 🔴 認証アプリでテナント利用者の登録と取り違えないよう、発行者名を分ける
 *    （`A-001` の平面帯「運営者コンソール」と同じ文言。`packages/i18n` が唯一の出所）。
 */
function subjectOf(identity: PlatformIdentity): TwoFactorSubject {
  return {
    subjectId: identity.platformUserId,
    actorKind: 'PLATFORM_USER',
    issuer: t('admin.console.issuer'),
  };
}

function storeOf(identity: PlatformIdentity): TwoFactorStore {
  return {
    readCredential: () => readPlatformTwoFactorCredential(identity),
    readRecentFailures: (since, limit) =>
      readRecentPlatformTwoFactorFailures(identity, since, limit),
    startEnrollment: (input, audit) => startPlatformTwoFactorEnrollment(identity, input, audit),
    confirmEnrollment: (now, audit) => confirmPlatformTwoFactorEnrollment(identity, now, audit),
    consumeRecovery: (previous, remaining, audit) =>
      consumePlatformRecoveryCode(identity, previous, remaining, audit),
    recordAudit: (entry) => recordPlatformAuditLog(identity, entry),
  };
}

/** 運営者の 2FA 登録を開始する（API-A1）。 */
export async function startPlatformEnrollment(
  identity: PlatformIdentity,
  meta: AuthAttemptMeta,
): Promise<StartEnrollmentResult> {
  return startEnrollmentCore(subjectOf(identity), storeOf(identity), meta);
}

/** 運営者の 2FA コードを検証する（API-A1 `2fa/verify`）。 */
export async function verifyPlatformTwoFactorCode(
  identity: PlatformIdentity,
  code: string,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<VerifyTwoFactorResult> {
  return verifyTwoFactorCodeCore(subjectOf(identity), storeOf(identity), code, meta, now);
}
