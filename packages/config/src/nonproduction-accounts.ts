import type { AppEnv } from './schema.js';

/** 未認証画面には合成アカウントだけを出す。実利用者をDBから列挙しない。 */
export const ROLE_ACCOUNT_ROLES = ['OWNER', 'ADMIN', 'SALES', 'VIEWER', 'PARTNER_ADMIN', 'PARTNER_SALES'] as const;
export type RoleAccount = {
  readonly id: string; readonly email: string;
  readonly role: (typeof ROLE_ACCOUNT_ROLES)[number] | 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT';
  readonly realm: 'tenant' | 'platform'; readonly mode: 'standard' | 'two-factor';
  readonly tenantNumber: number; readonly accountNumber: number;
};
const accountId = (sequence: number): string => `f0000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
/** 公開の合成データ用パスワード。実ユーザーの資格情報ではない。 */
export const ROLE_ACCOUNT_PASSWORD = 'seed-demo-password-1';

export function createRoleAccountAccess(env: Pick<AppEnv, 'APP_ENV' | 'AWS_ISOLATION_MODE'>) {
  const development = env.APP_ENV === 'development' && env.AWS_ISOLATION_MODE === 'resource';
  const enabled = development || env.APP_ENV === 'demo';
  const accounts: RoleAccount[] = [];
  if (enabled) {
    for (const tenantNumber of [1, 2]) {
      const domain = tenantNumber === 1 ? 'demo-alpha.example' : 'demo-beta.example';
      ROLE_ACCOUNT_ROLES.forEach((role, roleIndex) => {
        for (const accountNumber of [1, 2]) {
          const sequence = (tenantNumber - 1) * 12 + roleIndex * 2 + accountNumber;
          accounts.push({ id: accountId(sequence), email: `check-${role.toLowerCase().replaceAll('_', '-')}-${accountNumber}@${domain}`, role,
            realm: 'tenant', mode: 'standard', tenantNumber, accountNumber });
          if (development && (role === 'OWNER' || role === 'ADMIN')) accounts.push({ id: accountId(sequence + 1000), email: `check-2fa-${role.toLowerCase()}-${accountNumber}@${domain}`, role,
            realm: 'tenant', mode: 'two-factor', tenantNumber, accountNumber });
        }
      });
    }
    (['PLATFORM_OWNER', 'PLATFORM_SUPPORT'] as const).forEach((role, index) => {
      for (const accountNumber of [1, 2]) accounts.push({ id: accountId(2000 + index * 2 + accountNumber), email: `check-${role.toLowerCase().replaceAll('_', '-')}-${accountNumber}@platform.example`, role,
        realm: 'platform', mode: 'standard', tenantNumber: 0, accountNumber });
    });
  }
  const ordinaryIds = new Set(accounts.filter((account) => account.realm === 'tenant' && account.mode === 'standard').map((account) => account.id));
  return {
    enabled, development, accounts: Object.freeze(accounts.map((account) => Object.freeze(account))),
    /** DB認証後の識別子だけを見る。要求本文やロール指定で2FAを緩めない。 */
    twoFactorPolicy(userId: string | undefined, base: 'ENFORCED' | 'RELAXED'): 'ENFORCED' | 'RELAXED' {
      return development && userId !== undefined && ordinaryIds.has(userId) ? 'RELAXED' : base;
    },
  };
}
