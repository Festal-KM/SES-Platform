// apps/web/lib/chat/screen-query.ts
// `S-031` の URL（純粋関数 + Zod）。
//
// 🔴 **スレッドの選択を URL に載せる**（`/chat?thread=<id>`）。理由は 2 つ:
//   ① 共有・再読込・戻るで同じ会話に戻れる（`S-005` / `S-015` の検索条件が URL に載るのと同じ規律）。
//   ② 動的ルート（`/chat/[id]`）を作らないため、**`/chat` が静的ルートのまま**になり、
//      ナビの到達集合（`tests/static/nav-reach.test.ts`）に 1 件として現れる。
// 🔴 **壊れた値は素の `/chat` へ戻す**（握り潰して `undefined` 扱いにしない。`S-019` と同じ判断）。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない（クライアントの島からも呼べる）。
import { PAGE_CURSOR_MAX_LENGTH } from '@ses/config';
import { z } from 'zod';
import { isChatThreadCursor } from './thread-cursor';

export const CHAT_PATH = '/chat';

/** 選択中のスレッド。 */
export const CHAT_THREAD_PARAM = 'thread';
/** スレッド一覧のカーソル（会話のカーソルは URL に載せない = 島が `fetch` で追う）。 */
export const CHAT_THREADS_CURSOR_PARAM = 'threads';

/**
 * 🔴 **形だけを受ける**（形が違えば `safeParse` が失敗し、画面は素の `/chat` へ戻す）。
 *    形の妥当な ID が母集団に無ければ「見えない」= 一覧へ戻す（`docs/05` §4.8）。
 *  - `thread` … スレッドの行の UUID
 *  - `threads` … 🔴 **スレッド一覧の複合カーソル**（`thread-cursor.ts`。UUID ではない）
 */
export const chatScreenQuerySchema = z.object({
  [CHAT_THREAD_PARAM]: z.uuid().optional(),
  [CHAT_THREADS_CURSOR_PARAM]: z
    .string()
    .trim()
    .min(1)
    .max(PAGE_CURSOR_MAX_LENGTH)
    .refine(isChatThreadCursor)
    .optional(),
});

export type ChatScreenQuery = z.infer<typeof chatScreenQuerySchema>;

/** `/chat` の URL を組む（空のクエリを付けない）。 */
export function chatHref(input: {
  readonly thread?: string | null;
  readonly threadsCursor?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.thread !== null && input.thread !== undefined) params.set(CHAT_THREAD_PARAM, input.thread);
  if (input.threadsCursor !== null && input.threadsCursor !== undefined) {
    params.set(CHAT_THREADS_CURSOR_PARAM, input.threadsCursor);
  }
  const query = params.toString();
  return query === '' ? CHAT_PATH : `${CHAT_PATH}?${query}`;
}

/** 会話の取得・投稿先（`docs/05` §6.5 #50 / #51）。🔴 画面に URL を書き写さない。 */
export function chatMessagesApiPath(threadId: string): string {
  return `/api/threads/${threadId}/messages`;
}
