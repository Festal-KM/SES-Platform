// apps/web/lib/chat/export.ts
// ✅ 2026-10-16（チャットレーン）: `S-031` の会話の書き出し（CSV。純粋関数）。#110 ロードマップの 19。
//
// 🔴 Excel で開くことを前提にする: 先頭に BOM（UTF-8 のまま文字化けしない）、改行は CRLF。
// 🔴 数式の差し込み（CSV インジェクション）を防ぐ: `=` `+` `-` `@` とタブ・CR で始まるセルは先頭に `'` を付ける。
// 🔴 入力は RLS を通って読めた発言だけ（`read.ts`）。ここは並べて文字にするだけ。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない。
import { formatDateTimeJst } from '../format/datetime';
import type { ChatMessageView } from './views';

/** 見出し・削除済みの語（`packages/i18n` で解決した値を渡す）。 */
export type ChatExportLabels = {
  readonly sentAt: string;
  readonly sender: string;
  readonly company: string;
  readonly body: string;
  readonly unknownName: string;
  readonly deleted: string;
  readonly purged: string;
};

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** CSV の 1 セル（引用符で囲み、`"` を重ね、数式の差し込みを無害にする）。 */
export function csvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** 会話を CSV にする（古い順）。 */
export function buildThreadCsv(messages: readonly ChatMessageView[], labels: ChatExportLabels): string {
  const header = [labels.sentAt, labels.sender, labels.company, labels.body].map(csvCell).join(',');
  const rows = messages.map((message) =>
    [
      formatDateTimeJst(message.sentAt),
      message.senderName ?? labels.unknownName,
      message.senderCompanyName ?? labels.unknownName,
      message.body ?? (message.deleted === true ? labels.deleted : labels.purged),
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}
