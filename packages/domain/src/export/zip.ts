// packages/domain/src/export/zip.ts
// 返却データ（CSV 一式）を 1 つの ZIP に束ねる（docs/05 §14.1 `t/{tenantId}/exports/{exportRequestId}/{uuid}.zip`）。T-10-09。
//
// 🔴 依存を持たない最小の ZIP ライタである（`packages/domain` は何にも依存しない。`CLAUDE.md` §2.1）:
//    - 圧縮しない（method 0 = STORE）。CSV は数 MB 程度であり、依存を増やす理由にならない。
//    - ファイル名は UTF-8（general purpose flag bit 11）。返却ファイル名は ASCII だが規格どおり立てる。
//    - 🔴 更新日時は **固定値（1980-01-01 00:00）** にする。`packages/domain` は現在時刻を取らず、
//      同じ入力から同じバイト列が出る（決定的 = テストで固定できる）。
//    - ZIP64 は扱わない（1 エントリ 4 GiB / 65,535 エントリまで。超えたら例外にして黙って壊れた ZIP を出さない）。

import { decodeUtf8, encodeUtf8 } from './utf8.js';

export type ZipEntry = {
  /** アーカイブ内のパス（`engineers.csv` 等。区切りは `/`）。 */
  readonly name: string;
  readonly data: Uint8Array;
};

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;
/** DOS 日時（1980-01-01 00:00:00）。固定値である（上の 🔴）。 */
const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32（IEEE 802.3。ZIP が使うもの）。 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  u16(value: number): void {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.push(bytes);
  }

  u32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.push(bytes);
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let cursor = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}

function assertEntryName(name: string): void {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
    throw new RangeError(`buildZipArchive: 不正なエントリ名です（${name}）。`);
  }
}

/**
 * エントリ列から ZIP のバイト列を作る（STORE。決定的）。
 * 🔴 同名のエントリは例外（展開時にどちらかが黙って上書きされる ZIP を作らない）。
 */
export function buildZipArchive(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_UINT16) throw new RangeError('buildZipArchive: エントリ数が ZIP の上限を超えています。');
  const writer = new ByteWriter();
  const seen = new Set<string>();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    assertEntryName(entry.name);
    if (seen.has(entry.name)) throw new RangeError(`buildZipArchive: エントリ名が重複しています（${entry.name}）。`);
    seen.add(entry.name);
    if (entry.data.length > MAX_UINT32) throw new RangeError(`buildZipArchive: ${entry.name} が 4 GiB を超えています。`);
    const name = encodeUtf8(entry.name);
    if (name.length > MAX_UINT16) throw new RangeError(`buildZipArchive: エントリ名が長すぎます（${entry.name}）。`);
    const crc = crc32(entry.data);
    const offset = writer.offset;

    writer.u32(LOCAL_HEADER_SIGNATURE);
    writer.u16(VERSION_NEEDED);
    writer.u16(FLAG_UTF8_NAMES);
    writer.u16(METHOD_STORE);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(name.length);
    writer.u16(0);
    writer.push(name);
    writer.push(entry.data);

    central.push({ name, crc, size: entry.data.length, offset });
  }

  const centralOffset = writer.offset;
  for (const record of central) {
    writer.u32(CENTRAL_HEADER_SIGNATURE);
    writer.u16(VERSION_MADE_BY);
    writer.u16(VERSION_NEEDED);
    writer.u16(FLAG_UTF8_NAMES);
    writer.u16(METHOD_STORE);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(record.crc);
    writer.u32(record.size);
    writer.u32(record.size);
    writer.u16(record.name.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(record.offset);
    writer.push(record.name);
  }
  const centralSize = writer.offset - centralOffset;
  if (centralSize > MAX_UINT32 || centralOffset > MAX_UINT32) {
    throw new RangeError('buildZipArchive: アーカイブが 4 GiB を超えています。');
  }

  writer.u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralOffset);
  writer.u16(0);

  return writer.toUint8Array();
}

/** 読み取り（テスト用。展開ツールを持ち込まずにエントリ名とサイズを確かめる）。 */
export function listZipEntries(archive: Uint8Array): readonly { readonly name: string; readonly size: number; readonly data: Uint8Array }[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = archive.length - 22;
  if (eocd < 0 || view.getUint32(eocd, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new RangeError('listZipEntries: EOCD が見つかりません。');
  }
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: { name: string; size: number; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) throw new RangeError('listZipEntries: 中央ディレクトリが壊れています。');
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decodeUtf8(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, size, data: archive.subarray(dataStart, dataStart + size) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
