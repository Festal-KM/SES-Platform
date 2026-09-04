// apps/web/lib/auth/two-factor-core.ts
// 🔴 2 要素認証（TOTP + リカバリコード）の判断ロジックの**唯一の実装**。
//
// なぜ抽出したか（T-03-07）: 主平面（`F-003 AC-2` / `BR-30`）と管理平面（`F-055 AC-3`）は
// **主体（`User` / `PlatformUser`）と保存先（`subject_type`）が違うだけ**で、
// 「登録は上書きしない」「リカバリコードは 1 回限り」「スロットル中はコードを検証しない」
// 「失敗理由を返さない」という規律は完全に同じである。2 本に書き分けると、片方だけ緩んだときに
// 気づけない（`CLAUDE.md` §3.5 の 2 要素認証の要求は両平面に等しくかかる）。
//
// 🔴 本モジュールは Next.js / Auth.js / 特定の DB 表に依存しない。DB への到達は
//    `TwoFactorStore`（ポート）越しにのみ行う。主平面のアダプタは `two-factor.ts`、
//    管理平面のアダプタは `platform-two-factor.ts` である。
//
// 🔴 秘匿値の扱い（CLAUDE.md §3.4）:
//   - TOTP シークレットは `TOKEN_ENCRYPTION_KEY` で暗号化して保存する（`EncryptedString`）。
//     平文がこのモジュールの外に出るのは **`otpauth://` URL を本人へ返す 1 回だけ**である。
//   - リカバリコードは Argon2id のハッシュだけを保存する。平文は生成直後の 1 回だけ返す。
//   - どちらも `AuditLog` / ログ / エラーに載せない（`summary` は種別と残数のみ）。
import {
  EncryptedString,
  type AuditActorKind,
  type AuditLogEntry,
  type TwoFactorCredentialRow,
  type TwoFactorEnrollmentInput,
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
 *    「AAD = subjectId + 'totp_secret'」）。スコープ ID は**主体の ID**であり、
 *    別の主体の行へ暗号文をコピーしても復号できない。
 */
const TOTP_SECRET_AAD_COLUMN = 'totp_secret';

/** docs/05 §16.1 の `auth.*`（主平面・管理平面で同じ action 名を使う）。 */
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

/** 2 要素認証の主体（誰の資格情報か）。🔴 分離キーではない（主体の ID だけ）。 */
export type TwoFactorSubject = {
  /** 暗号化 AAD のスコープ ID 兼 `AuditLog` の `actorId` / `targetId`。 */
  readonly subjectId: string;
  readonly actorKind: AuditActorKind;
  /** 認証アプリに表示する発行者名。🔴 文言は `packages/i18n` が出所（呼び出し側が渡す）。 */
  readonly issuer: string;
};

export type EnrollmentStartOutcome =
  | { readonly status: 'STARTED'; readonly accountLabel: string }
  | { readonly status: 'ALREADY_CONFIRMED' };

/**
 * 資格情報の保存先（主平面 = `two_factor_credentials` の `USER` 行 /
 * 管理平面 = 同表の `PLATFORM_USER` 行）。**RLS はアダプタ側で効く。**
 */
export type TwoFactorStore = {
  readonly readCredential: () => Promise<TwoFactorCredentialRow | null>;
  readonly readRecentFailures: (since: Date, limit: number) => Promise<readonly Date[]>;
  readonly startEnrollment: (
    input: TwoFactorEnrollmentInput,
    audit: AuditLogEntry,
  ) => Promise<EnrollmentStartOutcome>;
  readonly confirmEnrollment: (now: Date, audit: AuditLogEntry) => Promise<boolean>;
  /**
   * リカバリコードを 1 つ消費する（CAS）。
   * 🔴 メンバー名を `packages/db` の関数名（`consumeRecoveryCode` /
   *    `consumePlatformRecoveryCode`）と**あえて変えている**。
   *    `tests/static/auth-db-callers.test.ts` は「その関数名に言及しているファイル」を
   *    走査して呼び出し元を固定するため、ポートのメンバー名が同名だと
   *    「アダプタ以外のファイルが DB 関数に触れている」と誤検知される。
   */
  readonly consumeRecovery: (
    previousHashes: readonly string[],
    remainingHashes: readonly string[],
    audit: AuditLogEntry,
  ) => Promise<boolean>;
  readonly recordAudit: (entry: AuditLogEntry) => Promise<void>;
};

function auditEntry(
  subject: TwoFactorSubject,
  action: string,
  summary: Readonly<Record<string, string | number | boolean | null>>,
  meta: AuthAttemptMeta,
): AuditLogEntry {
  return {
    action,
    actorKind: subject.actorKind,
    actorId: subject.subjectId,
    targetType: 'TwoFactorCredential',
    targetId: subject.subjectId,
    // 🔴 シークレット・リカバリコード・コード入力値を入れない（CLAUDE.md §3.4 / docs/05 §16.2）。
    summary,
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  };
}

async function recordFailure(
  subject: TwoFactorSubject,
  store: TwoFactorStore,
  reason: TwoFactorFailureReason,
  meta: AuthAttemptMeta,
): Promise<void> {
  await store.recordAudit(auditEntry(subject, TWO_FACTOR_AUDIT_ACTIONS.failed, { reason }, meta));
}

/** 直近の失敗回数からロック状態を求める（docs/04 §S-001 / `A-001`）。 */
async function loadThrottleState(
  store: TwoFactorStore,
  now: Date,
): Promise<TwoFactorThrottleState> {
  const failures = await store.readRecentFailures(
    twoFactorThrottleWindowStart(now),
    // 閾値ぴったりまで読めば判定できる（それ以上は数えても結論が変わらない）。
    TWO_FACTOR_THROTTLE_POLICY.maxFailures,
  );
  return evaluateTwoFactorThrottle(failures, now);
}

function decryptSecret(subject: TwoFactorSubject, secretEncrypted: string): string {
  return EncryptedString.fromStorageValue(secretEncrypted).decrypt({
    scopeId: subject.subjectId,
    column: TOTP_SECRET_AAD_COLUMN,
  });
}

/**
 * 2FA の登録を開始する（docs/05 §6.3 #3 / API-A1）。
 *
 * 🔴 **確認済みの資格情報があるときは上書きしない**（`ALREADY_ENROLLED`）。
 *    パスワードだけを奪った攻撃者が自分の認証器へ差し替えられると、2 要素目が無意味になる。
 * 🔴 監査ログは保存先の実装が**登録と同一トランザクション**で書く
 *    （記録できなければ登録も成立しない。`F-005`）。
 */
export async function startEnrollmentCore(
  subject: TwoFactorSubject,
  store: TwoFactorStore,
  meta: AuthAttemptMeta,
): Promise<StartEnrollmentResult> {
  // 🔴 先に状態を見てから鍵とコードを作る。確認済みの主体が 2 段階目に入るたびに
  //    Argon2id を 10 回回すのは、認証済み利用者から仕掛けられる負荷そのものになる。
  //    判定の正は依然として `store.startEnrollment`（同一トランザクションで再確認する）であり、
  //    ここは早期リターンにすぎない（この間に確認済みになっても DB 側で弾かれる）。
  const existing = await store.readCredential();
  if (existing !== null && existing.confirmedAt !== null) return { status: 'ALREADY_ENROLLED' };

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const secretEncrypted = EncryptedString.encrypt(secret, {
    scopeId: subject.subjectId,
    column: TOTP_SECRET_AAD_COLUMN,
  }).toStorageValue();
  const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);

  const result = await store.startEnrollment(
    { secretEncrypted, recoveryCodeHashes },
    auditEntry(
      subject,
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
      issuer: subject.issuer,
    }),
    recoveryCodes,
  };
}

/**
 * コード（TOTP またはリカバリコード）を検証する（docs/05 §6.3 #2 / API-A1）。
 *
 * - 未確認の登録がある場合: **TOTP のみ**を受け付け、成功で `confirmedAt` を確定する。
 *   🔴 リカバリコードでの確定を認めない（認証器を持っていることの確認が登録確定の意味だから）。
 * - 確認済みの場合: TOTP → 失敗ならリカバリコードの順で照合する。
 *   🔴 リカバリコードは 1 回限り（DB の CAS で消費する）。
 *
 * 🔴 失敗は理由を返さない（`REJECTED` の 1 種類）。理由は監査ログにだけ残す。
 * 🔴 **試行回数の上限に達していたら、コードを一切検証せずに拒否する**（docs/04 §S-001 / `A-001`）。
 *    判定を Route Handler ではなくここに置くのは、呼び出し経路が増えたときに
 *    「スロットルを通らない検証」が生まれないようにするためである（ゲートは実装の内側に置く）。
 */
export async function verifyTwoFactorCodeCore(
  subject: TwoFactorSubject,
  store: TwoFactorStore,
  code: string,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<VerifyTwoFactorResult> {
  // 🔴 最初に判定する（資格情報の読み出し・復号・Argon2id 照合のいずれも行わない）。
  const throttle = await loadThrottleState(store, now);
  if (throttle.locked) {
    await store.recordAudit(
      auditEntry(
        subject,
        TWO_FACTOR_AUDIT_ACTIONS.throttled,
        // 🔴 件数と残り秒数だけ（入力コード・シークレット・資格情報の有無を残さない）。
        { failures: throttle.failures, retryAfterSeconds: throttle.retryAfterSeconds },
        meta,
      ),
    );
    return { outcome: 'THROTTLED', retryAfterSeconds: throttle.retryAfterSeconds };
  }

  const credential = await store.readCredential();
  if (credential === null) {
    await recordFailure(subject, store, 'NOT_ENROLLED', meta);
    return { outcome: 'NOT_ENROLLED' };
  }

  const secret = decryptSecret(subject, credential.secretEncrypted);
  const totpMatched = verifyTotpCode(secret, code, now);

  if (credential.confirmedAt === null) {
    if (!totpMatched) {
      await recordFailure(subject, store, 'INVALID_CODE', meta);
      return { outcome: 'REJECTED' };
    }
    const confirmed = await store.confirmEnrollment(
      now,
      auditEntry(
        subject,
        TWO_FACTOR_AUDIT_ACTIONS.enabled,
        { recoveryCodeCount: credential.recoveryCodeHashes.length },
        meta,
      ),
    );
    if (!confirmed) {
      // 同時確定に負けた（CAS が 0 件）。状態は他方の確定で正しくなっている。
      await recordFailure(subject, store, 'RACE_LOST', meta);
      return { outcome: 'REJECTED' };
    }
    return { outcome: 'ENROLLED' };
  }

  if (totpMatched) {
    await store.recordAudit(
      auditEntry(subject, TWO_FACTOR_AUDIT_ACTIONS.verified, { method: 'TOTP' }, meta),
    );
    return { outcome: 'VERIFIED', method: 'TOTP' };
  }

  const recoveryIndex = await findRecoveryCodeIndex(code, credential.recoveryCodeHashes);
  if (recoveryIndex === null) {
    await recordFailure(subject, store, 'INVALID_CODE', meta);
    return { outcome: 'REJECTED' };
  }

  const remaining = withoutIndex(credential.recoveryCodeHashes, recoveryIndex);
  const consumed = await store.consumeRecovery(
    credential.recoveryCodeHashes,
    remaining,
    auditEntry(
      subject,
      TWO_FACTOR_AUDIT_ACTIONS.recoveryUsed,
      { remainingRecoveryCodes: remaining.length },
      meta,
    ),
  );
  if (!consumed) {
    // 🔴 CAS に負けた ＝ 同じコードが並行して使われた。**使えたことにしない。**
    await recordFailure(subject, store, 'RACE_LOST', meta);
    return { outcome: 'REJECTED' };
  }
  return { outcome: 'VERIFIED', method: 'RECOVERY_CODE' };
}
