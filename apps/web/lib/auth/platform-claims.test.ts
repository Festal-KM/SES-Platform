// apps/web/lib/auth/platform-claims.test.ts
// 🔴 `parsePlatformSessionClaims` は `platform.ts` の session コールバックが**唯一**使う
//    検証実装である（JWT の中身 → 管理平面の主張）。ここが緩むと、壊れた / 細工された JWT から
//    運営者の主体が素通りする。fail-closed（形が違えば `null`）を固定する。
//
// 🔴 `F-055 AC-2`（相互に到達不能）の一部を型ではなく**値**で固定する:
//    主平面の JWT ペイロードを渡しても `null` になること。
import { describe, expect, it } from 'vitest';
import { isPlatformTwoFactorVerifiedUpdate, parsePlatformSessionClaims } from './platform-claims';
import { parseTenantSessionClaims } from './claims';

const PLATFORM_USER = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02';
const USER = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b03';

describe('parsePlatformSessionClaims', () => {
  it('主体 ID を読み取る（既定は未検証）', () => {
    expect(parsePlatformSessionClaims({ platformUserId: PLATFORM_USER })).toEqual({
      platformUserId: PLATFORM_USER,
      twoFactorVerified: false,
    });
  });

  it('platformTwoFactorVerified が true のときだけ検証済みとして読む', () => {
    expect(
      parsePlatformSessionClaims({
        platformUserId: PLATFORM_USER,
        platformTwoFactorVerified: true,
      })?.twoFactorVerified,
    ).toBe(true);
  });

  it.each([
    ['未設定', undefined],
    ['文字列の "true"', 'true'],
    ['数値の 1', 1],
    ['false', false],
    ['null', null],
  ])(
    '🔴 platformTwoFactorVerified が %s のときは未検証として読む（fail-closed）',
    (_label, value) => {
      expect(
        parsePlatformSessionClaims({
          platformUserId: PLATFORM_USER,
          platformTwoFactorVerified: value,
        })?.twoFactorVerified,
      ).toBe(false);
    },
  );

  it('🔴 主平面の twoFactorVerified を流用しない（フィールド名が別である）', () => {
    expect(
      parsePlatformSessionClaims({ platformUserId: PLATFORM_USER, twoFactorVerified: true })
        ?.twoFactorVerified,
    ).toBe(false);
  });

  it('Auth.js が付ける他のクレーム（sub / iat / exp 等）が混ざっていても影響しない', () => {
    expect(
      parsePlatformSessionClaims({
        sub: PLATFORM_USER,
        iat: 1_760_000_000,
        exp: 1_760_040_000,
        platformUserId: PLATFORM_USER,
      }),
    ).toEqual({ platformUserId: PLATFORM_USER, twoFactorVerified: false });
  });

  it.each([
    ['payload が null', null],
    ['payload が文字列', 'not-an-object'],
    ['platformUserId が無い', { twoFactorVerified: true }],
    ['platformUserId が UUID でない', { platformUserId: 'not-a-uuid' }],
    ['platformUserId が数値', { platformUserId: 1 }],
  ])('🔴 %s のときは null（fail-closed）', (_label, payload) => {
    expect(parsePlatformSessionClaims(payload)).toBeNull();
  });
});

/**
 * 🔴 `F-055 AC-2`「テナント利用者の認証情報で `/admin` に到達できず、逆も成立しない」。
 *    実行時の一次防御は署名鍵の分離（`AUTH_SECRET` / `AUTH_PLATFORM_SECRET`）だが、
 *    **仮に署名検証を通り抜けても主張として解釈されない**ことを、ここで固定する。
 */
describe('🔴 2 平面の JWT ペイロードは相互に解釈されない（F-055 AC-2）', () => {
  const tenantToken = {
    tenantId: TENANT,
    userId: USER,
    partnerCompanyId: null,
    twoFactorVerified: true,
  };
  const platformToken = { platformUserId: PLATFORM_USER, platformTwoFactorVerified: true };

  it('対照: それぞれ自分の平面では読める（空振り防止）', () => {
    expect(parseTenantSessionClaims(tenantToken)).not.toBeNull();
    expect(parsePlatformSessionClaims(platformToken)).not.toBeNull();
  });

  it('主平面の JWT は管理平面の主張にならない', () => {
    expect(parsePlatformSessionClaims(tenantToken)).toBeNull();
  });

  it('管理平面の JWT は主平面の主張にならない', () => {
    expect(parseTenantSessionClaims(platformToken)).toBeNull();
  });
});

describe('isPlatformTwoFactorVerifiedUpdate', () => {
  it('platformClaims.twoFactorVerified === true のときだけ真', () => {
    expect(isPlatformTwoFactorVerifiedUpdate({ platformClaims: { twoFactorVerified: true } })).toBe(
      true,
    );
  });

  it.each([
    ['payload が null', null],
    ['payload が文字列', 'true'],
    ['platformClaims が無い', { twoFactorVerified: true }],
    ['platformClaims が null', { platformClaims: null }],
    ['主平面の claims キー', { claims: { twoFactorVerified: true } }],
    ['false', { platformClaims: { twoFactorVerified: false } }],
    ['文字列の "true"', { platformClaims: { twoFactorVerified: 'true' } }],
    ['数値の 1', { platformClaims: { twoFactorVerified: 1 } }],
    ['未設定', { platformClaims: {} }],
  ])('🔴 %s のときは偽（fail-closed）', (_label, payload) => {
    expect(isPlatformTwoFactorVerifiedUpdate(payload)).toBe(false);
  });

  it('🔴 主体の書き換えを試みる更新は「2FA 検証済み」としてすら真にならない', () => {
    expect(
      isPlatformTwoFactorVerifiedUpdate({
        platformClaims: { platformUserId: '00000000-0000-7000-8000-000000000001' },
      }),
    ).toBe(false);
  });
});
