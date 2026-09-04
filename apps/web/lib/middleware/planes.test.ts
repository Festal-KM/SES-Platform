// apps/web/lib/middleware/planes.test.ts
// T-03-08: `/admin` を別ミドルウェアで認可する（`CLAUDE.md` §10.5 / docs/05 §5.1 / `F-055 AC-2`）。
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SIGNIN_PATH,
  adminMiddleware,
  decidePlane,
  isAdminPlanePath,
  mainMiddleware,
  type PlaneRequestView,
} from './planes';

function view(overrides: Partial<PlaneRequestView> & { pathname: string }): PlaneRequestView {
  return {
    hasPlatformSessionCookie: false,
    hasTenantSessionCookie: false,
    ...overrides,
  };
}

describe('平面の呼び分け（docs/05 §5.1 の matcher 補正）', () => {
  it.each([
    '/admin',
    '/admin/signin',
    '/admin/tenants/00000000-0000-0000-0000-000000000001',
    // 🔴 管理平面の API は `/api/admin/**` にあり `/admin` 配下ではない（docs/05 §6.9）。
    //    ここを取りこぼすと管理平面の API が主平面のミドルウェアへ流れる。
    '/api/admin/auth/signin',
    '/api/admin/tenants',
  ])('%s は管理平面と判定される', (pathname) => {
    expect(isAdminPlanePath(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/signin',
    '/audit-logs',
    '/api/me',
    '/api/auth/signin',
    // 🔴 接頭辞の一致だけで判定しない（`/administrators` は管理平面ではない）。
    '/administrators',
    '/api/administrators',
    '/adminx',
  ])('%s は主平面と判定される', (pathname) => {
    expect(isAdminPlanePath(pathname)).toBe(false);
  });
});

describe('管理平面のミドルウェア（F-055 AC-2 / CLAUDE.md §10.5）', () => {
  it('🔴 未認証で /admin に来たら A-001 へ 302 する', () => {
    expect(adminMiddleware(view({ pathname: '/admin' }))).toEqual({
      kind: 'REDIRECT',
      location: ADMIN_SIGNIN_PATH,
    });
  });

  it('🔴 主平面のセッションだけを持って /admin に来ても A-001 へ 302 する（交差の禁止）', () => {
    expect(
      adminMiddleware(view({ pathname: '/admin', hasTenantSessionCookie: true })),
    ).toEqual({ kind: 'REDIRECT', location: ADMIN_SIGNIN_PATH });
  });

  it('🔴 主平面のセッションの有無で挙動が変わらない（Cookie を捨てれば通る穴を作らない）', () => {
    const withTenant = adminMiddleware(
      view({ pathname: '/admin/tenants', hasTenantSessionCookie: true }),
    );
    const withoutTenant = adminMiddleware(view({ pathname: '/admin/tenants' }));
    expect(withTenant).toEqual(withoutTenant);
  });

  it('管理平面のセッションがあれば素通しする', () => {
    expect(
      adminMiddleware(view({ pathname: '/admin', hasPlatformSessionCookie: true })),
    ).toEqual({ kind: 'CONTINUE' });
  });

  it('両方の Cookie が同居していても管理平面のセッションで判定する（path=/ で同居しうる）', () => {
    expect(
      adminMiddleware(
        view({
          pathname: '/admin',
          hasPlatformSessionCookie: true,
          hasTenantSessionCookie: true,
        }),
      ),
    ).toEqual({ kind: 'CONTINUE' });
  });

  it('A-001（サインイン画面）は未認証でも素通しする（リダイレクトループを作らない）', () => {
    expect(adminMiddleware(view({ pathname: ADMIN_SIGNIN_PATH }))).toEqual({ kind: 'CONTINUE' });
  });

  it.each([
    '/api/admin/auth/signin',
    '/api/admin/auth/2fa/verify',
    '/api/admin/tenants',
  ])(
    '🔴 %s は未認証でも 302 にしない（API の拒否は Route Handler が 401 / 403 で行う。docs/05 §6.1）',
    (pathname) => {
      expect(adminMiddleware(view({ pathname }))).toEqual({ kind: 'CONTINUE' });
    },
  );
});

describe('主平面のミドルウェア', () => {
  it.each(['/', '/signin', '/audit-logs', '/api/me'])(
    '%s は素通しする（境界の強制は resolveTenantCtx と RLS が行う）',
    (pathname) => {
      expect(mainMiddleware(view({ pathname }))).toEqual({ kind: 'CONTINUE' });
    },
  );

  it('🔴 管理平面のセッションだけを持って主平面に来ても、ミドルウェアは何もしない（ページの ctx 解決が弾く）', () => {
    expect(mainMiddleware(view({ pathname: '/', hasPlatformSessionCookie: true }))).toEqual({
      kind: 'CONTINUE',
    });
  });
});

describe('decidePlane の委譲', () => {
  it('管理平面のパスは adminMiddleware の判断になる', () => {
    const target = view({ pathname: '/admin/tenants' });
    expect(decidePlane(target)).toEqual(adminMiddleware(target));
    expect(decidePlane(target)).toEqual({ kind: 'REDIRECT', location: ADMIN_SIGNIN_PATH });
  });

  it('主平面のパスは mainMiddleware の判断になる（管理平面の規則を適用しない）', () => {
    const target = view({ pathname: '/audit-logs' });
    expect(decidePlane(target)).toEqual(mainMiddleware(target));
    expect(decidePlane(target)).toEqual({ kind: 'CONTINUE' });
  });
});
