// apps/web/lib/chat/announcement-read.ts
// ✅ 2026-10-26（チャットレーン・紺野の決定 2026-10-22）: 部屋のアナウンスを読む（`chat_thread_announcements`。docs/05 §3.7.1）。
// 会話を開くとき（`read.ts` の `readChatScreen`）と、設定・外す・読む API（`announcement.ts`）が同じこの 1 実装を通る。
//
// 🔴 ここが守るもの
//   ① 🔴 **どの部屋のアナウンスが読めるかは RLS が決める**（読み = その部屋が読める。chat_threads の C6 / C10 を EXISTS で通す）。
//      `where` に取引先・メンバーの条件を書き足さない。別の取引先・別のテナント・メンバーでない DM / グループの行は返らない。
//   ② 🔴 **固定した発言も `messages` の RLS 越しに読み直す**（二重）。発言が読めない・別の部屋の発言なら、その部屋のアナウンスは出さない。
//   ③ 🔴 送った本人が消した・保持期限で本文が消えた発言は、本文を出さない（`snippet: null`。帯は「この発言は削除されました」）。
//   ④ 🔴 設定した人は名前だけ（`users` の C8。読めなければ `null`）。利用者 ID を応答に載せない。
//   ⑤ 本モジュールは `read.ts` を import しない（`read.ts` がここを使うため。循環させない）。
import type { withTenant } from '@ses/db';
import { chatAnnouncementView, type ChatAnnouncementView } from './views';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

export type ChatAnnouncementReadDb = Pick<TenantDb, 'chatThreadAnnouncement' | 'message' | 'user'>;

/** 開いている部屋のアナウンス（部屋の ID → アナウンス）。🔴 読めない部屋・アナウンスの無い部屋は載らない。 */
export async function readThreadAnnouncements(
  db: ChatAnnouncementReadDb,
  threadIds: readonly string[],
): Promise<ReadonlyMap<string, ChatAnnouncementView>> {
  const unique = [...new Set(threadIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.chatThreadAnnouncement.findMany({
    where: { threadId: { in: unique } },
    select: { threadId: true, messageId: true, setByUserId: true, setAt: true },
  });
  if (rows.length === 0) return new Map();
  const messages = await db.message.findMany({
    where: { id: { in: rows.map((row) => row.messageId) } },
    select: { id: true, threadId: true, sentAt: true, body: true, deletedAt: true, purgedAt: true },
  });
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.setByUserId))] } },
    select: { id: true, displayName: true },
  });
  const nameById = new Map(users.map((user) => [user.id, user.displayName]));
  const result = new Map<string, ChatAnnouncementView>();
  for (const row of rows) {
    const message = messageById.get(row.messageId);
    // 🔴 ② 読めない発言・別の部屋の発言は出さない（DB の WITH CHECK でも作れないが、読みでも確かめる）。
    if (message === undefined || message.threadId !== row.threadId) continue;
    result.set(
      row.threadId,
      chatAnnouncementView(row, { message, setByName: nameById.get(row.setByUserId) ?? null }),
    );
  }
  return result;
}
