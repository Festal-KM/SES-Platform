// apps/web/app/(main)/(auth)/password-reset/page.tsx
// `S-046` パスワード再設定（docs/04 §S-046 / T1 / Phase 0 / `F-003`）。①②の状態。
//
// 🔴 未認証・全ロール共通の導線。運営者の再設定は別ルート（`A-001`）が持つ（`BR-36`）。
// 🔴 本タスク（T-03-13）は画面のみ。既存の #5 `POST /api/auth/password-reset` を呼ぶだけで、
//    API 側は変更しない（docs/05 §6.3 #5 の仕様のまま）。
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { AuthShell } from '../../../_components/auth-shell';
import { RequestForm, type RequestFormMessages } from './request-form';

export const metadata: Metadata = {
  title: t('passwordReset.title'),
};

const messages: RequestFormMessages = {
  eyebrow: t('passwordReset.request.eyebrow'),
  emailLabel: t('passwordReset.request.email.label'),
  submit: t('passwordReset.request.submit'),
  submitting: t('passwordReset.request.submitting'),
  backToSignIn: t('passwordReset.request.backToSignIn'),
  networkError: t('passwordReset.error.network'),
  validationError: t('error.validation'),
  completeEyebrow: t('passwordReset.request.complete.eyebrow'),
  completeMessage: t('passwordReset.request.complete.message'),
  completeNote: t('passwordReset.request.complete.note'),
};

export default function PasswordResetPage() {
  return (
    <AuthShell wordmark={t('product.name')}>
      <h1 className="mb-4 text-xl font-bold text-slate-900">{t('passwordReset.title')}</h1>
      <RequestForm messages={messages} />
    </AuthShell>
  );
}
