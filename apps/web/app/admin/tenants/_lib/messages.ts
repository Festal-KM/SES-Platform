// apps/web/app/admin/tenants/_lib/messages.ts
// `A-002` テナント一覧の文言（`packages/i18n` → 純粋な描画部品 `AdminTenantsList` の props）。T-11-01。
// 🔴 `page.tsx` から分けているのは Next.js のページが任意の名前を export できないため（`*.render.test.tsx` もここから読む）。
// 🔴 文言は `packages/i18n` にのみ置く（`CLAUDE.md` §3.5）。ここは `t()` の呼び出しの束であり、文言そのものを書かない。
import { TENANT_HEALTH_SIGNALS, TENANT_LIST_SORT_KEYS } from '@ses/domain';
import { t } from '@ses/i18n';
import type { AdminTenantsListMessages } from '../admin-tenants-list';
import {
  TENANT_HEALTH_SIGNAL_MESSAGE_KEYS,
  TENANT_LIFECYCLE_STATE_MESSAGE_KEYS,
  TENANT_LIST_SORT_MESSAGE_KEYS,
} from './labels';

export function adminTenantsMessages(): AdminTenantsListMessages {
  return {
    columns: {
      name: t('admin.tenants.column.name'),
      lifecycleState: t('admin.tenants.column.lifecycleState'),
      environment: t('admin.tenants.column.environment'),
      seats: t('admin.tenants.column.seats'),
      seatsDetail: t('admin.tenants.column.seats.detail'),
      partners: t('admin.tenants.column.partners'),
      engineers: t('admin.tenants.column.engineers'),
      projects: t('admin.tenants.column.projects'),
      lastActivity: t('admin.tenants.column.lastActivity'),
      health: t('admin.tenants.column.health'),
    },
    lifecycleState: {
      SANDBOX: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS.SANDBOX),
      ACTIVE: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS.ACTIVE),
      SUSPENDED: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS.SUSPENDED),
      CLOSING: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS.CLOSING),
      PURGED: t(TENANT_LIFECYCLE_STATE_MESSAGE_KEYS.PURGED),
    },
    environment: {
      production: t('admin.tenants.environment.production'),
      sandbox: t('admin.tenants.environment.sandbox'),
      demo: t('admin.tenants.environment.demo'),
    },
    signal: Object.fromEntries(
      TENANT_HEALTH_SIGNALS.map((signal) => [signal, t(TENANT_HEALTH_SIGNAL_MESSAGE_KEYS[signal])]),
    ) as AdminTenantsListMessages['signal'],
    sort: {
      label: t('admin.tenants.sort.label'),
      byKey: Object.fromEntries(
        TENANT_LIST_SORT_KEYS.map((key) => [key, t(TENANT_LIST_SORT_MESSAGE_KEYS[key])]),
      ) as AdminTenantsListMessages['sort']['byKey'],
    },
    healthNone: t('admin.tenants.health.none'),
    healthNotScored: t('admin.tenants.health.notScored'),
    allClear: t('admin.tenants.health.allClear'),
    lead: t('admin.tenants.health.lead'),
    observedAt: t('admin.tenants.health.observedAt'),
    thresholds: {
      label: t('admin.tenants.health.thresholds.label'),
      inactive: t('admin.tenants.health.thresholds.inactive'),
      seats: t('admin.tenants.health.thresholds.seats'),
      partners: t('admin.tenants.health.thresholds.partners'),
      trial: t('admin.tenants.health.thresholds.trial'),
      daysOrMore: t('admin.tenants.health.unit.daysOrMore'),
      daysAfter: t('admin.tenants.health.unit.daysAfter'),
      percentBelow: t('admin.tenants.health.unit.percentBelow'),
      daysWithin: t('admin.tenants.health.unit.daysWithin'),
    },
    lastActivityNone: t('admin.tenants.lastActivity.none'),
    loadMore: t('admin.tenants.loadMore'),
    empty: t('admin.tenants.empty'),
  };
}
