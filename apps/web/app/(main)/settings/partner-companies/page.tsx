// apps/web/app/(main)/settings/partner-companies/page.tsx
// `S-014` 取引先企業の一覧・詳細と招待（docs/04 §S-014 / `F-007` / docs/05 §6.4 #11〜#14）。T-04-07。
//
// 🔴 **ロールで到達を止めない**（`S-035` / `S-036` とは扱いが違う）。docs/04 §S-014 の権限差分は
//    「`OWNER` / `ADMIN` が招待・停止。`SALES` / `VIEWER` は閲覧のみ。`PARTNER_ADMIN` は
//    **自社 1 社の詳細のみに到達**し、他社は一覧にも件数にも現れない」であり、
//    **パートナーもこの画面に到達してよい**。他社が見えないのはロール判定ではなく
//    RLS の C5 が母集団を 1 行に絞るからである（`F-007 AC-1` / `F-004 AC-1`）。
//    ⚠️ ここでパートナーをリダイレクトすると、「見えないのは画面のおかげ」になってしまい、
//    API 直叩きでの担保（`F-004 AC-9`）と食い違う設計になる。
// 🔴 `listPartnerCompanies` を直接呼ぶ（自己 fetch しない。`S-035` / `S-036` と同じ方針）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { inviteUrlRuntime, sendingDomainRuntime } from '../../../../lib/db/bootstrap';
import { isMemberManagerRole } from '../../../../lib/members/policy';
import { listMembers } from '../../../../lib/members/service';
import { listPartnerCompanies } from '../../../../lib/partner-companies/service';
import {
  isSendingDomainUnverified,
  resolveSendingDomainFact,
} from '../../../../lib/settings/sending-domain-fact';
import { readSendingDomainSettings } from '../../../../lib/settings/sending-domains';
import { PARTNER_TENANT_ROLES } from '../../../../lib/tenants/roles';
import { TENANT_ROLE_MESSAGE_KEYS, TENANT_ROLE_CAPABILITY_MESSAGE_KEYS } from '../../../../lib/tenants/labels';
import type { MemberPanelProps } from './partner-companies-screen';
import { PartnerCompaniesScreen } from './partner-companies-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('partnerCompanies.title') };

export default async function PartnerCompaniesPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  // 🔴 登録・招待・停止はホスト所属の `OWNER` / `ADMIN` のみ（docs/05 §6.4 #12 / #13 の認可）。
  //    画面で導線を隠すのは補助であり、拒否の本体は API 側の `requireRole` である。
  const canManage = ctx.partnerCompanyId === null && (ctx.role === 'OWNER' || ctx.role === 'ADMIN');

  const view = await listPartnerCompanies(ctx, {});

  // 🔴 送信ドメインの検証状態は**操作できる立場の利用者にだけ**引く。
  //    `tenant_sending_domains` は C2 HOST_ONLY であり、パートナー文脈では 0 件になる ——
  //    その 0 件を「未検証」と読んで警告を出すと、取れる行動が無い相手に行き止まりの
  //    導線を見せることになる（`_shared/sending-domain-guard-banner.tsx` と同じ判断）。
  const invitationBlocked = canManage
    ? isSendingDomainUnverified(
        resolveSendingDomainFact(await readSendingDomainSettings(ctx, sendingDomainRuntime())),
      )
    : false;

  // 🔴 T-04-09: 配下アカウント（`F-002 AC-4`）。**アカウント管理の当事者でなければ引かない**
  //    （`#83` と同じ `requireRole`。氏名とメールアドレスを見せる理由が無い側に倒す）。
  //    母集団は `listMembers` の内側で RLS（C5）が決める —— パートナーには自社配下しか返らず、
  //    ホスト（自社）のアカウントも他社のアカウントも 1 行も含まれない。
  const memberPanel: MemberPanelProps | null = isMemberManagerRole(ctx.role)
    ? {
        members: await listMembers(ctx),
        viewerPartnerCompanyId: ctx.partnerCompanyId,
        // 🔴 ホストの `OWNER` / `ADMIN` は配下アカウントを**閲覧のみ**（RLS の C3 が書込を許さない）。
        canManageOwnAccounts: ctx.role === 'PARTNER_ADMIN',
        currentUserId: ctx.userId,
        // 🔴 パートナー配下に付与できるのはパートナーロールだけである
        //    （`memberships` の CHECK 制約と `decideMemberRoleChange` の規律）。
        assignableRoles: PARTNER_TENANT_ROLES,
        messages: {
          section: t('members.section'),
          readOnlyNote: t('members.readOnlyNote'),
          empty: t('members.empty'),
          valueNone: t('members.value.none'),

          columnName: t('members.column.name'),
          columnEmail: t('members.column.email'),
          columnRole: t('members.column.role'),
          columnStatus: t('members.column.status'),
          columnLastLogin: t('members.column.lastLogin'),
          columnActions: t('members.column.actions'),

          statusLabels: {
            ACTIVE: t('members.status.ACTIVE'),
            REVOKED: t('members.status.REVOKED'),
          },
          roleLabels: {
            OWNER: t(TENANT_ROLE_MESSAGE_KEYS.OWNER),
            ADMIN: t(TENANT_ROLE_MESSAGE_KEYS.ADMIN),
            SALES: t(TENANT_ROLE_MESSAGE_KEYS.SALES),
            PARTNER_ADMIN: t(TENANT_ROLE_MESSAGE_KEYS.PARTNER_ADMIN),
            PARTNER_SALES: t(TENANT_ROLE_MESSAGE_KEYS.PARTNER_SALES),
            VIEWER: t(TENANT_ROLE_MESSAGE_KEYS.VIEWER),
          },
          roleCapabilities: {
            OWNER: t(TENANT_ROLE_CAPABILITY_MESSAGE_KEYS.OWNER),
            ADMIN: t(TENANT_ROLE_CAPABILITY_MESSAGE_KEYS.ADMIN),
            SALES: t(TENANT_ROLE_CAPABILITY_MESSAGE_KEYS.SALES),
            PARTNER_ADMIN: t(TENANT_ROLE_CAPABILITY_MESSAGE_KEYS.PARTNER_ADMIN),
            PARTNER_SALES: t(TENANT_ROLE_CAPABILITY_MESSAGE_KEYS.PARTNER_SALES),
            VIEWER: t(TENANT_ROLE_CAPABILITY_MESSAGE_KEYS.VIEWER),
          },

          self: t('members.self'),

          roleChangeLabel: t('members.roleChange.label'),
          roleChangeSubmit: t('members.roleChange.submit'),
          roleChangeConfirmTitle: t('members.roleChange.confirmTitle'),
          roleChangeConfirmBefore: t('members.roleChange.confirmBefore'),
          roleChangeConfirmAfter: t('members.roleChange.confirmAfter'),
          roleChangeConfirm: t('members.roleChange.confirm'),
          roleChangeCancel: t('members.roleChange.cancel'),
          roleChangeSubmitting: t('members.roleChange.submitting'),
          roleChangeDone: t('members.roleChange.done'),
          roleChangeError: t('members.roleChange.error'),

          revokeSubmit: t('members.revoke.submit'),
          revokeConfirmTitle: t('members.revoke.confirmTitle'),
          revokeConfirmText: t('members.revoke.confirmText'),
          revokeConfirm: t('members.revoke.confirm'),
          revokeCancel: t('members.revoke.cancel'),
          revokeSubmitting: t('members.revoke.submitting'),
          revokeDone: t('members.revoke.done'),
          revokeError: t('members.revoke.error'),

          inviteSection: t('members.invite.section'),
          inviteEmailLabel: t('members.invite.email.label'),
          inviteRoleLabel: t('members.invite.role.label'),
          inviteSubmit: t('members.invite.submit'),
          inviteSubmitting: t('members.invite.submitting'),
          inviteQueued: t('members.invite.queued'),
          inviteHeld: t('members.invite.held'),
          inviteError: t('members.invite.error'),
          invitePreNotice: t('members.invite.preNotice'),

          // 🔴 `sandbox` の招待リンク（`F-007 AC-4`）。取引先招待と同一の文言を使う ——
          //    「1 回限り・再表示できない」という規律は宛先が誰であっても同じである。
          inviteLinkHeading: t('partnerCompanies.invite.link.heading'),
          inviteLinkNotice: t('partnerCompanies.invite.link.notice'),
          inviteLinkOnceOnly: t('partnerCompanies.invite.link.onceOnly'),
          inviteLinkLabel: t('partnerCompanies.invite.link.label'),
          inviteLinkCopy: t('partnerCompanies.invite.link.copy'),
          inviteLinkCopied: t('partnerCompanies.invite.link.copied'),
          inviteLinkCopyFailed: t('partnerCompanies.invite.link.copyFailed'),
        },
      }
    : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('partnerCompanies.breadcrumb.home')} / {t('partnerCompanies.breadcrumb.settings')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('partnerCompanies.title')}</h1>
      <PartnerCompaniesScreen
        initial={view}
        canManage={canManage}
        invitationBlocked={invitationBlocked}
        // 🔴 T-04-08: `sandbox` かどうかは**起動時に確定した値**から読む（`CLAUDE.md` §11.1）。
        //    ここで `APP_ENV` を評価しない。操作前の予告にだけ使い、リンクを出すか否かは
        //    `#14` の応答（`disclosure`）が決める。
        sandboxLinkHandover={inviteUrlRuntime().kind === 'SANDBOX_LINK_HANDOVER'}
        memberPanel={memberPanel}
        messages={{
          partnerScopeNotice: t('partnerCompanies.partnerScopeNotice'),
          readOnlyNote: t('partnerCompanies.readOnlyNote'),

          sectionList: t('partnerCompanies.section.list'),
          columnName: t('partnerCompanies.column.name'),
          columnStatus: t('partnerCompanies.column.status'),
          columnAccountCount: t('partnerCompanies.column.accountCount'),
          columnOpenProjectCount: t('partnerCompanies.column.openProjectCount'),
          columnProposalCount: t('partnerCompanies.column.proposalCount'),
          columnLastActivity: t('partnerCompanies.column.lastActivity'),
          statusLabels: {
            ACTIVE: t('partnerCompanies.status.ACTIVE'),
            SUSPENDED: t('partnerCompanies.status.SUSPENDED'),
          },
          valueNone: t('partnerCompanies.value.none'),
          select: t('partnerCompanies.select'),
          empty: t('partnerCompanies.empty'),

          sectionRegister: t('partnerCompanies.section.register'),
          registerNameLabel: t('partnerCompanies.register.name.label'),
          registerContactNameLabel: t('partnerCompanies.register.contactName.label'),
          registerContactEmailLabel: t('partnerCompanies.register.contactEmail.label'),
          registerSubmit: t('partnerCompanies.register.submit'),
          registerSubmitting: t('partnerCompanies.register.submitting'),
          registerDone: t('partnerCompanies.register.done'),
          registerError: t('partnerCompanies.register.error'),

          sectionDetail: t('partnerCompanies.section.detail'),
          detailSelectPrompt: t('partnerCompanies.detail.selectPrompt'),
          detailContactName: t('partnerCompanies.detail.contactName'),
          detailContactEmail: t('partnerCompanies.detail.contactEmail'),
          detailInvitedAt: t('partnerCompanies.detail.invitedAt'),
          detailPendingInvitations: t('partnerCompanies.detail.pendingInvitations'),
          detailSuspendedAt: t('partnerCompanies.detail.suspendedAt'),

          sectionInvite: t('partnerCompanies.section.invite'),
          inviteEmailLabel: t('partnerCompanies.invite.email.label'),
          inviteRoleLabel: t('partnerCompanies.invite.role.label'),
          inviteRoleValue: t('partnerCompanies.invite.role.value'),
          inviteSubmit: t('partnerCompanies.invite.submit'),
          inviteSubmitting: t('partnerCompanies.invite.submitting'),
          inviteQueued: t('partnerCompanies.invite.queued'),
          inviteHeld: t('partnerCompanies.invite.held'),
          inviteError: t('partnerCompanies.invite.error'),
          inviteBlocked: t('partnerCompanies.invite.blocked'),
          inviteBlockedLink: t('partnerCompanies.invite.blocked.link'),
          inviteBlockedMemberInviteNote: t('partnerCompanies.invite.blocked.memberInviteNote'),

          inviteLinkHeading: t('partnerCompanies.invite.link.heading'),
          inviteLinkNotice: t('partnerCompanies.invite.link.notice'),
          inviteLinkOnceOnly: t('partnerCompanies.invite.link.onceOnly'),
          inviteLinkLabel: t('partnerCompanies.invite.link.label'),
          inviteLinkCopy: t('partnerCompanies.invite.link.copy'),
          inviteLinkCopied: t('partnerCompanies.invite.link.copied'),
          inviteLinkCopyFailed: t('partnerCompanies.invite.link.copyFailed'),
          inviteLinkPreNotice: t('partnerCompanies.invite.link.preNotice'),

          sectionSuspension: t('partnerCompanies.section.suspension'),
          suspensionReasonLabel: t('partnerCompanies.suspension.reason.label'),
          suspendSubmit: t('partnerCompanies.suspend.submit'),
          suspendConfirmTitle: t('partnerCompanies.suspend.confirmTitle'),
          suspendConfirmText: t('partnerCompanies.suspend.confirmText'),
          suspendConfirm: t('partnerCompanies.suspend.confirm'),
          suspendCancel: t('partnerCompanies.suspend.cancel'),
          suspendSubmitting: t('partnerCompanies.suspend.submitting'),
          resumeSubmit: t('partnerCompanies.resume.submit'),
          resumeSubmitting: t('partnerCompanies.resume.submitting'),
          suspensionError: t('partnerCompanies.suspension.error'),
        }}
      />
    </main>
  );
}
