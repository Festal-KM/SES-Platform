'use client';

// apps/web/app/admin/usage/admin-usage-view.tsx
// `A-004` 利用量・クォータ管理 — 読み込み・抽出・クォータ上書きの組み立て（docs/04 §A-004 / API-A6 / `F-057`）。T-11-02。
//
// 🔴 開いた時点で API-A6 を 1 回呼ぶ（読み取りは `withPlatformRead` 1 回 = 監査行 1 本）。抽出（`F-057 AC-1`）は `?filter=` を付けて
//    再取得する（帯の判定はサーバ側で済んでいる。ここでは表示だけ）。
// 🔴 `canEditQuota`（`PLATFORM_OWNER`）が `false` のとき、フォーム（`QuotaOverrideForm`）と行の「クォータを変更」は**描かれない**
//    （`F-057 AC-2` / `BR-44`。グレーアウトではなく不在）。判定はサーバ（`page.tsx`）が `platformRole` から行い、ここは受け取るだけ。
// 🔴 文言は props（`packages/i18n`）。`@ses/db` / `@ses/db/platform` を値 import しない（`tests/static/client-db-boundary.test.ts`）。
//    応答の型は `apps/web/lib/admin-usage/view.ts`（純粋な型）だけを参照する。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuotaOverrideMetric } from '@ses/domain';
import { Alert, AlertDescription, Button } from '@ses/ui';
import type { AdminUsageFilter } from '../../../lib/admin-usage/schemas';
import type { AdminUsageTenantRow, AdminUsageView as AdminUsageViewData } from '../../../lib/admin-usage/view';
import { AdminUsageTable, type AdminUsageTableMessages } from './admin-usage-table';
import { QuotaOverrideForm, type QuotaOverrideFormMessages } from './quota-override-form';

export type AdminUsageViewMessages = AdminUsageTableMessages & {
  readonly lead: string;
  readonly loading: string;
  readonly loadFailed: string;
  readonly reload: string;
  readonly reloading: string;
  readonly filter: {
    readonly label: string;
    readonly all: string;
    readonly low: string;
    readonly high: string;
    readonly noteLow: string;
    readonly noteHigh: string;
    readonly thresholdLow: string;
    readonly thresholdHigh: string;
  };
  readonly form: QuotaOverrideFormMessages;
};

export type AdminUsageViewProps = {
  readonly messages: AdminUsageViewMessages;
  /** API-A6 の URL（`/api/admin/usage`）。 */
  readonly endpoint: string;
  /** `/api/admin/tenants`。`PUT {tenantsEndpoint}/{id}/quota`（API-A6）を組み立てる起点。 */
  readonly tenantsEndpoint: string;
  /** 🔴 `PLATFORM_OWNER` だけ `true`。 */
  readonly canEditQuota: boolean;
  readonly initialFilter: AdminUsageFilter;
  /** `A-005` からの導線（`?targetTenantId=`）。該当行を先頭に出し、OWNER ならフォームの対象にする。 */
  readonly targetTenantId?: string;
  /** 今日（`YYYY-MM-DD`。JST。サーバが渡す = クライアントの時計に依存しない）。 */
  readonly today: string;
  readonly metrics: readonly QuotaOverrideMetric[];
};

type LoadState =
  | { readonly kind: 'loading'; readonly previous: AdminUsageViewData | null }
  | { readonly kind: 'error'; readonly previous: AdminUsageViewData | null }
  | { readonly kind: 'ready'; readonly view: AdminUsageViewData };

const FILTERS: readonly AdminUsageFilter[] = ['all', 'low', 'high'];

export function AdminUsageView({
  messages,
  endpoint,
  tenantsEndpoint,
  canEditQuota,
  initialFilter,
  targetTenantId,
  today,
  metrics,
}: AdminUsageViewProps) {
  const [filter, setFilter] = useState<AdminUsageFilter>(initialFilter);
  const [state, setState] = useState<LoadState>({ kind: 'loading', previous: null });
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(targetTenantId ?? null);

  const load = useCallback(async () => {
    setState((current) => ({ kind: 'loading', previous: current.kind === 'ready' ? current.view : current.previous }));
    try {
      const url = `${endpoint}?filter=${encodeURIComponent(filter)}`;
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const view = (await response.json()) as AdminUsageViewData;
      setState({ kind: 'ready', view });
    } catch {
      setState((current) => ({ kind: 'error', previous: current.kind === 'ready' ? current.view : current.previous }));
    }
  }, [endpoint, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = state.kind === 'loading';
  const shown = state.kind === 'ready' ? state.view : state.previous;

  const selectedTenant: AdminUsageTenantRow | null = useMemo(() => {
    if (shown === null || selectedTenantId === null) return null;
    return shown.items.find((row) => row.tenantId === selectedTenantId) ?? null;
  }, [shown, selectedTenantId]);

  const filterLabel: Record<AdminUsageFilter, string> = {
    all: messages.filter.all,
    low: messages.filter.low,
    high: messages.filter.high,
  };

  return (
    <div>
      <p className="mb-4 text-sm text-slate-600" data-testid="admin-usage-lead">
        {messages.lead}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={messages.filter.label} data-testid="admin-usage-filters">
        <span className="text-sm text-slate-700">{messages.filter.label}:</span>
        {FILTERS.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={value === filter ? 'primary' : 'secondary'}
            aria-pressed={value === filter}
            onClick={() => setFilter(value)}
            data-testid={`admin-usage-filter-${value}`}
          >
            {filterLabel[value]}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading} data-testid="admin-usage-reload">
          {loading ? messages.reloading : messages.reload}
        </Button>
      </div>
      {shown === null ? null : (
        <p className="mb-4 text-xs text-slate-600" data-testid="admin-usage-filter-note">
          {filter === 'low' ? messages.filter.noteLow : filter === 'high' ? messages.filter.noteHigh : null}
          {filter === 'all' ? null : ' '}
          {messages.filter.thresholdLow}: {shown.lowPercent}% / {messages.filter.thresholdHigh}: {shown.warnPercent}%
        </p>
      )}
      {loading && shown === null ? (
        <p className="text-sm text-slate-600" data-testid="admin-usage-loading">
          {messages.loading}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <Alert variant="danger" className="mb-6" data-testid="admin-usage-load-failed">
          <AlertDescription>{messages.loadFailed}</AlertDescription>
        </Alert>
      ) : null}
      {shown === null ? null : (
        <AdminUsageTable
          view={shown}
          messages={messages}
          canEditQuota={canEditQuota}
          highlightedTenantId={targetTenantId}
          onSelectTenant={canEditQuota ? setSelectedTenantId : undefined}
        />
      )}
      {/* 🔴 SUPPORT にはフォームそのものが無い（描かない）。 */}
      {canEditQuota ? (
        <QuotaOverrideForm
          messages={messages.form}
          metricLabels={messages.metric}
          metrics={metrics}
          tenant={selectedTenant}
          today={today}
          quotaEndpoint={(tenantId) => `${tenantsEndpoint}/${encodeURIComponent(tenantId)}/quota`}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
