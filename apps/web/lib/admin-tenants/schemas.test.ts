// apps/web/lib/admin-tenants/schemas.test.ts
// `parseAdminTenantListQuery`（`GET /api/admin/tenants` の境界検証。API-A2）。
//
// 🔴 `apps/web/app/api/admin/tenants/route.ts` が呼ぶのと同じ関数を直接検証する
//    （e2e-tester 指摘の回帰防止: 不正な形の `cursor` が 500 にならず 400 になること）。
import { describe, expect, it } from 'vitest';
import {
  createTenantBodySchema,
  isTenantIdLike,
  parseAdminTenantListQuery,
  parseCreateTenantBody,
  parseOwnerInvitationBody,
} from './schemas';
import { ISOLATION_KEYS } from '../api/isolation-keys';

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

const VALID_CREATE_BODY = {
  name: 'ホスト株式会社',
  environment: 'sandbox',
  lifecycleState: 'SANDBOX',
  planId: 'plan-starter',
  provisioningRequestId: '01930000-0000-7000-8000-0000000000f1',
} as const;

describe('parseCreateTenantBody（API-A4 の境界検証。docs/05 §6.9）', () => {
  it('必須項目がそろっていれば通る', () => {
    const result = parseCreateTenantBody(VALID_CREATE_BODY);
    expect(result.ok).toBe(true);
  });

  it('sendingDomain は任意（未入力でも開設できる。docs/04 §A-014 5b）', () => {
    const result = parseCreateTenantBody(VALID_CREATE_BODY);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.sendingDomain).toBeUndefined();
  });

  it('sendingDomain は小文字に正規化される（DNS は大文字小文字を区別しない）', () => {
    const result = parseCreateTenantBody({ ...VALID_CREATE_BODY, sendingDomain: 'Example.CO.JP' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.sendingDomain).toBe('example.co.jp');
  });

  it.each(['not a domain', 'example', 'ex ample.jp', '-bad.example.jp'])(
    'ドメインでない値 %s を拒否する',
    (sendingDomain) => {
      expect(parseCreateTenantBody({ ...VALID_CREATE_BODY, sendingDomain }).ok).toBe(false);
    },
  );

  it.each(['PURGED', 'SUSPENDED', 'CLOSING'])(
    '🔴 開設できない状態 %s を lifecycleState に指定できない（docs/02 章 5.4）',
    (lifecycleState) => {
      expect(parseCreateTenantBody({ ...VALID_CREATE_BODY, lifecycleState }).ok).toBe(false);
    },
  );

  it('🔴 environment は 3 値のみ（APP_ENV の development / staging は取れない）', () => {
    expect(parseCreateTenantBody({ ...VALID_CREATE_BODY, environment: 'development' }).ok).toBe(
      false,
    );
    expect(parseCreateTenantBody({ ...VALID_CREATE_BODY, environment: 'staging' }).ok).toBe(false);
  });

  it('🔴 環境と初期状態の**組み合わせ**はここで判定しない（422 として後段が判定する）', () => {
    // `sandbox` × `ACTIVE` は不正な組み合わせだが、形式としては通る（400 と 422 を混ぜない）。
    const result = parseCreateTenantBody({
      ...VALID_CREATE_BODY,
      environment: 'sandbox',
      lifecycleState: 'ACTIVE',
    });
    expect(result.ok).toBe(true);
  });

  it('🔴 分離キーをスキーマに持たない（CLAUDE.md §3.1 / BR-03）', () => {
    const keys = Object.keys(createTenantBodySchema.shape);
    for (const isolationKey of ISOLATION_KEYS) {
      expect(keys).not.toContain(isolationKey);
    }
  });

  it('🔴 未知のキー（tenantId 等）は黙って捨てられる（strip。応答が変わらない）', () => {
    const result = parseCreateTenantBody({
      ...VALID_CREATE_BODY,
      tenantId: '01930000-0000-7000-8000-0000000000b1',
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).not.toHaveProperty('tenantId');
  });

  it('本文が無い（null）ときは 400 相当で拒否する', () => {
    expect(parseCreateTenantBody(null).ok).toBe(false);
  });
});

describe('parseOwnerInvitationBody（API-A5 の境界検証）', () => {
  it('メールアドレスは小文字に正規化される', () => {
    const result = parseOwnerInvitationBody({ email: 'Owner@Example.co.jp' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.email).toBe('owner@example.co.jp');
  });

  it('🔴 role を受け取らない（運営者が発行できるのは初期 OWNER 招待だけ。docs/05 §5.2）', () => {
    const result = parseOwnerInvitationBody({ email: 'owner@example.co.jp', role: 'ADMIN' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).not.toHaveProperty('role');
    expect(Object.keys(result.value)).toEqual(['email']);
  });

  it('🔴 partnerCompanyId を受け取らない（分離キー）', () => {
    const result = parseOwnerInvitationBody({
      email: 'owner@example.co.jp',
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).not.toHaveProperty('partnerCompanyId');
  });

  it('メールアドレスの形式でなければ拒否する', () => {
    expect(parseOwnerInvitationBody({ email: 'not-an-email' }).ok).toBe(false);
  });
});
