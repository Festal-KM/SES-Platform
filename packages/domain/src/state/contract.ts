// packages/domain/src/state/contract.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.7）。
// CLAUDE.md §4.2 の Contract ステートマシン（Phase 3。契約書。NDA / 基本契約 / 個別契約で共通）。
// 🔴 T-02-10: 遷移表と transition() をここに置いた（docs/05 §10.3 / §15.3 / §13.6）。
//    送付ジョブの CAS・電子署名 Webhook・再送の導線は SP-17 の範囲。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

import { createStateMachine, type TransitionTable } from './machine.js';

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

/**
 * CLAUDE.md §4.2 の Contract ステートマシン（**この表が遷移の全体である**）。
 *
 * 🔴 `SENDING` は片道（`UNDER_REVIEW` / `SEND_FAILED` に必ず確定する）。自動リトライしない。
 *    `SEND_FAILED → DRAFT` は**人間の明示操作**のみが呼ぶ（docs/05 §17.2 #16 が静的に固定する）。
 * 🔴 `EXECUTED` に到達した契約書は内容を書き換えられない（訂正は新しい Contract を起こす）。
 *    残る遷移は期間満了 / 解除の `EXPIRED` だけである。
 */
export const CONTRACT_TRANSITIONS = {
  DRAFT: ['SENDING'],
  SENDING: ['UNDER_REVIEW', 'SEND_FAILED'],
  SEND_FAILED: ['DRAFT'],
  UNDER_REVIEW: ['EXECUTED', 'DRAFT', 'WITHDRAWN'],
  EXECUTED: ['EXPIRED'],
  WITHDRAWN: [],
  EXPIRED: [],
} as const satisfies TransitionTable<ContractState>;

export const contractMachine = createStateMachine(
  'Contract',
  CONTRACT_STATES,
  CONTRACT_TRANSITIONS,
);
