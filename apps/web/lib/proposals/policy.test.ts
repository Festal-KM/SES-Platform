// apps/web/lib/proposals/policy.test.ts
// 🔴 レビュー依頼（#39）の入口（docs/05 §9.10 ①「作成者 / `SALES` / `ADMIN`」）を固定する。T-07-08。
import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@ses/db';
import {
  canRequestProposalGate,
  HOST_GATE_REQUEST_ROLES,
  PROPOSAL_GATE_REQUEST_ROLES,
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
