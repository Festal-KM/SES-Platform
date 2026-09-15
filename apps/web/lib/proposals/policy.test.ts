// apps/web/lib/proposals/policy.test.ts
// 🔴 レビュー依頼（#39）の入口（docs/05 §9.10 ①「作成者 / `SALES` / `ADMIN`」）を固定する。T-07-08。
import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@ses/db';
import type { ProposalState } from '@ses/domain';
import {
  canEditProposal,
  canRequestProposalGate,
  canTransitionProposal,
  HOST_GATE_REQUEST_ROLES,
  isProposalEditorRole,
  PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS,
  PROPOSAL_EDITOR_ROLES,
  PROPOSAL_GATE_REQUEST_ROLES,
  PROPOSAL_TRANSITION_ROLES,
  type GateRequestActor,
} from './policy';

const CREATOR = 'user-creator';
const OTHER = 'user-other';
const PARTNER = 'partner-1';

function actor(role: TenantRole, options?: Partial<GateRequestActor>): GateRequestActor {
  return {
    userId: OTHER,
    role,
    partnerCompanyId: null,
    ...options,
  };
}

describe('canRequestProposalGate（docs/05 §9.10 ①）', () => {
  it.each(['OWNER', 'ADMIN', 'SALES'] as const)(
    'ホストの %s は、他人が作った提案でも依頼できる（承認・送信の当事者だから）',
    (role) => {
      expect(canRequestProposalGate(actor(role), { createdBy: CREATOR })).toBe(true);
    },
  );

  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '%s は、**自分が作った**提案なら依頼できる（提案を作るのは取引先である）',
    (role) => {
      expect(
        canRequestProposalGate(
          actor(role, { userId: CREATOR, partnerCompanyId: PARTNER }),
          { createdBy: CREATOR },
        ),
      ).toBe(true);
    },
  );

  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '🔴 %s は、自社の**他人**が作った提案には依頼できない（入口を広げない）',
    (role) => {
      expect(
        canRequestProposalGate(actor(role, { partnerCompanyId: PARTNER }), { createdBy: CREATOR }),
      ).toBe(false);
    },
  );

  it('🔴 VIEWER は作成者でなければ依頼できない（ロールでは通れない）', () => {
    expect(canRequestProposalGate(actor('VIEWER'), { createdBy: CREATOR })).toBe(false);
  });

  it('🔴 VIEWER が作成者であることは起こりえないが、起きても API では requireRole / requireNotViewer が先に落とす', () => {
    expect((PROPOSAL_GATE_REQUEST_ROLES as readonly TenantRole[]).includes('VIEWER')).toBe(false);
  });

  it('🔴 ホスト判定は「ロール」ではなく「所属」も見る（パートナー所属の SALES は存在しないが、型では作れる）', () => {
    expect(
      canRequestProposalGate(actor('SALES', { partnerCompanyId: PARTNER }), { createdBy: CREATOR }),
    ).toBe(false);
  });

  it('ホストのロール集合は #39 の許可ロールの部分集合である', () => {
    for (const role of HOST_GATE_REQUEST_ROLES) {
      expect((PROPOSAL_GATE_REQUEST_ROLES as readonly TenantRole[]).includes(role)).toBe(true);
    }
  });
});

describe('✅ T-09-01 canEditProposal（#37）は #39 の canRequestProposalGate と同じ判定である', () => {
  const subjects = [{ createdBy: CREATOR }, { createdBy: OTHER }];
  const actors: readonly GateRequestActor[] = [
    actor('OWNER'),
    actor('ADMIN'),
    actor('SALES'),
    actor('VIEWER'),
    actor('SALES', { partnerCompanyId: PARTNER }),
    actor('PARTNER_ADMIN', { userId: CREATOR, partnerCompanyId: PARTNER }),
    actor('PARTNER_SALES', { userId: CREATOR, partnerCompanyId: PARTNER }),
    actor('PARTNER_ADMIN', { partnerCompanyId: PARTNER }),
    actor('PARTNER_SALES', { partnerCompanyId: PARTNER }),
    actor('VIEWER', { userId: CREATOR, partnerCompanyId: PARTNER }),
  ];

  it('全組み合わせで一致する（埋められるのに出せない / 出せるのに埋められない立場を作らない）', () => {
    for (const a of actors) {
      for (const subject of subjects) {
        expect(canEditProposal(a, subject)).toBe(canRequestProposalGate(a, subject));
      }
    }
  });

  it('🔴 パートナー所属の非作成者は編集できない（同じ取引先の別の担当者にも開かない）', () => {
    expect(canEditProposal(actor('PARTNER_SALES', { partnerCompanyId: PARTNER }), { createdBy: CREATOR })).toBe(false);
    expect(canEditProposal(actor('PARTNER_ADMIN', { partnerCompanyId: PARTNER }), { createdBy: CREATOR })).toBe(false);
  });

  it('PROPOSAL_EDITOR_ROLES は #39 の許可ロールと同じ集合で、VIEWER を含まない', () => {
    expect([...PROPOSAL_EDITOR_ROLES]).toEqual([...PROPOSAL_GATE_REQUEST_ROLES]);
    expect((PROPOSAL_EDITOR_ROLES as readonly TenantRole[]).includes('VIEWER')).toBe(false);
    expect(isProposalEditorRole('VIEWER')).toBe(false);
    expect(isProposalEditorRole('PARTNER_SALES')).toBe(true);
    expect(isProposalEditorRole('OWNER')).toBe(true);
  });
});

// ============================================================================
// T-09-02: canTransitionProposal（docs/05 §6.5「#48 の実装の決着」）
// ============================================================================

/** #48 が受ける 10 本（所有者 MANUAL）。 */
const MANUAL_PAIRS: ReadonlyArray<readonly [ProposalState, ProposalState]> = [
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

/** 取引先が自社提案に記録できる 6 本（docs/04 §S-024「面談実施・辞退」）。 */
const PARTNER_PAIRS: ReadonlyArray<readonly [ProposalState, ProposalState]> = [
  ['INTERVIEW_SCHEDULED', 'INTERVIEWED'],
  ['INTERVIEWED', 'RESULT_PENDING'],
  ['SUBMITTED', 'WITHDRAWN'],
  ['INTERVIEW_SCHEDULED', 'WITHDRAWN'],
  ['INTERVIEWED', 'WITHDRAWN'],
  ['RESULT_PENDING', 'WITHDRAWN'],
];

function pair(from: ProposalState, to: ProposalState) {
  return { from, to };
}

describe('canTransitionProposal（#48。docs/05 §6.5「#48 の実装の決着」）', () => {
  it('PROPOSAL_TRANSITION_ROLES は #39 と同じ集合で VIEWER を含まない', () => {
    expect(PROPOSAL_TRANSITION_ROLES).toBe(PROPOSAL_GATE_REQUEST_ROLES);
    expect(PROPOSAL_TRANSITION_ROLES).not.toContain('VIEWER');
    expect(PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS).toEqual(PARTNER_PAIRS);
  });

  it.each(['OWNER', 'ADMIN', 'SALES'] as const)('ホストの %s は MANUAL の 10 本すべてを行える（他人が作った提案でも）', (role) => {
    for (const [from, to] of MANUAL_PAIRS) {
      expect(canTransitionProposal(actor(role), { createdBy: CREATOR }, pair(from, to)), `${from} -> ${to}`).toBe(true);
    }
  });

  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '%s は自社提案の面談実施・辞退（6 本）を記録でき、面談日程の確定と結果の確定（WON / LOST）は行えない',
    (role) => {
      const partner = actor(role, { partnerCompanyId: PARTNER });
      for (const [from, to] of MANUAL_PAIRS) {
        const expected = PARTNER_PAIRS.some(([f, t]) => f === from && t === to);
        expect(canTransitionProposal(partner, { createdBy: CREATOR }, pair(from, to)), `${from} -> ${to}`).toBe(expected);
      }
      expect(canTransitionProposal(partner, { createdBy: CREATOR }, pair('SUBMITTED', 'INTERVIEW_SCHEDULED'))).toBe(false);
      expect(canTransitionProposal(partner, { createdBy: CREATOR }, pair('RESULT_PENDING', 'WON'))).toBe(false);
      expect(canTransitionProposal(partner, { createdBy: CREATOR }, pair('RESULT_PENDING', 'LOST'))).toBe(false);
    },
  );

  it('GATE_FAILED -> DRAFT は canEditProposal と同じ線（作成者 / ホストの OWNER・ADMIN・SALES）', () => {
    const back = pair('GATE_FAILED', 'DRAFT');
    expect(canTransitionProposal(actor('PARTNER_SALES', { userId: CREATOR, partnerCompanyId: PARTNER }), { createdBy: CREATOR }, back)).toBe(true);
    expect(canTransitionProposal(actor('PARTNER_ADMIN', { partnerCompanyId: PARTNER }), { createdBy: CREATOR }, back)).toBe(false);
    expect(canTransitionProposal(actor('SALES'), { createdBy: CREATOR }, back)).toBe(true);
    expect(canTransitionProposal(actor('OWNER'), { createdBy: CREATOR }, back)).toBe(true);
    // 🔴 一方、商談の記録は「作成者だから」では通らない（取引先の作成者でも結果の確定は不可）。
    expect(
      canTransitionProposal(actor('PARTNER_SALES', { userId: CREATOR, partnerCompanyId: PARTNER }), { createdBy: CREATOR }, pair('RESULT_PENDING', 'WON')),
    ).toBe(false);
  });

  it('🔴 VIEWER は作成者であっても 1 本も行えない（BR-31）', () => {
    for (const [from, to] of MANUAL_PAIRS) {
      expect(canTransitionProposal(actor('VIEWER', { userId: CREATOR }), { createdBy: CREATOR }, pair(from, to)), `${from} -> ${to}`).toBe(false);
      expect(
        canTransitionProposal(actor('VIEWER', { userId: CREATOR, partnerCompanyId: PARTNER }), { createdBy: CREATOR }, pair(from, to)),
        `partner ${from} -> ${to}`,
      ).toBe(false);
    }
  });

  it('🔴 MANUAL でない遷移（専有 / 遷移表に無い）は、どの立場でも false', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES'] as const) {
      expect(canTransitionProposal(actor(role), { createdBy: OTHER }, pair('APPROVAL_PENDING', 'APPROVED'))).toBe(false);
      expect(canTransitionProposal(actor(role), { createdBy: OTHER }, pair('APPROVAL_PENDING', 'DRAFT'))).toBe(false);
      expect(canTransitionProposal(actor(role), { createdBy: OTHER }, pair('SUBMIT_FAILED', 'APPROVED'))).toBe(false);
      expect(canTransitionProposal(actor(role), { createdBy: OTHER }, pair('DRAFT', 'GATE_RUNNING'))).toBe(false);
      expect(canTransitionProposal(actor(role), { createdBy: OTHER }, pair('DRAFT', 'WON'))).toBe(false);
    }
  });

  it('🔴 ホスト文脈の PARTNER_* / 取引先文脈の SALES（食い違った ctx）は通らない', () => {
    expect(canTransitionProposal(actor('PARTNER_SALES'), { createdBy: OTHER }, pair('SUBMITTED', 'WITHDRAWN'))).toBe(false);
    expect(canTransitionProposal(actor('SALES', { partnerCompanyId: PARTNER }), { createdBy: OTHER }, pair('SUBMITTED', 'WITHDRAWN'))).toBe(false);
  });
});
