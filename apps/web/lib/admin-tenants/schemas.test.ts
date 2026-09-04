// apps/web/lib/admin-tenants/schemas.test.ts
// `parseAdminTenantListQuery`（`GET /api/admin/tenants` の境界検証。API-A2）。
//
// 🔴 `apps/web/app/api/admin/tenants/route.ts` が呼ぶのと同じ関数を直接検証する
//    （e2e-tester 指摘の回帰防止: 不正な形の `cursor` が 500 にならず 400 になること）。
import { describe, expect, it } from 'vitest';
import { isTenantIdLike, parseAdminTenantListQuery } from './schemas';

const VALID_TENANT_ID = '01930000-0000-7000-8000-0000000000a1';

describe('isTenantIdLike', () => {
  it('UUID 形式を受け付ける', () => {
    expect(isTenantIdLike(VALID_TENANT_ID)).toBe(true);
  });

  it.each(['abc', '', '00000000-0000-0000-0000-00000000000g', "1' OR '1'='1"])(
    '🔴 UUID 形式でない値 %s を拒否する',
    (value) => {
      expect(isTenantIdLike(value)).toBe(false);
    },
  );
});

describe('parseAdminTenantListQuery（API-A2 の境界検証）', () => {
  it('cursor 無しは通る', () => {
    const result = parseAdminTenantListQuery({});
    expect(result.ok).toBe(true);
  });

  it('UUID 形式の cursor は通る', () => {
    const result = parseAdminTenantListQuery({ cursor: VALID_TENANT_ID });
    expect(result).toEqual({ ok: true, value: { cursor: VALID_TENANT_ID, limit: 50 } });
  });

  it('🔴 UUID 形式でない cursor は 400 相当（issues に cursor を含む）で拒否する（500 にしない）', () => {
    const result = parseAdminTenantListQuery({ cursor: 'not-a-uuid' });
    expect(result).toEqual({ ok: false, issues: ['cursor'] });
  });

  it('🔴 改竄・破損したカーソル値（SQL インジェクション風の文字列）も拒否する', () => {
    const result = parseAdminTenantListQuery({ cursor: "1'; DROP TABLE tenants; --" });
    expect(result.ok).toBe(false);
  });

  it('limit が上限を超えると cursorPageQuerySchema の時点で拒否する（cursor チェックへ進まない）', () => {
    const result = parseAdminTenantListQuery({ limit: '99999' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues).toContain('limit');
  });
});
