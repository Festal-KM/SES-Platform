// apps/web/lib/chat/search-text.ts
// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑰）: 会話の中の検索の、本文の扱い（純粋関数）。
//
// 🔴 ここが守るもの
//   ① 当たりを決めるのは**その人が書いた部分だけ**（引用の見出し `> 引用 [名前](chat-message:…)` と写した冒頭は除く）。
//      引用の見出しに入った名前・写しの文で当たると、「その人が書いていない言葉」で発言が見つかってしまう。
//   ② 冒頭（snippet）は当たった箇所の前後だけ・60 文字ほど。引用の行は出さない。
//   ③ DB の照合は `@ses/db` の `freeWordFilter`（検索の実装の唯一の出所。`search-sql-single-path.test.ts`）で候補を絞り、
//      ここでは候補を確かめるだけ（`lib/chat/mention.ts` と同じ作法）。
import { chatOwnText } from './quote';
import { messageSnippet } from './thread-tree';

/** 冒頭の長さの目安（前後の「…」を除く）。 */
export const CHAT_SEARCH_SNIPPET_MAX = 60;

/** その人が書いた部分に検索語が含まれるか（大文字小文字を区別しない）。空の語は当たらない。 */
export function chatOwnTextIncludes(body: string | null, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase('ja');
  if (body === null || needle === '') return false;
  return chatOwnText(body).toLocaleLowerCase('ja').includes(needle);
}

/** 当たった箇所の前後だけの冒頭（引用は除く。改行は空白に畳む）。 */
export function chatSearchSnippet(body: string, q: string): string {
  const needle = q.trim();
  const radius = Math.max(8, Math.floor((CHAT_SEARCH_SNIPPET_MAX - [...needle].length) / 2));
  return messageSnippet(chatOwnText(body), needle, radius);
}
