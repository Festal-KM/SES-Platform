// apps/web/app/(main)/settings/retention/page.tsx
// `S-042` データの返却と保持期間（docs/04 §S-042 / `F-064` / docs/05 §6.7 #77 #78）。T-10-09。Tier 3。
//
// 🔴 権限差分: `OWNER` / `ADMIN` のみ到達する（`DATA_EXPORT_ROLES` = #77 / #78 と同じ定数）。他ロール・取引先はホームへ戻す
//    （`S-035` / `S-036` と同じ規律）。運営者は主平面のセッションを持たないので到達できない（`F-064 AC-7`）。
// 🔴 `readRetentionView` を直接呼ぶ（自己 fetch しない。`S-038` と同じ方針）。件数は**この利用者に見える範囲**である。
// 🔴 パスは `/settings/retention`（予告メールの本文の URL = `apps/worker/src/jobs/operational-mail-params.ts` の
//    `RETENTION_SCREEN_PATH` と一致させる。変えるなら両方）。
// 🔴 `requireExecutable` 相当のガードを掛けない —— この画面は `CLOSING` でこそ使う（返却）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SECONDARY_LINK_CLASSES } from '@ses/ui';
import { t, type MessageKey } from '@ses/i18n';
import type { DataExportStatus, TenantRole } from '@ses/db';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { DATA_EXPORT_ROLES } from '../../../../lib/data-exports/service';
import { purgeGraceDays } from '../../../../lib/db/bootstrap';
import { PURGE_TARGET_TABLES, readRetentionView, type PurgeTargetTable } from '../../../../lib/retention/view';
import { RetentionScreen, type RetentionScreenMessages } from './retention-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('retention.title') };

const HOME_PATH = '/';

/** 🔴 `PURGE_SPEC.delete` の表 → 文言キー。表が増減すればコンパイルで落ちる（文言の書き忘れを作らない）。 */
const PURGE_TARGET_MESSAGE_KEYS = {
  engineers: 'retention.schedule.kind.engineers',
  skill_sheets: 'retention.schedule.kind.skill_sheets',
  skill_sheet_extractions: 'retention.schedule.kind.skill_sheet_extractions',
  engineer_careers: 'retention.schedule.kind.engineer_careers',
  users: 'retention.schedule.kind.users',
  invitations: 'retention.schedule.kind.invitations',
  partner_companies: 'retention.schedule.kind.partner_companies',
  engineer_snapshots: 'retention.schedule.kind.engineer_snapshots',
  proposals: 'retention.schedule.kind.proposals',
  proposal_events: 'retention.schedule.kind.proposal_events',
  proposal_requests: 'retention.schedule.kind.proposal_requests',
  review_gates: 'retention.schedule.kind.review_gates',
  match_candidates: 'retention.schedule.kind.match_candidates',
  messages: 'retention.schedule.kind.messages',
  contract_documents: 'retention.schedule.kind.contract_documents',
  contract_templates: 'retention.schedule.kind.contract_templates',
  contracts: 'retention.schedule.kind.contracts',
  extension_reviews: 'retention.schedule.kind.extension_reviews',
  notifications: 'retention.schedule.kind.notifications',
  email_dispatches: 'retention.schedule.kind.email_dispatches',
  send_attempts: 'retention.schedule.kind.send_attempts',
  data_export_requests: 'retention.schedule.kind.data_export_requests',
} as const satisfies Readonly<Record<PurgeTargetTable, MessageKey>>;

const STATUS_MESSAGE_KEYS = {
  QUEUED: 'retention.status.QUEUED',
  RUNNING: 'retention.status.RUNNING',
  READY: 'retention.status.READY',
  FAILED: 'retention.status.FAILED',
  EXPIRED: 'retention.status.EXPIRED',
} as const satisfies Readonly<Record<DataExportStatus, MessageKey>>;

function labelsOf<K extends string>(order: readonly K[], keys: Readonly<Record<K, MessageKey>>): Readonly<Record<K, string>> {
  const labels = {} as Record<K, string>;
  for (const key of order) labels[key] = t(keys[key]);
  return labels;
}

export function retentionMessages(): RetentionScreenMessages {
  return {
    lead: t('retention.lead'),
    readOnlyNote: t('retention.readOnlyNote'),
    bannerClosingPrefix: t('retention.banner.closing.prefix'),
    bannerClosingSuffix: t('retention.banner.closing.suffix'),
    bannerSuspended: t('retention.banner.suspended'),
    sectionSchedule: t('retention.section.schedule'),
    scheduleEmpty: t('retention.schedule.empty'),
    scheduleLead: t('retention.schedule.lead'),
    scheduleColumnKind: t('retention.schedule.column.kind'),
    scheduleColumnCount: t('retention.schedule.column.count'),
    scheduleColumnScheduledOn: t('retention.schedule.column.scheduledOn'),
    scheduleUnit: t('retention.schedule.unit'),
    scheduleKindLabels: labelsOf(PURGE_TARGET_TABLES, PURGE_TARGET_MESSAGE_KEYS),
    sectionExport: t('retention.section.export'),
    exportLead: t('retention.export.lead'),
    exportNotClosing: t('retention.export.notClosing'),
    exportGenerate: t('retention.export.generate'),
    exportGenerating: t('retention.export.generating'),
    exportGenerated: t('retention.export.generated'),
    exportDownload: t('retention.export.download'),
    exportDownloading: t('retention.export.downloading'),
    exportFailed: t('retention.export.failed'),
    exportRetry: t('retention.export.retry'),
    exportRequestFailed: t('retention.export.requestFailed'),
    exportDownloadFailed: t('retention.export.downloadFailed'),
    exportExpired: t('retention.export.expired'),
    sectionHistory: t('retention.section.history'),
    historyEmpty: t('retention.history.empty'),
    historyColumnRequestedAt: t('retention.history.column.requestedAt'),
    historyColumnStatus: t('retention.history.column.status'),
    historyColumnExpiresAt: t('retention.history.column.expiresAt'),
    historyColumnAction: t('retention.history.column.action'),
    statusLabels: labelsOf(['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'], STATUS_MESSAGE_KEYS),
  };
}

const ALLOWED_ROLES: readonly TenantRole[] = DATA_EXPORT_ROLES;

export default async function RetentionSettingsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (!ALLOWED_ROLES.includes(outcome.ctx.role)) redirect(HOME_PATH);

  const view = await readRetentionView(outcome.ctx, { now: new Date(), purgeGraceDays: purgeGraceDays() });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="retention-page">
      <p className="mb-1 text-sm text-slate-500">
        <Link className={SECONDARY_LINK_CLASSES} href="/" data-testid="retention-breadcrumb-home">
          {t('retention.breadcrumb.home')}
        </Link>{' '}
        / {t('retention.breadcrumb.settings')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('retention.title')}</h1>
      <RetentionScreen view={view} messages={retentionMessages()} />
    </main>
  );
}
