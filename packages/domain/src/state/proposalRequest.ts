// packages/domain/src/state/proposalRequest.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.6）。
// CLAUDE.md §4.2 の ProposalRequest ステートマシン（越境経路 4。§3.1）。
// 🔴 T-02-10: 遷移表と transition() をここに置いた（docs/05 §10.3 / §15.3 / §13.6）。
//    提案依頼の発行・応諾・辞退の API と DTO 分離（BR-57）は SP-08 の範囲。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

import { createStateMachine, type TransitionTable } from './machine.js';

/** docs/05 §3.6 `enum ProposalRequestState`（5 状態がすべて）。 */
export const PROPOSAL_REQUEST_STATES = [
  'REQUESTED',
  'ACCEPTED',
  'DECLINED',
  'WITHDRAWN_BY_HOST',
  'EXPIRED',
] as const;

export type ProposalRequestState = (typeof PROPOSAL_REQUEST_STATES)[number];

/**
 * CLAUDE.md §4.2 の ProposalRequest ステートマシン（**この表が遷移の全体である**）。
 *
 * 🔴 `DECLINED`（パートナーが辞退）は `LOST` / `GATE_FAILED` と別物であり、成約率の分母に入れない。
 *    辞退理由はホストに開示しない（CLAUDE.md §3.1 経路 4 / BR-57）。
 * 🔴 `ACCEPTED` / `DECLINED` / `WITHDRAWN_BY_HOST` / `EXPIRED` はいずれも終端
 *    （`ACCEPTED` の先は Proposal を DRAFT で生成する = 別の機械に合流する）。
 */
export const PROPOSAL_REQUEST_TRANSITIONS = {
  REQUESTED: ['ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'],
  ACCEPTED: [],
  DECLINED: [],
  WITHDRAWN_BY_HOST: [],
  EXPIRED: [],
} as const satisfies TransitionTable<ProposalRequestState>;

export const proposalRequestMachine = createStateMachine(
  'ProposalRequest',
  PROPOSAL_REQUEST_STATES,
  PROPOSAL_REQUEST_TRANSITIONS,
);
