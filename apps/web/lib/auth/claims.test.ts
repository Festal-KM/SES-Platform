// apps/web/lib/auth/claims.test.ts
// 🔴 `parseTenantSessionClaims` は `main.ts` の session コールバックが**唯一**使う検証実装である
//    （JWT の中身 → セッションの主張）。ここが緩むと、壊れた / 細工された JWT から
//    分離キーが素通りする。fail-closed（形が違えば `null`）を固定する。
import { describe, expect, it } from 'vitest';
import { isTwoFactorVerifiedUpdate, parseTenantSessionClaims } from './claims';

const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const USER = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60';
const PARTNER = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61';

describe('parseTenantSessionClaims', () => {
  it('ホスト所属（partnerCompanyId が null）を読み取る', () => {
    expect(
      parseTenantSessionClaims({ tenantId: TENANT, userId: USER, partnerCompanyId: null }),
    ).toEqual({ tenantId: TENANT, userId: USER, partnerCompanyId: null, twoFactorVerified: false });
  });

  it('partnerCompanyId が未設定でもホスト所属として読む', () => {
    expect(parseTenantSessionClaims({ tenantId: TENANT, userId: USER })).toEqual({
      tenantId: TENANT,
      userId: USER,
      partnerCompanyId: null,
      twoFactorVerified: false,
    });
  });

  it('パートナー所属を読み取る', () => {
    expect(
      parseTenantSessionClaims({ tenantId: TENANT, userId: USER, partnerCompanyId: PARTNER }),
    ).toEqual({
      tenantId: TENANT,
      userId: USER,
      partnerCompanyId: PARTNER,
      twoFactorVerified: false,
    });
  });

  // 🔴 T-03-02: 2 要素認証の検証済みフラグ（docs/05 §6.2）。
  it('twoFactorVerified が true のときだけ検証済みとして読む', () => {
    expect(
      parseTenantSessionClaims({
        tenantId: TENANT,
        userId: USER,
        partnerCompanyId: null,
        twoFactorVerified: true,
      })?.twoFactorVerified,
    ).toBe(true);
  });

  it.each([
    ['未設定', undefined],
    ['文字列の "true"', 'true'],
    ['数値の 1', 1],
    ['false', false],
    ['null', null],
  ])('🔴 twoFactorVerified が %s のときは未検証として読む（fail-closed）', (_label, value) => {
    expect(
      parseTenantSessionClaims({
        tenantId: TENANT,
        userId: USER,
        partnerCompanyId: null,
        twoFactorVerified: value,
      })?.twoFactorVerified,
    ).toBe(false);
  });

  it('Auth.js が付ける他のクレーム（sub / iat / exp 等）が混ざっていても影響しない', () => {
    expect(
      parseTenantSessionClaims({
        sub: USER,
        iat: 1_760_000_000,
        exp: 1_760_040_000,
        name: '氏名',
        email: 'someone@example.test',
        tenantId: TENANT,
        userId: USER,
        partnerCompanyId: null,
      }),
    ).toEqual({ tenantId: TENANT, userId: USER, partnerCompanyId: null, twoFactorVerified: false });
  });

  it.each([
    ['payload が null', null],
    ['payload が文字列', 'not-an-object'],
    ['tenantId が無い', { userId: USER }],
    ['userId が無い', { tenantId: TENANT }],
    ['tenantId が UUID でない', { tenantId: 'not-a-uuid', userId: USER }],
    ['userId が UUID でない', { tenantId: TENANT, userId: 'not-a-uuid' }],
    ['partnerCompanyId が UUID でない', { tenantId: TENANT, userId: USER, partnerCompanyId: 'x' }],
    // 🔴 数値・オブジェクトを「所属あり」として読まない（fail-closed）。
    ['partnerCompanyId が数値', { tenantId: TENANT, userId: USER, partnerCompanyId: 1 }],
  ])('🔴 %s のときは null（fail-closed）', (_label, payload) => {
    expect(parseTenantSessionClaims(payload)).toBeNull();
  });
});

/**
 * 🔴 セッション更新（Auth.js の `trigger === 'update'`）で受け付ける宣言の範囲。
 *    ここが緩むと「セッション更新で別テナントへ乗り換える」経路になる（CLAUDE.md §3.1）。
 */
describe('isTwoFactorVerifiedUpdate', () => {
  it('claims.twoFactorVerified === true のときだけ真', () => {
    expect(isTwoFactorVerifiedUpdate({ claims: { twoFactorVerified: true } })).toBe(true);
  });

  it.each([
    ['payload が null', null],
    ['payload が文字列', 'true'],
    ['claims が無い', { twoFactorVerified: true }],
    ['claims が null', { claims: null }],
    ['false', { claims: { twoFactorVerified: false } }],
    ['文字列の "true"', { claims: { twoFactorVerified: 'true' } }],
    ['数値の 1', { claims: { twoFactorVerified: 1 } }],
    ['未設定', { claims: {} }],
  ])('🔴 %s のときは偽（fail-closed）', (_label, payload) => {
    expect(isTwoFactorVerifiedUpdate(payload)).toBe(false);
  });

  it('🔴 分離キーを含む更新でも、判定に使われるのは 2FA のビットだけである', () => {
    // tenantId を書き換えようとする更新は「2FA 検証済み」としてすら真にならない。
    expect(
      isTwoFactorVerifiedUpdate({
        claims: { tenantId: '00000000-0000-7000-8000-000000000001' },
      }),
    ).toBe(false);
  });
});
