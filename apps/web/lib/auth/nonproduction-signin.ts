import { ROLE_ACCOUNT_PASSWORD } from '@ses/config';
import { roleAccountAccess } from '../db/bootstrap';
import { signInWithCredentials } from './session';
import { signInPlatformWithCredentials } from './platform-session';
import { resolveSignInNext } from './credentials';

/** ロールや分離キーを要求から受けず、合成アカウントも通常の認証を通す。 */
export async function signInRoleAccount(accountId: string, realm: 'tenant' | 'platform'): Promise<{ next: 'home' | '2fa' } | null> {
  const access = roleAccountAccess();
  if (!access.enabled) return null;
  const account = access.accounts.find((candidate) => candidate.id === accountId && candidate.realm === realm);
  if (!account) return null;
  const credentials = { email: account.email, password: ROLE_ACCOUNT_PASSWORD };
  if (realm === 'platform') {
    if (await signInPlatformWithCredentials(credentials) === 'REJECTED') return null;
    return { next: '2fa' };
  }
  if (await signInWithCredentials(credentials) === 'REJECTED') return null;
  return { next: await resolveSignInNext(account.email) };
}
