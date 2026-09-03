// apps/web/lib/auth/two-factor.ts
// docs/05 §6.3 #2（`POST /api/auth/2fa/verify`）/ #3（`POST /api/auth/2fa/setup`）の中核。
// `F-003 AC-2` / `BR-30` / docs/03 §4.9 / CLAUDE.md §3.5。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/i18n` と node:crypto のみ）。
//    結合テスト（tests/isolation）がサーバを立てずに同じ経路を実行できるようにするため
//    （`credentials.ts` と同じ方針）。HTTP とセッション Cookie の更新は Route Handler の責務。
//
// 🔴 秘匿値の扱い（CLAUDE.md §3.4）:
//   - TOTP シークレットは `TOKEN_ENCRYPTION_KEY` で暗号化して保存する（`EncryptedString`）。
//     平文がこのモジュールの外に出るのは **`otpauth://` URL を本人へ返す 1 回だけ**である。
//   - リカバリコードは Argon2id のハッシュだけを保存する。平文は生成直後の 1 回だけ返す。
//   - どちらも `AuditLog` / ログ / エラーに載せない（`summary` は種別と残数のみ）。
import { t } from '@ses/i18n';
import {
  confirmTwoFactorEnrollment,
  consumeRecoveryCode,
  EncryptedString,
  readRecentTwoFactorFailures,
  readTwoFactorCredential,
  recordAuthAuditLog,
  startTwoFactorEnrollment,
  type AuditLogEntry,
  type TenantIdentity,
} from '@ses/db';
import type { AuthAttemptMeta } from './credentials';
import {
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCodes,
  withoutIndex,
} from './recovery-codes';
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from './totp';
import {
  evaluateTwoFactorThrottle,
  twoFactorThrottleWindowStart,
  TWO_FACTOR_THROTTLE_POLICY,
  type TwoFactorThrottleState,
} from './two-factor-throttle';

/**
 * 🔴 暗号化の AAD の列名（docs/05 §3.3 `TwoFactorCredential.secretEncrypted` の
 *    「AAD = subjectId + 'totp_secret'」）。スコープ ID は**利用者 ID**であり、
 *    同一テナント内の別利用者の行へ暗号文をコピーしても復号できない。
 */
const TOTP_SECRET_AAD_COLUMN = 'totp_secret';

/** docs/05 §16.1 の `auth.*` に倣った 2FA の監査アクション（CLAUDE.md §3.5）。 */
export const TWO_FACTOR_AUDIT_ACTIONS = {
  setupStarted: 'auth.2fa.setup_started',
  enabled: 'auth.2fa.enabled',
  verified: 'auth.2fa.verified',
  recoveryUsed: 'auth.2fa.recovery_used',
  failed: 'auth.2fa.failed',
  /**
   * 🔴 スロットルによる拒否は `failed` と**別の action** にする。
   *    同じ action にすると、ロック中の試行がそのまま窓を延ばし続け（自己増殖するロック）、
   *    正規の利用者が自分の連打で永久にロックされる。監視上も「本当の失敗」と分けたい。
   */
  throttled: 'auth.2fa.throttled',
} as const;

/** 🔴 失敗理由は監査ログにだけ残す（利用者への応答では区別しない）。 */
export const TWO_FACTOR_FAILURE_REASONS = ['INVALID_CODE', 'NOT_ENROLLED', 'RACE_LOST'] as const;

export type TwoFactorFailureReason = (typeof TWO_FACTOR_FAILURE_REASONS)[number];

export type StartEnrollmentResult =
  | {
      readonly status: 'ENROLLMENT_STARTED';
      /** 🔴 シークレットを含む。本人の画面にだけ返し、ログに出さない。 */
      readonly otpauthUrl: string;
      /** 🔴 平文。**この 1 回だけ**返る（DB にはハッシュしか無い）。 */
      readonly recoveryCodes: readonly string[];
    }
  /** 確認済みの資格情報がある（上書きしない）。呼び出し側はコード入力へ進ませる。 */
  | { readonly status: 'ALREADY_ENROLLED' };

export type VerifyTwoFactorResult =
  /** 登録の確定（初回のコード入力）。 */
  | { readonly outcome: 'ENROLLED' }
  | { readonly outcome: 'VERIFIED'; readonly method: 'TOTP' | 'RECOVERY_CODE' }
  /** 資格情報が無い（先に `setup` が要る）。 */
  | { readonly outcome: 'NOT_ENROLLED' }
  /** 🔴 試行回数の上限に達したため、**コードを検証せずに**拒否した。 */
  | { readonly outcome: 'THROTTLED'; readonly retryAfterSeconds: number }
  | { readonly outcome: 'REJECTED' };

function auditEntry(
  identity: TenantIdentity,
  action: string,
  summary: Readonly<Record<string, string | number | boolean | null>>,
  meta: AuthAttemptMeta,
): AuditLogEntry {
  return {
    action,
    actorKind: 'USER',
    actorId: identity.userId,
    targetType: 'TwoFactorCredential',
    targetId: identity.userId,
    // 🔴 シークレット・リカバリコード・コード入力値を入れない（CLAUDE.md §3.4 / docs/05 §16.2）。
    summary,
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  };
}

async function recordFailure(
  identity: TenantIdentity,
  reason: TwoFactorFailureReason,
  meta: AuthAttemptMeta,
): Promise<void> {
  await recordAuthAuditLog(
    identity,
    auditEntry(identity, TWO_FACTOR_AUDIT_ACTIONS.failed, { reason }, meta),
  );
}

/**
 * 直近の失敗回数からロック状態を求める（docs/04 §S-001）。
 * 🔴 読むのは**本人の失敗時刻だけ**である（`readRecentTwoFactorFailures` の説明を参照）。
 */
async function loadThrottleState(
  identity: TenantIdentity,
  now: Date,
): Promise<TwoFactorThrottleState> {
  const failures = await readRecentTwoFactorFailures(
    identity,
    twoFactorThrottleWindowStart(now),
    // 閾値ぴったりまで読めば判定できる（それ以上は数えても結論が変わらない）。
    TWO_FACTOR_THROTTLE_POLICY.maxFailures,
  );
  return evaluateTwoFactorThrottle(failures, now);
}

function decryptSecret(identity: TenantIdentity, secretEncrypted: string): string {
  return EncryptedString.fromStorageValue(secretEncrypted).decrypt({
    scopeId: identity.userId,
    column: TOTP_SECRET_AAD_COLUMN,
  });
}

/**
 * 2FA の登録を開始する（docs/05 §6.3 #3）。
 *
 * 🔴 **確認済みの資格情報があるときは上書きしない**（`ALREADY_ENROLLED`）。
 *    パスワードだけを奪った攻撃者が自分の認証器へ差し替えられると、2 要素目が無意味になる。
 * 🔴 監査ログは `packages/db` 側で**登録と同一トランザクション**に書く
 *    （記録できなければ登録も成立しない。`F-005`）。
 */
export async function startEnrollment(
  identity: TenantIdentity,
  meta: AuthAttemptMeta,
): Promise<StartEnrollmentResult> {
  // 🔴 先に状態を見てから鍵とコードを作る。確認済みの利用者が 2 段階目に入るたびに
  //    Argon2id を 10 回回すのは、認証済み利用者から仕掛けられる負荷そのものになる。
  //    判定の正は依然として `startTwoFactorEnrollment`（同一トランザクションで再確認する）であり、
  //    ここは早期リターンにすぎない（この間に確認済みになっても DB 側で弾かれる）。
  const existing = await readTwoFactorCredential(identity);
  if (existing !== null && existing.confirmedAt !== null) return { status: 'ALREADY_ENROLLED' };

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const secretEncrypted = EncryptedString.encrypt(secret, {
    scopeId: identity.userId,
    column: TOTP_SECRET_AAD_COLUMN,
  }).toStorageValue();
  const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);

  const result = await startTwoFactorEnrollment(
    identity,
    { secretEncrypted, recoveryCodeHashes },
    auditEntry(
      identity,
      TWO_FACTOR_AUDIT_ACTIONS.setupStarted,
      { recoveryCodeCount: recoveryCodes.length },
      meta,
    ),
  );
  if (result.status === 'ALREADY_CONFIRMED') return { status: 'ALREADY_ENROLLED' };

  return {
    status: 'ENROLLMENT_STARTED',
    otpauthUrl: buildOtpauthUrl({
      secret,
      accountLabel: result.accountLabel,
      // 🔴 文言（プロダクト名）は packages/i18n が唯一の出所（CLAUDE.md §3.5）。
      issuer: t('product.name'),
    }),
    recoveryCodes,
  };
}

/**
 * コード（TOTP またはリカバリコード）を検証する（docs/05 §6.3 #2）。
 *
 * - 未確認の登録がある場合: **TOTP のみ**を受け付け、成功で `confirmedAt` を確定する。
 *   🔴 リカバリコードでの確定を認めない（認証器を持っていることの確認が登録確定の意味だから）。
 * - 確認済みの場合: TOTP → 失敗ならリカバリコードの順で照合する。
 *   🔴 リカバリコードは 1 回限り（DB の CAS で消費する。`consumeRecoveryCode`）。
 *
 * 🔴 失敗は理由を返さない（`REJECTED` の 1 種類）。理由は監査ログにだけ残す。
 *
 * 🔴 **試行回数の上限に達していたら、コードを一切検証せずに拒否する**（docs/04 §S-001）。
 *    判定を Route Handler ではなくここに置くのは、呼び出し経路が増えたときに
 *    「スロットルを通らない検証」が生まれないようにするためである（ゲートは実装の内側に置く）。
 */
export async function verifyTwoFactorCode(
  identity: TenantIdentity,
  code: string,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<VerifyTwoFactorResult> {
  // 🔴 最初に判定する（資格情報の読み出し・復号・Argon2id 照合のいずれも行わない）。
  const throttle = await loadThrottleState(identity, now);
  if (throttle.locked) {
    await recordAuthAuditLog(
      identity,
      auditEntry(
        identity,
        TWO_FACTOR_AUDIT_ACTIONS.throttled,
        // 🔴 件数と残り秒数だけ（入力コード・シークレット・資格情報の有無を残さない）。
        { failures: throttle.failures, retryAfterSeconds: throttle.retryAfterSeconds },
        meta,
      ),
    );
    return { outcome: 'THROTTLED', retryAfterSeconds: throttle.retryAfterSeconds };
  }

  const credential = await readTwoFactorCredential(identity);
  if (credential === null) {
    await recordFailure(identity, 'NOT_ENROLLED', meta);
    return { outcome: 'NOT_ENROLLED' };
  }

  const secret = decryptSecret(identity, credential.secretEncrypted);
  const totpMatched = verifyTotpCode(secret, code, now);

  if (credential.confirmedAt === null) {
    if (!totpMatched) {
      await recordFailure(identity, 'INVALID_CODE', meta);
      return { outcome: 'REJECTED' };
    }
    const confirmed = await confirmTwoFactorEnrollment(
      identity,
      now,
      auditEntry(
        identity,
        TWO_FACTOR_AUDIT_ACTIONS.enabled,
        { recoveryCodeCount: credential.recoveryCodeHashes.length },
        meta,
      ),
    );
    if (!confirmed) {
      // 同時確定に負けた（CAS が 0 件）。状態は他方の確定で正しくなっている。
      await recordFailure(identity, 'RACE_LOST', meta);
      return { outcome: 'REJECTED' };
    }
    return { outcome: 'ENROLLED' };
  }

  if (totpMatched) {
    await recordAuthAuditLog(
      identity,
      auditEntry(identity, TWO_FACTOR_AUDIT_ACTIONS.verified, { method: 'TOTP' }, meta),
    );
    return { outcome: 'VERIFIED', method: 'TOTP' };
  }

  const recoveryIndex = await findRecoveryCodeIndex(code, credential.recoveryCodeHashes);
  if (recoveryIndex === null) {
    await recordFailure(identity, 'INVALID_CODE', meta);
    return { outcome: 'REJECTED' };
  }

  const remaining = withoutIndex(credential.recoveryCodeHashes, recoveryIndex);
  const consumed = await consumeRecoveryCode(
    identity,
    credential.recoveryCodeHashes,
    remaining,
    auditEntry(
      identity,
      TWO_FACTOR_AUDIT_ACTIONS.recoveryUsed,
      { remainingRecoveryCodes: remaining.length },
      meta,
    ),
  );
  if (!consumed) {
    // 🔴 CAS に負けた ＝ 同じコードが並行して使われた。**使えたことにしない。**
    await recordFailure(identity, 'RACE_LOST', meta);
    return { outcome: 'REJECTED' };
  }
  return { outcome: 'VERIFIED', method: 'RECOVERY_CODE' };
}
