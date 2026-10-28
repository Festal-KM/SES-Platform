import { describe, expect, it } from 'vitest';
import { createRoleAccountAccess, ROLE_ACCOUNT_ROLES } from './nonproduction-accounts.js';
describe('合成アカウントの選択と開発専用2FA検証', () => {
  it.each(['production', 'sandbox', 'staging'] as const)('%sではUIも例外も無効', (APP_ENV) => {
    const access = createRoleAccountAccess({ APP_ENV, AWS_ISOLATION_MODE: 'resource' });
    expect(access.enabled).toBe(false); expect(access.accounts).toEqual([]);
    expect(access.twoFactorPolicy('f0000000-0000-4000-8000-000000000001', 'ENFORCED')).toBe('ENFORCED');
  });
  it('開発は通常の合成アカウントだけを緩め、検証用と実利用者は既存の検証を要求する', () => {
    const access = createRoleAccountAccess({ APP_ENV: 'development', AWS_ISOLATION_MODE: 'resource' });
    for (const account of access.accounts) expect(access.twoFactorPolicy(account.id, 'ENFORCED')).toBe(account.realm === 'tenant' && account.mode === 'standard' ? 'RELAXED' : 'ENFORCED');
    expect(access.twoFactorPolicy('unknown', 'ENFORCED')).toBe('ENFORCED');
    expect(access.twoFactorPolicy(undefined, 'ENFORCED')).toBe('ENFORCED');
    expect(new Set(access.accounts.map((account) => account.id)).size).toBe(access.accounts.length);
    expect(new Set(access.accounts.map((account) => account.email)).size).toBe(access.accounts.length);
  });
  it('各ロールに2テナント・各2名を用意し、デモに2FA検証用を出さない', () => {
    const access = createRoleAccountAccess({ APP_ENV: 'demo', AWS_ISOLATION_MODE: 'resource' });
    for (const role of ROLE_ACCOUNT_ROLES) expect(access.accounts.filter((account) => account.role === role)).toHaveLength(4);
    expect(access.accounts.some((account) => account.mode === 'two-factor')).toBe(false);
    expect(access.accounts.every((account) => account.email.endsWith('.example'))).toBe(true);
  });
  it('従来のローカル開発の認証動作は変えない', () => {
    expect(createRoleAccountAccess({ APP_ENV: 'development', AWS_ISOLATION_MODE: 'account' }).enabled).toBe(false);
  });
});
