// apps/web/lib/chat/day-separators.ts
// `S-031` の会話に挟む「日付の区切り」の計算（定義書 §3.12「日付区切り: 中央・24h の pill」）。
//
// 🔴 **純粋関数に閉じる**（`'use client'` の島から呼ばれるため、`@ses/db` / `@ses/i18n` を import しない。
//    `tests/static/client-db-boundary.test.ts`）。
// 🔴 **日付は JST の暦日で切る**（`toJstIsoDay`）。`toISOString().slice(0, 10)` の UTC 切り出しにすると、
//    JST の 0:00〜8:59 の発言が前日の区切りの下に入る（`lib/format/datetime.ts` の注記と同じ理由）。
// 🔴 **並び替えない。** 受け取った順（古い順。`lib/chat/read.ts` が並べて渡す）のまま、
//    日付が変わる位置に区切りを差し込むだけである。
import { toJstIsoDay } from '../format/datetime';
import type { ChatMessageView } from './views';

/** 会話の 1 行。発言か、日付の区切りのどちらか。 */
export type ChatTimelineEntry =
  | { readonly kind: 'day'; readonly day: string }
  | { readonly kind: 'message'; readonly message: ChatMessageView };

/** 解析できない日時はそのまま返す（握りつぶさず、原因が追える形で表示に出す。`formatDateTimeJst` と同じ）。 */
function dayOf(sentAt: string): string {
  const date = new Date(sentAt);
  return Number.isNaN(date.getTime()) ? sentAt : toJstIsoDay(date);
}

/**
 * 発言の列に、JST の日付が変わるたびに区切りを差し込む。
 * 先頭の発言の前にも必ず 1 つ置く（「いつの会話か」を最初の行で分かるようにする）。
 */
export function withDaySeparators(items: readonly ChatMessageView[]): readonly ChatTimelineEntry[] {
  const entries: ChatTimelineEntry[] = [];
  let currentDay: string | null = null;
  for (const message of items) {
    const day = dayOf(message.sentAt);
    if (day !== currentDay) {
      entries.push({ kind: 'day', day });
      currentDay = day;
    }
    entries.push({ kind: 'message', message });
  }
  return entries;
}
