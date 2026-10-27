// packages/domain/src/storage/index.ts
// オブジェクトキーの規約（docs/05 §14.1）。T-05-04。
export {
  // 🔴 T-05-07: ダウンロード名は**版番号だけ**から作る（原本のファイル名を保存しない。§14.1）。
  buildSkillSheetDownloadFileName,
  buildSkillSheetObjectKey,
  // 🔴 T-10-09: 返却データ（ZIP）のキー（docs/05 §14.1 `exports/`）。
  buildDataExportObjectKey,
  // ✅ 2026-10-27: チャットの添付（社内だけの部屋。docs/05 §14.1 `chat/`）。
  buildChatAttachmentObjectKey,
  parseChatAttachmentObjectKey,
  type ChatAttachmentObjectKeyInput,
  // 🔴 T-10-02: 検算（`usage.storage-reconcile`）が走査するテナントのプレフィックス。
  buildTenantObjectPrefix,
  InvalidObjectKeyPartError,
  isTenantScopedObjectKey,
  objectKeyExtensionOf,
  OBJECT_KIND_SEGMENTS,
  // 🔴 T-05-06: #19 がクライアント申告の `objectKey` を照合するための分解（object-key.ts の 🔴）。
  parseSkillSheetObjectKey,
  tenantIdFromObjectKey,
  type DataExportObjectKeyInput,
  type SkillSheetObjectKeyInput,
  type SkillSheetObjectKeyParts,
} from './object-key.js';

// ✅ 2026-10-27: チャットの添付の受け付ける種類・大きさ（DB の CHECK と突き合わせる唯一の出所）。
export {
  CHAT_ATTACHMENT_CONTENT_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_TYPES,
  chatAttachmentExtensionOf,
  chatAttachmentKindOf,
  isChatAttachmentByteSize,
  isChatAttachmentContentType,
  type ChatAttachmentContentType,
  type ChatAttachmentExtension,
  type ChatAttachmentKind,
} from './chat-attachment.js';
