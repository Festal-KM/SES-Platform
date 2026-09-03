// packages/db/src/crypto.ts
// 🔴 秘匿値の暗号化（docs/05 §8.6 / docs/03 §4.4 / BR-25 / CLAUDE.md §3.4）。
//    保存形式 `v1:{keyId}:{iv}:{ct}:{tag}`（AES-256-GCM）。**この 1 箇所以外で暗号化しない。**
//
// 🔴 平文が `console.log` / Sentry / `AuditLog` / LLM プロンプトに出る事故を、**キー名に頼らずに**
//    防ぐ（docs/03 §4.4 の回避策）。`EncryptedString` は値そのものを外へ出す経路を持たず、
//    `toString()` / `toJSON()` / Node の inspect のいずれも `'[REDACTED]'` を返す。
//    復号は `decrypt(aad)` の**明示的な呼び出しだけ**である。
//
// 🔴 AAD（追加認証データ）に「スコープ ID + 列名」を入れる。これにより、**ある行の暗号文を
//    別の行へコピーしても復号に失敗する**（DB を直接触られたときの横展開を防ぐ）。
//    docs/05 §8.6 の署名は `{ tenantId, column }` だが、`two_factor_credentials` だけは
//    docs/05 §3.3 の列コメントが `AAD = subjectId + 'totp_secret'` を指定している。両者を満たすため
//    第 1 要素を `scopeId`（テナント ID または主体 ID）として一般化した。理由は 2 つある:
//      ① `two_factor_credentials` は `PLATFORM_USER` 行が `tenant_id IS NULL`（docs/05 §3.3）であり、
//         テナント ID を AAD にできない行が構造上存在する
//      ② 同一テナント内の別利用者の行へ暗号文をコピーする攻撃を、`subjectId` なら防げる
//         （テナント ID では防げない）＝ **より強い側に倒している**
//
// 🔴 鍵は `packages/config` が検証した値を**起動時に注入**する（`configureTokenEncryption`）。
//    ここで `process.env` を読まない（client.ts と同じ規律。CLAUDE.md §3.5）。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 保存形式のバージョン。復号は既知のバージョンだけを受け付ける（未知は失敗させる）。 */
const FORMAT_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FIELD_SEPARATOR = ':';
const REDACTED = '[REDACTED]';

/**
 * 🔴 暗号化・復号の AAD。
 * - `scopeId`: 既定はテナント ID。`two_factor_credentials` は主体 ID（docs/05 §3.3）
 * - `column`: 列名（同じ行の別列の暗号文を入れ替えられないようにする）
 */
export type EncryptionAad = {
  readonly scopeId: string;
  readonly column: string;
};

export type TokenEncryptionOptions = {
  /** `TOKEN_ENCRYPTION_KEY`（32 バイトの base64）。 */
  readonly key: string;
  /** `TOKEN_ENCRYPTION_KEY_ID`（`k1` 形式）。 */
  readonly keyId: string;
  /** `TOKEN_ENCRYPTION_KEY_PREVIOUS`（`{keyId}:{base64}`。ローテーション中のみ）。 */
  readonly previous?: string | undefined;
};

/**
 * 🔴 暗号化・復号の失敗。**原因に暗号文・鍵・平文を含めない**（docs/05 §15.2 の denylist に
 *    頼らず、メッセージの組み立て時点で持たせない）。
 */
export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptionError';
  }
}

type EncryptionKey = { readonly keyId: string; readonly key: Buffer };
type KeyRing = { readonly current: EncryptionKey; readonly previous: EncryptionKey | null };

let keyRing: KeyRing | undefined;

function decodeKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new TokenEncryptionError(
      `暗号鍵の長さが不正です（${KEY_BYTES} バイトの base64 が必要です）。`,
    );
  }
  return key;
}

function parsePreviousKey(value: string): EncryptionKey {
  const separator = value.indexOf(FIELD_SEPARATOR);
  const keyId = separator === -1 ? '' : value.slice(0, separator);
  if (keyId === '') {
    throw new TokenEncryptionError(
      'TOKEN_ENCRYPTION_KEY_PREVIOUS の形式が不正です（`{keyId}:{base64}`）。',
    );
  }
  return { keyId, key: decodeKey(value.slice(separator + 1)) };
}

/**
 * 起動時に 1 度だけ呼ぶ（`configureTenantDb` と同じ初期化経路）。
 * 🔴 呼ばれていない状態で暗号化・復号を行うと例外になる（黙って素通ししない）。
 */
export function configureTokenEncryption(options: TokenEncryptionOptions): void {
  keyRing = {
    current: { keyId: options.keyId, key: decodeKey(options.key) },
    previous: options.previous === undefined ? null : parsePreviousKey(options.previous),
  };
}

function getKeyRing(): KeyRing {
  if (keyRing === undefined) {
    throw new TokenEncryptionError(
      'configureTokenEncryption() が呼ばれていません。起動時に packages/config の TOKEN_ENCRYPTION_KEY で 1 度だけ初期化してください。',
    );
  }
  return keyRing;
}

/** 復号に使う鍵を選ぶ。🔴 現行鍵 → 旧鍵の順（ローテーション中は両方で復号できる）。 */
function keyForDecryption(keyId: string): Buffer {
  const ring = getKeyRing();
  if (ring.current.keyId === keyId) return ring.current.key;
  if (ring.previous !== null && ring.previous.keyId === keyId) return ring.previous.key;
  throw new TokenEncryptionError(
    '暗号文の鍵 ID が現行鍵・旧鍵のいずれとも一致しません（鍵の設定漏れ、またはローテーション未完了）。',
  );
}

function aadBuffer(aad: EncryptionAad): Buffer {
  return Buffer.from(`${aad.scopeId}${FIELD_SEPARATOR}${aad.column}`, 'utf8');
}

type ParsedCiphertext = {
  readonly keyId: string;
  readonly iv: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
};

function parseStored(stored: string): ParsedCiphertext {
  const parts = stored.split(FIELD_SEPARATOR);
  if (parts.length !== 5) {
    throw new TokenEncryptionError('暗号文の形式が不正です（`v1:{keyId}:{iv}:{ct}:{tag}`）。');
  }
  const [version, keyId, iv, ciphertext, authTag] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== FORMAT_VERSION) {
    throw new TokenEncryptionError('暗号文の形式バージョンが未知です。');
  }
  if (keyId === '') {
    throw new TokenEncryptionError('暗号文に鍵 ID がありません。');
  }
  const ivBuffer = Buffer.from(iv, 'base64');
  const authTagBuffer = Buffer.from(authTag, 'base64');
  if (ivBuffer.length !== IV_BYTES || authTagBuffer.length !== AUTH_TAG_BYTES) {
    throw new TokenEncryptionError('暗号文の IV または認証タグの長さが不正です。');
  }
  return {
    keyId,
    iv: ivBuffer,
    ciphertext: Buffer.from(ciphertext, 'base64'),
    authTag: authTagBuffer,
  };
}

/**
 * 🔴 暗号化された文字列（docs/05 §8.6）。
 *
 * - 値を取り出せるのは `decrypt(aad)` だけ。AAD が一致しなければ復号は失敗する
 * - `toString()` / `toJSON()` / Node の inspect は `'[REDACTED]'`。**ログ・エラー・監査ログ・
 *   LLM プロンプトに平文が出ない**（CLAUDE.md §3.4）
 * - DB へ保存する文字列は `toStorageValue()` でのみ取り出す（暗号文であり平文ではない）
 */
export class EncryptedString {
  readonly #stored: string;

  private constructor(stored: string) {
    this.#stored = stored;
  }

  /** 平文を暗号化する。🔴 IV は毎回生成する（同じ平文でも同じ暗号文にならない）。 */
  static encrypt(plain: string, aad: EncryptionAad): EncryptedString {
    const ring = getKeyRing();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, ring.current.key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(aadBuffer(aad));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return new EncryptedString(
      [
        FORMAT_VERSION,
        ring.current.keyId,
        iv.toString('base64'),
        ciphertext.toString('base64'),
        authTag.toString('base64'),
      ].join(FIELD_SEPARATOR),
    );
  }

  /** DB から読んだ保存文字列を包む（この時点では復号しない）。 */
  static fromStorageValue(stored: string): EncryptedString {
    parseStored(stored); // 🔴 形式の検証だけを先に行う（壊れた値を持ち回らない）。
    return new EncryptedString(stored);
  }

  /**
   * 復号する。🔴 AAD（スコープ ID + 列名）が暗号化時と一致しなければ失敗する
   *    ＝ 他の行・他の列からコピーされた暗号文は復号できない。
   */
  decrypt(aad: EncryptionAad): string {
    const parsed = parseStored(this.#stored);
    const decipher = createDecipheriv(ALGORITHM, keyForDecryption(parsed.keyId), parsed.iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(aadBuffer(aad));
    decipher.setAuthTag(parsed.authTag);
    try {
      return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // 🔴 原因（暗号文・鍵・AAD の値）を例外に載せない。
      throw new TokenEncryptionError('復号に失敗しました（鍵または AAD が一致しません）。');
    }
  }

  /** 🔴 DB へ保存する暗号文。平文ではない。 */
  toStorageValue(): string {
    return this.#stored;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  /** 🔴 `console.log(value)` / pino のオブジェクト展開でも平文・暗号文を出さない。 */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
