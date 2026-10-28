// apps/web/lib/chat/mention.ts
// ✅ 2026-10-27（紺野の決定「軽い版・DB を変えない」）: 自分宛ての `@名前` の判定（`docs/02` F-038 改訂 13 ⑭ / AC-16）。
//
// 🔴 判定は 1 つ: **本文（引用を除いた、その人が書いた部分）に `@<自分の表示名>` がそのまま含まれるか**（大文字・小文字を区別する）。
//    入力欄の「@」が入れる形（`insertChatMention` = `@名前 `）と同じ。一覧の「@」の印（サーバ）と会話の左の線（画面）が
//    同じこの関数で決める（2 実装にしない）。
// 🔴 引用の冒頭（写し）にある `@名前` は数えない —— 他人の発言を引用しただけで、引用された人に印が付かないように。
// 純粋関数（I/O なし）。
import { splitChatQuote } from './quote';

/** 探す文字列（`@名前`）。名前が空なら `null`（何にも当てない）。 */
export function chatMentionNeedle(displayName: string | null | undefined): string | null {
  const name = displayName?.trim() ?? '';
  return name === '' ? null : `@${name}`;
}

/** この本文が、この名前の人に宛てた `@` を含むか。 */
export function mentionsName(body: string | null | undefined, displayName: string | null | undefined): boolean {
  const needle = chatMentionNeedle(displayName);
  if (needle === null || body == null || body === '') return false;
  return splitChatQuote(body).rest.includes(needle);
}
