// packages/db/src/tokens.ts
// 🔴 招待トークン（`Invitation.tokenHash`）とパスワード再設定トークン
//    （`User.passwordResetTokenHash`）の**平文とハッシュの対応を 1 箇所に閉じる**。
//
// ============================================================================
// 🔴 なぜ `packages/db` に置くのか（T-04-05 で `apps/web/lib/auth/tokens.ts` から移設）
// ============================================================================
// 保存されるのは常にハッシュであり、その形式（**SHA-256 の 16 進**）は
// `invitations.token_hash` / `users.password_reset_token_hash` という**列の契約**である
// （docs/05 §3.3 の列コメント）。照合するのも `packages/db`（行由来コンテキスト。§4.4.2）である。
//
// 🔴 決定的だったのは「**再発行する側が `apps/worker` になった**」ことである（docs/05 §8.3 の
//    保留からの復帰手順。T-04-05）。`apps/web` の関数は `apps/worker` から import できない
//    （`CLAUDE.md` §2.1 の依存方向）ため、置き場所が `apps/web` のままだと**ワーカー側に
//    2 つ目のハッシュ実装が生まれる**。2 つが少しでもずれた瞬間、再発行した招待リンクは
//    `withInvitationToken(hashToken(token))` で 1 行も引けず、**リンクが黙って死ぬ**。
//
// 🔴 平文の扱い（`CLAUDE.md` §3.4 / docs/05 §16.2）:
//    - 平文が出るのは「メール本文」と「`sandbox` の招待リンク表示」だけである
//    - DB・ログ・監査ログ・エラー追跡・LLM プロンプトに載せない（redact denylist の `token`）
//    - 保留（`HELD_*`）に入った時点で平文は失われる。だから復帰は再発行でしか行えない

import { createHash, randomBytes } from 'node:crypto';

/**
 * トークンの乱数長（バイト）。
 * 🔴 base64url で 43 文字になる。URL パス（`/invitations/{token}`）に安全に載る文字集合だけを使う。
 */
const TOKEN_BYTES = 32;

/**
 * 推測不能なトークンの平文を作る。
 * 🔴 戻り値をログ・DB・監査ログに渡さない（渡してよいのはメール本文と `sandbox` の画面表示だけ）。
 */
export function generateSecretToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * 平文トークンから保存用のハッシュを作る（SHA-256 の 16 進表現）。
 *
 * 🔴 Argon2id ではない —— トークンは 256 bit の乱数であり総当たりが成立しないため、
 *    要件はストレッチではなく「`token_hash` の `UNIQUE` / 追加 SELECT ポリシーでの完全一致」である。
 */
export function hashSecretToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
