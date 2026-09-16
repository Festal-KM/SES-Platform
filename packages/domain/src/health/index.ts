// packages/domain/src/health/index.ts
// テナント健全性（`A-002` の異常度スコアと並び順。docs/05 §5.7 / §6.9 API-A2 / `F-056 AC-2`）。T-11-01。
export {
  assertTenantHealthThresholds,
  compareTenantCreatedAtOrder,
  compareTenantHealthOrder,
  compareTenantNameOrder,
  DEFAULT_TENANT_HEALTH_THRESHOLDS,
  DEFAULT_TENANT_LIST_SORT,
  scoreTenantHealth,
  TENANT_HEALTH_SIGNAL_WEIGHTS,
  TENANT_HEALTH_SIGNALS,
  TENANT_LIST_SORT_KEYS,
  tenantListComparator,
  type TenantHealth,
  type TenantHealthInput,
  type TenantHealthSignal,
  type TenantHealthThresholds,
  type TenantListSortable,
  type TenantListSortKey,
} from './tenant-health.js';
