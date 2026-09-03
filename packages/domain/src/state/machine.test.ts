// packages/domain/src/state/machine.test.ts
// T-02-10（docs/sprints/SP-02-schema-isolation.md）: 5 状態機械の遷移可否の**全網羅**。
// docs/05 §17.1「ユニット: packages/domain の純粋関数（状態遷移の可否）」/ §15.3 / CLAUDE.md §4.2。
//
// 🔴 「許可の一覧」ではなく「全組み合わせ」を検査する。許可だけを列挙すると、
//    遷移表に 1 本余分な線を足したときにテストが増えるだけで落ちない（= 気づけない）。
import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from './errors.js';
import { ASSIGNMENT_TRANSITIONS, assignmentMachine } from './assignment.js';
import { CONTRACT_TRANSITIONS, contractMachine } from './contract.js';
import { PROPOSAL_TRANSITIONS, proposalMachine } from './proposal.js';
import { PROPOSAL_REQUEST_TRANSITIONS, proposalRequestMachine } from './proposalRequest.js';
import { TENANT_LIFECYCLE_TRANSITIONS, tenantMachine } from './tenant.js';
import { createStateMachine } from './machine.js';

/** 型を広げた見え方（DB から読んだ文字列で呼ぶ経路と同じ形）。 */
type LooseMachine = {
  readonly entity: string;
  readonly states: readonly string[];
  canTransition(from: string, to: string): boolean;
  nextStates(from: string): readonly string[];
  isTerminal(state: string): boolean;
  isState(value: unknown): boolean;
  transition(from: string, to: string): string;
};

const MACHINES: ReadonlyArray<{
  name: string;
  machine: LooseMachine;
  table: Readonly<Record<string, readonly string[]>>;
}> = [
  { name: 'Proposal', machine: proposalMachine as unknown as LooseMachine, table: PROPOSAL_TRANSITIONS },
  {
    name: 'ProposalRequest',
    machine: proposalRequestMachine as unknown as LooseMachine,
    table: PROPOSAL_REQUEST_TRANSITIONS,
  },
  { name: 'Assignment', machine: assignmentMachine as unknown as LooseMachine, table: ASSIGNMENT_TRANSITIONS },
  { name: 'Contract', machine: contractMachine as unknown as LooseMachine, table: CONTRACT_TRANSITIONS },
  { name: 'Tenant', machine: tenantMachine as unknown as LooseMachine, table: TENANT_LIFECYCLE_TRANSITIONS },
];

describe.each(MACHINES)('$name の遷移表（CLAUDE.md §4.2）', ({ name, machine, table }) => {
  it('遷移表に載っている組はすべて成功し、載っていない組はすべて 422 で落ちる（全網羅）', () => {
    for (const from of machine.states) {
      for (const to of machine.states) {
        const allowed = table[from]?.includes(to) ?? false;
        expect(machine.canTransition(from, to), `${name}: ${from} -> ${to}`).toBe(allowed);
        if (allowed) {
          expect(machine.transition(from, to)).toBe(to);
        } else {
          expect(() => machine.transition(from, to), `${name}: ${from} -> ${to}`).toThrow(
            InvalidStateTransitionError,
          );
        }
      }
    }
  });

  it('🔴 自己遷移（from = to）は 1 つも許可されていない', () => {
    for (const state of machine.states) {
      expect(machine.canTransition(state, state), `${name}: ${state} -> ${state}`).toBe(false);
    }
  });

  it('未知の状態は遷移元にも遷移先にもできない（サイレントに無視しない）', () => {
    expect(machine.isState('NOPE')).toBe(false);
    expect(() => machine.transition('NOPE', machine.states[0] as string)).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => machine.transition(machine.states[0] as string, 'NOPE')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('例外は 422 / error.state.invalidTransition を持ち、entity・from・to を記録する', () => {
    const from = machine.states[0] as string;
    try {
      machine.transition(from, 'NOPE');
      expect.unreachable('例外が投げられていない');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      const typed = error as InvalidStateTransitionError;
      expect(typed.httpStatus).toBe(422);
      expect(typed.userMessageKey).toBe('error.state.invalidTransition');
      expect(typed.entity).toBe(name);
      expect(typed.from).toBe(from);
      expect(typed.to).toBe('NOPE');
    }
  });
});

describe('🔴 CLAUDE.md §4.2 / docs/05 §10.3 が名指しで禁じている組', () => {
  it('Proposal: APPROVAL_PENDING -> SUBMITTING（承認を経ない実行遷移）が存在しない', () => {
    expect(proposalMachine.canTransition('APPROVAL_PENDING', 'SUBMITTING')).toBe(false);
    // @ts-expect-error docs/05 §10.3「APPROVAL_PENDING → SUBMITTING の組が型に存在しない」
    expect(() => proposalMachine.transition('APPROVAL_PENDING', 'SUBMITTING')).toThrow();
  });

  it('Proposal: GATE_FAILED から送信側へ直接進めない（元データを直す以外に道が無い）', () => {
    expect(proposalMachine.nextStates('GATE_FAILED')).toEqual(['DRAFT']);
  });

  it('Proposal: SUBMITTING は片道（SUBMITTED / SUBMIT_FAILED にしか行けない）', () => {
    expect(proposalMachine.nextStates('SUBMITTING')).toEqual(['SUBMITTED', 'SUBMIT_FAILED']);
  });

  it('Proposal: SUBMIT_FAILED からの復帰先は APPROVED だけ（人間の明示操作）', () => {
    expect(proposalMachine.nextStates('SUBMIT_FAILED')).toEqual(['APPROVED']);
  });

  it('Contract: SENDING は片道で、SEND_FAILED からの復帰先は DRAFT だけ', () => {
    expect(contractMachine.nextStates('SENDING')).toEqual(['UNDER_REVIEW', 'SEND_FAILED']);
    expect(contractMachine.nextStates('SEND_FAILED')).toEqual(['DRAFT']);
  });

  it('Contract: EXECUTED から戻れない（訂正は新しい Contract を起こす）', () => {
    expect(contractMachine.nextStates('EXECUTED')).toEqual(['EXPIRED']);
  });

  it('終端状態が CLAUDE.md §4.2 のとおりである', () => {
    expect(proposalMachine.states.filter((s) => proposalMachine.isTerminal(s))).toEqual([
      'WON',
      'LOST',
      'WITHDRAWN',
    ]);
    expect(assignmentMachine.states.filter((s) => assignmentMachine.isTerminal(s))).toEqual(['ENDED']);
    expect(tenantMachine.states.filter((s) => tenantMachine.isTerminal(s))).toEqual(['PURGED']);
    expect(
      proposalRequestMachine.states.filter((s) => proposalRequestMachine.isTerminal(s)),
    ).toEqual(['ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED']);
  });
});

describe('遷移表と状態一覧の不一致は生成時に落ちる（状態の追加漏れを見逃さない）', () => {
  it('状態一覧にある状態の行が遷移表に無ければ例外', () => {
    expect(() =>
      createStateMachine('Tenant', ['A', 'B'] as const, { A: ['B'] } as unknown as {
        readonly A: readonly ('A' | 'B')[];
        readonly B: readonly ('A' | 'B')[];
      }),
    ).toThrow(/遷移表に B の行がありません/);
  });

  it('遷移表の遷移先が状態一覧に無ければ例外', () => {
    expect(() =>
      createStateMachine('Tenant', ['A', 'B'] as const, {
        A: ['C'],
        B: [],
      } as unknown as { readonly A: readonly ('A' | 'B')[]; readonly B: readonly ('A' | 'B')[] }),
    ).toThrow(/遷移先が状態一覧にありません/);
  });
});
