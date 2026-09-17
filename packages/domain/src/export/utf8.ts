// packages/domain/src/export/utf8.ts
// UTF-8 のエンコード / デコード（`packages/domain` の tsconfig は DOM / Node の lib を持たないため `TextEncoder` を使わない）。
// 🔴 純粋関数。サロゲートペアは 1 つの符号位置として扱い、孤立サロゲートは U+FFFD に置き換える（黙って壊れたバイト列を出さない）。

const REPLACEMENT_CHARACTER = 0xfffd;

export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      } else {
        codePoint = REPLACEMENT_CHARACTER;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = REPLACEMENT_CHARACTER;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** BOM を剥がさない（`TextDecoder` の既定と違う。CSV の先頭 BOM の有無をそのまま確かめられるように）。 */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i]!;
    let codePoint: number;
    let width: number;
    if (b0 < 0x80) {
      codePoint = b0;
      width = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      codePoint = ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      width = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      codePoint = ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      width = 3;
    } else {
      codePoint =
        ((b0 & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      width = 4;
    }
    out += String.fromCodePoint(codePoint);
    i += width;
  }
  return out;
}
