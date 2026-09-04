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
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
        <h1>{t('admin.signin.title')}</h1>
        <p>{t('admin.signin.lead')}</p>
        <AdminSignInForm messages={messages} initialStage={initialStageOf(step)} />
      </div>
    </main>
  );
}
