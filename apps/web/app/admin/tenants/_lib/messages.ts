// apps/web/app/admin/tenants/_lib/messages.ts
// `A-002` テナント一覧の文言（`packages/i18n` → 純粋な描画部品 `AdminTenantsList` の props）。T-11-01。
// 🔴 `page.tsx` から分けているのは Next.js のページが任意の名前を export できないため（`*.render.test.tsx` もここから読む）。
// 🔴 文言は `packages/i18n` にのみ置く（`CLAUDE.md` §3.5）。ここは `t()` の呼び出しの束であり、文言そのものを書かない。
import { TENANT_HEALTH_SIGNALS, TENANT_LIST_SORT_KEYS } from '@ses/domain';
import { t, type MessageKey } from '@ses/i18n';
import {
  TENANT_HIDEABLE_COLUMN_IDS,
  type TenantHideableColumnId,
} from '../../../../lib/admin-tenants/list-href';
import type { ColumnToggleItem } from '../../../_components/column-toggle';
import type { AdminTenantsHeaderMessages } from '../admin-tenants-header';
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
    firstPage: t('admin.tenants.firstPage'),
    columnToggleTrigger: t('admin.tenants.columnToggle.trigger'),
    empty: t('admin.tenants.empty'),
    summary: {
      label: t('admin.tenants.summary.label'),
      unit: t('admin.tenants.summary.unit'),
      clear: t('admin.tenants.summary.clear'),
      filteredEmpty: t('admin.tenants.summary.filteredEmpty'),
      outOfRange: t('admin.tenants.summary.outOfRange'),
    },
  };
}

/** `A-002` の画面ヘッダ（タイトル / `A-014` の導線 / `閲覧のみ`）の文言。 */
export function adminTenantsHeaderMessages(): AdminTenantsHeaderMessages {
  return {
    title: t('admin.tenants.title'),
    provision: t('admin.provisioning.link'),
    readOnlyBadge: t('admin.readOnly.badge'),
  };
}

/**
 * 🔴 **列表示切替の項目**（`T-22-08`。`docs/04` §7.1「9 列目以降は列表示切替に格納する」/
 *    §10.3 改訂 21「優先度が最も低い `案件数` を `hideable` にする」）。
 *
 * 🔴 **語は「いまの状態に対する操作」である**（`隠す` / `表示する`）—— 切替の項目は
 *    `DropdownMenu` の 1 行であり、チェックの印を持たない（§5-13）。したがって
 *    **項目の語が状態を語らなければ、開いても「いまどちらか」が分からない**。
 *    `packages/i18n` に列ごとの 2 語を置き、**ここで文字列を合成しない**（`CLAUDE.md` §3.5）。
 *    形は `S-010`（`projects/list-props.ts`）と同じである（画面ごとに別の形を作らない）。
 */
const TENANT_COLUMN_TOGGLE_MESSAGE_KEYS: Readonly<
  Record<TenantHideableColumnId, { readonly hide: MessageKey; readonly show: MessageKey }>
> = {
  projects: {
    hide: 'admin.tenants.columnToggle.hide.projects',
    show: 'admin.tenants.columnToggle.show.projects',
  },
};

export function adminTenantsColumnToggleItems(params: {
  /** いま隠れている列（URL 由来。`parseHiddenTenantColumns`）。 */
  readonly hidden: readonly TenantHideableColumnId[];
  /** その列の表示 / 非表示を反転した URL（`tenantColumnToggleHref`）。 */
  readonly hrefOf: (columnId: TenantHideableColumnId) => string;
}): readonly ColumnToggleItem[] {
  const { hidden, hrefOf } = params;
  // 🔴 並びは `TENANT_HIDEABLE_COLUMN_IDS`（= 列の並び）で固定する（メニューの順序が動かない）。
  return TENANT_HIDEABLE_COLUMN_IDS.map((id) => {
    const isHidden = hidden.includes(id);
    const keys = TENANT_COLUMN_TOGGLE_MESSAGE_KEYS[id];
    return {
      id,
      label: t(isHidden ? keys.show : keys.hide),
      hidden: isHidden,
      href: hrefOf(id),
    };
  });
}
