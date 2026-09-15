// apps/web/lib/proposals/approval.test.ts
// 🔴 T-09-02 の申し送り（docs/05 §6.5「#48 の実装の決着」末尾）: **本経路（#41 / #42）が動かす組の所有者を固定する。**
//    `APPROVAL_PENDING → APPROVED` = `APPROVE` / `APPROVAL_PENDING → DRAFT` = `REJECT` であり、#48 の `MANUAL` と重ならない。
//    遷移表側で所有者を付け替えたら、`assertOwnedTransition` が実行時に 422 で止まる（静かに通り抜けない）ことも、
//    ここで `proposalTransitionOwner()` の実値と突き合わせて固定する。
import { describe, expect, it } from 'vitest';
import {
  isManualProposalTransition,
  PROPOSAL_STATES,
  PROPOSAL_TRANSITION_OWNERS,
  proposalMachine,
  proposalTransitionOwner,
} from '@ses/domain';
import { PROPOSAL_APPROVE_TRANSITION, PROPOSAL_REJECT_TRANSITION } from './approval';

describe('🔴 #41 / #42 が動かす遷移の所有者（T-09-02 の申し送り）', () => {
  it('APPROVAL_PENDING → APPROVED の所有者は APPROVE（#41 の専有）であり、本モジュールの定数と一致する', () => {
    expect(proposalTransitionOwner('APPROVAL_PENDING', 'APPROVED')).toBe('APPROVE');
    expect(PROPOSAL_APPROVE_TRANSITION).toEqual({ from: 'APPROVAL_PENDING', to: 'APPROVED', owner: 'APPROVE' });
    expect(proposalTransitionOwner(PROPOSAL_APPROVE_TRANSITION.from, PROPOSAL_APPROVE_TRANSITION.to)).toBe(
      PROPOSAL_APPROVE_TRANSITION.owner,
    );
  });

  it('APPROVAL_PENDING → DRAFT の所有者は REJECT（#42 の専有）であり、本モジュールの定数と一致する', () => {
    expect(proposalTransitionOwner('APPROVAL_PENDING', 'DRAFT')).toBe('REJECT');
    expect(PROPOSAL_REJECT_TRANSITION).toEqual({ from: 'APPROVAL_PENDING', to: 'DRAFT', owner: 'REJECT' });
    expect(proposalTransitionOwner(PROPOSAL_REJECT_TRANSITION.from, PROPOSAL_REJECT_TRANSITION.to)).toBe(
      PROPOSAL_REJECT_TRANSITION.owner,
    );
  });

  it('🔴 どちらも #48 の MANUAL ではない（汎用の遷移 API から承認・却下を起こせない）', () => {
    expect(isManualProposalTransition('APPROVAL_PENDING', 'APPROVED')).toBe(false);
    expect(isManualProposalTransition('APPROVAL_PENDING', 'DRAFT')).toBe(false);
  });

  it('🔴 APPROVE / REJECT を所有者に持つ遷移はそれぞれ 1 本だけ（承認・却下の入口が増えていない）', () => {
    const owners = Object.entries(PROPOSAL_TRANSITION_OWNERS);
    expect(owners.filter(([, owner]) => owner === 'APPROVE').map(([key]) => key)).toEqual(['APPROVAL_PENDING->APPROVED']);
    expect(owners.filter(([, owner]) => owner === 'REJECT').map(([key]) => key)).toEqual(['APPROVAL_PENDING->DRAFT']);
  });

  it('🔴 APPROVED へ入る遷移は APPROVE と RESEND の 2 本だけで、#41 が動かせるのは前者だけ（SUBMIT_FAILED → APPROVED は #44 の専有）', () => {
    const intoApproved = PROPOSAL_STATES.filter((from) => proposalMachine.canTransition(from, 'APPROVED'));
    expect(intoApproved).toEqual(['APPROVAL_PENDING', 'SUBMIT_FAILED']);
    expect(proposalTransitionOwner('SUBMIT_FAILED', 'APPROVED')).toBe('RESEND');
  });

  it('🔴 docs/05 §10.3: APPROVAL_PENDING → SUBMITTING の組が遷移表に存在しない（承認を経ない実行遷移が型・実行時ともに不可能）', () => {
    expect(proposalMachine.canTransition('APPROVAL_PENDING', 'SUBMITTING')).toBe(false);
    expect(proposalMachine.canTransition('APPROVAL_PENDING', 'SUBMITTED')).toBe(false);
    expect(proposalMachine.canTransition('GATE_FAILED', 'SUBMITTING')).toBe(false);
    expect(proposalMachine.canTransition('DRAFT', 'SUBMITTING')).toBe(false);
    // SUBMITTING に入れるのは APPROVED からだけ。
    expect(PROPOSAL_STATES.filter((from) => proposalMachine.canTransition(from, 'SUBMITTING'))).toEqual(['APPROVED']);
  });
});
