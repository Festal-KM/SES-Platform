// apps/web/lib/auth/password.ts
// パスワードのハッシュ化と検証。
//
// 🔴 アルゴリズムは **Argon2id**（docs/03 §4.9「パスワードのハッシュ: Argon2id（@node-rs/argon2）」/
//    docs/05 §3.3 `User.passwordHash` のコメント）。bcrypt を使わない。
//
// 🔴 平文パスワードは `packages/db` に渡さない（`withInvitationAccept` はハッシュを受け取る）。
//    本モジュールが平文に触れる唯一の場所である。
import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * 🔴 `Algorithm` は `@node-rs/argon2` の **ambient const enum** であり、`isolatedModules`
 *    （ルート tsconfig。docs/03 §5.2）の下では値として参照できない。数値リテラルに
 *    型注釈を付けて 1 箇所に固定する（`Algorithm.Argon2id === 2`）。
 */
const ARGON2ID: Algorithm = 2;

/**
 * Argon2id のパラメータ。
 * OWASP Password Storage Cheat Sheet の推奨（m=19MiB / t=2 / p=1）を基準にした。
 * 🔴 変更するとすべての既存ハッシュの検証コストが変わるため、値は 1 箇所に固定する。
 */
const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * ハッシュとパスワードを照合する。
 *
 * 🔴 例外を投げない。`passwordHash` が壊れている・形式が違う（シードのプレースホルダ等）
 *    場合も **`false`** を返す。理由: 呼び出し側の分岐が「不一致」と「壊れたハッシュ」で
 *    変わると、応答時間や応答内容の差からアカウントの状態を推測できてしまう
 *    （docs/04 §S-001「失敗理由を区別しない」）。
 */
export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * 🔴 **タイミング等化用のダミーハッシュ**（`ARGON2_OPTIONS` と同一パラメータの PHC 文字列）。
 *
 * サインインで「該当する `users` 行が無い」分岐だけ Argon2id の検証を省くと、
 * 応答時間の差から**アカウントの存在**が推測できてしまう
 * （docs/04 §S-001「メールアドレスが存在しないとパスワードが違うを区別しない」の実質的な破れ）。
 * 未知アカウントの分岐でもこの定数に対して 1 回検証を走らせ、3 分岐（未知 / 不一致 / 無効化）の
 * Argon2id 検証回数を 1 回に揃える。
 *
 * 🔴 これはシークレットではない。生成元の平文は乱数（`randomBytes(48)`）であり保持していない。
 *    どの `users` 行にも紐づかないため、この値で認証が成立することはない。
 * 🔴 パラメータ（`m=19456,t=2,p=1`）は `ARGON2_OPTIONS` と一致していなければ意味が無い。
 *    一致は `password.test.ts` が固定する。
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$4NwJ6dGW2vHeD5GesFMXUQ$1uEBOr7AFrKSj0CmJRxP2nEFsMbyW+4oMD8sLcGHiBM';
