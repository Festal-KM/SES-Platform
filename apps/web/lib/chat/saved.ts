// apps/web/lib/chat/saved.ts
// ✅ 2026-10-22（チャットレーン・紺野）: 発言の「保存済み」（`chat_saved_messages`。docs/05 §3.7.1 / §6.5 #51l）。
// Teams の「保存済み」/ Slack の「後で」にあたる、本人だけの栞。
//
// 🔴 ここが守るもの
//   ① 🔴 **誰の栞が読めるか・どの発言を保存できるかは RLS が決める**（読み = 本人の行 かつ 発言が今も読める /
//      保存 = 本人の行 かつ 発言が読める）。`where` に境界を書き足さない。
//      部屋から外れた・取引先の関係が切れた後は、栞の行そのものが返らない（本文に届く経路を作らない）。
//   ② 🔴 **保存・外すの対象は「このスレッドの、読める発言」だけ**。見えないスレッド・別スレッドの発言・見えない発言は 404
//      （不存在・他社・別スレッドを区別しない。`service.ts` のリアクションと同じ）。
//   ③ 🔴 利用者 ID は認証コンテキストから取る（リクエスト入力から受けない。CLAUDE.md §3.1）。
//   ④ 監査ログに書かない —— 本人だけの栞で、ほかの人には何も見えず、本文も増えない（リアクションより閉じている）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { findChatThreadRow } from './read';
import { messageSnippet } from './thread-tree';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 一覧に出す上限（新しく保存した順）。超えた分は「古い保存は表示していません」と書く。 */
export const CHAT_SAVED_LIST_MAX = 200;
/** 一覧の抜粋の長さ（前後の文字数）。 */
const SAVED_SNIPPET_RADIUS = 80;

/** 保存した発言 1 件（一覧の 1 行）。🔴 部屋の名前は画面が一覧の母集団（RLS 済み）から引く。 */
export type ChatSavedItem = {
  readonly messageId: string;
  readonly threadId: string;
  /** 発言の日時（ISO）。 */
  readonly sentAt: string;
  /** 保存した日時（ISO）。 */
  readonly savedAt: string;
  /** 本文の冒頭。送った本人が消した・保持期限で消えた発言は `null`。 */
  readonly snippet: string | null;
};

export type ChatSavedList = {
  readonly items: readonly ChatSavedItem[];
  /** 上限を超えたので、古い保存を読んでいない。 */
  readonly truncated: boolean;
};

/** 保存した発言の一覧（新しく保存した順）。🔴 今も読める発言の栞だけが返る（RLS）。 */
export async function readSavedList(db: Pick<TenantDb, 'chatSavedMessage' | 'message'>): Promise<ChatSavedList> {
  const saved = await db.chatSavedMessage.findMany({
    select: { messageId: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CHAT_SAVED_LIST_MAX + 1,
  });
  const truncated = saved.length > CHAT_SAVED_LIST_MAX;
  const kept = truncated ? saved.slice(0, CHAT_SAVED_LIST_MAX) : saved;
  if (kept.length === 0) return { items: [], truncated };
  // 🔴 発言は messages の RLS（C6 と人の段）越しに読む。栞が見えても発言が見えなければ載せない（二重）。
  const messages = await db.message.findMany({
    where: { id: { in: kept.map((row) => row.messageId) } },
    select: { id: true, threadId: true, body: true, sentAt: true },
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  const items: ChatSavedItem[] = [];
  for (const row of kept) {
    const message = byId.get(row.messageId);
    if (message === undefined) continue;
    items.push({
      messageId: message.id,
      threadId: message.threadId,
      sentAt: message.sentAt.toISOString(),
      savedAt: row.createdAt.toISOString(),
      snippet: message.body === null ? null : messageSnippet(message.body, '', SAVED_SNIPPET_RADIUS),
    });
  }
  return { items, truncated };
}

/** 画面の入口（`readChatScreen` の外から 1 トランザクションで読む）。 */
export async function readMySavedList(ctx: AuthenticatedTenantCtx): Promise<ChatSavedList> {
  return withTenant(ctx, (db) => readSavedList(db));
}

/** 「このスレッドの、読める発言」か（見えなければ 404）。 */
async function requireVisibleMessage(db: TenantDb, threadId: string, messageId: string): Promise<void> {
  requireFound(await findChatThreadRow(db, threadId));
  requireFound(await db.message.findFirst({ where: { id: messageId, threadId }, select: { id: true } }));
}

/**
 * 発言を保存する（`PUT /api/threads/{id}/messages/{messageId}/save`）。もう保存してあれば何もしない（冪等）。
 * 🔴 同時に 2 回押しても 1 行（一意制約 + `skipDuplicates`）。
 */
export async function saveChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
): Promise<{ readonly saved: true }> {
  return withTenant(ctx, async (db) => {
    await requireVisibleMessage(db, threadId, messageId);
    await db.chatSavedMessage.createMany({
      data: [{ tenantId: ctx.tenantId, userId: ctx.userId, messageId }],
      skipDuplicates: true,
    });
    return { saved: true as const };
  });
}

/** 保存を外す（`DELETE /api/threads/{id}/messages/{messageId}/save`）。保存していなければ何もしない（冪等）。 */
export async function unsaveChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
): Promise<{ readonly saved: false }> {
  return withTenant(ctx, async (db) => {
    await requireVisibleMessage(db, threadId, messageId);
    // `userId` は「自分の栞」を選ぶ条件であり、境界ではない（他人の行は DELETE ポリシーが消させない）。
    await db.chatSavedMessage.deleteMany({ where: { messageId, userId: ctx.userId } });
    return { saved: false as const };
  });
}
