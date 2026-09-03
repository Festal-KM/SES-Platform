// apps/web/lib/auth/recovery-codes.test.ts
// 🔴 リカバリコードは「認証器を失った利用者の最後の入口」であり、
//    ①推測できない ②平文を保存しない ③1 回しか使えない の 3 点が要点である。
//    ③の実行時の担保（DB の CAS）は `tests/isolation/two-factor.test.ts` が見る。
//    ここでは「一致したコードの位置を返し、消費後の配列からそれが消える」ことを固定する。
import { describe, expect, it } from 'vitest';
import {
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  withoutIndex,
} from './recovery-codes';

describe('generateRecoveryCodes', () => {
  it('既定で 10 件、重複無しで生成する', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('🔴 紛らわしい文字（I / O / 0 / 1）を含まない（紙に控えて手入力する運用のため）', () => {
    for (const code of generateRecoveryCodes(20)) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  it('呼ぶたびに異なる（乱数であることの対照）', () => {
    expect(generateRecoveryCodes(3)).not.toEqual(generateRecoveryCodes(3));
  });
});

describe('normalizeRecoveryCode', () => {
  it('区切り・空白・大小文字の違いを吸収する', () => {
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode(' ABCDE FGHJK ')).toBe('ABCDEFGHJK');
  });
});

describe('ハッシュ化と照合', () => {
  it('🔴 保存されるのはハッシュだけで、平文が復元できない', async () => {
    const codes = generateRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes);
    expect(hashes).toHaveLength(2);
    for (const [index, hash] of hashes.entries()) {
      // Argon2id の PHC 文字列であり、平文を含まない。
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).not.toContain(normalizeRecoveryCode(codes[index] as string));
    }
  });

  it('表示形式のまま入力しても一致する（正規化が保存時と同じ）', async () => {
    const codes = generateRecoveryCodes(3);
    const hashes = await hashRecoveryCodes(codes);
    expect(await findRecoveryCodeIndex(codes[1] as string, hashes)).toBe(1);
  });

  it('区切りを外した入力・小文字の入力でも一致する', async () => {
    const codes = generateRecoveryCodes(1);
    const hashes = await hashRecoveryCodes(codes);
    const raw = normalizeRecoveryCode(codes[0] as string);
    expect(await findRecoveryCodeIndex(raw.toLowerCase(), hashes)).toBe(0);
  });

  it('一致しないコードは null', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(2));
    expect(await findRecoveryCodeIndex('ZZZZZ-ZZZZZ', hashes)).toBeNull();
  });

  it('空文字・空白のみは null（ハッシュ照合に持ち込まない）', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(1));
    expect(await findRecoveryCodeIndex('   ', hashes)).toBeNull();
  });

  it('壊れたハッシュが混ざっていても例外にせず、他の候補を照合し続ける', async () => {
    const codes = generateRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes);
    const broken = ['not-a-hash', ...hashes];
    expect(await findRecoveryCodeIndex(codes[0] as string, broken)).toBe(1);
  });
});

describe('withoutIndex（消費後に DB へ書き戻す配列）', () => {
  it('🔴 使用した 1 件だけが消える（残りの順序は変わらない）', async () => {
    const codes = generateRecoveryCodes(4);
    const hashes = await hashRecoveryCodes(codes);
    const remaining = withoutIndex(hashes, 2);
    expect(remaining).toHaveLength(3);
    expect(remaining).toEqual([hashes[0], hashes[1], hashes[3]]);
    // 消費したコードは残りの中から見つからない（＝ 2 回目は使えない）。
    expect(await findRecoveryCodeIndex(codes[2] as string, remaining)).toBeNull();
  });
});
