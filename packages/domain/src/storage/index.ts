// packages/domain/src/storage/index.ts
// オブジェクトキーの規約（docs/05 §14.1）。T-05-04。
export {
  // 🔴 T-05-07: ダウンロード名は**版番号だけ**から作る（原本のファイル名を保存しない。§14.1）。
  buildSkillSheetDownloadFileName,
  buildSkillSheetObjectKey,
  InvalidObjectKeyPartError,
  isTenantScopedObjectKey,
  objectKeyExtensionOf,
  OBJECT_KIND_SEGMENTS,
  // 🔴 T-05-06: #19 がクライアント申告の `objectKey` を照合するための分解（object-key.ts の 🔴）。
  parseSkillSheetObjectKey,
  tenantIdFromObjectKey,
  type SkillSheetObjectKeyInput,
  type SkillSheetObjectKeyParts,
} from './object-key.js';
