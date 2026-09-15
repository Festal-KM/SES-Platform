// packages/domain/src/state/proposal.test.ts
// T-09-02（docs/sprints/SP-09-proposal-flow.md §5）: `Proposal` の遷移ごとの所有者（docs/05 §6.5
// 「#48 の実装の決着」/ §10.3 / §10.6 / CLAUDE.md §3.3 / §3.4 / §4.2）。
//
// 🔴 遷移の可否そのもの（14 × 14 の全網羅）は `machine.test.ts` が 5 機械共通で検査している。
//    ここで固定するのは「**遷移表にある組のすべてに所有者があり、遷移表に無い組には所有者が無い**」
//    という 14 × 14 の対応と、「#48 から呼べてはならない遷移が `MANUAL` になっていない」ことである。
//    許可の一覧だけを見ると、遷移表に線を 1 本足したときに所有者が漏れても気づけない。
import { describe, expect, it } from 'vitest';
import {
  isManualProposalTransition,
  PROPOSAL_MANUAL_TRANSITION_TARGET_STATES,
  PROPOSAL_MANUAL_TRANSITION_TARGETS_MATCH_OWNERS,
  PROPOSAL_STATES,
  PROPOSAL_TRANSITION_OWNERS,
  PROPOSAL_TRANSITIONS,
  proposalMachine,
  proposalTransitionKey,
  proposalTransitionOwner,
  type ProposalState,
  type ProposalTransitionOwner,
} from './proposal.js';

const OWNERS: Readonly<Record<string, ProposalTransitionOwner>> = PROPOSAL_TRANSITION_OWNERS;
const TABLE: Readonly<Record<string, readonly string[]>> = PROPOSAL_TRANSITIONS;

/** 🔴 #48 から呼べてはならない遷移（タスク仕様の列挙。docs/05 §6.5「#48 の実装の決着」の表）。 */
const RESERVED: ReadonlyArray<readonly [ProposalState, ProposalState, ProposalTransitionOwner]> = [
  ['DRAFT', 'GATE_RUNNING', 'GATE_REQUEST'],
  ['GATE_RUNNING', 'GATE_FAILED', 'GATE_JOB'],
  ['GATE_RUNNING', 'APPROVAL_PENDING', 'GATE_JOB'],
  ['APPROVAL_PENDING', 'APPROVED', 'APPROVE'],
  ['APPROVAL_PENDING', 'DRAFT', 'REJECT'],
  ['APPROVED', 'SUBMITTING', 'SEND_JOB'],
  ['SUBMITTING', 'SUBMITTED', 'SEND_JOB'],
  ['SUBMITTING', 'SUBMIT_FAILED', 'SEND_JOB'],
  ['SUBMIT_FAILED', 'APPROVED', 'RESEND'],
];

/** #48 が受ける遷移（docs/02 章 5.1 遷移 4 / 11〜15）。 */
const MANUAL: ReadonlyArray<readonly [ProposalState, ProposalState]> = [
  ['GATE_FAILED', 'DRAFT'],
  ['SUBMITTED', 'INTERVIEW_SCHEDULED'],
  ['INTERVIEW_SCHEDULED', 'INTERVIEWED'],
  ['INTERVIEWED', 'RESULT_PENDING'],
  ['RESULT_PENDING', 'WON'],
  ['RESULT_PENDING', 'LOST'],
  ['SUBMITTED', 'WITHDRAWN'],
  ['INTERVIEW_SCHEDULED', 'WITHDRAWN'],
  ['INTERVIEWED', 'WITHDRAWN'],
  ['RESULT_PENDING', 'WITHDRAWN'],
];

describe('PROPOSAL_TRANSITION_OWNERS と遷移表の対応（14 × 14 の全網羅）', () => {
  it('遷移表にある組には所有者が 1 つあり、遷移表に無い組には所有者が無い', () => {
    let owned = 0;
    for (const from of PROPOSAL_STATES) {
      for (const to of PROPOSAL_STATES) {
        const inTable = TABLE[from]?.includes(to) ?? false;
        const key = proposalTransitionKey(from, to);
        expect(key in OWNERS, `${key} の所有者`).toBe(inTable);
        expect(proposalTransitionOwner(from, to) === null, `${key} の owner()`).toBe(!inTable);
        if (inTable) owned += 1;
      }
    }
    // 🔴 CLAUDE.md §4.2 の Proposal は 19 本。所有者の表も 19 行で、余分な行が無い。
    expect(owned).toBe(19);
    expect(Object.keys(OWNERS)).toHaveLength(19);
  });

  it('所有者の表のキーは `${from}->${to}` の形で、両端が既知の状態である', () => {
    for (const key of Object.keys(OWNERS)) {
      const [from, to, ...rest] = key.split('->');
      expect(rest).toEqual([]);
      expect(proposalMachine.isState(from), key).toBe(true);
      expect(proposalMachine.isState(to), key).toBe(true);
    }
  });
});

describe('🔴 #48 の射程（docs/05 §6.5「#48 の実装の決着」）', () => {
  it.each(RESERVED)('%s -> %s は %s の専有であり MANUAL ではない（#48 から呼べない）', (from, to, owner) => {
    expect(proposalMachine.canTransition(from, to)).toBe(true);
    expect(proposalTransitionOwner(from, to)).toBe(owner);
    expect(isManualProposalTransition(from, to)).toBe(false);
  });

  it.each(MANUAL)('%s -> %s は MANUAL（#48 が受ける）', (from, to) => {
    expect(proposalMachine.canTransition(from, to)).toBe(true);
    expect(proposalTransitionOwner(from, to)).toBe('MANUAL');
    expect(isManualProposalTransition(from, to)).toBe(true);
  });

  it('MANUAL は 10 本で、RESERVED（9 本）と合わせて遷移表の 19 本を過不足なく覆う', () => {
    const manualKeys = Object.entries(OWNERS)
      .filter(([, owner]) => owner === 'MANUAL')
      .map(([key]) => key)
      .sort();
    expect(manualKeys).toEqual(MANUAL.map(([from, to]) => proposalTransitionKey(from, to)).sort());
    expect(manualKeys).toHaveLength(10);
    expect(RESERVED).toHaveLength(9);
    expect(manualKeys.length + RESERVED.length).toBe(Object.keys(OWNERS).length);
  });

  it('遷移表に無い組は MANUAL でも所有者付きでもない（DRAFT -> WON / SUBMITTED -> WON など）', () => {
    expect(isManualProposalTransition('DRAFT', 'WON')).toBe(false);
    expect(isManualProposalTransition('SUBMITTED', 'WON')).toBe(false);
    expect(isManualProposalTransition('APPROVAL_PENDING', 'SUBMITTING')).toBe(false);
    expect(proposalTransitionOwner('WON', 'DRAFT')).toBeNull();
  });

  it('🔴 SUBMIT_FAILED -> APPROVED（人間の再実行）は RESEND であり、#48 の汎用経路では起こせない（§10.6）', () => {
    expect(proposalTransitionOwner('SUBMIT_FAILED', 'APPROVED')).toBe('RESEND');
    expect(isManualProposalTransition('SUBMIT_FAILED', 'APPROVED')).toBe(false);
  });

  it('🔴 SUBMITTING は片道で、その両端の遷移はすべて送信ジョブの専有（自動リトライも人間の操作も入らない）', () => {
    expect(proposalTransitionOwner('APPROVED', 'SUBMITTING')).toBe('SEND_JOB');
    expect(proposalTransitionOwner('SUBMITTING', 'SUBMITTED')).toBe('SEND_JOB');
    expect(proposalTransitionOwner('SUBMITTING', 'SUBMIT_FAILED')).toBe('SEND_JOB');
  });

  it('🔴 APPROVED へ入る遷移に MANUAL が無い（承認を経ずに / 人間が汎用 API で APPROVED を書けない。§3.3 / §10.3）', () => {
    for (const from of PROPOSAL_STATES) {
      expect(isManualProposalTransition(from, 'APPROVED'), `${from} -> APPROVED`).toBe(false);
      expect(isManualProposalTransition(from, 'SUBMITTED'), `${from} -> SUBMITTED`).toBe(false);
      expect(isManualProposalTransition(from, 'SUBMITTING'), `${from} -> SUBMITTING`).toBe(false);
      expect(isManualProposalTransition(from, 'GATE_RUNNING'), `${from} -> GATE_RUNNING`).toBe(false);
      expect(isManualProposalTransition(from, 'GATE_FAILED'), `${from} -> GATE_FAILED`).toBe(false);
      expect(isManualProposalTransition(from, 'APPROVAL_PENDING'), `${from} -> APPROVAL_PENDING`).toBe(false);
      expect(isManualProposalTransition(from, 'SUBMIT_FAILED'), `${from} -> SUBMIT_FAILED`).toBe(false);
    }
  });
});

describe('PROPOSAL_MANUAL_TRANSITION_TARGET_STATES（#48 の `to` の列挙）', () => {
  it('MANUAL の遷移先の集合と一致し、PROPOSAL_STATES の並び順に従う', () => {
    const derived = new Set(
      Object.entries(OWNERS)
        .filter(([, owner]) => owner === 'MANUAL')
        .map(([key]) => key.split('->')[1]),
    );
    const expected = PROPOSAL_STATES.filter((state) => derived.has(state));
    expect([...PROPOSAL_MANUAL_TRANSITION_TARGET_STATES]).toEqual(expected);
    expect(PROPOSAL_MANUAL_TRANSITION_TARGETS_MATCH_OWNERS).toBe(true);
  });

  it('🔴 送信側の状態（GATE_RUNNING / GATE_FAILED / APPROVAL_PENDING / APPROVED / SUBMITTING / SUBMITTED / SUBMIT_FAILED）を含まない', () => {
    const targets: readonly string[] = PROPOSAL_MANUAL_TRANSITION_TARGET_STATES;
    for (const state of [
      'GATE_RUNNING',
      'GATE_FAILED',
      'APPROVAL_PENDING',
      'APPROVED',
      'SUBMITTING',
      'SUBMITTED',
      'SUBMIT_FAILED',
    ]) {
      expect(targets, state).not.toContain(state);
    }
    expect(targets).toHaveLength(7);
  });
});
