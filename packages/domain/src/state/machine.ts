// packages/domain/src/state/machine.ts
// CLAUDE.md §4.2 の 5 状態機械に共通の遷移機構（docs/05 §10.3 / §15.3）。
//
// 🔴 docs/05 §15.3「5 機械すべてに適用 … **同じ `transition()` の仕組みを使う**」。
//    機械ごとに遷移の書き方を変えない（片方だけ検査が緩む経路を作らないため）。
// 🔴 純粋関数のみ（CLAUDE.md §2.1）。現在時刻・I/O・乱数を持ち込まない
//    （tests/static/domain-purity.test.ts が機械検証する）。
// 🔴 型でも弾く（docs/05 §10.3「`APPROVAL_PENDING → SUBMITTING` の組が型に存在しない」）。
//    `transition(from, to)` の `to` は `from` から到達できる状態だけに絞られるため、
//    遷移表に無い組はコンパイルエラーになる。実行時の検査（DB から読んだ文字列など、
//    型が広がった値が来る経路）も同じ表で行い、判定を二重に書かない。
import { InvalidStateTransitionError, type StateMachineEntity } from './errors.js';

/** 状態 → その状態から遷移できる状態の一覧。終端は空配列で表す。 */
export type TransitionTable<S extends string> = Readonly<{ [K in S]: readonly S[] }>;

/** `from` から到達できる状態（型レベル）。遷移表がそのまま型になる。 */
export type NextState<T, F extends keyof T> = T[F] extends readonly (infer U)[] ? U : never;

export type StateMachine<S extends string, T extends TransitionTable<S>> = {
  readonly entity: StateMachineEntity;
  readonly states: readonly S[];
  readonly transitions: T;
  /** 値が既知の状態か（DB / 外部入力から来た文字列の絞り込みに使う）。 */
  isState(value: unknown): value is S;
  /** 遷移表にある組か。**判定だけ**を行い、副作用も例外も無い。 */
  canTransition(from: S, to: S): boolean;
  /** `from` から到達できる状態の一覧。 */
  nextStates(from: S): readonly S[];
  /** 終端状態か（`WON` / `LOST` / `WITHDRAWN` / `ENDED` / `PURGED` など）。 */
  isTerminal(state: S): boolean;
  /**
   * 🔴 遷移を確定する唯一の関数。許可された組なら `to` を返し、そうでなければ
   *    `InvalidStateTransitionError` を投げる（`null` を返さない。BR-33）。
   */
  transition<F extends S & keyof T>(from: F, to: NextState<T, F>): NextState<T, F>;
};

export function createStateMachine<S extends string, T extends TransitionTable<S>>(
  entity: StateMachineEntity,
  states: readonly S[],
  transitions: T,
): StateMachine<S, T> {
  const stateSet: ReadonlySet<string> = new Set<string>(states);

  // 🔴 遷移表と状態一覧の不一致（状態の追加漏れ・タイプミス）を、生成時に落とす。
  //    CLAUDE.md §4.2「状態を追加したくなった場合は勝手に足さず、人間に提起する」の
  //    裏返しとして、状態を足したのに遷移表を書いていない実装が動いてしまわないようにする。
  const declared = Object.keys(transitions);
  for (const state of states) {
    if (!declared.includes(state)) {
      throw new Error(`${entity}: 遷移表に ${state} の行がありません（CLAUDE.md §4.2）。`);
    }
  }
  for (const key of declared) {
    if (!stateSet.has(key)) {
      throw new Error(`${entity}: 遷移表の ${key} は状態一覧にありません（CLAUDE.md §4.2）。`);
    }
    for (const target of transitions[key as S]) {
      if (!stateSet.has(target)) {
        throw new Error(
          `${entity}: 遷移表 ${key} -> ${target} の遷移先が状態一覧にありません（CLAUDE.md §4.2）。`,
        );
      }
    }
  }

  function isState(value: unknown): value is S {
    return typeof value === 'string' && stateSet.has(value);
  }

  function nextStates(from: S): readonly S[] {
    return transitions[from] ?? [];
  }

  function canTransition(from: S, to: S): boolean {
    return isState(from) && isState(to) && nextStates(from).includes(to);
  }

  return {
    entity,
    states,
    transitions,
    isState,
    canTransition,
    nextStates,
    isTerminal: (state: S) => nextStates(state).length === 0,
    transition<F extends S & keyof T>(from: F, to: NextState<T, F>): NextState<T, F> {
      // 🔴 型で弾いていても実行時に検査する。DB から読んだ状態はキャストで型が広がるため。
      if (!canTransition(from as unknown as S, to as unknown as S)) {
        throw new InvalidStateTransitionError(entity, String(from), String(to));
      }
      return to;
    },
  };
}
