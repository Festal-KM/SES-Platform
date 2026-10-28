// apps/web/lib/chat/attachment-client.ts
// ✅ 2026-10-27（`F-038` 改訂 12 ⑫ / `docs/04` §S-031 改訂 44）: ブラウザ側のファイルの手順と表示の語（純粋関数 + fetch）。
//
// 🔴 `@ses/db` / `@ses/i18n` / `node:crypto` に依存しない（クライアントの島から読む。語は props で受ける）。
// 🔴 手順は 3 段（#51p で札と署名 → ストレージへ PUT → #51 に札を付けて送る）。ここは最初の 2 段を持つ。
//    送信（3 段目）は会話の送信と同じ 1 本（`use-chat-conversation.ts` の `deliver`）を通す。
// 🔴 共有 URL は押すたびに #51q で取り直す（画面に持ち続けない）。別タブは `noopener,noreferrer` で開く。
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_TYPES,
  isChatAttachmentContentType,
  type ChatAttachmentContentType,
} from '@ses/domain';
import { requiresDirectTransfer } from '../skill-sheets/upload-client';

/** 種類・大きさの語（`chat-props.ts` が解決して渡す）。 */
export type ChatAttachmentFormatLabels = {
  readonly types: {
    readonly image: string;
    readonly pdf: string;
    readonly docx: string;
    readonly xlsx: string;
    readonly csv: string;
    readonly txt: string;
    readonly other: string;
  };
  readonly units: { readonly byte: string; readonly kilo: string; readonly mega: string };
  readonly separator: string;
};

/** 種類の語（「PDF」「画像」など）。 */
export function chatAttachmentTypeLabel(contentType: string, labels: ChatAttachmentFormatLabels): string {
  const entry = CHAT_ATTACHMENT_TYPES.find((type) => type.contentType === contentType);
  if (entry === undefined) return labels.types.other;
  if (entry.kind === 'image') return labels.types.image;
  return labels.types[entry.extension];
}

/** 大きさの語（「1.2 MB」「340 KB」「12 B」）。 */
export function formatChatAttachmentSize(byteSize: number, labels: ChatAttachmentFormatLabels): string {
  if (byteSize < 1024) return `${String(byteSize)} ${labels.units.byte}`;
  if (byteSize < 1024 * 1024) return `${String(Math.max(1, Math.round(byteSize / 1024)))} ${labels.units.kilo}`;
  const mega = byteSize / (1024 * 1024);
  return `${mega >= 10 ? String(Math.round(mega)) : mega.toFixed(1)} ${labels.units.mega}`;
}

/** 「PDF・1.2 MB」。🔴 ファイル名は出さない（保存しない）。 */
export function chatAttachmentSummary(attachment: { readonly contentType: string; readonly byteSize: number }, labels: ChatAttachmentFormatLabels): string {
  return `${chatAttachmentTypeLabel(attachment.contentType, labels)}${labels.separator}${formatChatAttachmentSize(attachment.byteSize, labels)}`;
}

/** 拡張子から種類（端末によっては CSV の種類が空・別名で来るため。ファイル名はここで使うだけで送らない）。 */
const EXTENSION_FALLBACK: Readonly<Record<string, ChatAttachmentContentType>> = Object.fromEntries(
  [...CHAT_ATTACHMENT_TYPES.map((type) => [type.extension, type.contentType] as const), ['jpeg', 'image/jpeg'] as const],
);

/**
 * 選んだファイルを受け付けるか（種類・大きさ）。受け付けるなら送る種類、受け付けなければ `null`。
 * 🔴 最終の判定はサーバ（#51p の Zod と DB の CHECK）。ここは押してから断られる導線を減らすための事前の確認。
 */
export function acceptChatAttachment(file: { readonly type: string; readonly size: number; readonly name: string }): ChatAttachmentContentType | null {
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > CHAT_ATTACHMENT_MAX_BYTES) return null;
  if (isChatAttachmentContentType(file.type)) return file.type;
  const dot = file.name.lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
  return EXTENSION_FALLBACK[extension] ?? null;
}

/** `<input type="file" accept>` に渡す値。 */
export const CHAT_ATTACHMENT_ACCEPT = [
  ...CHAT_ATTACHMENT_TYPES.map((type) => type.contentType),
  ...CHAT_ATTACHMENT_TYPES.map((type) => `.${type.extension}`),
].join(',');

/**
 * ✅ 2026-10-27（デモで「ファイルを送れませんでした」）: ブラウザの `fetch` は `window` を `this` にして呼ばないと
 * `TypeError: Illegal invocation` になる。fetch をそのままオブジェクトの値に入れて `deps.fetch(...)` で呼ぶと
 * `this` が `deps` になり、要求を送る前に例外になる（Node のテストでは起きないので見逃した）。
 * 🔴 画面から渡すときは必ずこれを使う（`tests/static/chat-browser-fetch.test.ts` が短縮記法の受け渡しを禁止する）。
 */
export const browserFetch: typeof fetch = (input, init) => fetch(input, init);

export const chatAttachmentUploadApiPath = (threadId: string): string =>
  `/api/threads/${encodeURIComponent(threadId)}/attachments/upload-url`;
export const chatAttachmentDownloadApiPath = (threadId: string, messageId: string): string =>
  `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/attachment/download-url`;
export const chatAttachmentListApiPath = (threadId: string, cursor: string | null): string =>
  `/api/threads/${encodeURIComponent(threadId)}/attachments${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`;

type UploadTicket = { readonly uploadUrl: string; readonly uploadToken: string; readonly requiredHeaders: Readonly<Record<string, string>> };

/** 1・2 段目の結果。`MISSING` = 部屋が見えなくなった（404）。 */
export type ChatAttachmentUploadOutcome =
  | { readonly ok: true; readonly uploadToken: string }
  | { readonly ok: false; readonly reason: 'MISSING' | 'FAILED' };

/**
 * #51p で札と署名を受け取り、ストレージへ置く。🔴 転送に失敗したら札を返さない（実体が無いまま送らない）。
 */
export async function uploadChatAttachment(
  input: { readonly threadId: string; readonly contentType: ChatAttachmentContentType; readonly body: Blob },
  deps: { readonly fetch: typeof fetch },
): Promise<ChatAttachmentUploadOutcome> {
  const ticketResponse = await deps
    .fetch(chatAttachmentUploadApiPath(input.threadId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: input.contentType, byteSize: input.body.size }),
    })
    .catch(() => null);
  if (ticketResponse === null) return { ok: false, reason: 'FAILED' };
  if (ticketResponse.status === 404) return { ok: false, reason: 'MISSING' };
  if (!ticketResponse.ok) return { ok: false, reason: 'FAILED' };
  const ticket = (await ticketResponse.json()) as UploadTicket;
  if (requiresDirectTransfer(ticket.uploadUrl)) {
    const transferred = await deps
      .fetch(ticket.uploadUrl, { method: 'PUT', headers: { ...ticket.requiredHeaders }, body: input.body })
      .catch(() => null);
    if (transferred === null || !transferred.ok) return { ok: false, reason: 'FAILED' };
  }
  return { ok: true, uploadToken: ticket.uploadToken };
}

/** #51q で共有 URL を取り直す（押すたび）。取れなければ `null`。 */
export async function fetchChatAttachmentUrl(
  input: { readonly threadId: string; readonly messageId: string; readonly disposition: 'inline' | 'attachment' },
  deps: { readonly fetch: typeof fetch },
): Promise<string | null> {
  const response = await deps
    .fetch(chatAttachmentDownloadApiPath(input.threadId, input.messageId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disposition: input.disposition }),
      cache: 'no-store',
    })
    .catch(() => null);
  if (response === null || !response.ok) return null;
  const body = (await response.json().catch(() => null)) as { readonly url?: unknown } | null;
  return typeof body?.url === 'string' ? body.url : null;
}
