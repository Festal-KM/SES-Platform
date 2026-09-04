// apps/web/lib/auth/two-factor.ts
// docs/05 §6.3 #2（`POST /api/auth/2fa/verify`）/ #3（`POST /api/auth/2fa/setup`）の
// **主平面アダプタ**。`F-003 AC-2` / `BR-30` / docs/03 §4.9 / CLAUDE.md §3.5。
//
// 🔴 判断ロジック（登録の上書き禁止・リカバリコードの 1 回限り・スロットル・失敗理由の非開示）は
//    `two-factor-core.ts` にある。本ファイルは「主体 = `User`」「保存先 = `two_factor_credentials`
//    の `subject_type='USER'` 行」を core に結線するだけである（T-03-07 で管理平面と共通化した）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/i18n` のみ）。
//    結合テスト（tests/isolation）がサーバを立てずに同じ経路を実行できるようにするため。
import { t } from '@ses/i18n';
import {
  confirmTwoFactorEnrollment,
  consumeRecoveryCode,
  readRecentTwoFactorFailures,
  readTwoFactorCredential,
  recordAuthAuditLog,
  startTwoFactorEnrollment,
  type TenantIdentity,
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

export {
  TWO_FACTOR_AUDIT_ACTIONS,
  TWO_FACTOR_FAILURE_REASONS,
  type StartEnrollmentResult,
  type TwoFactorFailureReason,
  type VerifyTwoFactorResult,
} from './two-factor-core';

/**
 * 🔴 主体は**利用者 ID** である（AAD のスコープ ID もこれ）。同一テナント内の別利用者の行へ
 *    暗号文をコピーしても復号できない（docs/05 §3.3 の「AAD = subjectId + 'totp_secret'」）。
 */
function subjectOf(identity: TenantIdentity): TwoFactorSubject {
  return {
    subjectId: identity.userId,
    actorKind: 'USER',
    // 🔴 文言（プロダクト名）は packages/i18n が唯一の出所（CLAUDE.md §3.5）。
    issuer: t('product.name'),
  };
}

/** `two_factor_credentials` の `subject_type='USER'` 行に閉じた保存先（RLS の C7 SELF）。 */
function storeOf(identity: TenantIdentity): TwoFactorStore {
  return {
    readCredential: () => readTwoFactorCredential(identity),
    readRecentFailures: (since, limit) => readRecentTwoFactorFailures(identity, since, limit),
    startEnrollment: (input, audit) => startTwoFactorEnrollment(identity, input, audit),
    confirmEnrollment: (now, audit) => confirmTwoFactorEnrollment(identity, now, audit),
    consumeRecovery: (previous, remaining, audit) =>
      consumeRecoveryCode(identity, previous, remaining, audit),
    recordAudit: (entry) => recordAuthAuditLog(identity, entry),
  };
}

/** 2FA の登録を開始する（docs/05 §6.3 #3）。 */
export async function startEnrollment(
  identity: TenantIdentity,
  meta: AuthAttemptMeta,
): Promise<StartEnrollmentResult> {
  return startEnrollmentCore(subjectOf(identity), storeOf(identity), meta);
}

/** コード（TOTP またはリカバリコード）を検証する（docs/05 §6.3 #2）。 */
export async function verifyTwoFactorCode(
  identity: TenantIdentity,
  code: string,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<VerifyTwoFactorResult> {
  return verifyTwoFactorCodeCore(subjectOf(identity), storeOf(identity), code, meta, now);
}
