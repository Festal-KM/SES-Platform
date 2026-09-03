// apps/web/lib/invitations/policy.test.ts
// 🔴 `F-002 AC-1`（パートナーロールは必ず 1 社に紐づく）と `AC-4`（`PARTNER_ADMIN` は
//    自社配下のみ）の**判定そのもの**を全組み合わせで固定する。
//
//    DB 付きの結合テスト（tests/isolation/invitations.test.ts）は「その判定が実際の経路で
//    効いていること」を見る。ここは判定表の網羅であり、両方が要る
//    （判定が正しくても呼ばれなければ意味が無く、呼ばれても判定が抜けていれば意味が無い）。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import {
  decideInvitation,
  HOST_TENANT_ROLES,
  INVITATION_ISSUER_ROLES,
  isHostRole,
  isPartnerRole,
  PARTNER_TENANT_ROLES,
} from './policy';

const PARTNER_1 = '01930000-0000-7000-8000-0000000000c1';
const PARTNER_2 = '01930000-0000-7000-8000-0000000000c2';

const HOST_OWNER = { role: 'OWNER' as TenantRole, partnerCompanyId: null };
const HOST_ADMIN = { role: 'ADMIN' as TenantRole, partnerCompanyId: null };
const PARTNER_ADMIN = { role: 'PARTNER_ADMIN' as TenantRole, partnerCompanyId: PARTNER_1 };

describe('ロールの二分（`memberships` の CHECK 制約と同じ規律）', () => {
  it('ホストロールとパートナーロールで全 6 ロールを尽くす（増減を検知する）', () => {
    expect([...HOST_TENANT_ROLES, ...PARTNER_TENANT_ROLES].sort()).toEqual([...TENANT_ROLES].sort());
  });

  it('どのロールもホスト側かパートナー側のどちらか一方である', () => {
    for (const role of TENANT_ROLES) {
      expect(isHostRole(role)).toBe(!isPartnerRole(role));
    }
  });
});

describe('🔴 T-03-04: requireRole に渡すロール一覧が decideInvitation とずれない', () => {
  /**
   * `INVITATION_ISSUER_ROLES`（`requireRole` の引数）と、`decideInvitation` が
   * `allowed: true` を返しうるロールの集合が一致することを機械的に確かめる。
   * 🔴 ずれると「ルートは通すが判定が 403」または「ルートで弾くので判定に届かない」の
   *    どちらかになり、片方だけ広げた変更が静かに通ってしまう。
   */
  function canEverInvite(role: TenantRole): boolean {
    const partnerCompanyId = isPartnerRole(role) ? PARTNER_1 : null;
    return TENANT_ROLES.some((targetRole) =>
      [null, PARTNER_1].some(
        (targetPartner) =>
          decideInvitation(
            { role, partnerCompanyId },
            { role: targetRole, partnerCompanyId: targetPartner },
          ).allowed,
      ),
    );
  }

  it('両者の集合が一致する（全 6 ロールを走査する）', () => {
    expect(TENANT_ROLES.filter(canEverInvite).sort()).toEqual([...INVITATION_ISSUER_ROLES].sort());
  });
});

describe('🔴 F-002: 招待を発行できるのは OWNER / ADMIN と PARTNER_ADMIN だけ', () => {
  it.each(['SALES', 'VIEWER'] as const)('ホストの %s は招待できない', (role) => {
    expect(decideInvitation({ role, partnerCompanyId: null }, { role: 'SALES' })).toEqual({
      allowed: false,
      reason: 'ACTOR_ROLE_NOT_ALLOWED',
    });
  });

  it('PARTNER_SALES は招待できない（自社であっても）', () => {
    expect(
      decideInvitation(
        { role: 'PARTNER_SALES', partnerCompanyId: PARTNER_1 },
        { role: 'PARTNER_SALES' },
      ),
    ).toEqual({ allowed: false, reason: 'ACTOR_ROLE_NOT_ALLOWED' });
  });

  it.each(HOST_TENANT_ROLES)('OWNER はホストロール %s を招ける（所属は null）', (role) => {
    expect(decideInvitation(HOST_OWNER, { role })).toEqual({
      allowed: true,
      partnerCompanyId: null,
    });
  });

  it.each(HOST_TENANT_ROLES)('ADMIN もホストロール %s を招ける', (role) => {
    expect(decideInvitation(HOST_ADMIN, { role })).toEqual({
      allowed: true,
      partnerCompanyId: null,
    });
  });
});

describe('🔴 F-002 AC-1: パートナーロールは必ず 1 社のパートナー企業に紐づく', () => {
  it.each(PARTNER_TENANT_ROLES)(
    'ホストの ADMIN が %s を取引先企業の指定なしに招こうとすると拒否される',
    (role) => {
      expect(decideInvitation(HOST_ADMIN, { role })).toEqual({
        allowed: false,
        reason: 'PARTNER_COMPANY_REQUIRED',
      });
    },
  );

  it.each(PARTNER_TENANT_ROLES)('取引先企業を指定すれば %s を招ける', (role) => {
    expect(decideInvitation(HOST_ADMIN, { role, partnerCompanyId: PARTNER_2 })).toEqual({
      allowed: true,
      partnerCompanyId: PARTNER_2,
    });
  });

  it.each(HOST_TENANT_ROLES)(
    '🔴 ホストロール %s に取引先企業を付けることはできない（受諾時に DB が弾く招待を作らない）',
    (role) => {
      expect(decideInvitation(HOST_ADMIN, { role, partnerCompanyId: PARTNER_1 })).toEqual({
        allowed: false,
        reason: 'PARTNER_COMPANY_NOT_ALLOWED',
      });
    },
  );
});

describe('🔴 F-002 AC-4: PARTNER_ADMIN は自社配下のみ', () => {
  it.each(PARTNER_TENANT_ROLES)('自社のパートナーロール %s は招ける', (role) => {
    expect(decideInvitation(PARTNER_ADMIN, { role })).toEqual({
      allowed: true,
      partnerCompanyId: PARTNER_1,
    });
  });

  it('🔴 所属は ctx から入る（入力が無くても自社になる）', () => {
    const verdict = decideInvitation(PARTNER_ADMIN, { role: 'PARTNER_SALES' });
    expect(verdict).toEqual({ allowed: true, partnerCompanyId: PARTNER_1 });
  });

  it.each(HOST_TENANT_ROLES)('🔴 ホストロール %s は招けない（自社＝ホストのアカウント）', (role) => {
    expect(decideInvitation(PARTNER_ADMIN, { role })).toEqual({
      allowed: false,
      reason: 'TARGET_ROLE_NOT_ALLOWED',
    });
  });

  it('🔴 他社の取引先企業を指定しても通らない', () => {
    expect(
      decideInvitation(PARTNER_ADMIN, { role: 'PARTNER_SALES', partnerCompanyId: PARTNER_2 }),
    ).toEqual({ allowed: false, reason: 'OTHER_PARTNER_COMPANY' });
  });

  it('自社を明示した場合は通る（結論が同じであるため）', () => {
    expect(
      decideInvitation(PARTNER_ADMIN, { role: 'PARTNER_SALES', partnerCompanyId: PARTNER_1 }),
    ).toEqual({ allowed: true, partnerCompanyId: PARTNER_1 });
  });
});

describe('🔴 決定は入力の分離キーで変わらない（CLAUDE.md §3.1 / BR-03）', () => {
  it('実行者の所属が ctx で決まる: 同じ入力でもホストとパートナーで結論が違う', () => {
    const target = { role: 'PARTNER_SALES' as TenantRole, partnerCompanyId: PARTNER_1 };
    expect(decideInvitation(HOST_ADMIN, target)).toEqual({
      allowed: true,
      partnerCompanyId: PARTNER_1,
    });
    // 同じ target でも、PARTNER_2 所属の PARTNER_ADMIN からは他社なので拒否される。
    expect(
      decideInvitation({ role: 'PARTNER_ADMIN', partnerCompanyId: PARTNER_2 }, target),
    ).toEqual({ allowed: false, reason: 'OTHER_PARTNER_COMPANY' });
  });
});
