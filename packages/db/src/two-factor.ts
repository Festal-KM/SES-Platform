// packages/db/src/two-factor.ts
// 🔴 `TwoFactorCredential`（docs/05 §3.3 / §6.3 #2 #3 / `F-003 AC-2` / `BR-30`）に触れる唯一の経路。
//
// なぜ `packages/db` に置くか（`recordAuthAuditLog` / `loadTenantMembership` と同じ理由）:
//   ① 2FA の設定・確認は「**まだ `AuthenticatedTenantCtx` を作れない**」局面で必要になる。
//      `OWNER` / `ADMIN` は 2FA 未設定だと `resolveTenantCtx` が 403 を投げる（docs/05 §6.2）ため、
//      `withTenant` を要求すると**設定操作そのものが永久に実行できない**（詰む）。
//   ② かといって「RLS を通らない経路」を作ってはならない。本モジュールは
//      `runInTenantTransaction`（`withTenant` と同一手順）を使い、第 1 防御（RLS）と
//      第 2 防御（Prisma 拡張）の**両方を通す**。
//
// 🔴 汎用の抜け道ではない:
//   - 触れる表は `two_factor_credentials`（+ 監査ログ）だけで、引数に表名・列名・`tenant_id` が無い
//   - 分離キーは `TenantIdentity`（セッション Cookie / `withAuthLookup` が返した行）由来であり、
//     リクエスト入力から来ない（CLAUDE.md §3.1 / `BR-03`）
//   - RLS の **C7 SELF**（`tenant_id = app_tenant_id() AND subject_id = app_actor_user_id()
//     AND subject_type = 'USER'`）により、**本人の 1 行以外は読み書きできない**。
//     他人の 2FA を無効化する・盗み見る経路は DB 側で閉じている
//   - 呼び出し元は `tests/static/auth-db-callers.test.ts` が `apps/web/lib/auth/**` に限定する
//
// 🔴 秘匿値の扱い（CLAUDE.md §3.4 / docs/03 §4.9）:
//   - TOTP シークレットは**暗号化済みの文字列**として受け取る（本モジュールは平文を知らない）
//   - リカバリコードは**ハッシュだけ**を受け取る（平文は保存しない）
//   - どちらも `AuditLog` に載せない（`summary` は件数・種別のみ）
import type { TenantIdentity } from './auth-context.js';
import { writeAuditLog, type AuditLogEntry } from './audit.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * 🔴 テナント平面が触れてよい `subject_type` は `'USER'` だけである
 *    （`'PLATFORM_USER'` の行は `tenant_id IS NULL` であり C7 で不可視。管理平面 T-03-07 の範囲）。
 */
export const TWO_FACTOR_SUBJECT_TYPE_USER = 'USER';

/** `two_factor_credentials` の 1 行（本人の行のみ）。 */
export type TwoFactorCredentialRow = {
  /** 🔴 暗号文（`EncryptedString.toStorageValue()` の形式）。平文ではない。 */
  readonly secretEncrypted: string;
  /** 🔴 Argon2id のハッシュ。平文のリカバリコードは保存しない。 */
  readonly recoveryCodeHashes: readonly string[];
  readonly confirmedAt: Date | null;
};

export type TwoFactorEnrollmentInput = {
  readonly secretEncrypted: string;
  readonly recoveryCodeHashes: readonly string[];
};

export type TwoFactorEnrollmentResult =
  | {
      readonly status: 'STARTED';
      /** 認証アプリに表示するラベル（本人のメールアドレス）。 */
      readonly accountLabel: string;
    }
  /** 🔴 確認済みの資格情報がある。**上書きしない**（パスワードだけを奪った攻撃者に再登録させない）。 */
  | { readonly status: 'ALREADY_CONFIRMED' };

function scopeOf(identity: TenantIdentity) {
  return {
    tenantId: identity.tenantId,
    partnerCompanyId: identity.partnerCompanyId,
    actorUserId: identity.userId,
  };
}

/**
 * 🔴 2FA の検証失敗の監査アクション（`apps/web/lib/auth/two-factor.ts` と同じ値）。
 *    スロットル（試行回数の制限）の母集団はこの action の行である。
 */
export const TWO_FACTOR_FAILED_AUDIT_ACTION = 'auth.2fa.failed';

/**
 * 🔴 **本人の** 2FA 検証失敗の時刻を、古い順に最大 `limit` 件だけ読む
 *    （検証試行のスロットル用。docs/04 §S-001「ロックアウト」）。
 *
 * 🔴 なぜホスト文脈（`partnerCompanyId: null`）で読むのか:
 *    `audit_logs` の `SELECT` は **C2 HOST_ONLY**（docs/05 §4.4）であり、パートナー所属の利用者は
 *    **自分自身の失敗回数すら読めない**。そのまま本人の文脈で数えると、パートナーだけ常に 0 件 ＝
 *    **スロットルが静かに存在しない**ことになる（`CLAUDE.md` §1.2 のとおり取引先は主利用者であり、
 *    そこだけ総当たりが素通りするのは受け入れられない）。
 *
 * 🔴 これがエスケープハッチにならない理由:
 *    ① 引数は「本人の識別情報」と「時刻・件数の上限」だけで、表名・列名・述語・他者の ID を取れない
 *    ② 述語は `action = 'auth.2fa.failed'` かつ `actor_id = 認証済みの本人` に固定されている
 *       （`identity` はセッション由来であり、リクエスト入力から来ない。`CLAUDE.md` §3.1 / `BR-03`）
 *    ③ 戻り値は**時刻の配列だけ**である。他社・他者・業務データは式の上で 1 行も到達できない
 *    ④ テナント境界は通常どおり効く（`app.tenant_id` を設定し、RLS の C2 が `tenant_id` で絞る）
 *    ⑤ 呼び出し元は `tests/static/auth-db-callers.test.ts` が 1 ファイルに固定する
 *
 * ⚠️ 恒久的な解は「`audit_logs` に C7 相当（`action LIKE 'auth.2fa.%' AND actor_id =
 *    app_actor_user_id()`）の自己参照 `SELECT` ポリシーを足す」ことだが、それは docs/05 §4.4 の
 *    クラス割り当ての変更（設計事項）であるため、ここでは行っていない。
 */
export async function readRecentTwoFactorFailures(
  identity: TenantIdentity,
  since: Date,
  limit: number,
): Promise<readonly Date[]> {
  const rows = await runInTenantTransaction(
    {
      tenantId: identity.tenantId,
      partnerCompanyId: null,
      actorUserId: identity.userId,
    },
    (tx) =>
      tx.auditLog.findMany({
        where: {
          action: TWO_FACTOR_FAILED_AUDIT_ACTION,
          actorId: identity.userId,
          createdAt: { gte: since },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
  );
  return rows.map((row) => row.createdAt);
}

/** 本人の資格情報を読む。無ければ `null`。🔴 他人の行は RLS（C7）で 1 行も返らない。 */
export async function readTwoFactorCredential(
  identity: TenantIdentity,
): Promise<TwoFactorCredentialRow | null> {
  return runInTenantTransaction(scopeOf(identity), async (tx) => {
    const row = await tx.twoFactorCredential.findFirst({
      where: { subjectId: identity.userId, subjectType: TWO_FACTOR_SUBJECT_TYPE_USER },
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

/**
 * 2FA の登録を開始する（docs/05 §6.3 #3）。未確認の登録が残っていれば作り直す。
 *
 * 🔴 **確認済みの資格情報があるときは何もしない**（`ALREADY_CONFIRMED`）。
 *    ここで上書きを許すと、パスワードだけを入手した攻撃者が自分の認証器へ差し替えられる
 *    ＝ 2 要素目が無意味になる。解除・再登録は「現在の第 2 要素を提示できる者」だけの操作である。
 * 🔴 監査ログを**同一トランザクション**で書く（`F-005`。書けなければ登録も成立しない）。
 */
export async function startTwoFactorEnrollment(
  identity: TenantIdentity,
  input: TwoFactorEnrollmentInput,
  audit: AuditLogEntry,
): Promise<TwoFactorEnrollmentResult> {
  return runInTenantTransaction(scopeOf(identity), async (tx) => {
    const existing = await tx.twoFactorCredential.findFirst({
      where: { subjectId: identity.userId, subjectType: TWO_FACTOR_SUBJECT_TYPE_USER },
      select: { id: true, confirmedAt: true },
    });
    if (existing !== null && existing.confirmedAt !== null) {
      return { status: 'ALREADY_CONFIRMED' };
    }

    // 認証アプリのラベル用（本人の行。C8 DIRECTORY で自分の行は読める）。
    const user = await tx.user.findFirst({
      where: { id: identity.userId },
      select: { email: true },
    });
    if (user === null) {
      // 呼び出し側が有効な `Membership` を確認した後にしか来ないため、通常は到達しない。
      throw new Error('2 要素認証の登録対象の利用者を読み出せませんでした（前提の破綻）。');
    }

    if (existing !== null) {
      // 未確認の登録は破棄して作り直す（`@@unique([subjectType, subjectId])`）。
      await tx.twoFactorCredential.deleteMany({ where: { id: existing.id } });
    }

    await tx.twoFactorCredential.create({
      data: {
        subjectType: TWO_FACTOR_SUBJECT_TYPE_USER,
        subjectId: identity.userId,
        secretEncrypted: input.secretEncrypted,
        recoveryCodeHashes: [...input.recoveryCodeHashes],
      },
      select: { id: true },
    });

    await writeAuditLog(tx, audit);
    return { status: 'STARTED', accountLabel: user.email };
  });
}

/**
 * 登録を確定する（`confirmedAt` の CAS）。既に確定済み・行が無い場合は `false`。
 * 🔴 CAS（`confirmedAt: null` を条件にした `updateMany`）で二重確定を DB レベルで排除する。
 */
export async function confirmTwoFactorEnrollment(
  identity: TenantIdentity,
  now: Date,
  audit: AuditLogEntry,
): Promise<boolean> {
  return runInTenantTransaction(scopeOf(identity), async (tx) => {
    const updated = await tx.twoFactorCredential.updateMany({
      where: {
        subjectId: identity.userId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_USER,
        confirmedAt: null,
      },
      data: { confirmedAt: now },
    });
    if (updated.count !== 1) return false;
    await writeAuditLog(tx, audit);
    return true;
  });
}

/**
 * リカバリコードを 1 つ消費する（残りのハッシュで置き換える）。
 *
 * 🔴 **1 回限りの使用を DB の CAS で担保する**（`recovery_code_hashes` が消費前と一致するときだけ更新）。
 *    同じコードでの同時実行は片方だけが成功し、もう片方は 0 件更新 ＝ `false` になる。
 *    アプリ側の「照合してから書き戻す」だけでは、並行リクエストで同じコードを 2 回使える。
 */
export async function consumeRecoveryCode(
  identity: TenantIdentity,
  previousHashes: readonly string[],
  remainingHashes: readonly string[],
  audit: AuditLogEntry,
): Promise<boolean> {
  return runInTenantTransaction(scopeOf(identity), async (tx) => {
    const updated = await tx.twoFactorCredential.updateMany({
      where: {
        subjectId: identity.userId,
        subjectType: TWO_FACTOR_SUBJECT_TYPE_USER,
        confirmedAt: { not: null },
        recoveryCodeHashes: { equals: [...previousHashes] },
      },
      data: { recoveryCodeHashes: [...remainingHashes] },
    });
    if (updated.count !== 1) return false;
    await writeAuditLog(tx, audit);
    return true;
  });
}
