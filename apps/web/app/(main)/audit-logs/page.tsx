// apps/web/app/(main)/audit-logs/page.tsx
// `S-041` 監査ログ（自テナント）— docs/04 §S-041 / `F-005` / `F-012`。T-03-05（SP-03）。
//
// 🔴 権限差分: `OWNER` / `ADMIN` のみ（自テナント分）。取引先・`SALES` / `VIEWER` は到達しない
//    （docs/04 §S-041）。データ境界は `GET /api/audit-logs`（`requireRole` + RLS の C2）が
//    最終的に強制するが、画面としても到達させない（ホームへ戻す。他画面の「見えない＝存在しない」
//    ＝ 404 の規律とは別に、この画面は認証済み利用者向けのため 404 ではなくホームへ戻す）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { AUDIT_LOG_CATEGORY_KEYS, type AuditLogCategoryKey } from '../../../lib/audit-logs/categories';
import { AuditLogsView, type AuditLogsViewMessages } from './audit-logs-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('auditLogs.title') };

const HOME_PATH = '/';

function categoryNames(): Readonly<Record<AuditLogCategoryKey, string>> {
  const entries = AUDIT_LOG_CATEGORY_KEYS.map(
    (key) => [key, t(`auditLogs.category.${key}`)] as const,
  );
  return Object.fromEntries(entries) as Record<AuditLogCategoryKey, string>;
}

const messages: AuditLogsViewMessages = {
  fromLabel: t('auditLogs.filter.from.label'),
  toLabel: t('auditLogs.filter.to.label'),
  categoryLabel: t('auditLogs.filter.category.label'),
  categoryAll: t('auditLogs.filter.category.all'),
  categoryNames: categoryNames(),
  actorIdLabel: t('auditLogs.filter.actorId.label'),
  search: t('auditLogs.search'),
  searching: t('auditLogs.searching'),
  loadMore: t('auditLogs.loadMore'),
  loadingMore: t('auditLogs.loadingMore'),
  periodRequired: t('auditLogs.error.periodRequired'),
  searchFailed: t('auditLogs.error.searchFailed'),
  emptyBeforeSearch: t('auditLogs.empty.beforeSearch'),
  emptyNoMatch: t('auditLogs.empty.noMatch'),
  columnDate: t('auditLogs.column.date'),
  columnActor: t('auditLogs.column.actor'),
  columnAction: t('auditLogs.column.action'),
  columnTarget: t('auditLogs.column.target'),
  columnMeta: t('auditLogs.column.meta'),
  actorSystem: t('auditLogs.actor.system'),
  actorPlatform: t('auditLogs.actor.platform'),
};

export default async function AuditLogsPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.role !== 'OWNER' && outcome.ctx.role !== 'ADMIN') redirect(HOME_PATH);

  return (
    <main className="ses-page">
      <h1>{t('auditLogs.title')}</h1>
      <AuditLogsView messages={messages} />
    </main>
  );
}
