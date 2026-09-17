// packages/domain/src/export/utf8.test.ts
import { describe, expect, it } from 'vitest';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

describe('utf8（TextEncoder を使わない純粋実装）', () => {
  it('ASCII / 2 バイト / 3 バイト（日本語）/ 4 バイト（絵文字）の往復', () => {
    const text = 'a é 山田 太郎 \u{1F600} \uFEFF';
    const bytes = encodeUtf8(text);
    expect([...bytes.subarray(0, 4)]).toEqual([0x61, 0x20, 0xc3, 0xa9]);
    expect(decodeUtf8(bytes)).toBe(text);
  });

  it('孤立サロゲートは U+FFFD に置き換える（壊れたバイト列を出さない）', () => {
    expect(decodeUtf8(encodeUtf8('\ud800x'))).toBe('\ufffdx');
  });
});
