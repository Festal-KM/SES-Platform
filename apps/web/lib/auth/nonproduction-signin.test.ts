import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoleAccountAccess, ROLE_ACCOUNT_PASSWORD } from '@ses/config';
const mock = vi.hoisted(() => ({ access: vi.fn(), tenant: vi.fn(), platform: vi.fn(), next: vi.fn() }));
vi.mock('../db/bootstrap', () => ({ roleAccountAccess: mock.access }));
vi.mock('./session', () => ({ signInWithCredentials: mock.tenant }));
vi.mock('./platform-session', () => ({ signInPlatformWithCredentials: mock.platform }));
vi.mock('./credentials', () => ({ resolveSignInNext: mock.next }));
import { signInRoleAccount } from './nonproduction-signin';
import { POST as tenantPost } from '../../app/api/(main)/auth/test-signin/route';
import { POST as platformPost } from '../../app/api/admin/auth/test-signin/route';

const development = createRoleAccountAccess({ APP_ENV: 'development', AWS_ISOLATION_MODE: 'resource' });
beforeEach(() => {
  vi.clearAllMocks(); mock.access.mockReturnValue(development);
  mock.tenant.mockResolvedValue('AUTHENTICATED'); mock.platform.mockResolvedValue('AUTHENTICATED'); mock.next.mockResolvedValue('home');
});
describe('合成アカウントの認証境界', () => {
  it.each(['production', 'staging', 'sandbox'] as const)('%sは本文に関係なく両平面のAPIを404にする', async (APP_ENV) => {
    mock.access.mockReturnValue(createRoleAccountAccess({ APP_ENV, AWS_ISOLATION_MODE: 'resource' }));
    for (const route of [tenantPost, platformPost]) expect((await route(new Request('https://example.test/api/auth/test-signin', { method: 'POST', body: '{}' }))).status).toBe(404);
    expect(mock.tenant).not.toHaveBeenCalled(); expect(mock.platform).not.toHaveBeenCalled();
  });
  it('未登録の実利用者IDや別平面のIDでは認証しない', async () => {
    expect(await signInRoleAccount('unknown', 'tenant')).toBeNull();
    const platform = development.accounts.find((account) => account.realm === 'platform');
    expect(platform).toBeDefined();
    expect(await signInRoleAccount(platform!.id, 'tenant')).toBeNull();
    expect(mock.tenant).not.toHaveBeenCalled(); expect(mock.platform).not.toHaveBeenCalled();
  });
  it('要求に権限や分離キーを混ぜてもサーバーで確定したアカウントを通常認証する', async () => {
    const account = development.accounts.find((candidate) => candidate.realm === 'tenant' && candidate.role === 'VIEWER' && candidate.mode === 'standard')!;
    const response = await tenantPost(new Request('https://example.test/api/auth/test-signin', { method: 'POST', body: JSON.stringify({ accountId: account.id, role: 'OWNER', tenantId: 'other', skipTwoFactor: true }) }));
    expect(response.status).toBe(200);
    expect(mock.tenant).toHaveBeenCalledWith({ email: account.email, password: ROLE_ACCOUNT_PASSWORD });
    expect(await response.json()).toEqual({ next: 'home' });
  });
  it('パスワード認証で拒否された合成アカウントのセッションを作らない', async () => {
    mock.tenant.mockResolvedValue('REJECTED');
    expect(await signInRoleAccount(development.accounts[0]!.id, 'tenant')).toBeNull();
    expect(mock.next).not.toHaveBeenCalled();
  });
  it('2FA検証用はコード入力へ進み、運営者は必ず別平面の2FAへ進む', async () => {
    mock.next.mockResolvedValue('2fa');
    const account = development.accounts.find((candidate) => candidate.mode === 'two-factor')!;
    expect(await signInRoleAccount(account.id, 'tenant')).toEqual({ next: '2fa' });
    const platform = development.accounts.find((candidate) => candidate.realm === 'platform')!;
    expect(await signInRoleAccount(platform.id, 'platform')).toEqual({ next: '2fa' });
    expect(mock.platform).toHaveBeenCalledWith({ email: platform.email, password: ROLE_ACCOUNT_PASSWORD });
  });
});
