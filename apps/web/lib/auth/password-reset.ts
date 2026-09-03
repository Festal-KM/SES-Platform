// apps/web/lib/auth/password-reset.ts
// docs/05 §6.3 #5（`POST /api/auth/password-reset`）/ #5b（`.../confirm`）。`F-003`。
//
// 🔴 **アカウントの存在を漏らさない**（docs/05 §6.3 #5「存在有無を返さない」/ §4.8）。
//    発行の応答は常に 204 であり、戻り値も「送ったかどうか」を呼び出し側に返さない。
//
// 🔴 未認証経路なので、触れてよいのは docs/05 §4.4.2 の行由来コンテキストだけである
//    （`withPasswordResetIssue` / `withPasswordResetConfirm`）。分離キーはメール / トークン照合で
//    得た `users` の行から来る（CLAUDE.md §3.1）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`credentials.ts` / `two-factor.ts` と同じ方針）。
import { PASSWORD_RESET_TTL_MS } from '@ses/config';
import {
  withPasswordResetConfirm,
  withPasswordResetIssue,
  type AuditLogEntry,
} from '@ses/db';
import type { AuthAttemptMeta } from './credentials';
import { hashPassword } from './password';
import { generateToken, hashToken } from './tokens';
import { requireAccountMailQueue } from '../jobs/account-mail';

/** docs/05 §16.1 の `auth.*` に倣ったパスワード再設定の監査アクション。 */
export const PASSWORD_RESET_AUDIT_ACTIONS = {
  requested: 'auth.password_reset_requested',
  completed: 'auth.password_reset_completed',
} as const;

function auditEntry(
  action: string,
  userId: string,
  meta: AuthAttemptMeta,
): AuditLogEntry {
  return {
    action,
    actorKind: 'USER',
    actorId: userId,
    targetType: 'User',
    targetId: userId,
    // 🔴 メールアドレス（PII）・トークン（平文もハッシュも）を入れない（docs/05 §16.2）。
    summary: {},
    ipAddress: meta.ipAddress,
    deviceKind: meta.deviceKind,
  };
}

/**
 * パスワード再設定を申し込む（docs/05 §6.3 #5）。
 *
 * 🔴 戻り値を持たない。**「該当した / しなかった」を呼び出し側に渡さない**ため、
 *    応答の出し分けが実装上できない（docs/04 §S-001 と同じ規律）。
 *
 * 応答時間の等化（`credentials.ts` の `DUMMY_PASSWORD_HASH` と同じ考え方）:
 *   - トークンの生成とハッシュ化は**分岐の前**に必ず 1 回行う。
 *   - `withPasswordResetIssue` は該当の有無にかかわらずトランザクションを開き、
 *     同じ `SET LOCAL` と同じ SELECT を実行する。
 *   - 残差: 該当したときだけ `UPDATE` + 監査ログ + enqueue のぶん遅い。これは
 *     「該当が無ければ書くものが無い」という構造から来るもので、書き込みを足して
 *     揃えることはできない（`credentials.ts` に記した残差と同種）。
 */
export async function requestPasswordReset(
  email: string,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<void> {
  // 🔴 キューの有無は**メール照合の前**に確かめる。後ろに置くと「該当したときだけ 500 になる」
  //    ＝ 応答がアカウントの存在を教える（docs/05 §4.8 / §6.3 #5）。
  const queue = requireAccountMailQueue();

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

  const issued = await withPasswordResetIssue(email, {
    tokenHash,
    expiresAt,
    buildAudit: (subject) =>
      auditEntry(PASSWORD_RESET_AUDIT_ACTIONS.requested, subject.userId, meta),
  });
  if (issued === null) return;

  // 🔴 平文トークンはここ（payload = Redis）にしか渡らない。DB にはハッシュだけがある。
  await queue.enqueue({
    tenantId: issued.tenantId,
    kind: 'PASSWORD_RESET',
    targetId: issued.userId,
    token,
  });
}

/**
 * パスワード再設定を確定する（docs/05 §6.3 #5b）。
 *
 * 🔴 トークン列の CAS で**1 回限り**。期限切れ・不一致・使用済みはすべて `null` を返し、
 *    呼び出し側は 400 に写像する（理由を区別しない）。
 */
export async function confirmPasswordReset(
  token: string,
  password: string,
  meta: AuthAttemptMeta,
  now: Date = new Date(),
): Promise<{ readonly userId: string } | null> {
  const passwordHash = await hashPassword(password);
  return withPasswordResetConfirm(hashToken(token), {
    passwordHash,
    now,
    buildAudit: (subject) =>
      auditEntry(PASSWORD_RESET_AUDIT_ACTIONS.completed, subject.userId, meta),
  });
}
