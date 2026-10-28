'use client';
import { useState, type FormEvent } from 'react';
import { Button, Field, FieldError, Radio, Select, SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import type { RoleAccount } from '@ses/config';

export type RoleAccountMessages = {
  readonly role: string; readonly account: string; readonly company: string;
  readonly standard: string; readonly twoFactor: string; readonly submit: string; readonly submitting: string;
  readonly error: string; readonly emailMethod: string; readonly accountMethod: string;
  readonly platformLink: string; readonly tenantLink: string;
  readonly roles: Readonly<Record<RoleAccount['role'], string>>;
};
export type RoleAccountOptions = { readonly accounts: readonly RoleAccount[]; readonly development: boolean; readonly messages: RoleAccountMessages };

/** 権限を申告するUIではなく、用意済みの合成アカウントを選ぶ。 */
export function NonproductionAccountPicker({ options, realm, onAuthenticated, onManual }: {
  readonly options: RoleAccountOptions; readonly realm: 'tenant' | 'platform';
  readonly onAuthenticated: (next: '2fa' | 'home') => Promise<void>;
  readonly onManual: () => void;
}) {
  const { accounts, messages } = options;
  const [mode, setMode] = useState<RoleAccount['mode']>('standard');
  const [role, setRole] = useState<RoleAccount['role']>(realm === 'tenant' ? 'SALES' : 'PLATFORM_SUPPORT');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const available = accounts.filter((account) => account.realm === realm && account.mode === mode);
  const roles = [...new Set(available.map((account) => account.role))];
  const currentRole = roles.includes(role) ? role : roles[0];
  const candidates = available.filter((account) => account.role === currentRole);
  const current = candidates.find((account) => account.id === selected) ?? candidates[0];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !current) return;
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(realm === 'tenant' ? '/api/auth/test-signin' : '/api/admin/auth/test-signin', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: current.id }),
      });
      if (!response.ok) throw new Error('AUTH_FAILED');
      const result: unknown = await response.json();
      const next = (result as { next?: unknown }).next;
      if (next !== 'home' && next !== '2fa') throw new Error('AUTH_FAILED');
      await onAuthenticated(next);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <form method="post" onSubmit={submit} data-testid={`role-account-form-${realm}`}>
    {options.development && realm === 'tenant' ? <div className="mb-6 flex flex-wrap gap-x-6 border-b border-border pb-3">
      {(['standard', 'two-factor'] as const).map((value) => <label className="flex min-h-12 items-center gap-2 text-body text-fg" key={value}>
        <Radio name="account-mode" checked={mode === value} onChange={() => { if (!busy) { setMode(value); setSelected(''); setFailed(false); } }} data-testid={`role-account-mode-${value}`} />
        {value === 'standard' ? messages.standard : messages.twoFactor}
      </label>)}
    </div> : null}
    <Field label={messages.role} className="mb-4">
      <Select value={currentRole ?? ''} onChange={(event) => { if (!busy) { setRole(event.target.value as RoleAccount['role']); setSelected(''); setFailed(false); } }} data-testid={`role-account-role-${realm}`}>
        {roles.map((value) => <option key={value} value={value}>{messages.roles[value]}</option>)}
      </Select>
    </Field>
    <Field label={messages.account} className="mb-6">
      <Select value={current?.id ?? ''} onChange={(event) => { if (!busy) { setSelected(event.target.value); setFailed(false); } }} data-testid={`role-account-account-${realm}`}>
        {candidates.map((account) => <option key={account.id} value={account.id}>{realm === 'tenant' ? `${messages.company}${account.tenantNumber} · ${account.email}` : account.email}</option>)}
      </Select>
    </Field>
    {failed ? <FieldError className="mb-4" data-testid={`role-account-error-${realm}`}>{messages.error}</FieldError> : null}
    <Button type="submit" className="w-full" aria-busy={busy} data-testid={`role-account-submit-${realm}`}>{busy ? messages.submitting : messages.submit}</Button>
    <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <Button type="button" variant="secondary" onClick={() => { if (!busy) onManual(); }} data-testid={`role-account-manual-${realm}`}>{messages.emailMethod}</Button>
      <a className={SECONDARY_LINK_STACKED_CLASSES} href={realm === 'tenant' ? '/admin/signin' : '/signin'}>{realm === 'tenant' ? messages.platformLink : messages.tenantLink}</a>
    </div>
  </form>;
}
