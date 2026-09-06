// apps/web/lib/projects/policy.test.ts
// 🔴 `docs/04` §S-012 権限差分 / docs/05 §6.4 #26 の認可を、全ロールで固定する。T-06-01。
//    ここが緩むと「取引先が案件を登録できる」が静かに成立する（`CLAUDE.md` §3.1 の
//    越境経路 1 は**ホストが公開する**ことが前提であり、パートナーが案件を作れてはならない）。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import { isProjectEditorRole, PROJECT_EDITOR_ROLES } from './policy';

describe('PROJECT_EDITOR_ROLES（docs/05 §6.4 #26 / docs/04 §S-012）', () => {
  it('🔴 案件を登録・編集できるのは OWNER / ADMIN / SALES だけである', () => {
    expect([...PROJECT_EDITOR_ROLES]).toEqual(['OWNER', 'ADMIN', 'SALES']);
  });

  it('🔴 パートナーロールは 1 つも含まれない（案件はホストの持ち物）', () => {
    for (const role of ['PARTNER_ADMIN', 'PARTNER_SALES'] as const) {
      expect(isProjectEditorRole(role)).toBe(false);
    }
  });

  it('🔴 VIEWER は含まれない（BR-31 / F-004 AC-6）', () => {
    expect(isProjectEditorRole('VIEWER')).toBe(false);
  });

  it('全ロールのうち、判定が true になるのは宣言した 3 ロールだけである', () => {
    const allowed = (TENANT_ROLES as readonly TenantRole[]).filter(isProjectEditorRole);
    expect(allowed).toEqual([...PROJECT_EDITOR_ROLES]);
  });
});
