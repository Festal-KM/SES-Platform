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
export {
  ENGINEER_AVAILABILITIES,
  ENGINEER_SKILL_SOURCES,
  GATE_LAYERS,
  GATE_VERDICTS,
  PROJECT_STATUSES,
  PROPOSAL_EVENT_KINDS,
  REMOTE_MODES,
  REQUIREMENT_KINDS,
  REVIEW_GATE_EXECUTIONS,
  REVIEW_GATE_TARGET_TYPES,
  SCAN_STATUSES,
  SKILL_ALIAS_ORIGINS,
  SKILL_ALIAS_STATUSES,
  SKILL_SHEET_EXTRACTION_STATUSES,
  TENANT_SENDING_DOMAIN_STATES,
  TWO_FACTOR_SUBJECT_TYPES,
} from './schema-value-sets.js';
export type {
  EngineerAvailability,
  EngineerSkillSource,
  GateLayer,
  GateVerdict,
  ProjectStatus,
  ProposalEventKind,
  RemoteMode,
  RequirementKind,
  ReviewGateExecution,
  ReviewGateTargetType,
  ScanStatus,
  SkillAliasOrigin,
  SkillAliasStatus,
  SkillSheetExtractionStatus,
  TenantSendingDomainState,
  TwoFactorSubjectType,
} from './schema-value-sets.js';
export {
  CrossTenantWriteError,
  TENANT_SCOPE_EXCLUDED_MODELS,
  TenantRelationWriteError,
  UnscopedOperationError,
} from './scope-injection.js';
export { withHostTenant, withTenant } from './with-tenant.js';
