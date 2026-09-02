// packages/domain/src/state/assignment.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.7）。
// CLAUDE.md §4.2 の Assignment ステートマシン（⑥ 稼働・稼働後フォロー）。
// 🔴 transition() 等の遷移ロジックは、稼働の還流を実装するスプリント（SP-16）で追加する。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

/** docs/05 §3.7 `enum AssignmentState`（5 状態がすべて）。 */
export const ASSIGNMENT_STATES = [
  'SCHEDULED',
  'ACTIVE',
  'EXTENSION_REVIEW',
  'ENDING',
  'ENDED',
] as const;

export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];
