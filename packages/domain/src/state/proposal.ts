// packages/domain/src/state/proposal.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.6 / §10.3 / §17.2 #8）。
// CLAUDE.md §4.2 の Proposal ステートマシン（14 状態）。
// 🔴 transition() / canTransition() 等の遷移ロジックは SP-09（proposal-flow）で実装する。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。Date の直接参照・process.env・I/O を
//    持ち込まない（tests/static/domain-purity.test.ts が機械検証する）。

/** docs/05 §3.6 `enum ProposalState`（14 状態がすべて）。 */
export const PROPOSAL_STATES = [
  'DRAFT',
  'GATE_RUNNING',
  'GATE_FAILED',
  'APPROVAL_PENDING',
  'APPROVED',
  'SUBMITTING',
  'SUBMITTED',
  'SUBMIT_FAILED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'RESULT_PENDING',
  'WON',
  'LOST',
  'WITHDRAWN',
] as const;

export type ProposalState = (typeof PROPOSAL_STATES)[number];
