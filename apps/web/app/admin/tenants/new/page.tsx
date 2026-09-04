// apps/web/app/admin/tenants/new/page.tsx
// `A-014` テナントの開設（docs/04 §A-014 / API-A4 / API-A5 / `F-001`）。T-03-10。
//
// 🔴 **`PLATFORM_OWNER` のみ。`PLATFORM_SUPPORT` にはこの画面が存在しない**
//    （docs/04 §A-014 権限差分 / `docs/02` 章 4.4 の `F-001` は `PP` = `−`）。
//    グレーアウトで見せず **404** にする（`A-002` のナビからも導線を出さない）。
// 🔴 この画面が作るのは**テナントの器と初期 `OWNER` だけ**である（`BR-37` / `CLAUDE.md` §10.5）。
//    エンジニア・案件・提案などの業務データを運営者が作る導線を持たない。
// 🔴 「直近の開設」は**開設して終わりにしない**ための一覧である（`F-001 AC-4`）。招待が
//    受諾されたか・送信ドメインが検証されたかまでを追う。**招待先のメールアドレスは出さない。**
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { listRecentProvisionings } from '@ses/db/platform';
import { t } from '@ses/i18n';
import {
  readPlatformRequestMeta,
  resolvePlatformCtxOutcome,
} from '../../../../lib/auth/platform-session';
import { currentAppEnv } from '../../../../lib/db/bootstrap';
import {
  PROVISIONING_INVITATION_MESSAGE_KEYS,
  SENDING_DOMAIN_STATE_MESSAGE_KEYS,
  TENANT_LIFECYCLE_STATE_MESSAGE_KEYS,
  tenantEnvironmentMessageKey,
} from '../_lib/labels';
import { ProvisioningForm } from './provisioning-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 「直近の開設」に出す件数。
 * 🔴 同名テナントの警告（docs/04 §A-014）の母集団もこの一覧である。**全件走査はしない**
 *    （運営者向けの警告であって禁止ではなく、`A-002` の一覧で確認できるため）。
 */
const RECENT_LIMIT = 50;

export default async function AdminTenantProvisioningPage() {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');
  // 🔴 `PLATFORM_SUPPORT` には「存在しない」（導線もエラーも出さない）。
  if (outcome.ctx.platformRole !== 'PLATFORM_OWNER') notFound();

  const meta = await readPlatformRequestMeta();
  const recent = await listRecentProvisionings(
    outcome.ctx,
    { limit: RECENT_LIMIT },
    { ipAddress: meta.ipAddress, now: new Date() },
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('admin.provisioning.title')}</h1>

      <ProvisioningForm
        appEnv={currentAppEnv()}
        existingNames={recent.map((item) => item.name)}
        messages={{
          environmentSection: t('admin.provisioning.section.environment'),
          environmentReadOnlyNote: t('admin.provisioning.environment.readOnlyNote'),
          companySection: t('admin.provisioning.section.company'),
          nameLabel: t('admin.provisioning.name.label'),
          currencyLabel: t('admin.provisioning.currency.label'),
          currencyValue: t('admin.provisioning.currency.value'),
          duplicateNameWarning: t('admin.provisioning.duplicateName.warning'),
          lifecycleSection: t('admin.provisioning.section.lifecycle'),
          lifecycleSandbox: t('admin.provisioning.lifecycle.SANDBOX'),
          lifecycleActive: t('admin.provisioning.lifecycle.ACTIVE'),
          lifecycleSandboxNote: t('admin.provisioning.lifecycle.sandboxNote'),
          planSection: t('admin.provisioning.section.plan'),
          planLabel: t('admin.provisioning.plan.label'),
          planHint: t('admin.provisioning.plan.hint'),
          ownerSection: t('admin.provisioning.section.owner'),
          ownerEmailLabel: t('admin.provisioning.owner.email.label'),
          ownerSingleNote: t('admin.provisioning.owner.singleNote'),
          sendingDomainSection: t('admin.provisioning.section.sendingDomain'),
          sendingDomainLabel: t('admin.provisioning.sendingDomain.label'),
          sendingDomainNote: t('admin.provisioning.sendingDomain.note'),
          defaultsSection: t('admin.provisioning.section.defaults'),
          // 🔴 `F-001 AC-1` の既定値。開設**前**に運営者へ読ませる。
          defaults: [
            t('admin.provisioning.defaults.autoApprove'),
            t('admin.provisioning.defaults.approvalMode'),
            t('admin.provisioning.defaults.visibility'),
            t('admin.provisioning.defaults.sendingDomain'),
          ],
          confirmSection: t('admin.provisioning.section.confirm'),
          confirmLead: t('admin.provisioning.confirm.lead'),
          confirmReview: t('admin.provisioning.confirm.review'),
          confirmBack: t('admin.provisioning.confirm.back'),
          submit: t('admin.provisioning.submit'),
          submitting: t('admin.provisioning.submitting'),
          notCreated: t('admin.provisioning.error.notCreated'),
          invitationFailed: t('admin.provisioning.error.invitationFailed'),
          duplicateRequest: t('admin.provisioning.error.duplicateRequest'),
          success: t('admin.provisioning.success'),
          retryInvitation: t('admin.provisioning.retryInvitation'),
        }}
      />

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          {t('admin.provisioning.recent.title')}
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-600">{t('admin.provisioning.recent.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">
                    {t('admin.provisioning.recent.column.createdAt')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.provisioning.recent.column.name')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.provisioning.recent.column.environment')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.provisioning.recent.column.lifecycleState')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.provisioning.recent.column.invitation')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t('admin.provisioning.recent.column.sendingDomain')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((item) => {
                  const environmentKey = tenantEnvironmentMessageKey(item.environment);
                  return (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">{item.createdAt}</td>
                      <td className="px-3 py-2">
                        <Link
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                          href={`/admin/tenants/${item.id}`}
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {environmentKey === null ? item.environment : t(environmentKey)}
                      </td>
                      <td className="px-3 py-2">
                        {t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[item.lifecycleState])}
                      </td>
                      <td className="px-3 py-2">
                        {t(PROVISIONING_INVITATION_MESSAGE_KEYS[item.invitationState])}
                      </td>
                      <td className="px-3 py-2">
                        {item.sendingDomainState === null
                          ? t('admin.provisioning.sendingDomain.none')
                          : t(SENDING_DOMAIN_STATE_MESSAGE_KEYS[item.sendingDomainState])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
