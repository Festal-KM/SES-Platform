// apps/web/app/(main)/(auth)/password-reset/confirm/page.tsx
// `S-046` ③ 新パスワード設定（docs/04 §S-046 / T1 / Phase 0 / `F-003`）。
//
// 🔴 無効・期限切れのトークンは 404 ページに落とさない（`S-046` の Err 列の専用文言で扱う。
//    他画面の「見えない = 存在しない」＝ 404 の規律とは別扱い。docs/05 §6.3 #5b）。
// 🔴 本タスク（T-03-13）は画面のみ。既存の #5b `POST /api/auth/password-reset/confirm` を
//    呼ぶだけで、API 側は変更しない。
//
// 🔴 `PASSWORD_MIN_LENGTH` の出所を #5b（`packages/config/src/limits.ts`）と単一化する
//    （画面側で別の値を発明しない）。サーバコンポーネントである本ファイルでのみ
//    `@ses/config` を import し、値を prop として渡す（クライアントバンドルに
//    config を持ち込まない）。
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { PASSWORD_MIN_LENGTH } from '@ses/config';
import { ConfirmForm, type ConfirmFormMessages } from './confirm-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: t('passwordReset.title'),
  // 🔴 リンクはトークンを含む。検索エンジンにもリファラにも渡さない（`invite/[token]` と同じ）。
  robots: { index: false, follow: false },
};

const messages: ConfirmFormMessages = {
  eyebrow: t('passwordReset.confirm.eyebrow'),
  newPasswordLabel: t('passwordReset.confirm.newPassword.label'),
  newPasswordConfirmLabel: t('passwordReset.confirm.newPasswordConfirm.label'),
  passwordHint: t('passwordReset.confirm.passwordHint'),
  submit: t('passwordReset.confirm.submit'),
  submitting: t('passwordReset.confirm.submitting'),
  mismatch: t('passwordReset.confirm.mismatch'),
  success: t('passwordReset.confirm.success'),
  signInLink: t('passwordReset.confirm.signInLink'),
  invalidLink: t('error.passwordReset.invalidToken'),
  invalidLinkRetry: t('passwordReset.confirm.invalidLink.retry'),
  networkError: t('passwordReset.error.network'),
  validationError: t('error.validation'),
};

export default async function PasswordResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
        <h1>{t('passwordReset.title')}</h1>
        {/* 🔴 トークンはフォームの内部でしか使わない（画面にも監査ログにも出さない）。 */}
        <ConfirmForm token={token ?? ''} minLength={PASSWORD_MIN_LENGTH} messages={messages} />
      </div>
    </main>
  );
}
