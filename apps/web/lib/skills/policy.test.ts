// apps/web/lib/skills/policy.test.ts
// 🔴 `F-010 AC-1` / `AC-2` の判定を、ロール × 帰属 × 状態 × 入力の全組み合わせで固定する。
//    ここが緩むと「パートナーが採否できる」「グローバル辞書を書き換えられる」が
//    静かに成立する（どちらも `BR-02` / `CLAUDE.md` §3.1 の直接違反）。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import {
  decideSkillAliasDecision,
  isSkillAliasDeciderRole,
  SKILL_ALIAS_DECIDER_ROLES,
  type SkillAliasScope,
} from './policy';

const ACCEPT = { decision: 'ACCEPT', skillId: '01930000-0000-7000-8000-0000000000e1' } as const;
const REJECT = { decision: 'REJECT', skillId: null } as const;

function target(scope: SkillAliasScope, status: string) {
  return { scope, status };
}

describe('SKILL_ALIAS_DECIDER_ROLES（docs/05 §6.4 #24 / F-010 AC-1）', () => {
  it('🔴 採否を行えるのは ADMIN / SALES だけである', () => {
    expect([...SKILL_ALIAS_DECIDER_ROLES]).toEqual(['ADMIN', 'SALES']);
  });

  it('🔴 パートナーロールは 1 つも含まれない（起票のみ）', () => {
    for (const role of ['PARTNER_ADMIN', 'PARTNER_SALES'] as const) {
      expect(isSkillAliasDeciderRole(role)).toBe(false);
    }
  });

  it('🔴 VIEWER は含まれない（BR-31）', () => {
    expect(isSkillAliasDeciderRole('VIEWER')).toBe(false);
  });

  it('全ロールのうち、判定が true になるのは宣言した 2 ロールだけである', () => {
    const allowed = (TENANT_ROLES as readonly TenantRole[]).filter(isSkillAliasDeciderRole);
    expect(allowed).toEqual([...SKILL_ALIAS_DECIDER_ROLES]);
  });
});

describe('decideSkillAliasDecision（採否の可否）', () => {
  it('ADMIN は PROPOSED のテナント別名を採用できる', () => {
    expect(decideSkillAliasDecision('ADMIN', target('TENANT', 'PROPOSED'), ACCEPT)).toEqual({
      allowed: true,
    });
  });

  it('SALES は PROPOSED のテナント別名を却下できる', () => {
    expect(decideSkillAliasDecision('SALES', target('TENANT', 'PROPOSED'), REJECT)).toEqual({
      allowed: true,
    });
  });

  it.each(['OWNER', 'VIEWER', 'PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '🔴 %s は採否できない（ACTOR_ROLE_NOT_ALLOWED）',
    (role) => {
      expect(decideSkillAliasDecision(role, target('TENANT', 'PROPOSED'), ACCEPT)).toEqual({
        allowed: false,
        reason: 'ACTOR_ROLE_NOT_ALLOWED',
      });
    },
  );

  it('🔴 グローバル別名は採否できない（F-010 AC-2）', () => {
    expect(decideSkillAliasDecision('ADMIN', target('GLOBAL', 'PROPOSED'), ACCEPT)).toEqual({
      allowed: false,
      reason: 'GLOBAL_ROW',
    });
  });

  it.each(['ACCEPTED', 'REJECTED'] as const)(
    '🔴 すでに %s の候補は決め直せない（ALREADY_DECIDED）',
    (status) => {
      expect(decideSkillAliasDecision('ADMIN', target('TENANT', status), ACCEPT)).toEqual({
        allowed: false,
        reason: 'ALREADY_DECIDED',
      });
    },
  );

  it('🔴 採用に正規化先が無ければ拒否する（SKILL_REQUIRED）', () => {
    expect(
      decideSkillAliasDecision('ADMIN', target('TENANT', 'PROPOSED'), {
        decision: 'ACCEPT',
        skillId: null,
      }),
    ).toEqual({ allowed: false, reason: 'SKILL_REQUIRED' });
  });

  it('却下に正規化先が付いていれば拒否する（SKILL_NOT_ALLOWED）', () => {
    expect(
      decideSkillAliasDecision('ADMIN', target('TENANT', 'PROPOSED'), {
        decision: 'REJECT',
        skillId: ACCEPT.skillId,
      }),
    ).toEqual({ allowed: false, reason: 'SKILL_NOT_ALLOWED' });
  });

  it('🔴 ロールの拒否が最優先である（権限が無い相手に対象の状態を教えない）', () => {
    // グローバル行かつ決着済みかつ正規化先なし ＝ 3 つ理由があるが、返るのはロールの拒否。
    expect(
      decideSkillAliasDecision('PARTNER_SALES', target('GLOBAL', 'ACCEPTED'), {
        decision: 'ACCEPT',
        skillId: null,
      }),
    ).toEqual({ allowed: false, reason: 'ACTOR_ROLE_NOT_ALLOWED' });
  });
});
