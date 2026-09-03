// apps/web/lib/auth/recovery-codes.ts
// 2 要素認証のリカバリコード（docs/03 §4.9「リカバリコードはハッシュ（Argon2id）で保存し、
// 平文を保持しない」/ docs/05 §3.3 `TwoFactorCredential.recoveryCodeHashes`）。
//
// 🔴 平文は**生成した瞬間に 1 度だけ利用者へ返す**。DB にも監査ログにもログにも残さない。
// 🔴 ハッシュは `password.ts` の Argon2id をそのまま使う（パラメータの出所を 1 箇所に保つ）。
// 🔴 1 回限りの使用は、消費後のハッシュ配列を DB の CAS で書き戻すことで担保する
//    （`consumeRecoveryCode`。packages/db）。ここは「どれに一致したか」を返すだけである。
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

/** 発行数。認証器を失った利用者が、再設定に到達するまでに十分な数。 */
export const RECOVERY_CODE_COUNT = 10;
/** 1 コードあたりの文字数（32 種 × 10 文字 = 50 ビット）。 */
const RECOVERY_CODE_LENGTH = 10;
/** 表示上の区切り位置（`XXXXX-XXXXX`）。 */
const RECOVERY_CODE_GROUP = 5;
/**
 * 🔴 紛らわしい文字（`I` `O` `0` `1`）を除いた 32 文字。
 *    紙に控えて手入力する運用のため、読み間違いを構造的に減らす。
 */
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * 入力の正規化。🔴 **保存時（ハッシュ化）と照合時で必ず同じ関数を通す。**
 * 片方だけ正規化すると「表示どおりに入力したのに一致しない」になる。
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

function randomCode(): string {
  let code = '';
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    // 🔴 `randomInt` は偏りの無い一様乱数（`Math.random()` を使わない）。
    code += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)];
  }
  return code;
}

/** 表示用に整形する（`XXXXX-XXXXX`）。照合時は `normalizeRecoveryCode` で戻す。 */
function format(code: string): string {
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += RECOVERY_CODE_GROUP) {
    groups.push(code.slice(index, index + RECOVERY_CODE_GROUP));
  }
  return groups.join('-');
}

/** 🔴 平文のリカバリコードを生成する。戻り値は**この 1 回だけ**利用者に見せる。 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): readonly string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomCode());
  return [...codes].map(format);
}

/** 平文コードを Argon2id でハッシュ化する（保存されるのはこれだけ）。 */
export async function hashRecoveryCodes(codes: readonly string[]): Promise<readonly string[]> {
  return Promise.all(codes.map((code) => hashPassword(normalizeRecoveryCode(code))));
}

/**
 * 入力コードに一致するハッシュの位置を返す（無ければ `null`）。
 * 🔴 一致・不一致のいずれでも例外を投げない（`verifyPassword` が壊れたハッシュを `false` にする）。
 */
export async function findRecoveryCodeIndex(
  input: string,
  hashes: readonly string[],
): Promise<number | null> {
  const normalized = normalizeRecoveryCode(input);
  if (normalized === '') return null;
  for (let index = 0; index < hashes.length; index += 1) {
    const hash = hashes[index];
    if (hash === undefined) continue;
    if (await verifyPassword(normalized, hash)) return index;
  }
  return null;
}

/** 消費済みの 1 件を除いたハッシュ配列（DB へ CAS で書き戻す値）。 */
export function withoutIndex(
  hashes: readonly string[],
  index: number,
): readonly string[] {
  return hashes.filter((_, position) => position !== index);
}
