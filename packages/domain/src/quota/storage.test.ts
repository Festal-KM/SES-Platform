// packages/domain/src/quota/storage.test.ts
// docs/05 §8.7 / §14.2 / docs/03 §4.5。T-05-04。
import { describe, expect, it } from 'vitest';
import { decideStorageUpload } from './storage.js';

const GB = 1024n * 1024n * 1024n;

describe('decideStorageUpload（ストレージ上限。docs/03 §4.5）', () => {
  it('余裕があれば ALLOW（残量は発行後の値）', () => {
    expect(
      decideStorageUpload({ limitBytes: 10n * GB, usedBytes: 2n * GB, requestedBytes: 1n * GB }),
    ).toEqual({ kind: 'ALLOW', remainingBytes: 7n * GB });
  });

  it('🔴 現在使用量 + 要求サイズが上限を超えたら BLOCK（現在使用量だけで判定しない）', () => {
    expect(
      decideStorageUpload({
        limitBytes: 10n * GB,
        usedBytes: 10n * GB - 1n,
        requestedBytes: 2n,
      }),
    ).toEqual({ kind: 'BLOCK', reason: 'STORAGE' });
  });

  it('上限ちょうどは許す（超過の定義は「上限を超えたとき」）', () => {
    expect(
      decideStorageUpload({ limitBytes: 10n * GB, usedBytes: 9n * GB, requestedBytes: 1n * GB }),
    ).toEqual({ kind: 'ALLOW', remainingBytes: 0n });
  });

  it('すでに上限に達していれば、どんなに小さい要求でも BLOCK', () => {
    expect(
      decideStorageUpload({ limitBytes: 10n * GB, usedBytes: 10n * GB, requestedBytes: 1n }),
    ).toEqual({ kind: 'BLOCK', reason: 'STORAGE' });
  });

  it('🔴 Number の安全整数を超える値でも正しく比べる（bigint で扱う）', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    expect(
      decideStorageUpload({ limitBytes: huge, usedBytes: huge - 1n, requestedBytes: 1n }),
    ).toEqual({ kind: 'ALLOW', remainingBytes: 0n });
    expect(
      decideStorageUpload({ limitBytes: huge, usedBytes: huge - 1n, requestedBytes: 2n }),
    ).toEqual({ kind: 'BLOCK', reason: 'STORAGE' });
  });

  it.each([
    ['limitBytes が 0', { limitBytes: 0n, usedBytes: 0n, requestedBytes: 1n }],
    ['requestedBytes が 0', { limitBytes: 1n * GB, usedBytes: 0n, requestedBytes: 0n }],
    ['usedBytes が負', { limitBytes: 1n * GB, usedBytes: -1n, requestedBytes: 1n }],
  ])('🔴 前提が壊れた入力は例外にする（%s。0 件や ALLOW に丸めない）', (_label, input) => {
    expect(() => decideStorageUpload(input)).toThrow(RangeError);
  });
});
