// packages/domain/src/export/csv.ts
// 返却データ（`F-064 AC-5` / docs/05 §9.6 `export.generate`）の CSV エンコード。T-10-09。
//
// 🔴 RFC 4180 に従う（区切り `,` / 行末 `\r\n` / `"` `,` 改行を含むセルは `"` で囲み `"` は `""`）。
//    先頭に UTF-8 BOM を置く（Excel が UTF-8 と認識するため。返却先は SES 企業の管理部門であり Excel で開く）。
// 🔴 値の整形はここで閉じる: `null` → 空セル、`boolean` → `true` / `false`、数値 → `String()`、
//    `Date` は受け取らない（呼び出し側が ISO 8601 の文字列にしてから渡す。`packages/domain` は時刻を扱わない）。

export type CsvCell = string | number | boolean | null;

const UTF8_BOM = '﻿';
const NEEDS_QUOTING = /[",\r\n]/;

function encodeCell(cell: CsvCell): string {
  if (cell === null) return '';
  const text = typeof cell === 'string' ? cell : String(cell);
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * ヘッダ 1 行 + データ行を CSV 文字列にする。
 * 🔴 各行の列数はヘッダと一致しなければならない（ずれた行を黙って詰めない —— 列がずれた CSV は
 *    「返却したが復元できない」データになる）。
 */
export function encodeCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(encodeCell).join(',')];
  rows.forEach((row, index) => {
    if (row.length !== header.length) {
      throw new RangeError(`encodeCsv: ${index + 1} 行目の列数（${row.length}）がヘッダ（${header.length}）と一致しません。`);
    }
    lines.push(row.map(encodeCell).join(','));
  });
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
