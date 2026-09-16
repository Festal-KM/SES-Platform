// apps/web/app/admin/audit-logs/page.tsx
// `A-006` 監査ログ横断検索（docs/04 §A-006 / API-A7 / `F-058` / `BR-40` / `BR-42`）。T3 / Phase 1。T-11-03。
//
// 🔴 記録をテナント横断で読む唯一の業務（`BR-42`）。両ロール（`PLATFORM_OWNER` / `PLATFORM_SUPPORT`）
//    閲覧のみ。書き込み操作なし。画面タイトル右に「閲覧のみ」を常時表示する（`BR-37`。docs/04 §4-4）。
// 🔴 期間は既定で直近 7 日を埋めて開く（docs/04 §A-006「期間必須」）。上限日数（`AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS`）
//    とページサイズ（`ADMIN_MONITORING_PAGE_SIZE`）は `packages/config` から読んで props で渡す
//    （クライアントで `@ses/config` / `@ses/db` を値 import しない）。
// 🔴 このページ自身は DB を読まない（検索は利用者の操作で API-A7 を呼ぶ。開いただけで横断検索の
//    監査行を残さない）。`?targetTenantId=`（`A-003` の導線）は形だけ検証して初期値に入れる。
// 🔴 表示するのは日時・テナント・主体（種別 + ID）・操作・対象種別・マスク済みの記録・IP・デバイス
//    （`F-058 AC-1`）。行から遷移できるのは `A-003` だけで、対象の内容へ到達する導線は無い（`F-058 AC-2`）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ADMIN_MONITORING_PAGE_SIZE, AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS } from '@ses/config';
import { AUDIT_ACTOR_KINDS, AUDIT_DEVICE_KINDS, type AuditActorKind } from '@ses/db';
import { t } from '@ses/i18n';
import { Badge } from '@ses/ui';
import { resolvePlatformCtxOutcome } from '../../../lib/auth/platform-session';
import { defaultAuditLogPeriod } from '../../../lib/admin-audit-logs/period';
import { isTenantIdLike } from '../../../lib/admin-tenants/schemas';
import { AdminAuditLogsView, type AdminAuditLogsViewMessages } from './admin-audit-logs-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('admin.auditLogs.title') };

/** 既定の期間の幅（docs/04 §A-006「直近 7 日」）。 */
const DEFAULT_PERIOD_DAYS = 7;

const ACTOR_KIND_MESSAGE_KEYS = {
  USER: 'admin.auditLogs.actor.USER',
  PLATFORM_USER: 'admin.auditLogs.actor.PLATFORM_USER',
  SYSTEM: 'admin.auditLogs.actor.SYSTEM',
} as const satisfies Record<AuditActorKind, string>;

function actorKindLabels(): Readonly<Record<AuditActorKind, string>> {
  return {
    USER: t(ACTOR_KIND_MESSAGE_KEYS.USER),
    PLATFORM_USER: t(ACTOR_KIND_MESSAGE_KEYS.PLATFORM_USER),
    SYSTEM: t(ACTOR_KIND_MESSAGE_KEYS.SYSTEM),
  };
}

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly targetTenantId?: string }>;
}) {
  const outcome = await resolvePlatformCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/admin/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/admin/signin?step=2fa');

  const { targetTenantId } = await searchParams;
  // 🔴 形が違う値は初期値に入れない（`A-003` 以外から来た改竄値を API へそのまま流さない）。
  const initialTargetTenantId =
    targetTenantId !== undefined && isTenantIdLike(targetTenantId) ? targetTenantId : null;

  const actorLabels = actorKindLabels();
  const messages: AdminAuditLogsViewMessages = {
    sectionFilters: t('admin.auditLogs.section.filters'),
    sectionResults: t('admin.auditLogs.section.results'),
    sectionRecord: t('admin.auditLogs.section.record'),
    fromLabel: t('admin.auditLogs.filter.from.label'),
    toLabel: t('admin.auditLogs.filter.to.label'),
    targetTenantIdLabel: t('admin.auditLogs.filter.tenantId.label'),
    actionLabel: t('admin.auditLogs.filter.action.label'),
    actorTypeLabel: t('admin.auditLogs.filter.actorType.label'),
    actorTypeAll: t('admin.auditLogs.filter.actorType.all'),
    deviceKindLabel: t('admin.auditLogs.filter.deviceKind.label'),
    deviceKindAll: t('admin.auditLogs.filter.deviceKind.all'),
    periodNote: t('admin.auditLogs.filter.periodNote'),
    search: t('admin.auditLogs.search'),
    searching: t('admin.auditLogs.searching'),
    searchingSlow: t('admin.auditLogs.searchingSlow'),
    loadMore: t('admin.auditLogs.loadMore'),
    loadingMore: t('admin.auditLogs.loadingMore'),
    periodRequired: t('admin.auditLogs.error.periodRequired'),
    periodInverted: t('admin.auditLogs.error.periodInverted'),
    periodTooLong: t('admin.auditLogs.error.periodTooLong'),
    errorPeriodTooLong: t('admin.auditLogs.error.periodTooLong'),
    errorSearchFailed: t('admin.auditLogs.error.searchFailed'),
    emptyBeforeSearch: t('admin.auditLogs.empty.beforeSearch'),
    emptyNoMatch: t('admin.auditLogs.empty.noMatch'),
    columnDate: t('admin.auditLogs.column.date'),
    columnTenant: t('admin.auditLogs.column.tenant'),
    columnActor: t('admin.auditLogs.column.actor'),
    columnAction: t('admin.auditLogs.column.action'),
    columnTargetType: t('admin.auditLogs.column.targetType'),
    columnSummary: t('admin.auditLogs.column.summary'),
    columnMeta: t('admin.auditLogs.column.meta'),
    actorKinds: actorLabels,
    tenantCrossTenant: t('admin.auditLogs.tenant.crossTenant'),
    tenantUnresolved: t('admin.auditLogs.tenant.unresolved'),
    tenantOpenDetail: t('admin.auditLogs.tenant.openDetail'),
    recordNote: t('admin.auditLogs.record.note'),
    noReachNote: t('admin.auditLogs.noReachNote'),
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('admin.auditLogs.title')}</h1>
        {/* 🔴 BR-37: 運営者コンソールは既定 read-only。書き込み操作なしを常時明示する。 */}
        <Badge>{t('admin.readOnly.badge')}</Badge>
      </div>
      <p className="mb-6 text-sm text-slate-600" data-testid="admin-audit-logs-lead">
        {t('admin.auditLogs.lead')}
      </p>
      <AdminAuditLogsView
        messages={messages}
        initialPeriod={defaultAuditLogPeriod(new Date(), DEFAULT_PERIOD_DAYS)}
        initialTargetTenantId={initialTargetTenantId}
        maxPeriodDays={AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS}
        pageSize={ADMIN_MONITORING_PAGE_SIZE}
        actorTypeOptions={AUDIT_ACTOR_KINDS.map((kind) => ({ value: kind, label: actorLabels[kind] }))}
        // デバイス種別は値をそのまま表示する（技術的な列挙値。`S-041` の IP・デバイス列と同じ扱い）。
        deviceKindOptions={AUDIT_DEVICE_KINDS.map((kind) => ({ value: kind, label: kind }))}
      />
    </main>
  );
}
