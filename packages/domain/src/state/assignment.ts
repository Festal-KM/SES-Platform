// packages/domain/src/state/assignment.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.7）。
// CLAUDE.md §4.2 の Assignment ステートマシン（⑥ 稼働・稼働後フォロー）。
// 🔴 T-02-10: 遷移表と transition() をここに置いた（docs/05 §10.3 / §15.3 / §13.6）。
//    満了 60 日前の自動起票・還流のジョブと API は SP-16 の範囲。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

import { createStateMachine, type TransitionTable } from './machine.js';

/** docs/05 §3.7 `enum AssignmentState`（5 状態がすべて）。 */
export const ASSIGNMENT_STATES = [
  'SCHEDULED',
  'ACTIVE',
  'EXTENSION_REVIEW',
  'ENDING',
  'ENDED',
] as const;

export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

/**
 * CLAUDE.md §4.2 の Assignment ステートマシン（**この表が遷移の全体である**）。
 *
 * 🔴 `EXTENSION_REVIEW → ACTIVE`（延長合意）と `EXTENSION_REVIEW → ENDING`（終了決定）の 2 本。
 * 🔴 `ACTIVE → ENDING` は緊急離任。`ENDED` は終端（ここから ① へ還流する。CLAUDE.md §1.3）。
 */
export const ASSIGNMENT_TRANSITIONS = {
  SCHEDULED: ['ACTIVE'],
  ACTIVE: ['EXTENSION_REVIEW', 'ENDING'],
  EXTENSION_REVIEW: ['ACTIVE', 'ENDING'],
  ENDING: ['ENDED'],
  ENDED: [],
} as const satisfies TransitionTable<AssignmentState>;

export const assignmentMachine = createStateMachine(
  'Assignment',
  ASSIGNMENT_STATES,
  ASSIGNMENT_TRANSITIONS,
);
