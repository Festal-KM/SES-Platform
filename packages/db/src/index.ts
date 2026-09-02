// packages/db/src/index.ts
// 🔴 主平面から使ってよいものだけを export する（docs/05 §2.1）。
//    生 PrismaClient / TenantDb 型 / 生 SQL の入口は export しない。
export { configureTenantDb, disconnectTenantDb } from './client.js';
export type { TenantDbOptions } from './client.js';
export { HostOnlyContextError, requireHost, resolveTenantCtx } from './context.js';
export type {
  AuthenticatedTenantCtx,
  DeviceKind,
  HostTenantCtx,
  MainSession,
  RequestMeta,
  TenantLifecycleState,
  TenantRole,
} from './context.js';
export {
  CrossTenantWriteError,
  TENANT_SCOPE_EXCLUDED_MODELS,
  TenantRelationWriteError,
  UnscopedOperationError,
} from './scope-injection.js';
export { withHostTenant, withTenant } from './with-tenant.js';
