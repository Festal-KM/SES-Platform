// apps/web/app/(main)/(auth)/signin/page.tsx
// `S-001` サインイン（docs/04 §S-001 / T1 / Phase 0 / `F-003`）。
//
// セクション（docs/04 §S-001）:
//   1. ワードマーク（`U-01` の表示箇所）2. メール + パスワード
//   3. 2 要素認証コード（T-03-02）4. パスワード再設定リンク 5. 環境バナー（T-10-05）
// 🔴 3 と 5 は本タスクのスコープ外。**省略ではなく、担当タスクで同じ画面に足す。**
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { SignInForm, type SignInFormMessages } from './signin-form';

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
};

export default function SignInPage() {
  return (
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
        <h1>{t('auth.signin.title')}</h1>
        <SignInForm messages={messages} />
      </div>
    </main>
  );
}
