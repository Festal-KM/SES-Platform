// apps/web/lib/chat/day-separators.ts
// `S-031` の会話の並び（タイムライン）を組み立てる純粋関数。2026-10-13、チャット担当（Lark 寄せ）。
//
//   - **日付の区切り**（定義書 §3.12「日付区切り: 中央・24h の pill」）を、JST の暦日が変わる位置に差し込む
//   - **同じ人の連続した発言をまとめる**（2 件目以降は名前とアバターを省く。Lark / Slack と同じ）
//   - **時刻は `HH:MM` だけ**にする（日付は区切りが受け持つ）
//
// 🔴 **純粋関数に閉じる**（`'use client'` の島から呼ばれるため、`@ses/db` / `@ses/i18n` を import しない。
//    `tests/static/client-db-boundary.test.ts`）。
// 🔴 **日付と時刻は JST で切る**（`toJstIsoDay`）。`toISOString().slice(0, 10)` の UTC 切り出しにすると、
//    JST の 0:00〜8:59 の発言が前日の区切りの下に入る（`lib/format/datetime.ts` の注記と同じ理由）。
// 🔴 **並び替えない。** 受け取った順（古い順。`lib/chat/read.ts` が並べて渡す）のまま、
//    日付が変わる位置に区切りを差し込むだけである。
import { toJstIsoDay } from '../format/datetime';
import type { ChatMessageView } from './views';

/**
 * 同じ人の発言を 1 つにまとめる間隔の上限（ミリ秒）。これより空いたら、もう一度名前を出す。
 * 5 分 = 「続けて書いた」と読める間隔（Lark / Slack の見え方に合わせた目安）。
 */
export const CONTINUATION_WINDOW_MS = 5 * 60 * 1000;

/** 会話の 1 行。発言か、日付の区切りのどちらか。 */
export type ChatTimelineEntry =
  | { readonly kind: 'day'; readonly day: string }
  | {
      readonly kind: 'message';
      readonly message: ChatMessageView;
      /** 直前の発言と同じ人の続きか（`true` なら名前とアバターを省く）。 */
      readonly continued: boolean;
    };

const JST_TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parse(sentAt: string): Date | null {
  const date = new Date(sentAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 解析できない日時はそのまま返す（握りつぶさず、原因が追える形で表示に出す。`formatDateTimeJst` と同じ）。 */
function dayOf(sentAt: string): string {
  const date = parse(sentAt);
  return date === null ? sentAt : toJstIsoDay(date);
}

/** 発言の時刻を JST の `HH:MM` で返す。解析できなければそのまま返す。 */
export function formatChatTime(sentAt: string): string {
  const date = parse(sentAt);
  if (date === null) return sentAt;
  const parts = JST_TIME_FORMATTER.formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  return `${hour}:${minute}`;
}

/**
 * 同じ人か。🔴 **名前が読めない発言はまとめない**（`senderName` が `null` = 退会・他パートナーの利用者。
 * 「同じ人かどうか分からない」ものを同じ人として畳むと、別人の発言が 1 人の発言に見える）。
 */
function sameSender(a: ChatMessageView, b: ChatMessageView): boolean {
  if (a.senderName === null || b.senderName === null) return false;
  return a.own === b.own && a.senderName === b.senderName && a.senderCompanyName === b.senderCompanyName;
}

/**
 * 発言の列に、JST の日付が変わるたびに区切りを差し込み、同じ人の連続した発言に印を付ける。
 * 先頭の発言の前にも必ず 1 つ区切りを置く（「いつの会話か」を最初の行で分かるようにする）。
 * 日付の区切りをまたいだ発言は、同じ人でも「続き」にしない。
 */
export function withDaySeparators(items: readonly ChatMessageView[]): readonly ChatTimelineEntry[] {
  const entries: ChatTimelineEntry[] = [];
  let currentDay: string | null = null;
  let previous: ChatMessageView | null = null;
  for (const message of items) {
    const day = dayOf(message.sentAt);
    if (day !== currentDay) {
      entries.push({ kind: 'day', day });
      currentDay = day;
      previous = null;
    }
    const continued =
      previous !== null &&
      sameSender(previous, message) &&
      withinWindow(previous.sentAt, message.sentAt);
    entries.push({ kind: 'message', message, continued });
    previous = message;
  }
  return entries;
}

function withinWindow(earlier: string, later: string): boolean {
  const a = parse(earlier);
  const b = parse(later);
  if (a === null || b === null) return false;
  const gap = b.getTime() - a.getTime();
  return gap >= 0 && gap <= CONTINUATION_WINDOW_MS;
}

/**
 * ✅ 2026-10-19（一覧の行を揃える）: 一覧の時刻。今日なら `HH:MM`、今年なら `M/D`、それより前は `YYYY/M/D`（日本時間）。
 * 🔴 `now` は引数で受ける（呼び出し側が時刻を決める。テストで固定できる）。
 */
export function formatListTime(at: string, now: Date): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const jst = (value: Date) => new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const a = jst(date);
  const b = jst(now);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()) {
    return formatChatTime(at);
  }
  const md = `${String(a.getUTCMonth() + 1)}/${String(a.getUTCDate())}`;
  return a.getUTCFullYear() === b.getUTCFullYear() ? md : `${String(a.getUTCFullYear())}/${md}`;
}
