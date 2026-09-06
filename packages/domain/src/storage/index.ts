// packages/domain/src/storage/index.ts
// オブジェクトキーの規約（docs/05 §14.1）。T-05-04。
export {
  buildSkillSheetObjectKey,
  InvalidObjectKeyPartError,
  isTenantScopedObjectKey,
  objectKeyExtensionOf,
  OBJECT_KIND_SEGMENTS,
  tenantIdFromObjectKey,
  type SkillSheetObjectKeyInput,
} from './object-key.js';
