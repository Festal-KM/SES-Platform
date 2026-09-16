// packages/domain/src/audit/index.ts
// 監査ログの表示用マスキング（docs/05 §5.5 第 2 層 / `F-058`。T-11-03）の公開面。
// 🔴 `packages/ai` の `mask()`（LLM 入力用）とは別物。ここは運営者向け表示の畳み込みだけを持つ。
export { MASKED_VALUE, maskAuditSummary } from './mask-summary.js';
export type { MaskedAuditSummary, MaskedAuditValue } from './mask-summary.js';
