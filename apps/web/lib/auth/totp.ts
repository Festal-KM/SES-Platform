// apps/web/lib/auth/totp.ts
// TOTP（RFC 6238 / HOTP は RFC 4226）の計算。docs/03 §4.9「2FA は TOTP を自前で上乗せする」。
//
// 🔴 外部 API を呼ばない。**ローカル計算だけ**である（時刻同期も行わない。ずれは検証窓で吸収する）。
// 🔴 `node:crypto` の HMAC-SHA1 だけを使い、TOTP 用の外部ライブラリを導入していない。
//    docs/03 §4.9 は `otpauth` を挙げているが、本タスクで必要なのは RFC 4226 の
//    「HMAC → 動的切り詰め → 10^digits の剰余」だけであり（下の `hotpCode`）、
//    正しさは **RFC 6238 の公式テストベクタ**（`totp.test.ts`）で固定できる。
//    依存を 1 つ増やさない代わりに、実装の正しさを仕様の試験値で担保する方を選んだ。
//    ⚠️ ライブラリ採用へ戻す判断が要る場合は `docs/03` §4.9 の更新（CLAUDE.md §8.7）を先に行う。
//
// 🔴 純粋関数として書く（現在時刻を内部で読まない。`at: Date` を引数で受ける）。
//    検証窓の境界をテストで固定できるようにするため。
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 認証アプリ（Google Authenticator / 1Password 等）の既定に合わせる。 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = 'SHA1';
/**
 * 前後に許容するステップ数。🔴 1（= ±30 秒）に留める。
 * 広げるほど「盗み見たコードが使える時間」が延びる。
 */
export const TOTP_VERIFY_WINDOW_STEPS = 1;
/** シークレットの長さ（RFC 4226 は 128 ビット以上、SHA-1 では 160 ビットを推奨）。 */
const SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type TotpOptions = {
  readonly periodSeconds?: number;
  readonly digits?: number;
};

/** RFC 4648 の base32（パディング無し。otpauth URL の `secret` の形式）。 */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** base32 を復号する。🔴 不正な文字が 1 つでもあれば例外（黙って読み飛ばさない）。 */
export function base32Decode(encoded: string): Buffer {
  const normalized = encoded.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('base32 として解釈できない文字が含まれています。');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 新しい TOTP シークレット（base32）。🔴 暗号論的乱数（`randomBytes`）を使う。 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

function counterBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

/** RFC 4226 の HOTP。動的切り詰め（dynamic truncation）まで含む。 */
function hotpCode(secret: Buffer, counter: number, digits: number): string {
  const digest = createHmac('sha1', secret).update(counterBuffer(counter)).digest();
  // 最終バイトの下位 4 ビットがオフセット（RFC 4226 §5.3）。
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** 時刻 `at` におけるステップ番号（RFC 6238 の T）。 */
export function totpStep(at: Date, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  return Math.floor(at.getTime() / 1000 / periodSeconds);
}

/** 時刻 `at` に有効なコードを計算する。 */
export function totpCode(secret: string, at: Date, options: TotpOptions = {}): string {
  const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const digits = options.digits ?? TOTP_DIGITS;
  return hotpCode(base32Decode(secret), totpStep(at, periodSeconds), digits);
}

/** 入力コードの正規化（利用者は空白やハイフンを入れて貼り付けることがある）。 */
export function normalizeTotpInput(code: string): string {
  return code.replace(/[\s-]/g, '');
}

/**
 * コードを検証する。
 *
 * 🔴 比較は `timingSafeEqual`（応答時間から桁の一致数を推測させない）。
 * 🔴 検証窓は前後 `TOTP_VERIFY_WINDOW_STEPS` ステップに限る。
 * 🔴 桁数・文字種が合わない入力は**計算せずに拒否**する（数値以外を剰余計算に持ち込まない）。
 *
 * ⚠️ 同一ステップ内でのコード再利用（リプレイ）は本実装では検知できない。
 *    検知するには「最後に受理したステップ番号」を保存する列が要るが、docs/05 §3.3 の
 *    `TwoFactorCredential` に該当列が無い（`code-reviewer` / `pm` への申し送り）。
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  at: Date,
  options: TotpOptions & { readonly windowSteps?: number } = {},
): boolean {
  const digits = options.digits ?? TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const windowSteps = options.windowSteps ?? TOTP_VERIFY_WINDOW_STEPS;
  const candidate = normalizeTotpInput(code);
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return false;

  const secretBytes = base32Decode(secret);
  const currentStep = totpStep(at, periodSeconds);
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  let matched = false;
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const expected = Buffer.from(hotpCode(secretBytes, currentStep + offset, digits), 'utf8');
    // 🔴 早期 return しない（一致したステップ位置を応答時間に出さない）。
    if (
      expected.length === candidateBuffer.length &&
      timingSafeEqual(expected, candidateBuffer)
    ) {
      matched = true;
    }
  }
  return matched;
}

export type OtpauthUrlInput = {
  readonly secret: string;
  /** 認証アプリに表示される利用者の識別名（本人のメールアドレス）。 */
  readonly accountLabel: string;
  /** 発行者名（プロダクト名。`packages/i18n` の `product.name`）。 */
  readonly issuer: string;
};

/**
 * `otpauth://` URL を組み立てる（Key Uri Format）。
 * 🔴 この URL はシークレットを含む。**ログ・監査ログ・エラーに出さない**（本人の画面にのみ返す）。
 */
export function buildOtpauthUrl(input: OtpauthUrlInput): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountLabel)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: TOTP_ALGORITHM,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
