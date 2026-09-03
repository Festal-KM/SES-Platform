// packages/domain/src/state/proposal.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.6 / §10.3 / §17.2 #8）。
// CLAUDE.md §4.2 の Proposal ステートマシン（14 状態）。
// 🔴 T-02-10: 遷移表と transition() をここに置いた（docs/05 §10.3 / §15.3。seed:isolation が
//    「DB に直接 INSERT せず transition() を通して状態を進める」ために必要。§13.6）。
//    API（POST /api/proposals/{id}/transition）・ProposalEvent の記録・承認の分岐は SP-09 の範囲。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。Date の直接参照・process.env・I/O を
//    持ち込まない（tests/static/domain-purity.test.ts が機械検証する）。

import { createStateMachine, type TransitionTable } from './machine.js';

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

/**
 * CLAUDE.md §4.2 の Proposal ステートマシン（**この表が遷移の全体である**）。
 *
 * 🔴 `APPROVAL_PENDING → SUBMITTING` の組が存在しない（docs/05 §10.3。承認を経ない実行遷移が
 *    型としても実行時としても不可能）。
 * 🔴 `SUBMITTING` は片道（`SUBMITTED` / `SUBMIT_FAILED` に必ず確定する）。
 *    `SUBMIT_FAILED → APPROVED` は**人間の明示操作**のみが呼ぶ（自動再送は二重送信事故。
 *    §17.2 #16 が呼び出し元を静的に固定する）。
 * 🔴 `WON` / `LOST` / `WITHDRAWN` は終端。
 */
export const PROPOSAL_TRANSITIONS = {
  DRAFT: ['GATE_RUNNING'],
  GATE_RUNNING: ['GATE_FAILED', 'APPROVAL_PENDING'],
  GATE_FAILED: ['DRAFT'],
  APPROVAL_PENDING: ['DRAFT', 'APPROVED'],
  APPROVED: ['SUBMITTING'],
  SUBMITTING: ['SUBMITTED', 'SUBMIT_FAILED'],
  SUBMIT_FAILED: ['APPROVED'],
  SUBMITTED: ['INTERVIEW_SCHEDULED', 'WITHDRAWN'],
  INTERVIEW_SCHEDULED: ['INTERVIEWED', 'WITHDRAWN'],
  INTERVIEWED: ['RESULT_PENDING', 'WITHDRAWN'],
  RESULT_PENDING: ['WON', 'LOST', 'WITHDRAWN'],
  WON: [],
  LOST: [],
  WITHDRAWN: [],
} as const satisfies TransitionTable<ProposalState>;

export const proposalMachine = createStateMachine(
  'Proposal',
  PROPOSAL_STATES,
  PROPOSAL_TRANSITIONS,
);
