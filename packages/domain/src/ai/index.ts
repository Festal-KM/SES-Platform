// packages/domain/src/ai/index.ts
// AI 層が共有する値集合（docs/05 §7.1 / §3.8）。🔴 判定ロジックは持たない（純粋な値集合のみ）。
export {
  AI_ROLES,
  AI_USAGE_FAILURE_KINDS,
  AI_USAGE_PURPOSES,
  APPROVAL_MODE_CONFIGURABLE_ROLES,
  isAiRole,
  ROLE_PURPOSE,
  type AiRole,
  type AiUsageFailureKind,
  type AiUsagePurpose,
  type ApprovalModeConfigurableRole,
} from './roles.js';
