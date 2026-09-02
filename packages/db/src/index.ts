// packages/db/src/index.ts
// 🔴 主平面から使ってよいものだけを export する（docs/05 §2.1）。
//    生 PrismaClient / TenantDb 型 / 生 SQL の入口は export しない。
export { configureTenantDb, disconnectTenantDb } from './client.js';
export type { TenantDbOptions } from './client.js';
export { HostOnlyContextError, requireHost, resolveTenantCtx, TENANT_ROLES } from './context.js';
export type {
  AuthenticatedTenantCtx,
  DeviceKind,
  HostTenantCtx,
  MainSession,
  RequestMeta,
  TenantLifecycleState,
  TenantRole,
} from './context.js';
export { TENANT_SENDING_DOMAIN_STATES, TWO_FACTOR_SUBJECT_TYPES } from './schema-value-sets.js';
export type { TenantSendingDomainState, TwoFactorSubjectType } from './schema-value-sets.js';
export {
  CrossTenantWriteError,
  TENANT_SCOPE_EXCLUDED_MODELS,
  TenantRelationWriteError,
  UnscopedOperationError,
} from './scope-injection.js';
export { withHostTenant, withTenant } from './with-tenant.js';
