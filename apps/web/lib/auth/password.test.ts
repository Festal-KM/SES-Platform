// apps/web/lib/auth/password.test.ts
// docs/03 §4.9「パスワードのハッシュ: Argon2id（@node-rs/argon2）」。
//
// 🔴 `verifyPassword` が**例外を投げない**ことを固定する。壊れたハッシュ（シードの
//    プレースホルダ等）で例外になると、その 1 件だけ 500 が返り「そのアカウントは存在する」
//    ことが観測できてしまう（docs/04 §S-001「失敗理由を区別しない」）。
import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';

const PASSWORD = 'T-03-01 unit test passphrase';

describe('hashPassword / verifyPassword', () => {
  it('Argon2id の PHC 文字列を返す', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('同じパスワードでも毎回ハッシュが変わる（ソルトが効いている）', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it('正しいパスワードは検証に成功する', async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it('誤ったパスワードは false', async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(`${PASSWORD}!`, hash)).resolves.toBe(false);
  });

  it('🔴 壊れたハッシュでも例外にせず false を返す', async () => {
    await expect(verifyPassword(PASSWORD, 'seed:not-a-real-password-hash')).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, '')).resolves.toBe(false);
  });
});

describe('🔴 DUMMY_PASSWORD_HASH（未知アカウント分岐の応答時間を等化する定数）', () => {
  it('hashPassword が生成するものと同一パラメータの Argon2id PHC 文字列である', async () => {
    // 🔴 パラメータが ARGON2_OPTIONS とずれると検証コストが変わり、等化の意味が消える。
    //    実際に hashPassword が吐く接頭辞と突き合わせる（値の二重管理をしない）。
    const generated = await hashPassword(PASSWORD);
    const prefixOf = (phc: string): string => phc.split('$').slice(0, 4).join('$');
    expect(prefixOf(DUMMY_PASSWORD_HASH)).toBe(prefixOf(generated));
    expect(prefixOf(DUMMY_PASSWORD_HASH)).toBe('$argon2id$v=19$m=19456,t=2,p=1');
  });

  it('どんなパスワードでも検証に成功しない（この定数でログインできない）', async () => {
    await expect(verifyPassword(PASSWORD, DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPassword('', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});
