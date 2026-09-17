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

// ============================================================================
// 🔴 T-09-02: 遷移ごとの「唯一の実行経路（所有者）」（docs/05 §6.5「#48 の実装の決着」/ §10.3 / §10.6）
// ============================================================================
// 遷移表（上）は「何が起こりうるか」を定める。ここは「**誰が起こしてよいか**」を定める。
// `POST /api/proposals/{id}/transition`（#48）は人間の明示操作の遷移（`MANUAL`）だけを受け、
// ゲート依頼（#39）・ゲートジョブ・承認（#41）・却下（#42）・送信ジョブ・再送（#44）が専有する
// 遷移を #48 から起こせない。専有の遷移を汎用 API に渡すと、提案先が空の 422（#39）・
// ゲート結果の持ち込み（§3.3）・ハッシュ一致の承認 CAS（§11.5）・冪等キーと CAS（§10.2）・
// `acknowledged: true`（§10.6）のすべてを迂回できてしまう。
//
// 🔴 `Record<ProposalTransitionKey, …>` を `satisfies` で固定する: 遷移表に線を足す・消すと
//    ここがコンパイルで落ちる（所有者の割り当て漏れ・余分な割り当てを型が弾く）。

/** 遷移表から導いた `${from}->${to}` の全組（19 本）。 */
export type ProposalTransitionKey = {
  [F in ProposalState]: `${F}->${(typeof PROPOSAL_TRANSITIONS)[F][number]}`;
}[ProposalState];

/**
 * 遷移の所有者。
 * - `GATE_REQUEST` — #39（レビュー依頼）。提案先の検証と `contentHash` の書き込みと一体
 * - `GATE_JOB` — `gate.run`。人間がゲート結果を持ち込む経路を作らない（CLAUDE.md §3.3）
 * - `APPROVE` / `REJECT` — #41 / #42（T-09-03）。ハッシュ一致の CAS / 理由必須
 * - `SEND_JOB` — `send.proposal`（T-09-06）と、その ⑥ を代行する `send.settle-unknown`（T-09-07。`SUBMITTING → SUBMIT_FAILED`
 *   のみ。外部を呼ばず `APPROVED` に戻さない）。CAS と `SendAttempt`（§10.2 / §10.6）
 * - `RESEND` — #44（T-09-08）。`acknowledged: true` を要求（§10.6）。呼ぶコードは 1 か所
 * - `MANUAL` — #48。人間の明示操作（修正のための差し戻し・商談の進行・結果・辞退）
 */
export type ProposalTransitionOwner =
  | 'GATE_REQUEST'
  | 'GATE_JOB'
  | 'APPROVE'
  | 'REJECT'
  | 'SEND_JOB'
  | 'RESEND'
  | 'MANUAL';

export const PROPOSAL_TRANSITION_OWNERS = {
  'DRAFT->GATE_RUNNING': 'GATE_REQUEST',
  'GATE_RUNNING->GATE_FAILED': 'GATE_JOB',
  'GATE_RUNNING->APPROVAL_PENDING': 'GATE_JOB',
  'GATE_FAILED->DRAFT': 'MANUAL',
  'APPROVAL_PENDING->DRAFT': 'REJECT',
  'APPROVAL_PENDING->APPROVED': 'APPROVE',
  'APPROVED->SUBMITTING': 'SEND_JOB',
  'SUBMITTING->SUBMITTED': 'SEND_JOB',
  'SUBMITTING->SUBMIT_FAILED': 'SEND_JOB',
  'SUBMIT_FAILED->APPROVED': 'RESEND',
  'SUBMITTED->INTERVIEW_SCHEDULED': 'MANUAL',
  'SUBMITTED->WITHDRAWN': 'MANUAL',
  'INTERVIEW_SCHEDULED->INTERVIEWED': 'MANUAL',
  'INTERVIEW_SCHEDULED->WITHDRAWN': 'MANUAL',
  'INTERVIEWED->RESULT_PENDING': 'MANUAL',
  'INTERVIEWED->WITHDRAWN': 'MANUAL',
  'RESULT_PENDING->WON': 'MANUAL',
  'RESULT_PENDING->LOST': 'MANUAL',
  'RESULT_PENDING->WITHDRAWN': 'MANUAL',
} as const satisfies Record<ProposalTransitionKey, ProposalTransitionOwner>;

export function proposalTransitionKey(from: ProposalState, to: ProposalState): `${ProposalState}->${ProposalState}` {
  return `${from}->${to}`;
}

/**
 * 遷移の所有者。🔴 遷移表に無い組は `null`（所有者以前に、起こりえない遷移である）。
 * 実行時の検査用に型を広げて受ける（DB から読んだ状態は文字列で来る）。
 */
export function proposalTransitionOwner(from: ProposalState, to: ProposalState): ProposalTransitionOwner | null {
  if (!proposalMachine.canTransition(from, to)) return null;
  const owners: Readonly<Record<string, ProposalTransitionOwner>> = PROPOSAL_TRANSITION_OWNERS;
  return owners[proposalTransitionKey(from, to)] ?? null;
}

/** #48 が受ける遷移か（所有者が `MANUAL`）。 */
export function isManualProposalTransition(from: ProposalState, to: ProposalState): boolean {
  return proposalTransitionOwner(from, to) === 'MANUAL';
}

/** `MANUAL` の遷移の遷移先（型レベル）。#48 の body スキーマの列挙の出所。 */
export type ProposalManualTransitionTarget = {
  [K in ProposalTransitionKey]: (typeof PROPOSAL_TRANSITION_OWNERS)[K] extends 'MANUAL'
    ? K extends `${string}->${infer To extends ProposalState}`
      ? To
      : never
    : never;
}[ProposalTransitionKey];

/**
 * 🔴 #48 の `to` が取れる値（7 値）。`ProposalState` 全体ではない —— `APPROVED` / `SUBMITTING` /
 *    `SUBMITTED` / `SUBMIT_FAILED` / `GATE_RUNNING` / `APPROVAL_PENDING` / `GATE_FAILED` を
 *    #48 に渡す入力面そのものを作らない（docs/05 §6.5「#48 の実装の決着」）。
 *    型レベルの導出（`ProposalManualTransitionTarget`）と一致することを下の定数が固定し、
 *    実行時の一致は `proposal.test.ts` が突合する。並びは `PROPOSAL_STATES` と同じ。
 */
export const PROPOSAL_MANUAL_TRANSITION_TARGET_STATES = [
  'DRAFT',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'RESULT_PENDING',
  'WON',
  'LOST',
  'WITHDRAWN',
] as const satisfies readonly ProposalManualTransitionTarget[];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** 🔴 列挙が型レベルの導出と過不足なく一致する（どちらかを変えると代入が落ちる）。 */
export const PROPOSAL_MANUAL_TRANSITION_TARGETS_MATCH_OWNERS: Same<
  (typeof PROPOSAL_MANUAL_TRANSITION_TARGET_STATES)[number],
  ProposalManualTransitionTarget
> = true;
