import { t } from '@ses/i18n';
import type { RoleAccount } from '@ses/config';
import type { RoleAccountOptions } from '../../app/_components/nonproduction-account-picker';
import { roleAccountAccess } from '../db/bootstrap';

export function roleAccountOptions(realm: 'tenant' | 'platform'): RoleAccountOptions | undefined {
  const access = roleAccountAccess();
  if (!access.enabled) return undefined;
  const roles: Record<RoleAccount['role'], string> = {
    OWNER: t('auth.accounts.role.OWNER'), ADMIN: t('auth.accounts.role.ADMIN'), SALES: t('auth.accounts.role.SALES'), VIEWER: t('auth.accounts.role.VIEWER'),
    PARTNER_ADMIN: t('auth.accounts.role.PARTNER_ADMIN'), PARTNER_SALES: t('auth.accounts.role.PARTNER_SALES'),
    PLATFORM_OWNER: t('auth.accounts.role.PLATFORM_OWNER'), PLATFORM_SUPPORT: t('auth.accounts.role.PLATFORM_SUPPORT'),
  };
  return { accounts: access.accounts.filter((account) => account.realm === realm), development: access.development,
    messages: { role: t('auth.accounts.role'), account: t('auth.accounts.account'), company: t('auth.accounts.company'),
      standard: t('auth.accounts.standard'), twoFactor: t('auth.accounts.twoFactor'), submit: t('auth.accounts.submit'), submitting: t('auth.accounts.submitting'),
      error: t('auth.accounts.error'), emailMethod: t('auth.accounts.emailMethod'), accountMethod: t('auth.accounts.accountMethod'),
      platformLink: t('auth.accounts.platformLink'), tenantLink: t('auth.accounts.tenantLink'), roles } };
}
