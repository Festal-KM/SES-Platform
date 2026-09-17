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
// 🔴 T-04-06: 最上部の送信ドメイン未検証バナー（`docs/04` §S-036 1298 行）。本画面は
//    すでに `OWNER` / `ADMIN` のみ到達するため、追加のロール判定は要らない
//    （`_shared/sending-domain-guard-banner.tsx` 冒頭コメント参照）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SECONDARY_LINK_CLASSES } from '@ses/ui';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { sendingDomainRuntime } from '../../../../lib/db/bootstrap';
import { readOrganizationSettings } from '../../../../lib/settings/organization';
import { isSendingDomainUnverified, resolveSendingDomainFact } from '../../../../lib/settings/sending-domain-fact';
import { readSendingDomainSettings } from '../../../../lib/settings/sending-domains';
import { TENANT_LIFECYCLE_STATE_MESSAGE_KEYS } from '../../../../lib/tenants/labels';
import { SendingDomainGuardBanner } from '../../_shared/sending-domain-guard-banner';
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
  const showSendingDomainBanner = isSendingDomainUnverified(
    resolveSendingDomainFact(await readSendingDomainSettings(outcome.ctx, sendingDomainRuntime())),
  );

  // T-21-03: 旧 `.ses-page` を Tailwind へ。余白は他の業務画面と同じ器に揃えた
  //          （同じ「単一カラムの業務画面」が 2 種類の余白を持つと、次の画面が倣う先を選べない）。
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <SendingDomainGuardBanner
        visible={showSendingDomainBanner}
        messages={{
          text: t('settings.sendingDomain.guardBanner.text'),
          linkLabel: t('settings.sendingDomain.guardBanner.linkLabel'),
        }}
      />
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('orgSettings.title')}</h1>
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
      {/* 🔴 T-10-04: docs/04 §S-035 セクション 5「契約プランと利用量の要約（`S-038` への導線）」。
          要約の数値（席数 / 消化率）は本タスクでは置かず、導線だけを出す —— 要約を別実装で描くと
          `S-038` と数値がずれる経路になる（残量は `readUsageView` の 1 実装で読む）。 */}
      <section className="mt-8" data-testid="org-settings-usage">
        <h2 className="mb-2 text-base font-bold text-slate-900">{t('usage.summary.heading')}</h2>
        <Link className={SECONDARY_LINK_CLASSES} href="/settings/usage" data-testid="org-settings-usage-link">
          {t('usage.open')}
        </Link>
      </section>
    </main>
  );
}
