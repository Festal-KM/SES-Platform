// packages/domain/src/state/proposalRequest.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.6）。
// CLAUDE.md §4.2 の ProposalRequest ステートマシン（越境経路 4。§3.1）。
// 🔴 transition() 等の遷移ロジックは、経路 4 を実装するスプリント（SP-08）で追加する。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

/** docs/05 §3.6 `enum ProposalRequestState`（5 状態がすべて）。 */
export const PROPOSAL_REQUEST_STATES = [
  'REQUESTED',
  'ACCEPTED',
  'DECLINED',
  'WITHDRAWN_BY_HOST',
  'EXPIRED',
] as const;

export type ProposalRequestState = (typeof PROPOSAL_REQUEST_STATES)[number];
