// apps/web/app/admin/usage/_lib/messages.ts
// `A-004` の文言（`packages/i18n` → 純粋な描画部品 / クライアントの props）。T-11-02。
// 🔴 `page.tsx` から分けているのは Next.js のページが任意の名前を export できないため（`*.render.test.tsx` もここから読む）。
// 🔴 文言は `packages/i18n` にのみ置く（`CLAUDE.md` §3.5）。ここは `t()` の呼び出しの束であり、文言そのものを書かない。
import { AI_ROLES, AI_UNIT_METRICS, QUOTA_OVERRIDE_METRICS, type QuotaOverrideMetric } from '@ses/domain';
import { t } from '@ses/i18n';
import type { AdminUsageViewMessages } from '../admin-usage-view';

// 🔴 `QuotaOverrideMetric` は AI の月次件数 4 単位のみ（メール / ストレージは上書きの対象外。表示は `quota.defaultFixed`）。
const METRIC_MESSAGE_KEYS = {
  AI_UNIT_SHEET_PARSE: 'admin.usage.metric.AI_UNIT_SHEET_PARSE',
  AI_UNIT_MATCH_RATIONALE: 'admin.usage.metric.AI_UNIT_MATCH_RATIONALE',
  AI_UNIT_PROPOSAL_DRAFT: 'admin.usage.metric.AI_UNIT_PROPOSAL_DRAFT',
  AI_UNIT_RENEWAL_SUMMARY: 'admin.usage.metric.AI_UNIT_RENEWAL_SUMMARY',
} as const satisfies Readonly<Record<QuotaOverrideMetric, string>>;

export function adminUsageMessages(): AdminUsageViewMessages {
  return {
    lead: t('admin.usage.lead'),
    moneyNote: t('admin.usage.moneyNote'),
    loading: t('admin.usage.loading'),
    loadFailed: t('admin.usage.loadFailed'),
    reload: t('admin.usage.reload'),
    reloading: t('admin.usage.reloading'),
    observedAt: t('admin.usage.observedAt'),
    periodDay: t('admin.usage.period.day'),
    periodMonth: t('admin.usage.period.month'),
    env: {
      title: t('admin.usage.env.title'),
      note: t('admin.usage.env.note'),
      spent: t('admin.usage.env.spent'),
      cap: t('admin.usage.env.cap'),
      rate: t('admin.usage.env.rate'),
      over: t('admin.usage.env.over'),
      tenants: t('admin.usage.env.tenants'),
      byRole: t('admin.usage.env.byRole'),
    },
    filter: {
      label: t('admin.usage.filter.label'),
      all: t('admin.usage.filter.all'),
      low: t('admin.usage.filter.low'),
      high: t('admin.usage.filter.high'),
      noteLow: t('admin.usage.filter.note.low'),
      noteHigh: t('admin.usage.filter.note.high'),
      thresholdLow: t('admin.usage.filter.threshold.low'),
      thresholdHigh: t('admin.usage.filter.threshold.high'),
    },
    emptyFiltered: t('admin.usage.empty.filtered'),
    emptyNone: t('admin.usage.empty.none'),
    columns: {
      tenant: t('admin.usage.column.tenant'),
      state: t('admin.usage.column.state'),
      seats: t('admin.usage.column.seats'),
      aiUnits: t('admin.usage.column.aiUnits'),
      aiDaily: t('admin.usage.column.aiDaily'),
      aiMonthly: t('admin.usage.column.aiMonthly'),
      email: t('admin.usage.column.email'),
      storage: t('admin.usage.column.storage'),
      band: t('admin.usage.column.band'),
      actions: t('admin.usage.column.actions'),
    },
    metric: Object.fromEntries(QUOTA_OVERRIDE_METRICS.map((metric) => [metric, t(METRIC_MESSAGE_KEYS[metric])])) as Record<
      QuotaOverrideMetric,
      string
    >,
    unitCount: t('admin.usage.unit.count'),
    unitMessages: t('admin.usage.unit.messages'),
    standardCost: t('admin.usage.standardCost'),
    level: {
      BELOW: t('admin.usage.level.BELOW'),
      NEARING: t('admin.usage.level.NEARING'),
      REACHED: t('admin.usage.level.REACHED'),
      unknown: t('admin.usage.level.unknown'),
    },
    band: {
      LOW: t('admin.usage.band.LOW'),
      MID: t('admin.usage.band.MID'),
      HIGH: t('admin.usage.band.HIGH'),
    },
    quota: {
      default: t('admin.usage.quota.default'),
      defaultFixed: t('admin.usage.quota.defaultFixed'),
      override: t('admin.usage.quota.override'),
      pending: t('admin.usage.quota.pending'),
      pendingLowering: t('admin.usage.quota.pendingLowering'),
      effectiveFrom: t('admin.usage.quota.effectiveFrom'),
    },
    ratio: {
      unitCost: t('admin.usage.ratio.unitCost'),
      unitCostNote: t('admin.usage.ratio.unitCost.note'),
      baseline: t('admin.usage.ratio.baseline'),
      na: t('admin.usage.ratio.na'),
    },
    byRole: t('admin.usage.byRole'),
    roles: Object.fromEntries(AI_ROLES.map((role) => [role, role])) as Record<(typeof AI_ROLES)[number], string>,
    rowTenantDetail: t('admin.usage.row.tenantDetail'),
    rowOpenQuota: t('admin.usage.row.openQuota'),
    form: {
      title: t('admin.usage.form.title'),
      lead: t('admin.usage.form.lead'),
      selectTenant: t('admin.usage.form.selectTenant'),
      tenant: t('admin.usage.form.tenant'),
      metric: t('admin.usage.form.metric'),
      current: t('admin.usage.form.current'),
      limit: t('admin.usage.form.limit'),
      limitHint: t('admin.usage.form.limit.hint'),
      effectiveFrom: t('admin.usage.form.effectiveFrom'),
      lowering: t('admin.usage.form.lowering'),
      raising: t('admin.usage.form.raising'),
      notify: t('admin.usage.form.notify'),
      reason: t('admin.usage.form.reason'),
      submit: t('admin.usage.form.submit'),
      submitting: t('admin.usage.form.submitting'),
      success: t('admin.usage.form.success'),
      failed: t('admin.usage.form.failed'),
    },
    aiUnitMetrics: [...AI_UNIT_METRICS],
  };
}
