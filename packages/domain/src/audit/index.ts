// packages/domain/src/audit/index.ts
// 監査ログ `summary` の表示用の 2 関数の公開面。
// 🔴 `packages/ai` の `mask()`（LLM 入力用）とは別物。
// 🔴 2 関数は向きが逆であり **相互に import しない**（docs/05 §6.4「#10 の改訂」/ §17.2 #32 ④）:
//   - `maskAuditSummary` … 運営者（`A-006` / API-A7）向け。内容キーを語彙で落とし、残りは値の形で伏せる（T-11-03）
//   - `pickAuditDetail`  … ホスト管理者（`S-041` / #10）向け。許可したキー以外を落とす（T-11-09）
export {
  COMMERCE_WORDS,
  CONTENT_WORDS,
  IDENTITY_WORDS,
  MASKED_VALUE,
  maskAuditSummary,
} from './mask-summary.js';
export type { DataExportKind, ProposalRequestOperation, TenantPurgeCause } from './pick-detail.js';
export type { MaskedAuditSummary, MaskedAuditValue } from './mask-summary.js';
export {
  AUDIT_DETAIL_ALLOWLIST,
  AUDIT_DETAIL_SUFFIX_FAMILIES,
  AUDIT_DETAIL_SUFFIX_FAMILY_EXCLUDED_PREFIXES,
  DATA_EXPORT_KINDS,
  PARTNER_LEDGER_ACTION_PREFIXES,
  PROPOSAL_REQUEST_OPERATION,
  PROPOSAL_REQUEST_OPERATIONS,
  TENANT_PURGE_CAUSES,
  isPartnerLedgerAction,
  pickAuditDetail,
  resolveAuditDetailKeySpecs,
} from './pick-detail.js';
export type {
  AuditActorScope,
  AuditDetailAllowedKeySpec,
  AuditDetailEntry,
  AuditDetailKeySpecs,
  AuditDetailPair,
  AuditDetailPairSide,
  AuditDetailRefEntity,
  AuditDetailSuppressedReason,
  AuditDetailValue,
  PickedAuditDetail,
} from './pick-detail.js';
