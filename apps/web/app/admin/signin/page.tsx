// apps/web/app/admin/signin/page.tsx
// `A-001` 運営者サインイン（docs/04 §A-001 / T3 / Phase 0 / `F-055`）。
//
// セクション（docs/04 §A-001）:
//   1. 平面帯（`運営者コンソール`）… `app/admin/layout.tsx`
//   2. サインインフォーム
//   3. 2FA（**必須**。設定ウィザードを含む）
//
// 🔴 未認証画面である（`requirePlatformCtx` を呼ばない）。権限差分なし。
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { AuthShell } from '../../_components/auth-shell';
import {
  AdminSignInForm,
  type AdminSignInFormMessages,
  type AdminSignInStage,
} from './admin-signin-form';

export const metadata: Metadata = {
  title: t('admin.signin.title'),
};

const messages: AdminSignInFormMessages = {
  emailLabel: t('auth.signin.email.label'),
  passwordLabel: t('auth.signin.password.label'),
  submit: t('auth.signin.submit'),
  submitting: t('auth.signin.submitting'),
  invalidCredentials: t('auth.signin.error.invalidCredentials'),
  networkError: t('auth.signin.error.network'),
  twoFactorRequiredNotice: t('admin.twoFactor.required.notice'),
  twoFactorTitle: t('auth.twoFactor.title'),
  twoFactorSetupLead: t('auth.twoFactor.setup.lead'),
  twoFactorQrLabel: t('auth.twoFactor.setup.qrLabel'),
  twoFactorQrAlt: t('auth.twoFactor.setup.qrAlt'),
  twoFactorUriLabel: t('auth.twoFactor.setup.uriLabel'),
  twoFactorRecoveryHeading: t('auth.twoFactor.setup.recoveryHeading'),
  twoFactorRecoveryNote: t('auth.twoFactor.setup.recoveryNote'),
  twoFactorVerifyLead: t('auth.twoFactor.verify.lead'),
  twoFactorCodeLabel: t('auth.twoFactor.code.label'),
  twoFactorSubmit: t('auth.twoFactor.submit'),
  twoFactorSubmitting: t('auth.twoFactor.submitting'),
  twoFactorInvalidCode: t('auth.twoFactor.error.invalidCode'),
  twoFactorThrottled: t('auth.twoFactor.error.throttled'),
};

/**
 * 🔴 `?step=2fa` は「一次認証は済んでいるが第 2 要素が未充足」の再入場口である
 *    （`app/admin/page.tsx` から送られる）。**これは認可ではない** —— クエリを付けても、
 *    検証していないセッションのままでは `resolvePlatformCtx` が ctx を作らない。
 */
function initialStageOf(step: string | undefined): AdminSignInStage {
  return step === '2fa' ? 'twoFactor' : 'credentials';
}

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step } = await searchParams;
  return (
    <AuthShell wordmark={t('product.name')}>
      {/* 🔴 T-21-05: 見出しとリード文の見え方を `S-001` に揃えた（`docs/04` §A-001）。
          平面帯（`app/admin/layout.tsx`）はこの `AuthShell` の**上**に常時在る —— ここに
          最上部を占める要素を足さない。 */}
      <h1 className="mb-2 text-xl font-bold text-slate-900">{t('admin.signin.title')}</h1>
      <p className="mb-4 text-sm text-slate-700">{t('admin.signin.lead')}</p>
      <AdminSignInForm messages={messages} initialStage={initialStageOf(step)} />
    </AuthShell>
  );
}
