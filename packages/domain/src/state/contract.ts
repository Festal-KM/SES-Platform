// packages/domain/src/state/contract.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.7）。
// CLAUDE.md §4.2 の Contract ステートマシン（Phase 3。契約書。NDA / 基本契約 / 個別契約で共通）。
// 🔴 transition() 等の遷移ロジックは、契約の中核を実装するスプリント（SP-17）で追加する。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

/** docs/05 §3.7 `enum ContractState`（7 状態がすべて）。 */
export const CONTRACT_STATES = [
  'DRAFT',
  'SENDING',
  'SEND_FAILED',
  'UNDER_REVIEW',
  'EXECUTED',
  'WITHDRAWN',
  'EXPIRED',
] as const;

export type ContractState = (typeof CONTRACT_STATES)[number];
