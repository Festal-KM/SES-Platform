// apps/web/lib/chat/service.ts
// `POST /api/threads/{id}/messages`（`docs/05` §6.5 #51 / `F-038` / `docs/04` §S-031「操作と結果」）。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **投稿先の母集団は読みと同じ 1 実装**（`findChatThreadRow`）。見えないスレッドへの投稿は
//      **404**（`requireFound`）であり、403 と書き分けない（`docs/05` §4.8。書き分けると
//      「参加していないスレッドが実在すること」を応答から探れる）。RLS（C6）の `WITH CHECK` が
//      最後の砦として同じ判定をもう一度行う（二重防御）。
//   ② 🔴 **`owner_partner_company_id` を利用者入力から決めない。** 値はスレッド行（RLS で見えた行）
//      から取り、DB 側では継承トリガ `messages_inherit_owner`
//      （`20260903070000_owner_counterparty_inheritance`）が `chat_threads.partner_company_id` で
//      上書きする。したがってアプリが誤った値を渡しても**行は常に正しい会社に属する**。
//   ③ 🔴 **`senderPartnerCompanyId` は `ctx` から取る**（`CLAUDE.md` §3.1。リクエスト入力に
//      そのキーが存在しないことは `schemas.ts` の `AssertNoIsolationKeys` が型で固定する）。
//   ④ 🔴 **添付を受け取らない。** `CLAUDE.md` §3.4「ウイルススキャンが `CLEAN` になるまで共有 URL を
//      発行しない」/ §3.3「チャット添付は `ReviewGate` を通す」の配線が無い状態で口を開けない。
//      🔴 **本文だけの投稿にゲートは無い** —— §3.3 の列挙は「チャット**添付**」であり、
//      `Message.reviewGateId` も schema で「添付があるときのみ」と宣言されている。
//   ⑤ 🔴 **監査ログは業務トランザクションの中で書く**（`writeAuditLog`）。`withApiRoute` の `audit`
//      オプションはハンドラの**前**に別トランザクションで書くため、404 で**起きなかった投稿**まで
//      記録に残る（`skill_sheet.create` / `skill_alias.update` と同じ判断）。
//      🔴 `summary` に**本文を載せない**（`docs/05` §16.2「チャット本文を入れない」）。載せるのは
//      スレッドの ID と本文の長さだけである。
//   ⑥ 🔴 **二重送信を作らない。** 本操作は外部送信ではなく自テナント DB への 1 行の INSERT であり、
//      §3.4 の `idempotency_key` + CAS の射程（外部 API を呼ぶジョブ）には当たらない。
//      連打の抑止は画面側の `createSubmitGuard` が行う。
//   ⑦ ✅ 2026-10-23（紺野）: 🔴 **案件を貼る（`projectId`）ときは、貼れるかを同じトランザクションで確かめる**
//      （送る人が RLS で読める・部屋に取引先がいればその取引先に公開中。`project-cards.ts` の ②）。
//      満たさなければ理由を書き分けずに 400。部屋の取引先は RLS で読めた部屋の行から取る（リクエストから受けない）。
import { withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { NotFoundError, requireFound } from '../api/errors';
import { CHAT_MESSAGE_SELECT, findChatThreadRow, projectChatMessages } from './read';
import { summarizeReactions, type ChatReactionKind, type ChatReactionSummary } from './views';
import { requirePastableProject } from './project-cards';
import type { ChatMessageBody, ChatMessagePostBody } from './schemas';
import type { ChatMessageRow, ChatMessageView } from './views';

/** 🔴 `docs/05` §16.1 の `*.create`（`S-041` の操作種別フィルタは接尾辞一致）。独自 action を作らない。 */
export const CHAT_MESSAGE_AUDIT_ACTION_CREATE = 'message.create';

/** 🔴 `audit_logs.target_type` は状態機械・エンティティ名の表記（PascalCase。`docs/05` §16.1 の 🔴）。 */
export const CHAT_MESSAGE_AUDIT_TARGET_TYPE = 'Message';

export type SendChatMessageDeps = {
  readonly now: () => Date;
  readonly meta: { readonly ipAddress: string | null };
};

/** 投稿 1 件の結果（🔴 作成した 1 件だけを返す。会話全体を返さない）。 */
export type SendChatMessageResult = {
  readonly message: ChatMessageView;
};

export async function sendChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  input: ChatMessagePostBody,
  deps: SendChatMessageDeps,
): Promise<SendChatMessageResult> {
  const sentAt = deps.now();
  return withTenant(ctx, async (db) => {
    // ① 投稿先が見えるか（見えなければ 404。読みと同じ 1 実装）。
    const thread = requireFound(await findChatThreadRow(db, threadId));
    // ⑦ 貼る案件があれば、この部屋に貼れるか（貼れなければ 400。部屋が見えないときは上の 404 が先に返る）。
    const attachedProjectId = input.projectId ?? null;
    if (attachedProjectId !== null) await requirePastableProject(db, thread.partnerCompanyId, attachedProjectId);

    const created = (await db.message.create({
      data: {
        // 🔴 分離キーは**認証コンテキスト**から（`CLAUDE.md` §3.1。`createProposalDraft` と同じ規律）。
        //    Prisma 拡張（第 2 防御）も同じ値を注入し、RLS の `WITH CHECK`（第 1 防御）が
        //    別の値での INSERT を DB 側でも拒否する。
        tenantId: ctx.tenantId,
        threadId: thread.id,
        // ② 継承トリガが最終的に確定させる（アプリの値は一次的な整合にすぎない）。
        ownerPartnerCompanyId: thread.partnerCompanyId,
        // ③ 送信者は認証コンテキストから。
        senderUserId: ctx.userId,
        senderPartnerCompanyId: ctx.partnerCompanyId,
        body: input.body,
        attachedProjectId,
        sentAt,
      },
      select: CHAT_MESSAGE_SELECT,
    })) as ChatMessageRow;

    // 🔴 スレッドの「最終更新」は一覧の並びの根拠である（`read.ts` の `orderBy`）。
    //    投稿と**同じトランザクション**で進めないと、並びが実際の最終発言とずれる。
    await db.chatThread.update({ where: { id: thread.id }, data: { lastMessageAt: sentAt } });

    // ⑤ 監査（🔴 本文を載せない）。書けなければ例外 → トランザクションごと巻き戻る。
    await writeAuditLog(db, {
      action: CHAT_MESSAGE_AUDIT_ACTION_CREATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_MESSAGE_AUDIT_TARGET_TYPE,
      targetId: created.id,
      // ✅ 2026-10-23: 案件を貼ったときだけ、どの案件か（ID だけ。名前・本文は載せない）。貼らない投稿の形は従来のまま。
      summary: {
        threadId: thread.id,
        bodyLength: input.body.length,
        ...(attachedProjectId === null ? {} : { attachedProjectId }),
      },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    const [message] = await projectChatMessages(ctx, db, [created]);
    // 🔴 1 行入れて 1 行写せないことは起こりえない（起きたら不変条件が壊れている）。黙って空を返さない。
    return { message: requireFound(message ?? null) };
  });
}

/**
 * ✅ 2026-10-16（チャットレーン）: 発言へのリアクションを付ける / 外す（同じ種類をもう一度押すと外れる）。
 *
 * 🔴 発言は「このスレッドの、読める発言」でなければ 404（不存在・他社・別スレッドを区別しない）。
 * 🔴 付け外しは本人の行だけ（RLS の INSERT / DELETE が `user_id = app_actor_user_id()` を課す）。
 *    利用者 ID は認証コンテキストから取る。応答は件数と「自分が付けたか」だけ（`summarizeReactions`）。
 * 🔴 監査ログに書かない（投稿ではなく、本文も増えない。チャットの閲覧と同じく記録の対象外）。
 */
export async function toggleChatReaction(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  reaction: ChatReactionKind,
): Promise<readonly ChatReactionSummary[]> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    requireFound(await db.message.findFirst({ where: { id: messageId, threadId }, select: { id: true } }));
    const existing = await db.chatMessageReaction.findFirst({
      // 自分が付けた同じ種類（選ぶための条件であり、境界ではない。他人の行は DELETE ポリシーが消させない）。
      where: { messageId, reaction, userId: ctx.userId },
      select: { id: true },
    });
    if (existing === null) {
      await db.chatMessageReaction.create({
        data: { tenantId: ctx.tenantId, messageId, userId: ctx.userId, reaction },
      });
    } else {
      await db.chatMessageReaction.delete({ where: { id: existing.id } });
    }
    const rows = await db.chatMessageReaction.findMany({
      where: { messageId },
      select: { messageId: true, userId: true, reaction: true },
    });
    return summarizeReactions(rows, ctx.userId).get(messageId) ?? [];
  });
}

/** ✅ 2026-10-16: 編集・削除の監査 action（CLAUDE.md §3.5「作成・更新・削除」。本文は載せない）。 */
export const CHAT_MESSAGE_AUDIT_ACTION_UPDATE = 'message.update';
export const CHAT_MESSAGE_AUDIT_ACTION_DELETE = 'message.delete';

/**
 * ✅ 2026-10-26（#166 の 1）: 編集・削除の更新に掛ける条件（送った本人の、まだ消えていない、この部屋の発言）。
 * 🔴 確かめた後に別の要求が削除を確定させても、更新そのものがこの条件で 0 件になる（消した本文を書き戻さない）。
 *    同じ行を同時に更新すると PostgreSQL は後の側を待たせ、確定後の行で条件を測り直すので、条件付きの更新だけで足りる。
 */
function ownLiveMessageWhere(ctx: AuthenticatedTenantCtx, threadId: string, messageId: string) {
  return { id: messageId, threadId, senderUserId: ctx.userId, deletedAt: null, purgedAt: null };
}

/**
 * ✅ 2026-10-16（チャットレーン）: 自分の発言を探す（編集・削除の対象）。
 * 🔴 **送った本人の、まだ消えていない発言**だけ。他人の発言・別スレッド・見えない発言・削除済みは
 *    すべて 404（区別しない）。`senderUserId` の条件は「誰が編集できるか」の決まりであり、境界（誰が読めるか）は RLS。
 */
async function requireOwnLiveMessage(
  ctx: AuthenticatedTenantCtx,
  db: Parameters<Parameters<typeof withTenant<void>>[1]>[0],
  threadId: string,
  messageId: string,
) {
  requireFound(await findChatThreadRow(db, threadId));
  return requireFound(
    await db.message.findFirst({
      where: ownLiveMessageWhere(ctx, threadId, messageId),
      select: { id: true, body: true },
    }),
  );
}

/** ✅ 2026-10-16: 自分の発言を編集する（「編集済み」の印が付く）。監査ログに長さだけを残す。 */
export async function editChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  input: ChatMessageBody,
  deps: SendChatMessageDeps,
): Promise<SendChatMessageResult> {
  return withTenant(ctx, async (db) => {
    await requireOwnLiveMessage(ctx, db, threadId, messageId);
    // 🔴 ID だけで更新しない（#166 の 1）。0 件 = 確かめた後に消された → 404（削除済みと同じ扱い）。
    const changed = await db.message.updateMany({
      where: ownLiveMessageWhere(ctx, threadId, messageId),
      data: { body: input.body, editedAt: deps.now() },
    });
    if (changed.count === 0) throw new NotFoundError();
    const updated = (await db.message.findFirstOrThrow({
      where: { id: messageId, threadId },
      select: CHAT_MESSAGE_SELECT,
    })) as ChatMessageRow;
    await writeAuditLog(db, {
      action: CHAT_MESSAGE_AUDIT_ACTION_UPDATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_MESSAGE_AUDIT_TARGET_TYPE,
      targetId: messageId,
      summary: { threadId, bodyLength: input.body.length },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    const [message] = await projectChatMessages(ctx, db, [updated]);
    return { message: message as ChatMessageView };
  });
}

/** ✅ 2026-10-16: 自分の発言を削除する（論理削除。本文を消し「削除されました」と出す）。監査ログに残す。 */
export async function deleteChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  deps: SendChatMessageDeps,
): Promise<SendChatMessageResult> {
  return withTenant(ctx, async (db) => {
    const before = await requireOwnLiveMessage(ctx, db, threadId, messageId);
    // 🔴 削除も条件付き（#166 の 1）。同時に 2 回削除しても、監査ログは確定した 1 回だけに残る。
    const changed = await db.message.updateMany({
      where: ownLiveMessageWhere(ctx, threadId, messageId),
      // ✅ 2026-10-23: 貼った案件も外す（消した発言にカードを残さない。何を貼ったかは作成時の監査ログに残っている）。
      data: { body: null, deletedAt: deps.now(), attachedProjectId: null },
    });
    if (changed.count === 0) throw new NotFoundError();
    const updated = (await db.message.findFirstOrThrow({
      where: { id: messageId, threadId },
      select: CHAT_MESSAGE_SELECT,
    })) as ChatMessageRow;
    await writeAuditLog(db, {
      action: CHAT_MESSAGE_AUDIT_ACTION_DELETE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_MESSAGE_AUDIT_TARGET_TYPE,
      targetId: messageId,
      summary: { threadId, bodyLength: before.body?.length ?? 0 },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    const [message] = await projectChatMessages(ctx, db, [updated]);
    return { message: message as ChatMessageView };
  });
}

/** ✅ 2026-10-16: 会話の書き出しの監査（誰がどの会話を持ち出したか）。 */
export const CHAT_THREAD_AUDIT_ACTION_EXPORT = 'thread.export';
export const CHAT_THREAD_AUDIT_TARGET_TYPE = 'ChatThread';
/** 書き出す発言の上限（それを超えたら新しい方から上限まで。行数は監査に残す）。 */
export const CHAT_EXPORT_MAX_MESSAGES = 10_000;

/**
 * ✅ 2026-10-16（チャットレーン）: 会話をすべて読み（古い順）、監査ログに残す。CSV にするのは呼び出し側（`export.ts`）。
 * 🔴 スレッドが見えなければ 404。読めるのは RLS（C6）を通った発言だけ。監査に本文は載せない（件数だけ）。
 */
export async function readChatThreadForExport(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  deps: SendChatMessageDeps,
): Promise<readonly ChatMessageView[]> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    const newest = (await db.message.findMany({
      where: { threadId },
      select: CHAT_MESSAGE_SELECT,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: CHAT_EXPORT_MAX_MESSAGES,
    })) as readonly ChatMessageRow[];
    const messages = await projectChatMessages(ctx, db, [...newest].reverse());
    await writeAuditLog(db, {
      action: CHAT_THREAD_AUDIT_ACTION_EXPORT,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_THREAD_AUDIT_TARGET_TYPE,
      targetId: threadId,
      summary: { messageCount: messages.length, truncated: newest.length === CHAT_EXPORT_MAX_MESSAGES },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    return messages;
  });
}
