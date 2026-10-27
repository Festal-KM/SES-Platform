// packages/domain/src/storage/chat-attachment.ts
// ✅ 2026-10-27（紺野の決定。`docs/02` `F-038` 改訂 12 ⑫ / AC-14 / `docs/05` §3.7.1「ファイル（社内だけの部屋）」）:
// チャットの添付ファイルの**受け付ける種類・大きさ・表示の分類**（純粋関数と定数）。
//
// 🔴 受け付ける種類はここが唯一の出所である。DB の CHECK（migration 20261027010000 の
//    `messages_attachment_content_type_check`）は `tests/static/schema-enum-drift.test.ts` がこの配列と突き合わせる。
// 🔴 ファイル名は受け取らない・保存しない（氏名が入りうる。スキルシートと同じ扱い。docs/05 §14.1）。
//    拡張子は種類（MIME）から決める。

/** 受け付ける種類（MIME）と、キーに付ける拡張子。並びは DB の CHECK と同じ。 */
export const CHAT_ATTACHMENT_TYPES = [
  { contentType: 'image/png', extension: 'png', kind: 'image' },
  { contentType: 'image/jpeg', extension: 'jpg', kind: 'image' },
  { contentType: 'image/webp', extension: 'webp', kind: 'image' },
  { contentType: 'application/pdf', extension: 'pdf', kind: 'pdf' },
  { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', kind: 'file' },
  { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', kind: 'file' },
  { contentType: 'text/csv', extension: 'csv', kind: 'file' },
  { contentType: 'text/plain', extension: 'txt', kind: 'file' },
] as const;

export type ChatAttachmentContentType = (typeof CHAT_ATTACHMENT_TYPES)[number]['contentType'];
export type ChatAttachmentExtension = (typeof CHAT_ATTACHMENT_TYPES)[number]['extension'];
/** 画面の出し方の分類（画像は会話の中に縮めて出す / PDF は埋め込み / そのほかは札）。 */
export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_TYPES)[number]['kind'];

export const CHAT_ATTACHMENT_CONTENT_TYPES: readonly ChatAttachmentContentType[] = CHAT_ATTACHMENT_TYPES.map(
  (entry) => entry.contentType,
);

/** 1 ファイルの上限（20 MiB。DB の CHECK `messages_attachment_byte_size_check` と同じ値）。 */
export const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export function isChatAttachmentContentType(value: string): value is ChatAttachmentContentType {
  return (CHAT_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

/** 種類から拡張子（受け付けない種類なら `null`）。 */
export function chatAttachmentExtensionOf(contentType: string): ChatAttachmentExtension | null {
  return CHAT_ATTACHMENT_TYPES.find((entry) => entry.contentType === contentType)?.extension ?? null;
}

/** 種類から表示の分類（受け付けない種類なら `null`）。 */
export function chatAttachmentKindOf(contentType: string): ChatAttachmentKind | null {
  return CHAT_ATTACHMENT_TYPES.find((entry) => entry.contentType === contentType)?.kind ?? null;
}

/** 大きさが受け付ける範囲か（1 バイト以上・上限以下の整数）。 */
export function isChatAttachmentByteSize(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= CHAT_ATTACHMENT_MAX_BYTES;
}
