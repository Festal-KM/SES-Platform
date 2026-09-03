// apps/web/app/(main)/(auth)/signin/page.tsx
// `S-001` サインイン（docs/04 §S-001 / T1 / Phase 0 / `F-003`）。
//
// セクション（docs/04 §S-001）:
//   1. ワードマーク（`U-01` の表示箇所）2. メール + パスワード
//   3. 2 要素認証コード（T-03-02。設定ウィザードを含む）4. パスワード再設定リンク
//   5. 環境バナー（T-10-05）
// 🔴 5 は本タスクのスコープ外。**省略ではなく、担当タスクで同じ画面に足す。**
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { SignInForm, type SignInFormMessages, type SignInStage } from './signin-form';

export const metadata: Metadata = {
  title: t('auth.signin.title'),
};

const messages: SignInFormMessages = {
  emailLabel: t('auth.signin.email.label'),
  passwordLabel: t('auth.signin.password.label'),
  submit: t('auth.signin.submit'),
  submitting: t('auth.signin.submitting'),
  invalidCredentials: t('auth.signin.error.invalidCredentials'),
  networkError: t('auth.signin.error.network'),
  passwordResetLink: t('auth.signin.passwordReset.link'),
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
 *    （2FA 未充足のページからここへ送られる。`app/(main)/page.tsx`）。
 *    **これは認可ではない**（クエリを付けても、検証していないセッションのままでは
 *    `resolveTenantCtx` が ctx を作らないため業務データには 1 件も到達できない）。
 */
function initialStageOf(step: string | undefined): SignInStage {
  return step === '2fa' ? 'twoFactor' : 'credentials';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step } = await searchParams;
  return (
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
        <h1>{t('auth.signin.title')}</h1>
        <SignInForm messages={messages} initialStage={initialStageOf(step)} />
      </div>
    </main>
  );
}
