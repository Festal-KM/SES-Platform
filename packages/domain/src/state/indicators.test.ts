// packages/domain/src/state/indicators.test.ts
// T-08-08（docs/sprints/SP-08-anonymous-share.md §5）: 状態 → 指標区分の対応を固定する。
// docs/02 §5.1「状態の意味と、混同してはならない区別」/ `F-051 AC-1` `AC-2` / `F-018 AC-4` `AC-5` / `BR-23` / `BR-60`。
//
// 🔴 「許可の一覧」ではなく **14 状態 × 全区分**を検査する（`machine.test.ts` と同じ方針）。
//    分母に 1 状態を足したとき、テストが増えるだけで落ちない形にしない。
import { describe, expect, it } from 'vitest';
import {
  CONVERSION_DENOMINATOR_PROPOSAL_STATES,
  CONVERSION_NUMERATOR_PROPOSAL_STATES,
  isConversionDenominatorState,
  PROPOSAL_AND_PROPOSAL_REQUEST_STATES_ARE_DISJOINT,
  PROPOSAL_INDICATOR_BY_STATE,
  proposalIndicatorOf,
  type ProposalIndicator,
} from './indicators.js';
import { PROPOSAL_STATES, PROPOSAL_TRANSITIONS, type ProposalState } from './proposal.js';
import { PROPOSAL_REQUEST_STATES, type ProposalRequestState } from './proposalRequest.js';

/** docs/02 §5.1 の表をそのまま写した期待値（実装と同じ配列を参照しない）。 */
const EXPECTED: Readonly<Record<ProposalState, ProposalIndicator>> = {
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
};

describe('🔴 成約率の分母（F-051 AC-1 / AC-2 / BR-60）', () => {
  it('14 状態すべてに区分があり、docs/02 §5.1 の表と一致する（全網羅）', () => {
    expect(Object.keys(PROPOSAL_INDICATOR_BY_STATE).sort()).toEqual([...PROPOSAL_STATES].sort());
    for (const state of PROPOSAL_STATES) {
      expect(proposalIndicatorOf(state), state).toBe(EXPECTED[state]);
      expect(isConversionDenominatorState(state), state).toBe(EXPECTED[state] === 'CONVERSION');
    }
  });

  it('🔴 分母 = SUBMITTED に到達した状態だけ（遷移表から機械的に導いた集合と一致する）', () => {
    // SUBMITTED から到達できる状態の閉包（SUBMITTED 自身を含む）を遷移表から求める。
    const reachable = new Set<ProposalState>(['SUBMITTED']);
    const queue: ProposalState[] = ['SUBMITTED'];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const to of PROPOSAL_TRANSITIONS[next]) {
        if (!reachable.has(to)) {
          reachable.add(to);
          queue.push(to);
        }
      }
    }
    expect([...CONVERSION_DENOMINATOR_PROPOSAL_STATES].sort()).toEqual([...reachable].sort());
    // 定数と表が食い違わない。
    const fromTable = PROPOSAL_STATES.filter((state) => PROPOSAL_INDICATOR_BY_STATE[state] === 'CONVERSION');
    expect([...CONVERSION_DENOMINATOR_PROPOSAL_STATES].sort()).toEqual([...fromTable].sort());
    expect(new Set(CONVERSION_DENOMINATOR_PROPOSAL_STATES).size).toBe(CONVERSION_DENOMINATOR_PROPOSAL_STATES.length);
  });

  it('🔴 GATE_FAILED / SUBMIT_FAILED / LOST は 3 つの別の区分（1 つの「失敗」に畳まない。BR-23 / F-018 AC-5）', () => {
    const buckets = new Set([
      proposalIndicatorOf('GATE_FAILED'),
      proposalIndicatorOf('SUBMIT_FAILED'),
      proposalIndicatorOf('LOST'),
    ]);
    expect(buckets.size).toBe(3);
    expect(isConversionDenominatorState('GATE_FAILED')).toBe(false);
    expect(isConversionDenominatorState('SUBMIT_FAILED')).toBe(false);
    expect(isConversionDenominatorState('LOST')).toBe(true);
    expect(isConversionDenominatorState('WITHDRAWN')).toBe(true);
  });

  it('分子（WON）は分母の部分集合である', () => {
    for (const state of CONVERSION_NUMERATOR_PROPOSAL_STATES) {
      expect(CONVERSION_DENOMINATOR_PROPOSAL_STATES).toContain(state);
    }
  });
});

describe('🔴 ProposalRequest の状態は成約率に入らない（F-018 AC-4 / AC-5）', () => {
  it('🔴 型: ProposalRequestState を isConversionDenominatorState / proposalIndicatorOf に渡せない', () => {
    const declined: ProposalRequestState = 'DECLINED';
    // @ts-expect-error F-018 AC-4: 提案依頼の状態は分母判定の引数にならない（提案はまだ存在しない）
    isConversionDenominatorState(declined);
    // @ts-expect-error F-018 AC-5: 提案依頼の状態に Proposal の指標区分は無い
    proposalIndicatorOf('EXPIRED');
    // @ts-expect-error F-018 AC-5: WITHDRAWN_BY_HOST は Proposal の WITHDRAWN とは別の状態で、Proposal の指標区分を持たない
    proposalIndicatorOf('WITHDRAWN_BY_HOST');
    // 🔴 実行時: 表に 5 状態のキーが 1 つも無い（文字列で回り込んでも undefined になり、CONVERSION にならない）。
    const table: Readonly<Record<string, ProposalIndicator>> = PROPOSAL_INDICATOR_BY_STATE;
    for (const state of PROPOSAL_REQUEST_STATES) {
      expect(table[state], state).toBeUndefined();
      expect(CONVERSION_DENOMINATOR_PROPOSAL_STATES as readonly string[]).not.toContain(state);
    }
  });

  it('🔴 ProposalState と ProposalRequestState は値を 1 つも共有しない（型 + 実行時）', () => {
    expect(PROPOSAL_AND_PROPOSAL_REQUEST_STATES_ARE_DISJOINT).toBe(true);
    const overlap = PROPOSAL_STATES.filter((state) => (PROPOSAL_REQUEST_STATES as readonly string[]).includes(state));
    expect(overlap).toEqual([]);
    // 対照: 似た名前（WITHDRAWN と WITHDRAWN_BY_HOST）が別の値であることを明示しておく。
    expect(PROPOSAL_STATES).toContain('WITHDRAWN');
    expect(PROPOSAL_REQUEST_STATES).toContain('WITHDRAWN_BY_HOST');
    expect(PROPOSAL_STATES as readonly string[]).not.toContain('WITHDRAWN_BY_HOST');
    expect(PROPOSAL_REQUEST_STATES as readonly string[]).not.toContain('WITHDRAWN');
  });
});
