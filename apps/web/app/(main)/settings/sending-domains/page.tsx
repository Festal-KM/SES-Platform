// apps/web/app/(main)/settings/sending-domains/page.tsx
// `S-036` 送信ドメインの設定と検証（docs/04 §S-036 / `F-001 AC-4` / docs/05 §6.3 #71 #72）。T-04-06。
//
// 🔴 設定画面ではなく**オンボーディングの最終工程**として描く（`docs/02` `ui-design` 申し送り 13 /
//    `docs/04` §S-036）。未検証を「壊れている」ではなく「取引先へ送信できない状態」として、
//    理由と手順とともに示す（機能を隠さない）。
// 🔴 権限差分: 到達は `OWNER` / `ADMIN`。登録は `OWNER` のみ、`ADMIN` は検証状態の確認と
//    再実行のみ（docs/04 §S-036「権限差分」）。データ境界の最終的な強制は #71 / #72
//    （`requireRole` + RLS の `app_is_host()`）が行うが、画面としても他ロールを到達させない
//    （ホームへ戻す。`S-035` / `S-041` と同じ規律）。
// 🔴 `readSendingDomainSettings` を直接呼ぶ（自己 fetch しない。`S-035` の
//    `readOrganizationSettings` と同じ方針。docs/04 `program-design` 申し送り 6）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t, type MessageKey } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { sendingDomainRuntime } from '../../../../lib/db/bootstrap';
import {
  readSendingDomainSettings,
  SENDING_DOMAIN_AFFECTS,
} from '../../../../lib/settings/sending-domains';
import { SENDING_DOMAIN_STATE_MESSAGE_KEYS } from '../../../../lib/settings/sending-domain-fact';
import { SendingDomainScreen, type SendingDomainScreenMessages } from './sending-domain-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('settings.sendingDomain.title') };

const HOME_PATH = '/';

/** 🔴 `SENDING_DOMAIN_AFFECTS` の 4 要素に対する完全な写像（増減があればコンパイルで落ちる）。 */
const AFFECTED_FEATURE_MESSAGE_KEYS = {
  'S-021': 'settings.sendingDomain.affects.screen.S-021',
  'S-024': 'settings.sendingDomain.affects.screen.S-024',
  'S-026': 'settings.sendingDomain.affects.screen.S-026',
  'S-014': 'settings.sendingDomain.affects.screen.S-014',
} as const satisfies Record<(typeof SENDING_DOMAIN_AFFECTS)[number], MessageKey>;

/** 🔴 `failureMessageKeyOf`（`sending-domains.ts`）が返しうる 4 キーの表示文言。 */
const FAILURE_REASON_MESSAGE_KEYS = [
  'settings.sendingDomain.failure.DKIM_NOT_VERIFIED',
  'settings.sendingDomain.failure.MAIL_FROM_NOT_VERIFIED',
  'settings.sendingDomain.failure.MAIL_FROM_NOT_CONFIGURED',
  'settings.sendingDomain.failure.IDENTITY_NOT_VERIFIED',
] as const satisfies readonly MessageKey[];

export default async function SendingDomainSettingsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.role !== 'OWNER' && outcome.ctx.role !== 'ADMIN') redirect(HOME_PATH);

  const view = await readSendingDomainSettings(outcome.ctx, sendingDomainRuntime());

  const messages: SendingDomainScreenMessages = {
    onboardingHeading: t('settings.sendingDomain.onboarding.heading'),
    onboardingSteps: [
      t('settings.sendingDomain.onboarding.step.provisioning'),
      t('settings.sendingDomain.onboarding.step.invitation'),
      t('settings.sendingDomain.onboarding.step.organization'),
      t('settings.sendingDomain.onboarding.step.current'),
    ],
    onboardingGoal: t('settings.sendingDomain.onboarding.goal'),

    sectionStatus: t('settings.sendingDomain.section.status'),
    fact: {
      domainLabel: t('settings.sendingDomain.status.domainLabel'),
      noneLabel: t('settings.sendingDomain.status.none'),
      notRequiredNotice: t('settings.sendingDomain.notRequired.notice'),
      stateLabels: {
        REGISTERED: t(SENDING_DOMAIN_STATE_MESSAGE_KEYS.REGISTERED),
        PENDING: t(SENDING_DOMAIN_STATE_MESSAGE_KEYS.PENDING),
        VERIFIED: t(SENDING_DOMAIN_STATE_MESSAGE_KEYS.VERIFIED),
        FAILED: t(SENDING_DOMAIN_STATE_MESSAGE_KEYS.FAILED),
      },
    },

    bannerUnset: t('settings.sendingDomain.banner.unset'),
    bannerFailed: t('settings.sendingDomain.banner.failed'),
    failureReasonLabels: Object.fromEntries(FAILURE_REASON_MESSAGE_KEYS.map((key) => [key, t(key)])),

    sectionRegister: t('settings.sendingDomain.section.register'),
    registerDomainLabel: t('settings.sendingDomain.register.domainLabel'),
    registerPlaceholder: t('settings.sendingDomain.register.placeholder'),
    registerSubmit: t('settings.sendingDomain.register.submit'),
    registerSubmitting: t('settings.sendingDomain.register.submitting'),
    registerError: t('settings.sendingDomain.register.error'),
    registerOwnerOnlyNote: t('settings.sendingDomain.register.ownerOnlyNote'),

    sectionRecords: t('settings.sendingDomain.section.records'),
    recordsColumnType: t('settings.sendingDomain.records.column.type'),
    recordsColumnName: t('settings.sendingDomain.records.column.name'),
    recordsColumnValue: t('settings.sendingDomain.records.column.value'),
    recordsColumnCopy: t('settings.sendingDomain.records.column.copy'),
    recordsColumnResult: t('settings.sendingDomain.records.column.result'),
    recordsResultConfirmed: t('settings.sendingDomain.records.result.confirmed'),
    recordsResultUnconfirmed: t('settings.sendingDomain.records.result.unconfirmed'),
    recordsCopy: t('settings.sendingDomain.records.copy'),
    recordsCopied: t('settings.sendingDomain.records.copied'),
    recordsCopyFailed: t('settings.sendingDomain.records.copyFailed'),
    recordsDkimPending: t('settings.sendingDomain.records.dkimPending'),
    recordPurposeLabels: {
      DKIM: t('settings.sendingDomain.record.DKIM'),
      MAIL_FROM_MX: t('settings.sendingDomain.record.MAIL_FROM_MX'),
      MAIL_FROM_SPF: t('settings.sendingDomain.record.MAIL_FROM_SPF'),
    },

    verifySubmit: t('settings.sendingDomain.verify.submit'),
    verifySubmitting: t('settings.sendingDomain.verify.submitting'),
    verifyRequested: t('settings.sendingDomain.verify.requested'),
    verifyPending: t('settings.sendingDomain.verify.pending'),
    verifyPendingNote: t('settings.sendingDomain.verify.pendingNote'),
    verifyError: t('settings.sendingDomain.verify.error'),

    sectionAffects: t('settings.sendingDomain.section.affects'),
    affectsBlocked: t('settings.sendingDomain.affects.blocked'),
    affectedFeatures: SENDING_DOMAIN_AFFECTS.map((screenId) => t(AFFECTED_FEATURE_MESSAGE_KEYS[screenId])),
    exclusionMemberInvite: t('settings.sendingDomain.exclusion.memberInvite'),
    exclusionMemberInviteNote: t('settings.sendingDomain.exclusion.memberInvite.note'),
    exclusionEsign: t('settings.sendingDomain.exclusion.esign'),
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('settings.sendingDomain.breadcrumb.home')} / {t('settings.sendingDomain.breadcrumb.settings')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('settings.sendingDomain.title')}</h1>
      <SendingDomainScreen initial={view} canRegister={outcome.ctx.role === 'OWNER'} messages={messages} />
    </main>
  );
}
