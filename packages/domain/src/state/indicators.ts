// packages/domain/src/state/indicators.ts
// 状態 → 指標区分の対応（docs/02 §5.1「状態の意味と、混同してはならない区別」/ `F-051 AC-1` `AC-2` /
// `F-018 AC-4` `AC-5` / `BR-23` / `BR-60` / docs/05 §6.6 #63）。T-08-08。
//
// ============================================================================
// 🔴 「成約率の分母に入る状態 / 入らない状態」の**唯一の定義**
// ============================================================================
// KPI の実装は SP-19（`F-051` / `GET /api/kpi/conversion`）だが、**状態の区別はここで確定する**。
// SP-19 は `WHERE state IN (...)` の値集合をここから引き、独自の配列を作らない。
//
//   - 分母は **`SUBMITTED` に到達した `Proposal`** だけ（`F-051 AC-1`）。`SUBMITTED` 以降の 7 状態が
//     それにあたる（`LOST` は「届いたが見送られた」営業結果であり分母に入る。`WITHDRAWN` は送信後の
//     辞退で分母に入る）。
//   - `GATE_FAILED`（送る前に自ら止めた）→ ゲート不合格率、`SUBMIT_FAILED`（送信自体が失敗した）→ 障害率。
//     🔴 **どちらも成約率の分母に入れない**（`F-051 AC-2`）。3 つは**別の指標**であり、1 つの「失敗」に
//     畳まない（`BR-23`。混ぜると成約率と障害率の両方が汚れ、監視が誤検知する。CLAUDE.md §4.2）。
//   - 🔴 **`ProposalRequest` の 5 状態はこの表に存在しない。** `DECLINED`（提案依頼を断られた。**提案は
//     まだ存在しない**）/ `EXPIRED` / `WITHDRAWN_BY_HOST` を成約率の分母に入れる経路は、**引数の型
//     （`ProposalState`）が受け付けない**という形で塞ぐ（`F-018 AC-4`）。`ProposalRequestState` を渡す
//     コードはコンパイルで落ちる。`ACCEPTED` の先は `Proposal(DRAFT)` として別の機械に合流し、そこから
//     初めて（`SUBMITTED` に達したとき）分母に入る。
//
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。
import type { ProposalState } from './proposal.js';
import type { ProposalRequestState } from './proposalRequest.js';

/**
 * `Proposal` の状態が属する指標区分（docs/02 §5.1 の表の右列）。
 *
 * - `IN_PROGRESS` — 送信前・送信中。どの率にもまだ入らない
 * - `GATE_FAILURE` — `GATE_FAILED`。ゲート不合格率の分子
 * - `DELIVERY_FAILURE` — `SUBMIT_FAILED`。障害率の分子（`F-059` の監視対象）
 * - `CONVERSION` — `SUBMITTED` 以降。成約率の分母
 *
 * 🔴 `ProposalRequest` の区分をこの union に足さない（別エンティティ。混ぜた「失敗」区分を型で作れなくする）。
 */
export type ProposalIndicator = 'IN_PROGRESS' | 'GATE_FAILURE' | 'DELIVERY_FAILURE' | 'CONVERSION';

/**
 * 状態 → 指標区分。🔴 `Record` で 14 状態の割り当て漏れをコンパイラに強制させる。
 * 状態を足す・消すと（CLAUDE.md §4.2 は人間の承認事項）ここが落ちる。
 */
export const PROPOSAL_INDICATOR_BY_STATE = {
  DRAFT: 'IN_PROGRESS',
  GATE_RUNNING: 'IN_PROGRESS',
  GATE_FAILED: 'GATE_FAILURE',
  APPROVAL_PENDING: 'IN_PROGRESS',
  APPROVED: 'IN_PROGRESS',
  SUBMITTING: 'IN_PROGRESS',
  SUBMITTED: 'CONVERSION',
  SUBMIT_FAILED: 'DELIVERY_FAILURE',
  INTERVIEW_SCHEDULED: 'CONVERSION',
  INTERVIEWED: 'CONVERSION',
  RESULT_PENDING: 'CONVERSION',
  WON: 'CONVERSION',
  LOST: 'CONVERSION',
  WITHDRAWN: 'CONVERSION',
} as const satisfies Record<ProposalState, ProposalIndicator>;

/**
 * 🔴 成約率の分母（`F-051 AC-1`「`SUBMITTED` に到達した提案のみ」）。SP-19 の `WHERE state IN (...)` はこれを使う。
 *    `PROPOSAL_INDICATOR_BY_STATE` で `CONVERSION` の状態と一致する（`indicators.test.ts` が突合する）。
 */
export const CONVERSION_DENOMINATOR_PROPOSAL_STATES = [
  'SUBMITTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'RESULT_PENDING',
  'WON',
  'LOST',
  'WITHDRAWN',
] as const satisfies readonly ProposalState[];

export type ConversionDenominatorProposalState = (typeof CONVERSION_DENOMINATOR_PROPOSAL_STATES)[number];

/** 成約率の分子（`F-051` 処理①「提案 → 面談 → 決定」の終点）。 */
export const CONVERSION_NUMERATOR_PROPOSAL_STATES = ['WON'] as const satisfies readonly ConversionDenominatorProposalState[];

/** 状態の指標区分を返す。🔴 引数は `ProposalState` のみ（`ProposalRequestState` は型で弾く）。 */
export function proposalIndicatorOf(state: ProposalState): ProposalIndicator {
  return PROPOSAL_INDICATOR_BY_STATE[state];
}

/**
 * 成約率の分母に入る状態か。🔴 引数は `ProposalState` のみ —— `DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST`
 * （`ProposalRequestState`）を渡すコードはコンパイルで落ちる（`F-018 AC-4` / `BR-60`）。
 */
export function isConversionDenominatorState(state: ProposalState): boolean {
  return PROPOSAL_INDICATOR_BY_STATE[state] === 'CONVERSION';
}

/**
 * 🔴 `ProposalState` と `ProposalRequestState` は**値を 1 つも共有しない**（コンパイル時の固定）。
 *    共有する値が生まれると、文字列で状態を扱う経路（DB の `state` 列・一覧のフィルタ・集計の `GROUP BY`）で
 *    2 つのエンティティの状態が見分けられなくなり、`F-018 AC-5`「別の区分として扱う」が崩れる。
 *    どちらかの状態名を変えて重なった時点で、この定数の型注釈が `false` になり代入が落ちる。
 */
type Disjoint<A extends string, B extends string> = [Extract<A, B>] extends [never] ? true : false;

export const PROPOSAL_AND_PROPOSAL_REQUEST_STATES_ARE_DISJOINT: Disjoint<ProposalState, ProposalRequestState> = true;
