// apps/web/lib/chat/read-state.ts
// ✅ 2026-10-16（チャットレーン）: `S-031` の既読・未読（`chat_read_states`。CLAUDE.md §4.1 `ChatReadState`）。
//
// 設計案: docs/chat-lane/read-state-proposal.md。
//
// 🔴 この表の RLS は **C7 SELF**（本人の行だけ）。`where` に利用者 ID の条件を書き足さない —— 誰の行かを
//    決めるのは RLS であり、アプリの `where` ではない（`read.ts` の ① と同じ規律）。書くときの `userId` は
//    **認証コンテキスト**から取る（リクエスト入力から受けない。CLAUDE.md §3.1）。
// 🔴 指定された発言は「このスレッドの、読める発言」でなければ 404（不存在・他社・別スレッドを区別しない）。
// 🔴 監査ログに書かない（チャットの閲覧は記録の対象外。CLAUDE.md §3.5 / BR-27）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { findChatThreadRow } from './read';

/** トランザクションの中の DB（`read.ts` と同じ取り出し方）。 */
type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 並びの中の位置（会話の並び `(sent_at, id)` と同じ）。 */
export type ReadPosition = { readonly sentAt: Date; readonly id: string };

/** `a` が `b` より後ろか。 */
export function isAfterPosition(a: ReadPosition, b: ReadPosition | null): boolean {
  if (b === null) return true;
  if (a.sentAt.getTime() !== b.sentAt.getTime()) return a.sentAt.getTime() > b.sentAt.getTime();
  return a.id > b.id;
}

type Db = Pick<TenantDb, 'chatThread' | 'message' | 'chatReadState'>;

/** このスレッドの、読める発言の位置（無ければ 404）。 */
async function requireMessagePosition(db: Db, threadId: string, messageId: string): Promise<ReadPosition> {
  const message = requireFound(
    await db.message.findFirst({ where: { id: messageId, threadId }, select: { id: true, sentAt: true } }),
  );
  return { sentAt: message.sentAt, id: message.id };
}

async function writePosition(
  ctx: AuthenticatedTenantCtx,
  db: Db,
  threadId: string,
  position: ReadPosition | null,
): Promise<void> {
  const data = {
    lastReadSentAt: position?.sentAt ?? null,
    lastReadMessageId: position?.id ?? null,
  };
  await db.chatReadState.upsert({
    where: { tenantId_userId_threadId: { tenantId: ctx.tenantId, userId: ctx.userId, threadId } },
    create: { tenantId: ctx.tenantId, userId: ctx.userId, threadId, ...data },
    update: data,
  });
}

/**
 * ここまで読んだ（`PUT /api/threads/{id}/read`）。
 * 🔴 **戻す方向には動かさない**（古い画面からの送信で既読が巻き戻らないように）。
 */
export async function markChatRead(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  upToMessageId: string,
): Promise<{ readonly lastReadMessageId: string | null }> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    const target = await requireMessagePosition(db, threadId, upToMessageId);
    const current = await db.chatReadState.findFirst({
      where: { threadId },
      select: { lastReadSentAt: true, lastReadMessageId: true },
    });
    const currentPosition =
      current?.lastReadSentAt != null && current.lastReadMessageId != null
        ? { sentAt: current.lastReadSentAt, id: current.lastReadMessageId }
        : null;
    if (!isAfterPosition(target, currentPosition)) {
      return { lastReadMessageId: currentPosition?.id ?? null };
    }
    await writePosition(ctx, db, threadId, target);
    return { lastReadMessageId: target.id };
  });
}

/**
 * この発言から未読にする（`PUT /api/threads/{id}/unread`）。既読位置を「この発言の 1 つ前」に戻す。
 */
export async function markChatUnread(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  fromMessageId: string,
): Promise<{ readonly lastReadMessageId: string | null }> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    const from = await requireMessagePosition(db, threadId, fromMessageId);
    const previous = await db.message.findFirst({
      where: {
        threadId,
        OR: [{ sentAt: { lt: from.sentAt } }, { sentAt: from.sentAt, id: { lt: from.id } }],
      },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { id: true, sentAt: true },
    });
    const position = previous === null ? null : { sentAt: previous.sentAt, id: previous.id };
    await writePosition(ctx, db, threadId, position);
    return { lastReadMessageId: position?.id ?? null };
  });
}

/** 読み手の既読位置（スレッドごと。行が無ければ入らない）。🔴 RLS（C7）が本人の行だけを返す。 */
export async function readPositions(
  db: Pick<TenantDb, 'chatReadState'>,
  threadIds: readonly string[],
): Promise<ReadonlyMap<string, ReadPosition | null>> {
  if (threadIds.length === 0) return new Map();
  const rows = await db.chatReadState.findMany({
    where: { threadId: { in: [...threadIds] } },
    select: { threadId: true, lastReadSentAt: true, lastReadMessageId: true },
  });
  return new Map(
    rows.map((row) => [
      row.threadId,
      row.lastReadSentAt !== null && row.lastReadMessageId !== null
        ? { sentAt: row.lastReadSentAt, id: row.lastReadMessageId }
        : null,
    ]),
  );
}

/**
 * スレッドごとの未読の件数（**自分以外**の発言で、既読位置より後ろのもの）。
 * 🔴 数えるのは `messages` の RLS（C6）越し —— 読めない発言は数に入らない。
 */
export async function countUnread(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'message' | 'chatReadState'>,
  threadIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (threadIds.length === 0) return new Map();
  const positions = await readPositions(db, threadIds);
  const branches = threadIds.map((threadId) => {
    const position = positions.get(threadId) ?? null;
    return position === null
      ? { threadId }
      : {
          threadId,
          OR: [{ sentAt: { gt: position.sentAt } }, { sentAt: position.sentAt, id: { gt: position.id } }],
        };
  });
  const groups = await db.message.groupBy({
    by: ['threadId'],
    where: { senderUserId: { not: ctx.userId }, OR: branches },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.threadId, group._count._all]));
}

/** ✅ 2026-10-16: 自分の表示の設定（ピン留め・ミュート）。行が無ければどちらも偽。 */
export type ChatThreadPrefs = { readonly pinned: boolean; readonly muted: boolean };

/** 読み手のピン留め・ミュート（スレッドごと）。🔴 RLS（C7）が本人の行だけを返す。 */
export async function readThreadPrefs(
  db: Pick<TenantDb, 'chatReadState'>,
  threadIds: readonly string[],
): Promise<ReadonlyMap<string, ChatThreadPrefs>> {
  if (threadIds.length === 0) return new Map();
  const rows = await db.chatReadState.findMany({
    where: { threadId: { in: [...threadIds] } },
    select: { threadId: true, pinned: true, muted: true },
  });
  return new Map(rows.map((row) => [row.threadId, { pinned: row.pinned, muted: row.muted }]));
}

/**
 * ✅ 2026-10-16: ピン留め・ミュートを変える（`PUT /api/threads/{id}/prefs`）。既読位置は変えない。
 * 🔴 スレッドが見えなければ 404。誰の行かは RLS（C7）が決め、利用者 ID は認証コンテキストから。
 */
export async function setChatThreadPrefs(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  input: { readonly pinned?: boolean | undefined; readonly muted?: boolean | undefined },
): Promise<ChatThreadPrefs> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    const data = {
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.muted === undefined ? {} : { muted: input.muted }),
    };
    const row = await db.chatReadState.upsert({
      where: { tenantId_userId_threadId: { tenantId: ctx.tenantId, userId: ctx.userId, threadId } },
      create: { tenantId: ctx.tenantId, userId: ctx.userId, threadId, ...data },
      update: data,
      select: { pinned: true, muted: true },
    });
    return { pinned: row.pinned, muted: row.muted };
  });
}
