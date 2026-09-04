// packages/db/src/platform-auth.ts
// 🔴 運営者認証（`F-055` / API-A1 / `A-001`。T-03-07）が DB に触れる**唯一の経路**。
//    主平面の `row-context.ts`（docs/05 §4.4.2「テナント文脈を持たない経路」）の管理平面版である。
//
// 🔴 テナントの `User` とは**別テーブル・別認証・別接続**（`BR-36` / `CLAUDE.md` §10.5）:
//   - 主体は `platform_users`。`users` に運営者フラグに相当する列は存在しない
//     （`tests/static/platform-user-no-flag.test.ts` が列名を走査する）
//   - 接続は `app_platform_write`（`PLATFORM_WRITE_DATABASE_URL`）であり、
//     主平面の `app_tenant` プール（`configureTenantDb`）を 1 バイトも使わない
//   - 2FA の資格情報は `two_factor_credentials` の **`subject_type='PLATFORM_USER'` /
//     `tenant_id IS NULL`** の行（docs/05 §3.3 の列コメント / §4.4 C7 SELF の注記）
//
// 🔴 汎用の抜け道ではない（`row-context.ts` 冒頭の 5 点と同じ形で担保する）:
//   ① 触れる表は `platform_users` / `two_factor_credentials` / `audit_logs` の 3 表だけ、
//      列も本ファイルに書かれた固定列だけである。引数に表名・列名・`tenant_id` が無い
//   ② `SET LOCAL` する主体はメール照合で得た行かセッション Cookie であり、
//      呼び出し側がリクエスト入力から渡せない（`CLAUDE.md` §3.1 / `BR-03`）
//   ③ `AuthenticatedPlatformCtx` を生成しない（生成器は `resolvePlatformCtx` のまま）
//   ④ 呼び出し元は `tests/static/auth-db-callers.test.ts` が `apps/web/lib/auth/**` の
//      特定ファイルに固定する
//   ⑤ 戻り値は認証に必要な最小限の列だけで、行オブジェクトを外へ出さない
//
// 🔴 秘匿値（`CLAUDE.md` §3.4）: TOTP シークレットは**暗号化済み文字列**として受け渡し、
//    リカバリコードは**ハッシュだけ**を受け渡す。本モジュールは平文を知らない。
import type { PrismaClient } from '@prisma/client';
import { AuditLogWriteError, auditLogRowValues, type AuditLogEntry } from './audit.js';
import { getPlatformWriteClient } from './platform-client.js';
import { platformAuthScopeSql, type PlatformAuthCredential } from './scope-settings.js';
import { PLATFORM_ROLES, type PlatformRole } from './schema-value-sets.js';
import type { TwoFactorCredentialRow, TwoFactorEnrollmentInput } from './two-factor.js';

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * 🔴 管理平面が触れてよい `subject_type`。主平面（`app_tenant`）の C7 SELF は
 *    `subject_type = 'USER'` を AND しており、この値の行は 1 行も見えない。**射程は交わらない。**
 */
export const TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER = 'PLATFORM_USER';

/** 認証で確定した運営者の識別子。🔴 リクエスト入力から来ない。 */
export type PlatformIdentity = {
  readonly platformUserId: string;
};

/** `withPlatformAuthLookup` が返す 1 行（読み取り専用）。 */
export type PlatformAuthUser = PlatformIdentity & {
  readonly email: string;
  readonly displayName: string;
  readonly role: PlatformRole;
  readonly passwordHash: string;
  readonly disabledAt: Date | null;
};

/** セッションから毎リクエスト確定する事実（`resolvePlatformCtx` に渡す材料）。 */
export type PlatformUserFacts = {
  readonly role: PlatformRole;
  readonly displayName: string;
  /**
   * 🔴 `TwoFactorCredential.confirmedAt IS NOT NULL`。ロールと同じく**リクエストごとに
   *    DB から確定する**（セッションに焼き込まない）。焼き込むと 2FA を解除しても
   *    既存セッションが生き続ける。
   */
  readonly twoFactorEnrolled: boolean;
};

function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

async function inPlatformAuthScope<T>(
  credential: PlatformAuthCredential,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return getPlatformWriteClient().$transaction(async (tx) => {
    await tx.$queryRaw(platformAuthScopeSql(credential));
    return fn(tx);
  });
}

/** 本人（`identity`）の文脈で実行する（第 2 段）。 */
async function inPlatformSubjectScope<T>(
  identity: PlatformIdentity,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return inPlatformAuthScope({ kind: 'SUBJECT', value: identity.platformUserId }, fn);
}

/**
 * 🔴 運営者の `AuditLog` を 1 行書く（`F-055 AC-4` / `BR-41` / docs/05 §16.1）。
 *
 * `tenant_id` は **NULL**（運営者の認証はどのテナントの操作でもない）。
 * `actor_kind` は `'PLATFORM_USER'`。RLS の `audit_logs_platform_auth_insert` が
 * 「本人の PLATFORM_USER 行」以外の INSERT を拒否する。
 *
 * 🔴 1 行書けなかったら例外にする。呼び出し側はトランザクションごと巻き戻し、
 *    対象操作（ログイン / 2FA の確定）を成立させない。
 */
async function writePlatformAuditLog(
  tx: TransactionClient,
  identity: PlatformIdentity,
  entry: AuditLogEntry,
): Promise<void> {
  const result = await tx.auditLog.createMany({
    data: [
      {
        tenantId: null,
        ...auditLogRowValues(entry),
        actorKind: 'PLATFORM_USER',
        actorId: identity.platformUserId,
      },
    ],
  });
  if (result.count !== 1) throw new AuditLogWriteError(entry.action);
}

// ---------------------------------------------------------------------------
// 認証（メール照合 → セッション由来の事実確定）
// ---------------------------------------------------------------------------

/**
 * メールアドレスで `platform_users` の該当 1 行だけを読む（読み取り専用）。
 *
 * 🔴 照合の正規化は**二重に**効かせる（`code-reviewer` 指摘 T-03-07）:
 *    ①ポリシー側で `lower(email) = lower(NULLIF(GUC, ''))`（主平面の
 *      `users_auth_lookup_select` と同形。両辺を畳むので呼び出し側に依存しない）
 *    ②本関数でも `trim().toLowerCase()` する（`lower()` だけでは前後の空白が落ちないため）
 *    片方だけにすると「呼び出し側が正規化しているか」に正しさが依存し、別の呼び出し元が
 *    大文字混じり / 空白付きで渡した瞬間に、正規の運営者が常に拒否される。
 * 🔴 2 行以上返るのは想定外（`email` は UNIQUE）。fail-closed で `null` にする。
 */
export async function withPlatformAuthLookup(email: string): Promise<PlatformAuthUser | null> {
  return inPlatformAuthScope({ kind: 'EMAIL', value: email.trim().toLowerCase() }, async (tx) => {
    const rows = await tx.platformUser.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        passwordHash: true,
        disabledAt: true,
      },
      take: 2,
    });
    if (rows.length !== 1) return null;
    const row = rows[0] as NonNullable<(typeof rows)[number]>;
    if (!isPlatformRole(row.role)) return null;
    return {
      platformUserId: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      passwordHash: row.passwordHash,
      disabledAt: row.disabledAt,
    };
  });
}

/**
 * セッションの `platformUserId` から、ロールと 2FA の設定状態を DB で確定する。
 *
 * 次のいずれかなら `null`（＝ 認証コンテキストを作らせない）:
 *   - 行が無い（削除済み / 別の主体）
 *   - `disabledAt` が入っている（無効化済み）
 *   - ロールが既知の値集合に無い（CHECK 制約があるので通常起きない）
 *
 * 🔴 呼び出しごとに DB を読む（セッションにロールを焼き込まない）。ロール変更・無効化が
 *    **次のリクエストから**効く。
 */
export async function loadPlatformUserFacts(
  identity: PlatformIdentity,
): Promise<PlatformUserFacts | null> {
  return inPlatformSubjectScope(identity, async (tx) => {
    const rows = await tx.platformUser.findMany({
      select: { role: true, displayName: true, disabledAt: true },
      take: 2,
    });
    if (rows.length !== 1) return null;
    const row = rows[0] as NonNullable<(typeof rows)[number]>;
    if (row.disabledAt !== null) return null;
    if (!isPlatformRole(row.role)) return null;

    const twoFactor = await tx.twoFactorCredential.findFirst({
      where: {
        subjectId: identity.platformUserId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
        confirmedAt: { not: null },
      },
      select: { id: true },
    });

    return {
      role: row.role,
      displayName: row.displayName,
      twoFactorEnrolled: twoFactor !== null,
    };
  });
}

/**
 * 運営者の監査ログを 1 行書く（`F-055 AC-4`）。
 *
 * 🔴 `lastLoginAt` を渡した場合は**同一トランザクション**で `platform_users.last_login_at` も
 *    更新する。記録できなければログインも成立しない（例外がトランザクションを巻き戻す）。
 */
export async function recordPlatformAuditLog(
  identity: PlatformIdentity,
  entry: AuditLogEntry,
  options: { readonly lastLoginAt?: Date } = {},
): Promise<void> {
  await inPlatformSubjectScope(identity, async (tx) => {
    await writePlatformAuditLog(tx, identity, entry);
    if (options.lastLoginAt !== undefined) {
      await tx.platformUser.updateMany({
        where: { id: identity.platformUserId },
        data: { lastLoginAt: options.lastLoginAt },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 2 要素認証（🔴 全 `PlatformUser` に必須。`F-055 AC-3` / `BR-30`）
// ---------------------------------------------------------------------------

/** 🔴 スロットルの母集団となる action（主平面と同じ値。docs/05 §16.1）。 */
export const PLATFORM_TWO_FACTOR_FAILED_AUDIT_ACTION = 'auth.2fa.failed';

/**
 * 🔴 **本人の** 2FA 検証失敗の時刻を、古い順に最大 `limit` 件だけ読む（試行スロットル）。
 *    述語は `action = 'auth.2fa.failed'` かつ `actor_id = 本人` に固定されており、
 *    RLS（`audit_logs_platform_auth_select`）が同じ条件を DB 側でも課す。
 */
export async function readRecentPlatformTwoFactorFailures(
  identity: PlatformIdentity,
  since: Date,
  limit: number,
): Promise<readonly Date[]> {
  const rows = await inPlatformSubjectScope(identity, (tx) =>
    tx.auditLog.findMany({
      where: {
        action: PLATFORM_TWO_FACTOR_FAILED_AUDIT_ACTION,
        actorId: identity.platformUserId,
        createdAt: { gte: since },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
  );
  return rows.map((row) => row.createdAt);
}

/** 本人の資格情報を読む。無ければ `null`。🔴 他人の行は RLS で 1 行も返らない。 */
export async function readPlatformTwoFactorCredential(
  identity: PlatformIdentity,
): Promise<TwoFactorCredentialRow | null> {
  return inPlatformSubjectScope(identity, async (tx) => {
    const row = await tx.twoFactorCredential.findFirst({
      where: {
        subjectId: identity.platformUserId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
      },
      select: { secretEncrypted: true, recoveryCodeHashes: true, confirmedAt: true },
    });
    if (row === null) return null;
    return {
      secretEncrypted: row.secretEncrypted,
      recoveryCodeHashes: row.recoveryCodeHashes,
      confirmedAt: row.confirmedAt,
    };
  });
}

export type PlatformTwoFactorEnrollmentResult =
  | { readonly status: 'STARTED'; readonly accountLabel: string }
  /** 🔴 確認済みの資格情報がある。**上書きしない**（認証器の差し替えを許さない）。 */
  | { readonly status: 'ALREADY_CONFIRMED' };

/**
 * 2FA の登録を開始する。未確認の登録が残っていれば**同じ行を上書きして**作り直す。
 *
 * 🔴 `DELETE` を使わない（`app_platform_write` に `two_factor_credentials` の DELETE を
 *    GRANT しないため。migration 20260904000000）。未確認の行の差し替えは UPDATE で表現する。
 * 🔴 監査ログを**同一トランザクション**で書く（書けなければ登録も成立しない。`F-005`）。
 */
export async function startPlatformTwoFactorEnrollment(
  identity: PlatformIdentity,
  input: TwoFactorEnrollmentInput,
  audit: AuditLogEntry,
): Promise<PlatformTwoFactorEnrollmentResult> {
  return inPlatformSubjectScope(identity, async (tx) => {
    const rows = await tx.platformUser.findMany({ select: { email: true }, take: 2 });
    if (rows.length !== 1) {
      // 呼び出し側が有効な `PlatformUser` を確認した後にしか来ないため、通常は到達しない。
      throw new Error('2 要素認証の登録対象の運営者を読み出せませんでした（前提の破綻）。');
    }
    const accountLabel = (rows[0] as { email: string }).email;

    const existing = await tx.twoFactorCredential.findFirst({
      where: {
        subjectId: identity.platformUserId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
      },
      select: { id: true, confirmedAt: true },
    });
    if (existing !== null && existing.confirmedAt !== null) {
      return { status: 'ALREADY_CONFIRMED' };
    }

    if (existing === null) {
      await tx.twoFactorCredential.create({
        data: {
          subjectType: TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
          subjectId: identity.platformUserId,
          // 🔴 PLATFORM_USER 行は tenant_id を持たない（docs/05 §3.3）。
          tenantId: null,
          secretEncrypted: input.secretEncrypted,
          recoveryCodeHashes: [...input.recoveryCodeHashes],
        },
        select: { id: true },
      });
    } else {
      // 🔴 `confirmedAt: null` を条件に含める（この間に確定した行を上書きしない）。
      const replaced = await tx.twoFactorCredential.updateMany({
        where: { id: existing.id, confirmedAt: null },
        data: {
          secretEncrypted: input.secretEncrypted,
          recoveryCodeHashes: [...input.recoveryCodeHashes],
        },
      });
      if (replaced.count !== 1) return { status: 'ALREADY_CONFIRMED' };
    }

    await writePlatformAuditLog(tx, identity, audit);
    return { status: 'STARTED', accountLabel };
  });
}

/** 登録を確定する（`confirmedAt` の CAS）。既に確定済み・行が無い場合は `false`。 */
export async function confirmPlatformTwoFactorEnrollment(
  identity: PlatformIdentity,
  now: Date,
  audit: AuditLogEntry,
): Promise<boolean> {
  return inPlatformSubjectScope(identity, async (tx) => {
    const updated = await tx.twoFactorCredential.updateMany({
      where: {
        subjectId: identity.platformUserId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
        confirmedAt: null,
      },
      data: { confirmedAt: now },
    });
    if (updated.count !== 1) return false;
    await writePlatformAuditLog(tx, identity, audit);
    return true;
  });
}

/**
 * リカバリコードを 1 つ消費する（残りのハッシュで置き換える）。
 * 🔴 1 回限りの使用を DB の CAS で担保する（消費前のハッシュ配列と一致するときだけ更新）。
 */
export async function consumePlatformRecoveryCode(
  identity: PlatformIdentity,
  previousHashes: readonly string[],
  remainingHashes: readonly string[],
  audit: AuditLogEntry,
): Promise<boolean> {
  return inPlatformSubjectScope(identity, async (tx) => {
    const updated = await tx.twoFactorCredential.updateMany({
      where: {
        subjectId: identity.platformUserId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
        confirmedAt: { not: null },
        recoveryCodeHashes: { equals: [...previousHashes] },
      },
      data: { recoveryCodeHashes: [...remainingHashes] },
    });
    if (updated.count !== 1) return false;
    await writePlatformAuditLog(tx, identity, audit);
    return true;
  });
}
