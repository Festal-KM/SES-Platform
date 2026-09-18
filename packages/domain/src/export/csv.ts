// packages/domain/src/export/csv.ts
// 返却データ（`F-064 AC-5` / docs/05 §9.6 `export.generate`）の CSV エンコード。T-10-09。
//
// 🔴 RFC 4180 に従う（区切り `,` / 行末 `\r\n` / `"` `,` 改行を含むセルは `"` で囲み `"` は `""`）。
//    先頭に UTF-8 BOM を置く（Excel が UTF-8 と認識するため。返却先は SES 企業の管理部門であり Excel で開く）。
// 🔴 値の整形はここで閉じる: `null` → 空セル、`boolean` → `true` / `false`、数値 → `String()`、
//    `Date` は受け取らない（呼び出し側が ISO 8601 の文字列にしてから渡す。`packages/domain` は時刻を扱わない）。
// 🔴 T-12-17 ⑲ (a)（[Issue #68](https://github.com/Festal-KM/SES-Platform/issues/68)）: **CSV 数式注入の無害化**。返却先は
//    Excel で開く管理部門であり、先頭が `=` / `+` / `-` / `@` / タブ / CR の文字列セルは数式として評価されうる
//    （`=HYPERLINK(...)` / `=cmd|...` 等）。文字列セルだけを対象に先頭へ `'` を前置する（`sanitizeCsvCellText`。純粋関数）。
//    **値そのものは変えない**（元の文字は 1 文字も落とさない・置き換えない。`'` はスプレッドシートが「文字列」の
//    印として読む接頭辞であり、復元は先頭 1 文字を落とすだけ）。数値・真偽値・`null` は対象外（負数 `-1` を `'-1` にしない）。

export type CsvCell = string | number | boolean | null;

const UTF8_BOM = '﻿';
const NEEDS_QUOTING = /[",\r\n]/;
/** 数式として評価されうる先頭文字（OWASP「CSV Injection」の 6 文字）。 */
const FORMULA_LEADING = /^[=+\-@\t\r]/;

/**
 * 文字列セルの数式注入を無害化する（純粋関数）。先頭が `=` / `+` / `-` / `@` / `\t` / `\r` なら `'` を前置し、
 * それ以外はそのまま返す。🔴 引用・エスケープはここでは行わない（`encodeCell` が後段で RFC 4180 の引用を掛ける）。
 */
export function sanitizeCsvCellText(text: string): string {
  return FORMULA_LEADING.test(text) ? `'${text}` : text;
}

function encodeCell(cell: CsvCell): string {
  if (cell === null) return '';
  const text = typeof cell === 'string' ? sanitizeCsvCellText(cell) : String(cell);
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
