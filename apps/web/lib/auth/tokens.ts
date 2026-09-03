// apps/web/lib/auth/tokens.ts
// 招待トークン（docs/05 §6.3 #6 / #7 / §6.4 #14）とパスワード再設定トークン（#5 / #5b）の
// 生成・ハッシュ化。**平文とハッシュの対応をここ 1 箇所に閉じる。**
//
// 🔴 平文は「メールの本文」と「`sandbox` の招待リンク表示」にしか出ない（CLAUDE.md §3.4）。
//    DB に保存するのは常にハッシュだけであり、監査ログ・構造化ログ・エラーには載せない。
//    `packages/db` の行由来コンテキスト（docs/05 §4.4.2）が受け取るのもハッシュだけである。
//
// 🔴 ハッシュ関数は **SHA-256**（docs/05 §3.3 `Invitation.tokenHash` / `User.passwordResetTokenHash`
//    のコメント）。Argon2id ではない —— トークンは 256 bit の乱数であり総当たりが成立しないため、
//    ストレッチではなく「照合が定数時間で終わる一致検索」（`token_hash` の UNIQUE / 追加 SELECT
//    ポリシーでの完全一致）が要件である。
import { createHash, randomBytes } from 'node:crypto';

/**
 * トークンの乱数長（バイト）。
 * 🔴 base64url で 43 文字になる。URL パス（`/invite/{token}`）に安全に載る文字集合だけを使う。
 */
const TOKEN_BYTES = 32;

/** 推測不能なトークンの平文を作る。🔴 戻り値をログ・DB・監査ログに渡さない。 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** 平文トークンから保存用のハッシュを作る（SHA-256 の 16 進表現）。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
