// apps/web/lib/proposals/resend.test.ts
// 🔴 T-09-02 の申し送り（docs/05 §6.5「#48 の実装の決着」末尾）: **本経路（#44）が動かす組の所有者を固定する。**
//    `SUBMIT_FAILED → APPROVED` = `RESEND` であり、#41（`APPROVE`）/ #48（`MANUAL`）/ 送信ジョブ（`SEND_JOB`）と重ならない。
//    遷移表側で所有者を付け替えたら、`assertResendable` が実行時に 422 で止まる（静かに通り抜けない）ことも、
//    ここで `proposalTransitionOwner()` の実値と突き合わせて固定する。
// 🔴 `PROPOSAL_TRANSITION_OWNERS` には触れない（T-09-08 の制約）。読むだけ。
import { describe, expect, it } from 'vitest';
import {
  isManualProposalTransition,
  PROPOSAL_STATES,
  PROPOSAL_TRANSITION_OWNERS,
  proposalMachine,
  proposalTransitionOwner,
} from '@ses/domain';
import { PROPOSAL_RESEND_TRANSITION } from './resend';

describe('🔴 #44 が動かす遷移の所有者（T-09-02 の申し送り / docs/05 §10.6）', () => {
  it('SUBMIT_FAILED → APPROVED の所有者は RESEND（#44 の専有）であり、本モジュールの定数と一致する', () => {
    expect(proposalTransitionOwner('SUBMIT_FAILED', 'APPROVED')).toBe('RESEND');
    expect(PROPOSAL_RESEND_TRANSITION).toEqual({ from: 'SUBMIT_FAILED', to: 'APPROVED', owner: 'RESEND' });
    expect(proposalTransitionOwner(PROPOSAL_RESEND_TRANSITION.from, PROPOSAL_RESEND_TRANSITION.to)).toBe(
      PROPOSAL_RESEND_TRANSITION.owner,
    );
  });

  it('🔴 #48 の MANUAL ではない（汎用の遷移 API から再送を起こせない）', () => {
    expect(isManualProposalTransition('SUBMIT_FAILED', 'APPROVED')).toBe(false);
  });

  it('🔴 RESEND を所有者に持つ遷移は 1 本だけ（再送の入口が増えていない）', () => {
    const owners = Object.entries(PROPOSAL_TRANSITION_OWNERS);
    expect(owners.filter(([, owner]) => owner === 'RESEND').map(([key]) => key)).toEqual(['SUBMIT_FAILED->APPROVED']);
  });

  it('🔴 SUBMIT_FAILED から出る遷移は APPROVED への 1 本だけ（SUBMITTING / SUBMITTED へ直接は行けない = 再送も F-022 の手順を通る）', () => {
    expect(PROPOSAL_STATES.filter((to) => proposalMachine.canTransition('SUBMIT_FAILED', to))).toEqual(['APPROVED']);
    expect(proposalMachine.canTransition('SUBMIT_FAILED', 'SUBMITTING')).toBe(false);
    expect(proposalMachine.canTransition('SUBMIT_FAILED', 'SUBMITTED')).toBe(false);
  });

  it('🔴 SUBMIT_FAILED へ入るのは SUBMITTING からだけ（SEND_JOB の専有）。自動で APPROVED に戻る遷移は SUBMITTING から存在しない', () => {
    expect(PROPOSAL_STATES.filter((from) => proposalMachine.canTransition(from, 'SUBMIT_FAILED'))).toEqual(['SUBMITTING']);
    expect(proposalTransitionOwner('SUBMITTING', 'SUBMIT_FAILED')).toBe('SEND_JOB');
    expect(proposalMachine.canTransition('SUBMITTING', 'APPROVED')).toBe(false);
  });
});
