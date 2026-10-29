// apps/web/lib/chat/search.ts
// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑰ / `docs/05` §6.5 #51s）: この会話の中の検索（`GET /api/threads/{id}/messages/search`）。
//
// 🔴 ここが守るもの（レビューの焦点）
//   ① 部屋が読めなければ 404（`findChatThreadRow` + `requireFound`。不存在・他社・他テナント・メンバーでない DM / グループを区別しない）。
//   ② 母集団は `messages` の RLS（C6 / C10）だけ。`where` に置くのは「どの部屋か」「消えていないか」「検索語」と、
//      検査中の他人の添付を除く `chatMessageVisibleWhere`（RLS の二重の守り）だけで、分離キーの条件を書き足さない。
//   ③ 照合は `@ses/db` の `freeWordFilter`（検索の実装の唯一の出所）。引用の見出し・写しだけに当たった発言は除く（`search-text.ts` ①）。
//   ④ 応答は `{ items: [{ messageId, sentAt, senderName, snippet }] }` だけ。🔴 件数（総数・残り）を返さない。
//      本文の全文・添付・送信者の会社・ID 以外の識別子を載せない。
//   ⑤ 閲覧の監査ログは書かない（`read.ts` ⑤ と同じ。`CLAUDE.md` §3.5 の列挙にチャットの閲覧は無い）。
import { freeWordFilter, withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { findChatThreadRow, resolveSenderNames } from './read';
import { chatOwnTextIncludes, chatSearchSnippet } from './search-text';
import { chatMessageVisibleWhere, isChatMessageVisibleToViewer, type ChatMessageSearchHitView } from './views';

/** 返す件数の上限（新しい順）。 */
export const CHAT_IN_ROOM_SEARCH_LIMIT = 50;
/** DB から読む候補の上限（引用だけに当たった発言を除いた後で 50 件に届くよう、多めに読む）。 */
const CHAT_IN_ROOM_SEARCH_CANDIDATES = 200;

export async function searchChatMessages(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  q: string,
): Promise<readonly ChatMessageSearchHitView[]> {
  const needle = q.trim();
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    const rows = await db.message.findMany({
      where: {
        threadId,
        deletedAt: null,
        purgedAt: null,
        body: freeWordFilter(needle),
        AND: [chatMessageVisibleWhere(ctx.userId)],
      },
      select: { id: true, senderUserId: true, body: true, sentAt: true, attachmentContentType: true, attachmentScanStatus: true },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: CHAT_IN_ROOM_SEARCH_CANDIDATES,
    });
    const hits = rows
      .filter((row) => isChatMessageVisibleToViewer(row, ctx.userId) && chatOwnTextIncludes(row.body, needle))
      .slice(0, CHAT_IN_ROOM_SEARCH_LIMIT);
    const names = await resolveSenderNames(db, hits.map((row) => row.senderUserId));
    return hits.map((row) => ({
      messageId: row.id,
      sentAt: row.sentAt.toISOString(),
      senderName: names.get(row.senderUserId) ?? null,
      snippet: chatSearchSnippet(row.body ?? '', needle),
    }));
  });
}
