// packages/domain/src/state/errors.ts
// docs/05 §15.3「InvalidStateTransitionError（422）の扱い」/ CLAUDE.md §4.2。
//
// 🔴 「不正な遷移はサイレントに無視しない」（BR-33 / F-024 AC-1）。`transition()` は
//    `null` を返さず必ず例外を投げる。呼び出し側（API 境界）が 422 に写像する。
//
// 🔴 docs/05 §15.1 の `AppError` 階層（400/401/403/404/409/422/429/500）は API 境界の
//    実装（SP-03）で入る。`packages/domain` は何にも依存できない（CLAUDE.md §2.1）ため、
//    ここでは素の `Error` を継承しつつ、`AppError` が持つべき 2 属性（httpStatus /
//    userMessageKey）を同じ値であらかじめ持たせておく。`AppError` が実装された時点で
//    `extends AppError` へ差し替えても、呼び出し側の分岐は変わらない。

/** docs/05 §15.3 の `entity`。CLAUDE.md §4.2 の 5 状態機械がすべて。 */
export const STATE_MACHINE_ENTITIES = [
  'Proposal',
  'ProposalRequest',
  'Assignment',
  'Contract',
  'Tenant',
] as const;

export type StateMachineEntity = (typeof STATE_MACHINE_ENTITIES)[number];

/** docs/05 §15.1 / §15.3。HTTP 422 / `error.state.invalidTransition`。 */
export class InvalidStateTransitionError extends Error {
  readonly httpStatus = 422 as const;
  readonly userMessageKey = 'error.state.invalidTransition' as const;

  constructor(
    readonly entity: StateMachineEntity,
    readonly from: string,
    readonly to: string,
  ) {
    super(
      `${entity}: ${from} -> ${to} は CLAUDE.md §4.2 の遷移表にありません（docs/05 §15.3）。`,
    );
    this.name = 'InvalidStateTransitionError';
  }
}
