// packages/db/src/two-factor-gate.test.ts
// 🔴 `F-003 AC-2` / `BR-30` / docs/05 §6.2 のゲートそのもの。
//
//    「`OWNER` / `ADMIN` は 2 要素認証を未設定のまま業務データを取得できない。
//      それ以外のロールは任意設定でき、未設定でも利用できる。」
//
//    ここは DB を要らない純粋な判定の固定である（DB 付きの実証 ＝ 業務データが 0 件であることは
//    `tests/isolation/two-factor.test.ts` が見る）。
import { describe, expect, it } from 'vitest';
import {
  requiresTwoFactor,
  resolveTenantCtx,
  TENANT_ROLES,
  TWO_FACTOR_REQUIRED_ROLES,
  TwoFactorRequiredError,
  twoFactorSessionState,
  type MainSession,
  type TenantRole,
  type TwoFactorSessionState,
} from './context.js';

const BASE = {
  tenantId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  partnerCompanyId: null,
  userId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
  lifecycleState: 'ACTIVE',
  // 🔴 T-04-07: ホスト所属（`partnerCompanyId: null`）なので常に `null`（`F-007 AC-2`）。
  partnerSuspendedAt: null,
} as const;

function session(role: TenantRole, twoFactor: TwoFactorSessionState): MainSession {
  return { ...BASE, role, twoFactor };
}

const OPTIONAL_ROLES = TENANT_ROLES.filter((role) => !requiresTwoFactor(role));

describe('twoFactorSessionState（DB の事実 × セッションの事実）', () => {
  it.each([
    [false, false, 'NOT_ENROLLED'],
    [false, true, 'NOT_ENROLLED'],
    [true, false, 'ENROLLED_UNVERIFIED'],
    [true, true, 'VERIFIED'],
  ])(
    'enrolled=%s / verifiedInSession=%s → %s',
    (enrolled, verifiedInSession, expected) => {
      expect(twoFactorSessionState({ enrolled, verifiedInSession })).toBe(expected);
    },
  );

  it('🔴 設定していないのにセッションだけが「検証済み」でも、設定済みには化けない', () => {
    expect(twoFactorSessionState({ enrolled: false, verifiedInSession: true })).toBe(
      'NOT_ENROLLED',
    );
  });
});

describe('必須ロール（BR-30）', () => {
  it('OWNER / ADMIN のみが必須である', () => {
    expect([...TWO_FACTOR_REQUIRED_ROLES]).toEqual(['OWNER', 'ADMIN']);
    expect(requiresTwoFactor('OWNER')).toBe(true);
    expect(requiresTwoFactor('ADMIN')).toBe(true);
    for (const role of OPTIONAL_ROLES) expect(requiresTwoFactor(role)).toBe(false);
  });

  it('対照: 任意のロールが 1 つ以上ある（走査が空振りしていない）', () => {
    expect(OPTIONAL_ROLES.length).toBeGreaterThan(0);
  });
});

describe('🔴 resolveTenantCtx の 2FA ゲート（F-003 AC-2）', () => {
  it.each([...TWO_FACTOR_REQUIRED_ROLES])(
    '%s が未設定なら ctx を生成しない（SETUP_REQUIRED）',
    async (role) => {
      await expect(resolveTenantCtx(session(role, 'NOT_ENROLLED'), { deviceKind: 'api' })).rejects
        .toThrowError(TwoFactorRequiredError);
      await expect(
        resolveTenantCtx(session(role, 'NOT_ENROLLED'), { deviceKind: 'api' }),
      ).rejects.toMatchObject({ reason: 'SETUP_REQUIRED' });
    },
  );

  it.each([...OPTIONAL_ROLES])('%s は未設定でも ctx を生成できる（任意設定）', async (role) => {
    const ctx = await resolveTenantCtx(session(role, 'NOT_ENROLLED'), { deviceKind: 'api' });
    expect(ctx.role).toBe(role);
  });

  it.each([...TENANT_ROLES])(
    '🔴 %s は、設定済みでこのセッションが未検証なら ctx を生成しない（VERIFICATION_REQUIRED）',
    async (role) => {
      await expect(
        resolveTenantCtx(session(role, 'ENROLLED_UNVERIFIED'), { deviceKind: 'api' }),
      ).rejects.toMatchObject({
        name: 'TwoFactorRequiredError',
        reason: 'VERIFICATION_REQUIRED',
      });
    },
  );

  it.each([...TENANT_ROLES])('%s は検証済みなら ctx を生成できる', async (role) => {
    const ctx = await resolveTenantCtx(session(role, 'VERIFIED'), { deviceKind: 'api' });
    expect(ctx.role).toBe(role);
    expect(ctx.tenantId).toBe(BASE.tenantId);
  });

  it('🔴 ゲートは分離キーを書き換えない（拒否するだけで、境界を作り替えない）', async () => {
    const ctx = await resolveTenantCtx(
      { ...session('SALES', 'NOT_ENROLLED'), partnerCompanyId: 'p1' },
      { deviceKind: 'api' },
    );
    expect(ctx.partnerCompanyId).toBe('p1');
  });
});
