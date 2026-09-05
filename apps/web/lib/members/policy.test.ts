// apps/web/lib/members/policy.test.ts
// 🔴 `F-002 AC-4`（`PARTNER_ADMIN` は自社配下のみ）と、ロール変更・無効化の判定表を
//    全組み合わせで固定する。T-04-09。
//
//    DB 付きの結合テスト（`tests/isolation/members.test.ts`）は「その判定が実際の経路で
//    効いていること」を見る。ここは判定表の網羅であり、両方が要る
//    （判定が正しくても呼ばれなければ意味が無く、呼ばれても判定が抜けていれば意味が無い）。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import { HOST_TENANT_ROLES, PARTNER_TENANT_ROLES } from '../tenants/roles';
import {
  decideMemberRevoke,
  decideMemberRoleChange,
  isMemberManagerRole,
  MEMBER_MANAGER_ROLES,
  type MemberActor,
  type MemberTarget,
} from './policy';

const PARTNER_1 = '01930000-0000-7000-8000-0000000000c1';
const PARTNER_2 = '01930000-0000-7000-8000-0000000000c2';
const ACTOR_USER = '01930000-0000-7000-8000-0000000000u1';
const OTHER_USER = '01930000-0000-7000-8000-0000000000u2';

const HOST_OWNER: MemberActor = { role: 'OWNER', partnerCompanyId: null, userId: ACTOR_USER };
const HOST_ADMIN: MemberActor = { role: 'ADMIN', partnerCompanyId: null, userId: ACTOR_USER };
const PARTNER_ADMIN: MemberActor = {
  role: 'PARTNER_ADMIN',
  partnerCompanyId: PARTNER_1,
  userId: ACTOR_USER,
};

/** 「OWNER は複数居る」= 最後の 1 人の規則が発火しない既定。 */
const PLENTY_OWNERS = { activeOwnerCount: 3 } as const;
const LAST_OWNER = { activeOwnerCount: 1 } as const;

function hostTarget(overrides: Partial<MemberTarget> = {}): MemberTarget {
  return { userId: OTHER_USER, role: 'SALES', partnerCompanyId: null, revoked: false, ...overrides };
}

function partnerTarget(overrides: Partial<MemberTarget> = {}): MemberTarget {
  return {
    userId: OTHER_USER,
    role: 'PARTNER_SALES',
    partnerCompanyId: PARTNER_1,
    revoked: false,
    ...overrides,
  };
}

describe('🔴 requireRole に渡すロール一覧が decide* とずれない', () => {
  /**
   * `MEMBER_MANAGER_ROLES`（`requireRole` の引数）と、判定が `allowed` を返しうるロールの集合が
   * 一致することを固定する（招待側の `INVITATION_ISSUER_ROLES` と同じ規律）。
   * 片方だけ広げても、もう片方が拒否して fail-closed になることの裏返しでもある。
   */
  it('allowed を返しうるロールの集合と一致する', () => {
    const allowedRoles = TENANT_ROLES.filter((role) => {
      const asHost = decideMemberRoleChange(
        { role, partnerCompanyId: null, userId: ACTOR_USER },
        hostTarget(),
        'ADMIN',
        PLENTY_OWNERS,
      );
      const asPartner = decideMemberRoleChange(
        { role, partnerCompanyId: PARTNER_1, userId: ACTOR_USER },
        partnerTarget(),
        'PARTNER_ADMIN',
        PLENTY_OWNERS,
      );
      return asHost.allowed || asPartner.allowed;
    });

    expect([...allowedRoles].sort()).toEqual([...MEMBER_MANAGER_ROLES].sort());
  });

  it('isMemberManagerRole は MEMBER_MANAGER_ROLES と同じ集合を表す', () => {
    for (const role of TENANT_ROLES) {
      expect(isMemberManagerRole(role)).toBe(
        (MEMBER_MANAGER_ROLES as readonly TenantRole[]).includes(role),
      );
    }
  });
});

describe('実行者の資格（ACTOR_ROLE_NOT_ALLOWED）', () => {
  it.each(['SALES', 'VIEWER'] as const)('ホストの %s は誰のロールも変えられない', (role) => {
    const verdict = decideMemberRoleChange(
      { role, partnerCompanyId: null, userId: ACTOR_USER },
      hostTarget(),
      'ADMIN',
      PLENTY_OWNERS,
    );
    expect(verdict).toEqual({ allowed: false, reason: 'ACTOR_ROLE_NOT_ALLOWED' });
  });

  it('🔴 PARTNER_SALES は自社のアカウントも変えられない（管理者ではない）', () => {
    const verdict = decideMemberRoleChange(
      { role: 'PARTNER_SALES', partnerCompanyId: PARTNER_1, userId: ACTOR_USER },
      partnerTarget(),
      'PARTNER_ADMIN',
      PLENTY_OWNERS,
    );
    expect(verdict).toEqual({ allowed: false, reason: 'ACTOR_ROLE_NOT_ALLOWED' });
  });

  it('🔴 ロールと所属が食い違う実行者は fail-closed で拒否する（CHECK 制約が緩んでも広がらない）', () => {
    // ホスト所属なのに PARTNER_ADMIN を名乗る / パートナー所属なのに ADMIN を名乗る。
    expect(
      decideMemberRoleChange(
        { role: 'PARTNER_ADMIN', partnerCompanyId: null, userId: ACTOR_USER },
        hostTarget(),
        'SALES',
        PLENTY_OWNERS,
      ),
    ).toEqual({ allowed: false, reason: 'ACTOR_ROLE_NOT_ALLOWED' });
    expect(
      decideMemberRoleChange(
        { role: 'ADMIN', partnerCompanyId: PARTNER_1, userId: ACTOR_USER },
        partnerTarget(),
        'PARTNER_ADMIN',
        PLENTY_OWNERS,
      ),
    ).toEqual({ allowed: false, reason: 'ACTOR_ROLE_NOT_ALLOWED' });
  });
});

describe('🔴 F-002 AC-4: 射程は「実行者と同じ所属」だけである', () => {
  it('PARTNER_ADMIN は他社のアカウントを変えられない', () => {
    const verdict = decideMemberRoleChange(
      PARTNER_ADMIN,
      partnerTarget({ partnerCompanyId: PARTNER_2 }),
      'PARTNER_ADMIN',
      PLENTY_OWNERS,
    );
    expect(verdict).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' });
  });

  it('🔴 PARTNER_ADMIN は自社（ホスト）のアカウントを変えられない', () => {
    const verdict = decideMemberRoleChange(PARTNER_ADMIN, hostTarget(), 'ADMIN', PLENTY_OWNERS);
    expect(verdict).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' });
  });

  it('🔴 ホストの ADMIN は取引先配下のアカウントを変えられない（RLS の C3 と同じ述語）', () => {
    const verdict = decideMemberRoleChange(
      HOST_ADMIN,
      partnerTarget(),
      'PARTNER_ADMIN',
      PLENTY_OWNERS,
    );
    expect(verdict).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' });
  });

  it('同じ所属なら通る（ホスト → ホスト / パートナー → 自社）', () => {
    expect(decideMemberRoleChange(HOST_OWNER, hostTarget(), 'ADMIN', PLENTY_OWNERS)).toEqual({
      allowed: true,
    });
    expect(
      decideMemberRoleChange(PARTNER_ADMIN, partnerTarget(), 'PARTNER_ADMIN', PLENTY_OWNERS),
    ).toEqual({ allowed: true });
  });
});

describe('🔴 自分自身は対象にできない（SELF）', () => {
  it('ロール変更（自己昇格の経路を作らない）', () => {
    expect(
      decideMemberRoleChange(HOST_ADMIN, hostTarget({ userId: ACTOR_USER }), 'OWNER', PLENTY_OWNERS),
    ).toEqual({ allowed: false, reason: 'SELF' });
  });

  it('無効化（自己ロックアウトの経路を作らない）', () => {
    expect(
      decideMemberRevoke(PARTNER_ADMIN, partnerTarget({ userId: ACTOR_USER }), PLENTY_OWNERS),
    ).toEqual({ allowed: false, reason: 'SELF' });
  });

  it('🔴 射程の判定を自分自身より先に行う（他社の自分は SELF ではなく OUT_OF_SCOPE）', () => {
    expect(
      decideMemberRevoke(
        PARTNER_ADMIN,
        partnerTarget({ userId: ACTOR_USER, partnerCompanyId: PARTNER_2 }),
        PLENTY_OWNERS,
      ),
    ).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' });
  });
});

describe('付与できるロール（TARGET_ROLE_NOT_ALLOWED）', () => {
  it.each(PARTNER_TENANT_ROLES)(
    '🔴 ホスト所属のアカウントにパートナーロール %s を付与できない',
    (role) => {
      expect(decideMemberRoleChange(HOST_OWNER, hostTarget(), role, PLENTY_OWNERS)).toEqual({
        allowed: false,
        reason: 'TARGET_ROLE_NOT_ALLOWED',
      });
    },
  );

  it.each(HOST_TENANT_ROLES)(
    '🔴 取引先配下のアカウントにホストロール %s を付与できない',
    (role) => {
      expect(decideMemberRoleChange(PARTNER_ADMIN, partnerTarget(), role, PLENTY_OWNERS)).toEqual({
        allowed: false,
        reason: 'TARGET_ROLE_NOT_ALLOWED',
      });
    },
  );

  it.each(HOST_TENANT_ROLES)('ホスト所属にはホストロール %s を付与できる', (role) => {
    expect(
      decideMemberRoleChange(HOST_OWNER, hostTarget({ role: 'SALES' }), role, PLENTY_OWNERS),
    ).toEqual({ allowed: true });
  });

  it.each(PARTNER_TENANT_ROLES)('取引先配下にはパートナーロール %s を付与できる', (role) => {
    expect(decideMemberRoleChange(PARTNER_ADMIN, partnerTarget(), role, PLENTY_OWNERS)).toEqual({
      allowed: true,
    });
  });
});

describe('無効化済みの扱い', () => {
  it('🔴 無効化済みの所属はロールを変えられない（復帰は招待の再発行）', () => {
    expect(
      decideMemberRoleChange(
        PARTNER_ADMIN,
        partnerTarget({ revoked: true }),
        'PARTNER_ADMIN',
        PLENTY_OWNERS,
      ),
    ).toEqual({ allowed: false, reason: 'ALREADY_REVOKED' });
  });

  it('🔴 無効化は「すでに無効か」を認可の材料にしない（冪等な no-op はサービス層の責務）', () => {
    expect(
      decideMemberRevoke(PARTNER_ADMIN, partnerTarget({ revoked: true }), PLENTY_OWNERS),
    ).toEqual({ allowed: true });
  });
});

describe('🔴 最後の OWNER を失わせない（LAST_OWNER）', () => {
  it('最後の OWNER は降格できない', () => {
    expect(
      decideMemberRoleChange(HOST_ADMIN, hostTarget({ role: 'OWNER' }), 'ADMIN', LAST_OWNER),
    ).toEqual({ allowed: false, reason: 'LAST_OWNER' });
  });

  it('最後の OWNER は無効化できない', () => {
    expect(decideMemberRevoke(HOST_ADMIN, hostTarget({ role: 'OWNER' }), LAST_OWNER)).toEqual({
      allowed: false,
      reason: 'LAST_OWNER',
    });
  });

  it('OWNER が複数居れば降格・無効化できる', () => {
    expect(
      decideMemberRoleChange(HOST_ADMIN, hostTarget({ role: 'OWNER' }), 'ADMIN', PLENTY_OWNERS),
    ).toEqual({ allowed: true });
    expect(decideMemberRevoke(HOST_ADMIN, hostTarget({ role: 'OWNER' }), PLENTY_OWNERS)).toEqual({
      allowed: true,
    });
  });

  it('OWNER のまま（同じロール）の要求は最後の 1 人でも拒否しない', () => {
    expect(
      decideMemberRoleChange(HOST_ADMIN, hostTarget({ role: 'OWNER' }), 'OWNER', LAST_OWNER),
    ).toEqual({ allowed: true });
  });

  it('🔴 最後の PARTNER_ADMIN には同じ規則を置かない（ホストの招待で復旧できるため）', () => {
    expect(
      decideMemberRevoke(
        PARTNER_ADMIN,
        partnerTarget({ role: 'PARTNER_ADMIN' }),
        { activeOwnerCount: 0 },
      ),
    ).toEqual({ allowed: true });
  });
});
