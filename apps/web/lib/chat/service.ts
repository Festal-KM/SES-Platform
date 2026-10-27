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
//   ⑧ ✅ 2026-10-27（`F-038` 改訂 12 ⑫）: 🔴 **ファイルは #51p の札（`attachmentUploadToken`）でだけ受ける**。札を確かめ、
//      実体が置かれていることを確かめ（トランザクションの外）、部屋が添えられる部屋か（`chatRoomAcceptsAttachments`。
//      取引先がいれば 400。DB のトリガも拒む）を同じトランザクションで確かめてから、札の発言 ID で `SCANNING` の行を作る。
//      🔴 部屋の「最終更新」を進めない（進めると相手の一覧の並びで「何か送られた」と分かる。`CLEAN` になったときに
//      検査の関数が進める）。監査は `message.create` に加えて `chat_attachment.upload`（種類と大きさだけ）。
//      🔴 同じ札の二重送信は 1 行に収束する（発言 ID が同じ）。
import {
  accountChatAttachmentStorageInSend,
  lockTenantStorageForChatSend,
  releaseChatAttachmentOnDelete,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import type { ObjectStore } from '@ses/connectors';
import { InternalError, NotFoundError, requireFound, StorageLimitExceededError, ValidationError } from '../api/errors';
import {
  CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD,
  CHAT_ATTACHMENT_ROOM_DETAIL,
  chatAttachmentFitsStorage,
  resolveChatAttachmentForSend,
  type ChatAttachmentSendDeps,
  type ResolvedChatAttachment,
} from './attachments';
import { chatRoomAcceptsAttachments } from './policy';
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
  /** ✅ 2026-10-27: 添付の札の確認（札を受けたときだけ要る。無いのに札が来たら 500 にする —— 黙って添付を捨てない）。 */
  readonly attachments?: ChatAttachmentSendDeps;
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
  // ⑧ 札の確認と実体の確認（ネットワーク I/O があるのでトランザクションの外）。
  let attachment: ResolvedChatAttachment | null = null;
  if (input.attachmentUploadToken !== undefined) {
    if (deps.attachments === undefined) throw new InternalError('添付の確認に要る依存が渡されていません。');
    attachment = await resolveChatAttachmentForSend(ctx, threadId, input.attachmentUploadToken, deps.attachments, sentAt);
  }
  const result = await withTenant(ctx, async (db) => {
    // ① 投稿先が見えるか（見えなければ 404。読みと同じ 1 実装）。
    const thread = requireFound(await findChatThreadRow(db, threadId));
    // ⑦ 貼る案件があれば、この部屋に貼れるか（貼れなければ 400。部屋が見えないときは上の 404 が先に返る）。
    const attachedProjectId = input.projectId ?? null;
    if (attachedProjectId !== null) await requirePastableProject(db, thread.partnerCompanyId, attachedProjectId);
    if (attachment !== null) {
      if (!chatRoomAcceptsAttachments(thread)) throw new ValidationError([CHAT_ATTACHMENT_ROOM_DETAIL]);
      if (deps.attachments === undefined) throw new InternalError('添付の確認に要る依存が渡されていません。');
      return sendWithAttachment(ctx, db, thread.id, input, attachment, attachedProjectId, sentAt, deps, deps.attachments);
    }

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
  return result;
}

type ServiceDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * ⑧ 添付つきの発言を作る（同じトランザクションの中）。✅ 2026-10-27（Codex レビュー 2 回目）で 1 トランザクションに揃えた:
 *   1. 🔴 テナントのストレージを直列にする（`pg_advisory_xact_lock`。同じテナントの別の送信はここで待つ）と同時に使用量を読む
 *   2. 🔴 同じ札の二重送信（この ID の発言が既にある）なら、その発言を返す。**上限を数え直さず、実体も消さない**
 *   3. 上限を超えるなら、🔴 **鍵を持ったまま**実体を消して 429（この時点でこのキーを指す発言は無く、鍵を離すまで作られない）
 *   4. 発言を作り、同じトランザクションで加算する（CAS。`accountChatAttachmentStorageInSend`）と監査
 */
async function sendWithAttachment(
  ctx: AuthenticatedTenantCtx,
  db: ServiceDb,
  threadId: string,
  input: ChatMessagePostBody,
  attachment: ResolvedChatAttachment,
  attachedProjectId: string | null,
  sentAt: Date,
  deps: SendChatMessageDeps,
  attachmentDeps: NonNullable<SendChatMessageDeps['attachments']>,
): Promise<SendChatMessageResult> {
  const usedBytes = await lockTenantStorageForChatSend(db, { tenantId: ctx.tenantId, observedAt: sentAt });
  const existing = (await db.message.findFirst({
    where: { id: attachment.messageId, threadId, senderUserId: ctx.userId },
    select: CHAT_MESSAGE_SELECT,
  })) as ChatMessageRow | null;
  if (existing !== null) {
    const [replayed] = await projectChatMessages(ctx, db, [existing]);
    return { message: requireFound(replayed ?? null) };
  }
  if (!chatAttachmentFitsStorage({ usedBytes, byteSize: attachment.byteSize, storageLimitBytes: attachment.storageLimitBytes })) {
    try {
      await attachmentDeps.objectStore.delete(attachment.objectKey);
    } catch {
      // 消せなくても 429 は返す（残った実体は日次の片付け `cleanupAbandonedChatUploads` が拾う）。
    }
    throw new StorageLimitExceededError();
  }
  // 🔴 `createMany`（ON CONFLICT DO NOTHING）: 別の人の行と ID がぶつかっても例外でトランザクションを壊さない（下で 400）。
  const inserted = await db.message.createMany({
    data: [
      {
        id: attachment.messageId,
        tenantId: ctx.tenantId,
        threadId,
        ownerPartnerCompanyId: null,
        senderUserId: ctx.userId,
        senderPartnerCompanyId: ctx.partnerCompanyId,
        body: input.body,
        attachedProjectId,
        attachmentKey: attachment.objectKey,
        attachmentScanStatus: 'SCANNING',
        attachmentContentType: attachment.contentType,
        attachmentByteSize: BigInt(attachment.byteSize),
        sentAt,
      },
    ],
    skipDuplicates: true,
  });
  const row = (await db.message.findFirst({
    // 🔴 送った本人の、この部屋の発言だけ（別の部屋・別の人の行は返さない）。
    where: { id: attachment.messageId, threadId, senderUserId: ctx.userId },
    select: CHAT_MESSAGE_SELECT,
  })) as ChatMessageRow | null;
  if (row === null) throw new ValidationError(['body.attachmentUploadToken']);
  if (inserted.count === 1) {
    // 🔴 加算は同じトランザクション（直列にした鍵の内側）。CAS なので二重には数えない。
    await accountChatAttachmentStorageInSend(db, { tenantId: ctx.tenantId, messageId: row.id, observedAt: sentAt });
    await writeAuditLog(db, {
      action: CHAT_MESSAGE_AUDIT_ACTION_CREATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_MESSAGE_AUDIT_TARGET_TYPE,
      targetId: row.id,
      summary: {
        threadId,
        bodyLength: input.body.length,
        ...(attachedProjectId === null ? {} : { attachedProjectId }),
      },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    // 🔴 中身・ファイル名・キーを載せない（種類と大きさだけ）。
    await writeAuditLog(db, {
      action: CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_MESSAGE_AUDIT_TARGET_TYPE,
      targetId: row.id,
      summary: { contentType: attachment.contentType, byteSize: attachment.byteSize },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
  }
  const [message] = await projectChatMessages(ctx, db, [row]);
  return { message: requireFound(message ?? null) };
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
      select: { id: true, body: true, attachmentKey: true },
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

/**
 * ✅ 2026-10-27（紺野の決定 A）: 発言の削除に添付があるときの依存（実体を消すストレージ）。
 *    🔴 添付のある発言を消すのに渡されていなければ、何も動かさずに 500（実体を残したまま列だけ消さない）。
 */
export type DeleteChatMessageDeps = SendChatMessageDeps & { readonly objectStore?: Pick<ObjectStore, 'delete'> };

/**
 * ✅ 2026-10-16: 自分の発言を削除する（論理削除。本文を消し「削除されました」と出す）。監査ログに残す。
 * ✅ 2026-10-27（紺野の決定 A）: 添付があれば、**同じトランザクションで**添付の 4 列と計上の印を外し、計上済みなら
 *    `UsageCounter(STORAGE_BYTES)` を 1 度だけ減らす（`releaseChatAttachmentOnDelete`。CAS なので 2 回目は何もしない）。
 *    実体はコミットの**後**にストレージから消す。🔴 消せなかったときは削除を取り消さない（本文・添付を戻さない）。
 *    実体だけが残り、日次の検算（`usage.storage-reconcile`）が「実測 > カウンタ」の乖離として A-005 に出す。
 *    消した後は共有 URL（#51q）も一覧（#51r）も 404 / 載らない（列が NULL のため）。
 */
export async function deleteChatMessage(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  deps: DeleteChatMessageDeps,
): Promise<SendChatMessageResult> {
  const result = await withTenant(ctx, async (db) => {
    const before = await requireOwnLiveMessage(ctx, db, threadId, messageId);
    if (before.attachmentKey !== null && deps.objectStore === undefined) {
      throw new InternalError('添付の削除に要る依存が渡されていません。');
    }
    // 🔴 削除も条件付き（#166 の 1）。同時に 2 回削除しても、監査ログは確定した 1 回だけに残る。
    const changed = await db.message.updateMany({
      where: ownLiveMessageWhere(ctx, threadId, messageId),
      // ✅ 2026-10-23: 貼った案件も外す（消した発言にカードを残さない。何を貼ったかは作成時の監査ログに残っている）。
      data: { body: null, deletedAt: deps.now(), attachedProjectId: null },
    });
    if (changed.count === 0) throw new NotFoundError();
    // ✅ 2026-10-27: 添付と計上を外す（同じトランザクション）。
    const released = await releaseChatAttachmentOnDelete(db, {
      tenantId: ctx.tenantId,
      messageId,
      senderUserId: ctx.userId,
      observedAt: deps.now(),
    });
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
      // 🔴 添付は「あった」ことと大きさだけ（キー・種類の名前・ファイル名を載せない）。
      summary: {
        threadId,
        bodyLength: before.body?.length ?? 0,
        ...(released === null ? {} : { hadAttachment: true, byteSize: Number(released.byteSize) }),
      },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    const [message] = await projectChatMessages(ctx, db, [updated]);
    return { message: message as ChatMessageView, released };
  });
  if (result.released !== null && deps.objectStore !== undefined) {
    try {
      await deps.objectStore.delete(result.released.objectKey);
    } catch {
      // 🔴 ベストエフォート（上の関数の説明）。削除は確定しているので失敗を利用者の失敗にしない。残った実体は検算が拾う。
    }
  }
  return { message: result.message };
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
