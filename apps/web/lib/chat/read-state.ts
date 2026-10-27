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
import { freeWordFilter, withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { findChatThreadRow } from './read';
import { mentionsName, chatMentionNeedle } from './mention';
import { chatMessageVisibleWhere } from './views';

/** トランザクションの中の DB（`read.ts` と同じ取り出し方）。 */
type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 並びの中の位置（会話の並び `(sent_at, id)` と同じ）。 */
export type ReadPosition = { readonly sentAt: Date; readonly id: string };

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
 * ✅ 2026-10-26（#166 の 5）: 比べてから書くと、同時の 2 要求（PC とスマホ）で「新 → 旧」の順に書かれて後退していた。
 *    いまは **DB の更新条件で比べる**（今の位置より後ろのときだけ進める）。同じ行を同時に更新すると PostgreSQL は後の側を
 *    待たせ、確定後の行で条件を測り直すので、古い位置の要求は 0 件になる。行がまだ無いときの同時作成は
 *    `ON CONFLICT DO NOTHING`（`createMany` の `skipDuplicates`）で一意制約の競合を吸収してから、同じ条件付き更新に合流する。
 */
export async function markChatRead(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  upToMessageId: string,
): Promise<{ readonly lastReadMessageId: string | null }> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    const target = await requireMessagePosition(db, threadId, upToMessageId);
    // 行が無ければ「まだ何も読んでいない」で作る（ピン留め・ミュートは既定のまま）。既にあれば何もしない。
    await db.chatReadState.createMany({
      data: [{ tenantId: ctx.tenantId, userId: ctx.userId, threadId, lastReadSentAt: null, lastReadMessageId: null }],
      skipDuplicates: true,
    });
    // 🔴 誰の行かは RLS（C7）が決める（`where` に利用者 ID を書き足さない。冒頭の 🔴）。
    await db.chatReadState.updateMany({
      where: {
        threadId,
        OR: [
          { lastReadSentAt: null },
          { lastReadMessageId: null },
          { lastReadSentAt: { lt: target.sentAt } },
          { lastReadSentAt: target.sentAt, lastReadMessageId: { lt: target.id } },
        ],
      },
      data: { lastReadSentAt: target.sentAt, lastReadMessageId: target.id },
    });
    // 進めた・進めなかった（もっと先まで読んでいた）のどちらでも、確定した今の位置を返す。
    const current = await db.chatReadState.findFirst({ where: { threadId }, select: { lastReadMessageId: true } });
    return { lastReadMessageId: current?.lastReadMessageId ?? null };
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

/** スレッドごとに「既読位置より後ろ」の条件（読んでいない部屋は部屋全体）。 */
function afterReadPositionBranches(threadIds: readonly string[], positions: ReadonlyMap<string, ReadPosition | null>) {
  return threadIds.map((threadId) => {
    const position = positions.get(threadId) ?? null;
    return position === null
      ? { threadId }
      : {
          threadId,
          OR: [{ sentAt: { gt: position.sentAt } }, { sentAt: position.sentAt, id: { gt: position.id } }],
        };
  });
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
  const branches = afterReadPositionBranches(threadIds, await readPositions(db, threadIds));
  const groups = await db.message.groupBy({
    by: ['threadId'],
    // ✅ 2026-10-27: 🔴 検査中の他人の添付の発言を数えない（`chatMessageVisibleWhere`。RLS の二重）。
    where: { senderUserId: { not: ctx.userId }, OR: branches, AND: [chatMessageVisibleWhere(ctx.userId)] },
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

/** 自分の表示名（`users` の C8。🔴 利用者 ID は認証コンテキストから）。読めなければ `null`。 */
export async function readViewerDisplayName(ctx: AuthenticatedTenantCtx, db: Pick<TenantDb, 'user'>): Promise<string | null> {
  const me = await db.user.findFirst({ where: { id: ctx.userId }, select: { displayName: true } });
  return me?.displayName ?? null;
}

/** 自分宛ての `@` を探すときに読む発言の上限（未読のうち `@自分` を含む候補。超えた分は見ない）。 */
export const CHAT_MENTION_SCAN_MAX = 500;

/**
 * ✅ 2026-10-27（F-038 ⑭ / AC-16）: 未読の中に自分宛ての `@名前` がある部屋（一覧の「@」の印）。
 *
 * 🔴 返すのは「ある / ない」だけ（部屋の ID の集合）。件数・発言の ID は返さない。
 * 🔴 母集団は未読の数（`countUnread`）と同じ —— `messages` の RLS（C6 / C10）越し・自分以外の発言・既読位置より後ろ・
 *    検査中の他人の添付を除く（`chatMessageVisibleWhere`）。それに「消えていない」と `@自分の表示名` を足すだけ。
 *    `where` に境界（テナント・取引先・メンバー）を書き足さない。
 * 🔴 自分の表示名は認証コンテキストの利用者 ID から引く（入力から受けない）。判定は `mention.ts` の 1 実装
 *    （引用の写しにある `@` は数えない）。DB の照合（`freeWordFilter`）は候補を絞るだけで、最後は同じ関数で確かめる。
 * 🔴 ミュートした部屋も印は付ける（画面が決める）。
 * 呼び出しは 1 回で全部の部屋を見る（部屋ごとに問い合わせない）。
 */
export async function readMentionUnreadThreadIds(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'message' | 'chatReadState'>,
  threadIds: readonly string[],
  /** 自分の表示名（`readViewerDisplayName` で認証コンテキストから引いたもの）。 */
  viewerName: string | null,
): Promise<ReadonlySet<string>> {
  const needle = chatMentionNeedle(viewerName);
  if (threadIds.length === 0 || needle === null) return new Set();
  const branches = afterReadPositionBranches(threadIds, await readPositions(db, threadIds));
  const candidates = await db.message.findMany({
    where: {
      senderUserId: { not: ctx.userId },
      deletedAt: null,
      purgedAt: null,
      // 候補を絞るだけ（大小を区別しない照合。検索の述語は `@ses/db` の 1 実装から取る）。区別は下の `mentionsName` が付ける。
      body: freeWordFilter(needle),
      OR: branches,
      AND: [chatMessageVisibleWhere(ctx.userId)],
    },
    select: { threadId: true, body: true },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: CHAT_MENTION_SCAN_MAX,
  });
  return new Set(candidates.filter((message) => mentionsName(message.body, viewerName)).map((message) => message.threadId));
}
