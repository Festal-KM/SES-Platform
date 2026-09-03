// apps/web/lib/auth/tokens.test.ts
// 🔴 招待 / パスワード再設定トークンの性質を固定する（CLAUDE.md §3.4）。
//    ここが崩れると「推測できるトークン」「DB に平文が残る」のどちらかになる。
import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './tokens';

describe('generateToken', () => {
  it('URL パスに載せられる文字だけを使う（base64url）', () => {
    for (let index = 0; index < 32; index += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('🔴 32 バイトの乱数（base64url で 43 文字）である', () => {
    expect(generateToken()).toHaveLength(43);
  });

  it('🔴 呼ぶたびに違う値になる（連番・時刻由来にしない）', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('hashToken', () => {
  it('SHA-256 の 16 進表現（64 文字）を返す', () => {
    expect(hashToken('token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じトークンからは同じハッシュが出る（完全一致の照合に使える）', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('🔴 ハッシュに平文が含まれない（DB に残るのはこちらだけ）', () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it('1 文字違えば別のハッシュになる', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('既知ベクタ（SHA-256("abc")）と一致する', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
