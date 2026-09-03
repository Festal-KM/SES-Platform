// packages/db/src/crypto.test.ts
// docs/05 §8.6 / docs/03 §4.4 / `BR-25` / CLAUDE.md §3.4。
//
// 🔴 ここで固定するのは 3 点である:
//   ① AAD（スコープ ID + 列名）が違えば復号できない ＝ **暗号文を別の行・別の列へコピーしても無効**
//   ② 鍵が違えば復号できない / ローテーション中は旧鍵でも読める
//   ③ `toString` / `toJSON` / inspect が `'[REDACTED]'` を返す ＝ **ログに平文も暗号文も出ない**
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  configureTokenEncryption,
  EncryptedString,
  TokenEncryptionError,
} from './crypto.js';

// テスト専用のダミー鍵（32 バイト）。実運用の値ではない。
const KEY_1 = Buffer.alloc(32, 1).toString('base64');
const KEY_2 = Buffer.alloc(32, 2).toString('base64');

const AAD = { scopeId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', column: 'totp_secret' };
const SECRET = 'JBSWY3DPEHPK3PXP';

function useKey1(): void {
  configureTokenEncryption({ key: KEY_1, keyId: 'k1' });
}

describe('EncryptedString（AES-256-GCM）', () => {
  it('往復して元の平文に戻る', () => {
    useKey1();
    const encrypted = EncryptedString.encrypt(SECRET, AAD);
    expect(encrypted.decrypt(AAD)).toBe(SECRET);
  });

  it('保存形式は `v1:{keyId}:{iv}:{ct}:{tag}` である', () => {
    useKey1();
    const stored = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    const parts = stored.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toBe('k1');
    expect(Buffer.from(parts[2] as string, 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[4] as string, 'base64')).toHaveLength(16);
  });

  it('🔴 同じ平文でも毎回異なる暗号文になる（IV が毎回変わる）', () => {
    useKey1();
    const a = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    const b = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    expect(a).not.toBe(b);
  });

  it('🔴 暗号文に平文が現れない', () => {
    useKey1();
    expect(EncryptedString.encrypt(SECRET, AAD).toStorageValue()).not.toContain(SECRET);
  });

  it('🔴 スコープ ID が違うと復号できない（他人の行へコピーしても読めない）', () => {
    useKey1();
    const stored = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    expect(() =>
      EncryptedString.fromStorageValue(stored).decrypt({ ...AAD, scopeId: 'other-subject' }),
    ).toThrow(TokenEncryptionError);
  });

  it('🔴 列名が違うと復号できない（同じ行の別列へコピーしても読めない）', () => {
    useKey1();
    const stored = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    expect(() =>
      EncryptedString.fromStorageValue(stored).decrypt({ ...AAD, column: 'other_column' }),
    ).toThrow(TokenEncryptionError);
  });

  it('🔴 鍵が違うと復号できない', () => {
    useKey1();
    const stored = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    configureTokenEncryption({ key: KEY_2, keyId: 'k1' });
    expect(() => EncryptedString.fromStorageValue(stored).decrypt(AAD)).toThrow(
      TokenEncryptionError,
    );
  });

  it('ローテーション中は旧鍵の暗号文も復号できる（新鍵で書き、旧鍵で読む）', () => {
    useKey1();
    const oldCiphertext = EncryptedString.encrypt(SECRET, AAD).toStorageValue();

    configureTokenEncryption({ key: KEY_2, keyId: 'k2', previous: `k1:${KEY_1}` });
    expect(EncryptedString.fromStorageValue(oldCiphertext).decrypt(AAD)).toBe(SECRET);
    // 新規の書き込みは新鍵 ID になる。
    expect(EncryptedString.encrypt(SECRET, AAD).toStorageValue().split(':')[1]).toBe('k2');
  });

  it('🔴 旧鍵を外した後は、旧鍵 ID の暗号文を復号できない（黙って null にしない）', () => {
    useKey1();
    const oldCiphertext = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    configureTokenEncryption({ key: KEY_2, keyId: 'k2' });
    expect(() => EncryptedString.fromStorageValue(oldCiphertext).decrypt(AAD)).toThrow(
      TokenEncryptionError,
    );
  });

  it.each([
    ['区切りが足りない', 'v1:k1:aaa'],
    ['未知のバージョン', 'v2:k1:aaa:bbb:ccc'],
    ['IV の長さが不正', `v1:k1:${Buffer.alloc(4).toString('base64')}:AA:${Buffer.alloc(16).toString('base64')}`],
  ])('🔴 壊れた保存値（%s）は読み込み時点で例外にする', (_label, stored) => {
    useKey1();
    expect(() => EncryptedString.fromStorageValue(stored)).toThrow(TokenEncryptionError);
  });

  it('🔴 改竄された暗号文は復号に失敗する（GCM の認証タグ）', () => {
    useKey1();
    const parts = EncryptedString.encrypt(SECRET, AAD).toStorageValue().split(':');
    const tampered = Buffer.from(parts[3] as string, 'base64');
    tampered[0] = (tampered[0] as number) ^ 0xff;
    parts[3] = tampered.toString('base64');
    expect(() => EncryptedString.fromStorageValue(parts.join(':')).decrypt(AAD)).toThrow(
      TokenEncryptionError,
    );
  });
});

describe('🔴 ログ・エラーへ漏れない（docs/03 §4.4 の「denylist が漏れたときの保険」）', () => {
  it('toString / toJSON / JSON.stringify / inspect のすべてが [REDACTED]', () => {
    useKey1();
    const encrypted = EncryptedString.encrypt(SECRET, AAD);
    expect(String(encrypted)).toBe('[REDACTED]');
    expect(encrypted.toJSON()).toBe('[REDACTED]');
    expect(JSON.stringify({ secretEncrypted: encrypted })).toBe(
      '{"secretEncrypted":"[REDACTED]"}',
    );
    expect(inspect(encrypted)).toContain('[REDACTED]');
    expect(inspect({ secretEncrypted: encrypted })).not.toContain(SECRET);
  });

  it('例外メッセージに平文・暗号文・鍵を含めない', () => {
    useKey1();
    const stored = EncryptedString.encrypt(SECRET, AAD).toStorageValue();
    try {
      EncryptedString.fromStorageValue(stored).decrypt({ ...AAD, column: 'wrong' });
      throw new Error('復号が成功してしまいました（前提の破綻）。');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(stored);
      expect(message).not.toContain(KEY_1);
    }
  });
});

describe('鍵の設定', () => {
  it('🔴 32 バイトでない鍵は受け付けない', () => {
    expect(() =>
      configureTokenEncryption({ key: Buffer.alloc(16).toString('base64'), keyId: 'k1' }),
    ).toThrow(TokenEncryptionError);
    useKey1(); // 後続テストのために正しい鍵へ戻す。
  });

  it('🔴 旧鍵の形式（`{keyId}:{base64}`）が不正なら例外にする', () => {
    expect(() =>
      configureTokenEncryption({ key: KEY_1, keyId: 'k2', previous: KEY_1 }),
    ).toThrow(TokenEncryptionError);
    useKey1();
  });
});
