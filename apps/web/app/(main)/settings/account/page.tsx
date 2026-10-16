// apps/web/app/(main)/settings/account/page.tsx
// `S-048` アカウント設定（2026-10-16。人間の明示指示。[Issue #95](https://github.com/Festal-KM/SES-Platform/issues/95)）。
//
// 🔴 **ロールで絞らない。** 自分の表示名・役職・パスワードはどのロールにも在る
//    （`VIEWER` / `PARTNER_VIEWER` を含む）。`VIEWER` が禁じられているのは承認・送信・
//    ダウンロードであって（`CLAUDE.md` §10.1）、自分の資格情報の管理ではない。
// 🔴 **取引先所属も到達する。** 見えるのは自分の 1 行だけであり（`lib/settings/account.ts` の 🔴🔴）、
//    第二境界（§3.1）には 1 ミリも触れない。
// 🔴 **幅はクラス C = 読み幅**（`S-035` 組織設定と同じ。設定は「低密度・1 項目ずつ」。§7.1）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PageBody } from '@ses/ui';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { displayInitials } from '../../../../lib/format/initials';
import { readAccountSettings } from '../../../../lib/settings/account';
import { TENANT_ROLE_MESSAGE_KEYS } from '../../../../lib/tenants/labels';
import { ACCOUNT_SETTINGS_TRAIL } from '../../../../lib/shell/page-trail';
import { PageHeading } from '../../_shell/page-heading';
import { AccountForm } from './account-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('account.title') };

export default async function AccountSettingsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const settings = await readAccountSettings(outcome.ctx);

  return (
    <main className="py-6">
      <PageBody widthClass="prose">
        <PageHeading trail={ACCOUNT_SETTINGS_TRAIL} title={t('account.title')} />
        <p className="mb-6 text-body text-fg-muted">{t('account.lead')}</p>
        <AccountForm
          initial={{
            displayName: settings.displayName,
            jobTitle: settings.jobTitle,
            email: settings.email,
          }}
          // 🔴 **解決済みのイニシャル**を渡す（切り出しは呼び出し側の責務。`@ses/ui` の `Avatar` の 🔴）。
          initials={displayInitials(settings.displayName)}
          roleName={t(TENANT_ROLE_MESSAGE_KEYS[settings.role])}
          messages={{
            profileSection: t('account.section.profile'),
            displayNameLabel: t('account.displayName.label'),
            jobTitleLabel: t('account.jobTitle.label'),
            jobTitlePlaceholder: t('account.jobTitle.placeholder'),
            jobTitleUnset: t('account.jobTitle.unset'),
            emailLabel: t('account.email.label'),
            emailReadOnlyNote: t('account.email.readOnlyNote'),
            roleLabel: t('account.role.label'),
            roleName: t(TENANT_ROLE_MESSAGE_KEYS[settings.role]),
            avatarLabel: t('account.avatar.label'),
            avatarNote: t('account.avatar.note'),
            save: t('account.save'),
            saving: t('account.saving'),
            saved: t('account.saved'),
            saveFailed: t('account.saveFailed'),
            passwordSection: t('account.section.password'),
            passwordNote: t('account.password.note'),
            currentPasswordLabel: t('account.password.current'),
            newPasswordLabel: t('account.password.new'),
            newPasswordNote: t('account.password.newNote'),
            passwordSubmit: t('account.password.submit'),
            passwordSubmitting: t('account.password.submitting'),
            passwordChanged: t('account.password.changed'),
            passwordFailed: t('account.password.failed'),
          }}
        />
      </PageBody>
    </main>
  );
}
