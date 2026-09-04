// apps/web/app/(main)/settings/organization/page.tsx
// `S-035` 組織設定（docs/04 §S-035 / `F-001` / `F-021` / docs/05 §6.3 #64）。T-03-10。
//
// 🔴 権限差分: `OWNER` / `ADMIN` のみ到達する。`PARTNER_ADMIN` は自社配下を別の入口
//    （`S-014` の自社詳細）から管理し、本画面には到達しない（`F-002 AC-4`）。
//    データ境界の最終的な強制は `#64`（`requireRole` + RLS の `app_is_host()`）が行うが、
//    画面としても到達させない（ホームへ戻す。`S-041` と同じ規律）。
// 🔴 Phase 0 の範囲は**組織情報と承認ポリシー**（= `#64` が返す項目）である。
//    メンバー一覧・招待・プランと利用量の要約は Phase 1（`docs/04` §S-035 は Phase 0→P1）。
//    実装していないことを画面で隠さず、その旨を表示する。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { readOrganizationSettings } from '../../../../lib/settings/organization';
import { TENANT_LIFECYCLE_STATE_MESSAGE_KEYS } from '../../../../lib/tenants/labels';
import { OrganizationForm } from './organization-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('orgSettings.title') };

const HOME_PATH = '/';

export default async function OrganizationSettingsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.role !== 'OWNER' && outcome.ctx.role !== 'ADMIN') redirect(HOME_PATH);

  const settings = await readOrganizationSettings(outcome.ctx);

  return (
    <main className="ses-page">
      <h1>{t('orgSettings.title')}</h1>
      <OrganizationForm
        initial={settings}
        messages={{
          organizationSection: t('orgSettings.section.organization'),
          nameLabel: t('orgSettings.name.label'),
          timezoneLabel: t('orgSettings.timezone.label'),
          currencyLabel: t('orgSettings.currency.label'),
          currencyValue: t('orgSettings.currency.value'),
          environmentLabel: t('orgSettings.environment.label'),
          lifecycleLabel: t('orgSettings.lifecycleState.label'),
          lifecycleReadOnlyNote: t('orgSettings.lifecycleState.readOnlyNote'),
          lifecycleStateName: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS[settings.lifecycleState]),
          piiRetentionYearsLabel: t('orgSettings.piiRetentionYears.label'),
          approvalSection: t('orgSettings.section.approvalPolicy'),
          autoApproveLabel: t('orgSettings.autoApprove.label'),
          autoApproveWarning: t('orgSettings.autoApprove.warning'),
          autoApproveConfirm: t('orgSettings.autoApprove.confirm'),
          autoApproveScopeNote: t('orgSettings.autoApprove.scopeNote'),
          save: t('orgSettings.save'),
          saving: t('orgSettings.saving'),
          saved: t('orgSettings.saved'),
          saveFailed: t('orgSettings.error.saveFailed'),
          membersComingSoon: t('orgSettings.members.comingSoon'),
        }}
      />
    </main>
  );
}
