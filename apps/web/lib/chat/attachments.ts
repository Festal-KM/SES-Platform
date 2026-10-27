// apps/web/lib/chat/attachments.ts
// ✅ 2026-10-27（紺野の決定。`docs/02` `F-038` 改訂 12 ⑫ / AC-14 / `docs/05` §3.7.1「ファイル（社内だけの部屋）」/
// §6.5 #51p / #51q / #51r）: チャットのファイルの**発行・共有 URL・一覧**。送信（#51）は `service.ts` が持ち、
// 札の確認はここの `resolveChatAttachmentForSend` を通す。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **キーはサーバが組む**（`buildChatAttachmentObjectKey`）。利用者から受け取るのは種類と大きさだけで、
//      送信には署名付きの札（`attachment-token.ts`）で渡す。札は部屋・送る人・テナントに縛る。
//   ② 🔴 **取引先がいる部屋には添えられない**（`chatRoomAcceptsAttachments` の 1 か所 + DB のトリガ）。400 で拒む。
//   ③ 🔴 **共有 URL は `issueDownloadUrl` だけが出す**（`CLEAN` でなければ 409、記録の後に署名）。共有の分類は
//      **部屋に取引先がいるか**で決める（社内だけの部屋 = 社内〔`OWNER_SCOPE`〕。取引先がいる部屋は境界の外として
//      ゲートの PASS を要求する = いまは必ず止まる。後続の PR が決める）。
//   ④ 🔴 **見えない部屋・見えない発言・添付の無い発言はすべて 404**（存在を教えない。`docs/05` §4.8）。
//      `CLEAN` でない添付は送った本人以外には RLS で行ごと見えない（→ 404）。本人には 409（`FILE_NOT_CLEAN`）。
//   ⑤ 🔴 **ファイル名を受け取らない・保存しない・監査に載せない**（`summary` は種類と大きさだけ）。
//   ⑥ 🔴 **一覧は `CLEAN` だけ・新しい順・件数を返さない**。
//   ⑦ 🔴 設定の初期化を判定に混ぜない —— 札の鍵・ストレージは呼び出し側（ルート）が deps で渡す（HANDOFF §3.1）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import type { ObjectStore } from '@ses/connectors';
import {
  buildChatAttachmentObjectKey,
  CHAT_ATTACHMENT_MAX_BYTES,
  chatAttachmentExtensionOf,
  chatAttachmentKindOf,
  parseChatAttachmentObjectKey,
  type ChatAttachmentContentType,
  type ScanStatus,
} from '@ses/domain';
import { ConflictError, NotFoundError, requireFound, UploadTooLargeError, ValidationError } from '../api/errors';
import { buildCursorPage, takeForCursorPage, type CursorPage } from '../api/pagination';
import { issueDownloadUrl, type DownloadShareScope } from '../storage/download';
import { CHAT_ATTACHMENT_TOKEN_TTL_MS, type ChatAttachmentTokenCodec, type ChatAttachmentUploadClaims } from './attachment-token';
import { chatRoomAcceptsAttachments } from './policy';
import { findChatThreadRow, resolveSenderNames } from './read';
import type { ChatAttachmentListItem } from './views';

/** 🔴 `docs/05` §16.1 の `*.upload` / `*.download`（監査の操作種別）。 */
export const CHAT_ATTACHMENT_AUDIT_ACTION_UPLOAD = 'chat_attachment.upload';
export const CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD = 'chat_attachment.download';

/** 部屋に取引先がいて添えられない（400）。🔴 理由の細部は書き分けない。 */
export const CHAT_ATTACHMENT_ROOM_DETAIL = 'thread.attachment';
/** 札が無効（署名・期限・部屋・送る人が合わない）（400）。 */
export const CHAT_ATTACHMENT_TOKEN_DETAIL = 'body.attachmentUploadToken';

/**
 * 🔴 送ると申告したファイルがストレージに無い・申告と違う（409）。利用者の次の行動は「もう一度添える」。
 *    実体が無いまま発言の行を作らない。
 */
export class ChatAttachmentObjectMissingError extends ConflictError {
  override readonly code = 'CHAT_ATTACHMENT_OBJECT_MISSING';

  constructor() {
    super('添えたファイルを確認できませんでした。');
    this.name = 'ChatAttachmentObjectMissingError';
  }
}

/** `withTenant` が `fn` に渡すクライアント。 */
type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

// ---------------------------------------------------------------------------
// #51p 発行
// ---------------------------------------------------------------------------

export type ChatAttachmentUploadInput = {
  readonly contentType: ChatAttachmentContentType;
  readonly byteSize: number;
};

export type ChatAttachmentUploadDeps = {
  readonly objectStore: ObjectStore;
  readonly tokens: ChatAttachmentTokenCodec;
  /** `UPLOAD_MAX_BYTES`（既定 20 MB）。チャットの上限（20 MiB）と小さい方で止める。 */
  readonly uploadMaxBytes: number;
  readonly now: () => Date;
  /** 発言とオブジェクトの ID の採番（テストで差し替える）。 */
  readonly newId?: () => string;
};

/** `#51p` の応答。`requiredHeaders` は署名に含まれるヘッダ（PUT にそのまま付ける。スキルシートの #18 と同じ）。 */
export type ChatAttachmentUploadTicket = {
  readonly uploadUrl: string;
  readonly uploadToken: string;
  readonly expiresAt: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
};

/** `POST /api/threads/{id}/attachments/upload-url`（#51p）。 */
export async function issueChatAttachmentUploadUrl(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  input: ChatAttachmentUploadInput,
  deps: ChatAttachmentUploadDeps,
): Promise<ChatAttachmentUploadTicket> {
  const maxBytes = Math.min(deps.uploadMaxBytes, CHAT_ATTACHMENT_MAX_BYTES);
  if (input.byteSize > maxBytes) throw new UploadTooLargeError(maxBytes);
  const extension = chatAttachmentExtensionOf(input.contentType);
  if (extension === null) throw new ValidationError(['body.contentType']);

  // ② 部屋が見えるか（見えなければ 404）→ 添えられる部屋か（取引先がいれば 400）。
  const thread = await withTenant(ctx, async (db) => requireFound(await findChatThreadRow(db, threadId)));
  if (!chatRoomAcceptsAttachments(thread)) throw new ValidationError([CHAT_ATTACHMENT_ROOM_DETAIL]);

  const newId = deps.newId ?? (() => crypto.randomUUID());
  const messageId = newId();
  // ① キーはサーバが組む（ファイル名を含めない）。
  const objectKey = buildChatAttachmentObjectKey({
    tenantId: ctx.tenantId,
    threadId: thread.id,
    messageId,
    objectId: newId(),
    extension,
  });
  const presigned = await deps.objectStore.presignPut(objectKey, input.contentType, input.byteSize);
  const expiresAt = deps.now().getTime() + CHAT_ATTACHMENT_TOKEN_TTL_MS;
  const uploadToken = deps.tokens.sign({
    tenantId: ctx.tenantId,
    threadId: thread.id,
    userId: ctx.userId,
    messageId,
    objectKey,
    contentType: input.contentType,
    byteSize: input.byteSize,
    expiresAt,
  });
  return {
    uploadUrl: presigned.url,
    uploadToken,
    expiresAt: presigned.expiresAt.toISOString(),
    requiredHeaders: presigned.headers,
  };
}

// ---------------------------------------------------------------------------
// #51 送信（札の確認）
// ---------------------------------------------------------------------------

export type ChatAttachmentSendDeps = {
  readonly objectStore: ObjectStore;
  readonly tokens: ChatAttachmentTokenCodec;
};

/** 発言の行に書く添付（すべて札に焼き込んだ値）。 */
export type ResolvedChatAttachment = {
  readonly messageId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
};

/**
 * 🔴 札を確かめ、実体がストレージに置かれていることを確かめる（トランザクションの外で呼ぶ。ネットワーク I/O があるため）。
 * 部屋が添えられる部屋かは、送信のトランザクションの中で `chatRoomAcceptsAttachments` を通す（`service.ts`）。
 */
export async function resolveChatAttachmentForSend(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  token: string,
  deps: ChatAttachmentSendDeps,
  now: Date,
): Promise<ResolvedChatAttachment> {
  const claims = deps.tokens.verify(token, now);
  if (claims === null || !claimsMatch(claims, ctx, threadId)) throw new ValidationError([CHAT_ATTACHMENT_TOKEN_DETAIL]);
  const head = await deps.objectStore.head(claims.objectKey);
  // 🔴 署名に大きさと種類を焼き込んであるので一致するはず。違えば受け取らない（実体と行をずらさない）。
  if (head === null || head.byteSize !== claims.byteSize || head.contentType !== claims.contentType) {
    throw new ChatAttachmentObjectMissingError();
  }
  return {
    messageId: claims.messageId,
    objectKey: claims.objectKey,
    contentType: claims.contentType,
    byteSize: claims.byteSize,
  };
}

/** 札が「この人が、このテナントの、この部屋に」出したものか（キーの形も同じ値を指すこと）。 */
function claimsMatch(claims: ChatAttachmentUploadClaims, ctx: AuthenticatedTenantCtx, threadId: string): boolean {
  if (claims.tenantId !== ctx.tenantId || claims.userId !== ctx.userId || claims.threadId !== threadId) return false;
  const parts = parseChatAttachmentObjectKey(claims.objectKey);
  return (
    parts !== null &&
    parts.tenantId === ctx.tenantId &&
    parts.threadId === threadId &&
    parts.messageId === claims.messageId &&
    chatAttachmentExtensionOf(claims.contentType) === parts.extension
  );
}

// ---------------------------------------------------------------------------
// #51q 共有 URL
// ---------------------------------------------------------------------------

export type ChatAttachmentDisposition = 'inline' | 'attachment';

export type ChatAttachmentDownloadDeps = {
  readonly objectStore: ObjectStore;
  readonly ipAddress: string | null;
  readonly now: () => Date;
};

/**
 * 🔴 共有の分類（部屋に取引先がいるか）。社内だけの部屋は社内（ゲート不要。テナントの外に出ない）。
 *    取引先がいる部屋は境界の外として扱い、ゲート（`CHAT_ATTACHMENT`）の PASS を要求する（いまは必ず止まる）。
 */
export function chatAttachmentShareScope(
  thread: { readonly partnerCompanyId: string | null },
  messageId: string,
): DownloadShareScope {
  if (chatRoomAcceptsAttachments(thread)) return { kind: 'OWNER_SCOPE' };
  return { kind: 'EXTERNAL', gateTargetType: 'CHAT_ATTACHMENT', gateTargetId: messageId };
}

/** `POST /api/threads/{id}/messages/{messageId}/attachment/download-url`（#51q）。 */
export async function issueChatAttachmentDownloadUrl(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  disposition: ChatAttachmentDisposition,
  deps: ChatAttachmentDownloadDeps,
): Promise<{ readonly url: string; readonly expiresAt: string }> {
  const ticket = await issueDownloadUrl(
    ctx,
    async (db) => {
      const thread = await findChatThreadRow(db, threadId);
      if (thread === null) return null;
      // 🔴 RLS で読めた発言だけ（`CLEAN` でない他人の添付は行ごと見えない）。消えた発言の添付は出さない。
      const row = await db.message.findFirst({
        where: { id: messageId, threadId, deletedAt: null, purgedAt: null },
        select: { attachmentKey: true, attachmentScanStatus: true, attachmentContentType: true, attachmentByteSize: true },
      });
      if (row === null || row.attachmentKey === null || row.attachmentScanStatus === null || row.attachmentContentType === null) {
        return null;
      }
      const extension = chatAttachmentExtensionOf(row.attachmentContentType);
      return {
        objectKey: row.attachmentKey,
        scanStatus: row.attachmentScanStatus as ScanStatus,
        share: chatAttachmentShareScope(thread, messageId),
        // 🔴 ダウンロード名はファイル名を使わない（種類だけで組む）。開く（inline）は名前を付けない ＝ ブラウザがそのまま表示する。
        ...(disposition === 'attachment' && extension !== null ? { downloadFileName: `chat-file.${extension}` } : {}),
        audit: {
          action: CHAT_ATTACHMENT_AUDIT_ACTION_DOWNLOAD,
          targetType: 'Message',
          targetId: messageId,
          // ⑤ 種類と大きさだけ。
          summary: { contentType: row.attachmentContentType, byteSize: Number(row.attachmentByteSize ?? 0) },
        },
      };
    },
    { objectStore: deps.objectStore, ipAddress: deps.ipAddress },
  );
  return { url: ticket.url, expiresAt: new Date(deps.now().getTime() + ticket.expiresIn * 1000).toISOString() };
}

// ---------------------------------------------------------------------------
// #51r 一覧
// ---------------------------------------------------------------------------

export const CHAT_ATTACHMENT_LIST_LIMIT = 50;

/** `GET /api/threads/{id}/attachments`（#51r）。🔴 件数を返さない。 */
export async function listChatAttachments(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  query: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
): Promise<CursorPage<ChatAttachmentListItem>> {
  const limit = query.limit ?? CHAT_ATTACHMENT_LIST_LIMIT;
  return withTenant(ctx, async (db) => readAttachmentPage(db, threadId, limit, query.cursor));
}

async function readAttachmentPage(
  db: Pick<TenantDb, 'chatThread' | 'message' | 'user'>,
  threadId: string,
  limit: number,
  cursor: string | undefined,
): Promise<CursorPage<ChatAttachmentListItem>> {
  requireFound(await findChatThreadRow(db, threadId));
  if (cursor !== undefined) {
    // 🔴 カーソルはこの部屋の、一覧に載る発言でなければ 404（別の部屋の ID で並びを探らせない）。
    const anchor = await db.message.findFirst({
      where: { id: cursor, threadId, attachmentScanStatus: 'CLEAN', deletedAt: null, purgedAt: null },
      select: { id: true },
    });
    if (anchor === null) throw new NotFoundError();
  }
  const rows = await db.message.findMany({
    // 業務上の絞り込み（この部屋の、検査に合格した、消えていない添付）。境界は RLS が決める。
    where: { threadId, attachmentKey: { not: null }, attachmentScanStatus: 'CLEAN', deletedAt: null, purgedAt: null },
    select: { id: true, senderUserId: true, sentAt: true, attachmentContentType: true, attachmentByteSize: true },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: takeForCursorPage(limit),
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const page = buildCursorPage(rows, limit, (row) => row.id);
  const names = await resolveSenderNames(db, page.items.map((row) => row.senderUserId));
  return {
    items: page.items.map((row) => ({
      messageId: row.id,
      kind: chatAttachmentKindOf(row.attachmentContentType ?? '') ?? 'file',
      contentType: row.attachmentContentType ?? '',
      byteSize: Number(row.attachmentByteSize ?? 0),
      senderName: names.get(row.senderUserId) ?? null,
      sentAt: row.sentAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}

/**
 * ✅ 2026-10-27: 開いている部屋のうち、ファイルを添えられる部屋（画面の印と右の欄の「ファイル」の出し分け）。
 * 🔴 判定は `chatRoomAcceptsAttachments` の 1 か所。部屋は RLS で読めたものだけ（見えない ID は入らない）。
 */
export async function readAttachableThreadIds(
  ctx: AuthenticatedTenantCtx,
  threadIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (threadIds.length === 0) return new Set();
  return withTenant(ctx, async (db) => {
    const accepted = new Set<string>();
    for (const threadId of new Set(threadIds)) {
      const thread = await findChatThreadRow(db, threadId);
      if (thread !== null && chatRoomAcceptsAttachments(thread)) accepted.add(thread.id);
    }
    return accepted;
  });
}
