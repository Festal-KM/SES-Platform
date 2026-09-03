// apps/web/app/(main)/(auth)/invite/[token]/page.tsx
// `S-002` 招待の受諾とアカウント初期設定（docs/04 §S-002 / T1 / Phase 0 / `F-002` `F-003`）。
//
// セクション（docs/04 §S-002）:
//   1. 招待の内容（招待元の組織 / 所属 / 付与ロール / メール / 有効期限）
//   2. 氏名・パスワードの設定
//   3. 2 要素認証（`OWNER` / `ADMIN` は必須）
//   4. 受諾ボタン（primary、1 つ）
// 🔴 3 は**このページに実装を重ねない**。受諾後にセッションが張られ、`/` へ遷移した時点で
//    `app/(main)/page.tsx` が `S-001` の 2FA ウィザード（T-03-02）へ送る。
//    ウィザードを 2 箇所に持つと、片方だけ規律が緩む。
//
// 🔴 招待の内容は**クライアントから `#6` を呼んで**取得する（docs/04 §S-002 の
//    「ローディング = 招待内容の骨格」「エラー = 招待を確認できません + 再読込」）。
//    API 経路を 1 本に保つ（docs/05 §6.1 / P-A-04）。
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { InviteForm, type InviteFormMessages } from './invite-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: t('invite.title'),
  // 🔴 招待 URL はトークンを含む。検索エンジンにもリファラにも渡さない。
  robots: { index: false, follow: false },
};

const messages: InviteFormMessages = {
  invitationHeading: t('invite.section.invitation'),
  accountHeading: t('invite.section.account'),
  tenantNameLabel: t('invite.tenantName.label'),
  partnerCompanyLabel: t('invite.partnerCompany.label'),
  roleLabel: t('invite.role.label'),
  emailLabel: t('invite.email.label'),
  expiresAtLabel: t('invite.expiresAt.label'),
  displayNameLabel: t('invite.displayName.label'),
  passwordLabel: t('invite.password.label'),
  passwordHint: t('invite.password.hint'),
  onceOnlyNotice: t('invite.onceOnly.notice'),
  viewerNotice: t('invite.viewer.notice'),
  submit: t('invite.submit'),
  submitting: t('invite.submitting'),
  expired: t('invite.error.expired'),
  accepted: t('invite.error.accepted'),
  notFound: t('invite.error.notFound'),
  failed: t('invite.error.failed'),
  network: t('invite.error.network'),
  signInLink: t('invite.signin.link'),
  roleNames: {
    OWNER: t('role.OWNER'),
    ADMIN: t('role.ADMIN'),
    SALES: t('role.SALES'),
    PARTNER_ADMIN: t('role.PARTNER_ADMIN'),
    PARTNER_SALES: t('role.PARTNER_SALES'),
    VIEWER: t('role.VIEWER'),
  },
};

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="ses-auth-layout">
      <div className="ses-auth-card">
        <p className="ses-wordmark">{t('product.name')}</p>
        <h1>{t('invite.title')}</h1>
        {/* 🔴 トークンはフォームの内部でしか使わない（画面にも監査ログにも出さない）。 */}
        <InviteForm token={token} messages={messages} />
      </div>
    </main>
  );
}
