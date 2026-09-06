// packages/db/src/schema-value-sets.ts
// T-02-01 code-reviewer 指摘 2: 「今回の migration に CHECK がある他の列挙も同様に突合対象に含める」。
// TenantRole（context.ts）/ TenantLifecycleState（@ses/domain）/ 環境種別（schema-enum-drift.test.ts が
// @ses/config の APP_ENV_KINDS から導出）以外に、20260903000000_tenant_users_boundary/migration.sql が
// 値集合の CHECK を持つ列（TwoFactorCredential.subjectType / TenantSendingDomain.state）には、
// これまで単一出所の TS 定数が無かった。ここに追加し、tests/static/schema-enum-drift.test.ts の
// 突合対象にする。
//
// 🔴 docs/05 §3.3 の対応する列（`two_factor_credentials.subject_type` / `tenant_sending_domains.state`）は
// いずれも Prisma の `enum` を使わず `String` + コメントで宣言されている（§3.1「列挙」規約）。

/** docs/05 §3.3 `TwoFactorCredential.subjectType`（TEXT + CHECK）。 */
export const TWO_FACTOR_SUBJECT_TYPES = ['USER', 'PLATFORM_USER'] as const;

export type TwoFactorSubjectType = (typeof TWO_FACTOR_SUBJECT_TYPES)[number];

/** docs/05 §3.3 `TenantSendingDomain.state`（TEXT + CHECK）。 */
export const TENANT_SENDING_DOMAIN_STATES = ['REGISTERED', 'PENDING', 'VERIFIED', 'FAILED'] as const;

export type TenantSendingDomainState = (typeof TENANT_SENDING_DOMAIN_STATES)[number];

// 🔴 T-02-02（docs/05 §3.4 / §3.5。docs/sprints/SP-02-schema-isolation.md）:
// 20260903010000_engineer_project_visibility_share/migration.sql が値集合の CHECK を持つ列。
// いずれも CLAUDE.md §4.2 の 5 状態機械には含まれない（遷移ロジックの無い単純な値集合）ため、
// packages/domain ではなくここに置く（TenantSendingDomainState 等と同じ扱い）。

/** docs/05 §3.4 `Engineer.availability`（TEXT + CHECK）。稼働中/待機予定/待機中/非稼働。 */
export const ENGINEER_AVAILABILITIES = ['WORKING', 'STANDBY_SCHEDULED', 'STANDBY', 'INACTIVE'] as const;

export type EngineerAvailability = (typeof ENGINEER_AVAILABILITIES)[number];

/** docs/05 §3.4 `RemoteMode`（TEXT + CHECK）。`engineers.remote_mode` / `projects.remote_mode` で共有する。 */
export const REMOTE_MODES = ['FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'] as const;

export type RemoteMode = (typeof REMOTE_MODES)[number];

/**
 * docs/05 §3.4 `ScanStatus`（TEXT + CHECK）。`skill_sheets.scan_status` / `file_scan_results.status`
 * で共有する。🔴 UNSUPPORTED は UNSCANNABLE に正規化する（docs/03 §3.4.3）。
 *
 * 🔴 **宣言の唯一の出所は `packages/domain`**（T-05-05）。ここは re-export である ——
 *    正規化する側（`packages/connectors`）と CHECK を持つ側（本パッケージ）は相互に依存できず
 *    （`CLAUDE.md` §2.1）、共有点が domain しか無い（`RecipientClass` と同じ整理）。
 *    `tests/static/schema-enum-drift.test.ts` は引き続き `@ses/db` の名前で突合する。
 */
export { SCAN_STATUSES } from '@ses/domain';
export type { ScanStatus } from '@ses/domain';

/** docs/05 §3.4 `SkillAlias.status`（TEXT + CHECK）。 */
export const SKILL_ALIAS_STATUSES = ['PROPOSED', 'ACCEPTED', 'REJECTED'] as const;

export type SkillAliasStatus = (typeof SKILL_ALIAS_STATUSES)[number];

/** docs/05 §3.4 `SkillAlias.origin`（TEXT + CHECK）。AI は skill-normalizer ロールが起票する。 */
export const SKILL_ALIAS_ORIGINS = ['HUMAN', 'AI'] as const;

export type SkillAliasOrigin = (typeof SKILL_ALIAS_ORIGINS)[number];

/** docs/05 §3.4 `EngineerSkill.source`（TEXT + CHECK）。 */
export const ENGINEER_SKILL_SOURCES = ['MANUAL', 'EXTRACTED'] as const;

export type EngineerSkillSource = (typeof ENGINEER_SKILL_SOURCES)[number];

/** docs/05 §3.4 `SkillSheetExtraction.status`（TEXT + CHECK）。 */
export const SKILL_SHEET_EXTRACTION_STATUSES = [
  'PENDING_REVIEW',
  'APPLIED',
  'REJECTED',
  'FAILED',
] as const;

export type SkillSheetExtractionStatus = (typeof SKILL_SHEET_EXTRACTION_STATUSES)[number];

/** docs/05 §3.5 `Project.status`（TEXT + CHECK）。募集中/充足/後任募集。 */
export const PROJECT_STATUSES = ['OPEN', 'FILLED', 'SUCCESSOR_WANTED'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * docs/05 §3.5 `ProjectRequirement.kind`（TEXT + CHECK）。🔴 F-013 AC-1: 必須（MUST）/ 尚可（NICE）を
 * 別区分として保持する。MUST は F-029 の足切りと F-020 整合層の照合対象。
 */
export const REQUIREMENT_KINDS = ['MUST', 'NICE'] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

// 🔴 T-02-03（docs/05 §3.6。docs/sprints/SP-02-schema-isolation.md）:
// 20260903020000_proposal_request_gate/migration.sql が値集合の CHECK を持つ列。
// ProposalState / ProposalRequestState は CLAUDE.md §4.2 の状態機械であり、単一の出所は
// 既存の @ses/domain（PROPOSAL_STATES / PROPOSAL_REQUEST_STATES。T-01-07 から既存）のため、
// ここには置かない。以下はいずれも状態機械ではない単純な値集合。

/**
 * docs/05 §3.6 `ReviewGate.targetType`（TEXT + CHECK）。テナント外へ共有される 5 種。
 * 🔴 `CONTRACT_DOCUMENT` を含む（契約書のゲート対象化。決定済み。Issue #15 / `BR-15`）。
 */
export const REVIEW_GATE_TARGET_TYPES = [
  'PROPOSAL',
  'SKILL_SHEET_SHARE',
  'PROJECT_PUBLISH',
  'CHAT_ATTACHMENT',
  'CONTRACT_DOCUMENT',
] as const;

export type ReviewGateTargetType = (typeof REVIEW_GATE_TARGET_TYPES)[number];

/**
 * docs/05 §3.6 `ReviewGate.execution`（TEXT + CHECK）。🔴 状態機械の状態ではなく実行の属性
 * （`P-A-16`。CLAUDE.md §4.2 の 5 状態機械に状態を 1 つも追加しない）。
 */
export const REVIEW_GATE_EXECUTIONS = ['DONE', 'HELD_AI_COST_LIMIT'] as const;

export type ReviewGateExecution = (typeof REVIEW_GATE_EXECUTIONS)[number];

/**
 * docs/05 §3.6 `GateVerdict`（TEXT + CHECK）。`review_gates.pii_verdict` /
 * `.commerce_verdict` / `.consistency_verdict` で共有する。
 */
export const GATE_VERDICTS = ['PASS', 'FAIL'] as const;

export type GateVerdict = (typeof GATE_VERDICTS)[number];

/**
 * docs/05 §3.6 `GateLayer`。`review_gates.findings[].layer`（JSON）の値集合であり、
 * 独立した DB 列の CHECK ではない（`findings` は JSONB）。🔴 そのため
 * `tests/static/schema-enum-drift.test.ts` の突合対象には含めない。
 */
export const GATE_LAYERS = ['PII', 'COMMERCE', 'CONSISTENCY'] as const;

export type GateLayer = (typeof GATE_LAYERS)[number];

/** docs/05 §3.6 `ProposalEvent.kind`（TEXT + CHECK）。 */
export const PROPOSAL_EVENT_KINDS = ['STATE', 'NOTE', 'ATTACHMENT'] as const;

export type ProposalEventKind = (typeof PROPOSAL_EVENT_KINDS)[number];

// 🔴 T-02-04（docs/05 §3.7。docs/sprints/SP-02-schema-isolation.md）:
// 20260903030000_chat_contract_assignment/migration.sql が値集合の CHECK を持つ列。
// AssignmentState（5 状態）/ ContractState（7 状態）は CLAUDE.md §4.2 の状態機械であり、
// 単一の出所は既存の @ses/domain（ASSIGNMENT_STATES / CONTRACT_STATES。T-01-07 から既存）のため、
// ここには置かない。以下はいずれも状態機械ではない単純な値集合。ScanStatus は §3.4 で定義済みの
// SCAN_STATUSES を messages.attachment_scan_status / contract_documents.scan_status /
// contract_templates.scan_status で共有する（新規定義しない）。

/** docs/05 §3.7 `ChatThread.kind`（TEXT + CHECK）。 */
export const CHAT_THREAD_KINDS = ['PROJECT', 'COMPANY'] as const;

export type ChatThreadKind = (typeof CHAT_THREAD_KINDS)[number];

/** docs/05 §3.7 `ContractKind`（TEXT + CHECK）。`contracts.kind` / `contract_templates.kind` で共有する。 */
export const CONTRACT_KINDS = ['NDA', 'MASTER', 'INDIVIDUAL'] as const;

export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** docs/05 §3.7 `ContractDocument.externalProvider`（TEXT + CHECK。nullable。BYO 接続。決定済み Issue #11）。 */
export const CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS = ['docusign', 'cloudsign', 'mock'] as const;

export type ContractDocumentExternalProvider = (typeof CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS)[number];

/** docs/05 §3.7 `ContractDocument.sentVia`（TEXT + CHECK。nullable）。F-047 処理⑧の送付手段。 */
export const CONTRACT_DOCUMENT_SENT_VIAS = ['ESIGN', 'EMAIL'] as const;

export type ContractDocumentSentVia = (typeof CONTRACT_DOCUMENT_SENT_VIAS)[number];

/** docs/05 §3.7 `Order.paymentState`（TEXT + CHECK）。 */
export const ORDER_PAYMENT_STATES = ['UNPAID', 'PAID'] as const;

export type OrderPaymentState = (typeof ORDER_PAYMENT_STATES)[number];

/** docs/05 §3.7 `ExtensionReview.decision`（TEXT + CHECK。nullable）。 */
export const EXTENSION_REVIEW_DECISIONS = ['EXTEND', 'END', 'REPRICE'] as const;

export type ExtensionReviewDecision = (typeof EXTENSION_REVIEW_DECISIONS)[number];

// 🔴 T-02-05（docs/05 §3.8 / §3.9 / §3.10。docs/sprints/SP-02-schema-isolation.md）:
// 20260903040000_cross_cutting_platform/migration.sql が値集合の CHECK を持つ列。
// TenantLifecycleState 等の 5 状態機械はこのタスクの対象に含まれない（横断・外部連携・
// 管理平面の表のみ）。以下はいずれも状態機械ではない単純な値集合。

/** docs/05 §3.8 `Task.kind`（TEXT + CHECK）。 */
export const TASK_KINDS = ['EXTENSION_REVIEW', 'INTERVIEW', 'CONTRACT_PENDING'] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

/** docs/05 §3.8 `Task.state`（TEXT + CHECK）。🔴 CLAUDE.md §4.2 の状態機械ではない単純な OPEN/DONE。 */
export const TASK_STATES = ['OPEN', 'DONE'] as const;

export type TaskState = (typeof TASK_STATES)[number];

/**
 * docs/05 §3.8 `AiUsage.role`（TEXT + CHECK）/ CLAUDE.md §12.2 の 6 ロール。
 * `TenantRoleModel.role`（6 値すべて）でも共有する。
 * 🔴 `packages/ai` はまだ実装されていない（SP-07）。将来そちらに `AI_ROLES` が実装されたときは、
 *    こちらを唯一の出所として re-export するか、依存方向（`packages/ai` → `packages/db` は
 *    禁止。docs/05 §2.2）を踏まえて解消すること。
 */
export const AI_ROLES = [
  'sheet-parser',
  'skill-normalizer',
  'match-explainer',
  'gate-inspector',
  'proposal-drafter',
  'renewal-advisor',
] as const;

export type AiRole = (typeof AI_ROLES)[number];

/**
 * docs/05 §3.10 `TenantRoleApprovalMode.role`（TEXT + CHECK。5 値）。CLAUDE.md §12.4
 * 「`gate-inspector` に承認モードは存在しない」により `AI_ROLES` から `gate-inspector` を除いた集合。
 */
export const APPROVAL_MODE_CONFIGURABLE_ROLES = AI_ROLES.filter(
  (role): role is Exclude<AiRole, 'gate-inspector'> => role !== 'gate-inspector',
);

export type ApprovalModeConfigurableRole = (typeof APPROVAL_MODE_CONFIGURABLE_ROLES)[number];

/**
 * 🔴 docs/05 §3.8 `AiUsage.purpose`（TEXT + CHECK）。ドキュメント上は
 * `'gate'|'sheet_parse'|...`（省略記法）としか示されておらず、フル値集合は明記されていない。
 * 6 ロール（`AI_ROLES`）と 1:1 対応することが、示された 2 例（'gate' = gate-inspector,
 * 'sheet_parse' = sheet-parser）と `docs/03` §7.6.1 のメーター名（sheetParse / matchRationale /
 * proposalDraft / renewalSummary）から強く裏付けられるため、programmer 判断で 6 値に確定した
 * （プログラマ完了報告に記載。値そのものに疑義が生じた場合は `docs/05` §3.8 へ確定値を
 * 追記のうえ本コメントを更新すること）。
 */
export const AI_USAGE_PURPOSES = [
  'sheet_parse',
  'skill_normalize',
  'match_rationale',
  'gate',
  'proposal_draft',
  'renewal_summary',
] as const;

export type AiUsagePurpose = (typeof AI_USAGE_PURPOSES)[number];

/** docs/05 §3.8 `AiUsage.failureKind`（TEXT + CHECK。nullable）。 */
export const AI_USAGE_FAILURE_KINDS = ['SCHEMA', 'TIMEOUT', 'RATE', 'SPEND_CAP', 'API'] as const;

export type AiUsageFailureKind = (typeof AI_USAGE_FAILURE_KINDS)[number];

/** docs/05 §3.8 `AuditLog.actorKind`（TEXT + CHECK）。 */
export const AUDIT_ACTOR_KINDS = ['USER', 'PLATFORM_USER', 'SYSTEM'] as const;

export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

/** docs/05 §3.8 `AuditLog.deviceKind`（TEXT + CHECK。nullable）。CLAUDE.md §13 のデバイス階層と対応。 */
export const AUDIT_DEVICE_KINDS = ['desktop', 'mobile', 'tablet', 'api'] as const;

export type AuditDeviceKind = (typeof AUDIT_DEVICE_KINDS)[number];

/** docs/05 §3.8 `UsageCounter.periodKind`（TEXT + CHECK）。 */
export const USAGE_COUNTER_PERIOD_KINDS = ['DAY', 'MONTH'] as const;

export type UsageCounterPeriodKind = (typeof USAGE_COUNTER_PERIOD_KINDS)[number];

/**
 * docs/05 §3.8 `UsageCounter.metric`（TEXT + CHECK）。🔴 `AI_UNIT_*` は利用者向け件数
 * （`docs/03` §7.6.1。`MONTH` のみ）。金額と独立に加算し、`AiUsage` の行数から数え直さない（§7.6）。
 */
export const USAGE_COUNTER_METRICS = [
  'AI_COST_USD',
  'EMAIL_COUNT',
  'STORAGE_BYTES',
  'SEAT_COUNT',
  'ESIGN_REQUESTS',
  'AI_UNIT_SHEET_PARSE',
  'AI_UNIT_MATCH_RATIONALE',
  'AI_UNIT_PROPOSAL_DRAFT',
  'AI_UNIT_RENEWAL_SUMMARY',
] as const;

export type UsageCounterMetric = (typeof USAGE_COUNTER_METRICS)[number];

/** docs/05 §3.9 `TenantEsignConnection.provider`。`ContractDocument.externalProvider` と同じ値集合
 * を共有するため、`CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS` をそのまま使う（新規定義しない）。 */

/** docs/05 §3.9 `TenantEsignConnection.signingOrderDefault`（TEXT + CHECK）。docs/03 §3.1.10。 */
export const ESIGN_SIGNING_ORDERS = ['HOST_FIRST', 'PARALLEL'] as const;

export type EsignSigningOrder = (typeof ESIGN_SIGNING_ORDERS)[number];

/** docs/05 §3.9 `SendAttempt.entityType`（TEXT + CHECK）。🔴 docs/03 §4.7。冪等性の中核。 */
export const SEND_ATTEMPT_ENTITY_TYPES = ['PROPOSAL', 'INTERVIEW', 'CONTRACT'] as const;

export type SendAttemptEntityType = (typeof SEND_ATTEMPT_ENTITY_TYPES)[number];

/** docs/05 §3.9 `SendAttempt.status`（TEXT + CHECK）。 */
export const SEND_ATTEMPT_STATUSES = ['RESERVED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] as const;

export type SendAttemptStatus = (typeof SEND_ATTEMPT_STATUSES)[number];

/** docs/05 §3.9 `EmailDispatch.recipientClass`（TEXT + CHECK）。 */
export const EMAIL_RECIPIENT_CLASSES = [
  'HOST_MEMBER',
  'PARTNER_MEMBER',
  'CLIENT',
  'ENGINEER',
  'PLATFORM',
] as const;

export type EmailRecipientClass = (typeof EMAIL_RECIPIENT_CLASSES)[number];

/**
 * docs/05 §3.9 `EmailDispatch.status`（TEXT + CHECK。7 値）。🔴 `HELD_*` は「失敗」ではない
 * （送信を 1 回も試みていない）。
 */
export const EMAIL_DISPATCH_STATUSES = [
  'QUEUED',
  'HELD_DOMAIN_UNVERIFIED',
  'HELD_PROVIDER_QUOTA',
  'SENT',
  'MOCKED',
  'FAILED',
  'SUPPRESSED',
] as const;

export type EmailDispatchStatus = (typeof EMAIL_DISPATCH_STATUSES)[number];

/** docs/05 §3.9 `EmailEvent.eventType`（TEXT + CHECK）。SES の実値（大文字小文字を含め正確に一致）。 */
export const EMAIL_EVENT_TYPES = ['Bounce', 'Complaint', 'Delivery', 'Reject', 'Delay'] as const;

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

/** docs/05 §3.9 `WebhookDelivery.provider`（TEXT + CHECK）。 */
export const WEBHOOK_PROVIDERS = ['ses', 'guardduty', 'docusign', 'cloudsign', 'stripe'] as const;

export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

/** docs/05 §3.9 `DataExportRequest.kind`（TEXT + CHECK）。F-064 AC-5 / F-052。 */
export const DATA_EXPORT_KINDS = ['CLOSING_RETURN', 'OPERATIONAL'] as const;

export type DataExportKind = (typeof DATA_EXPORT_KINDS)[number];

/** docs/05 §3.9 `DataExportRequest.status`（TEXT + CHECK）。 */
export const DATA_EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'] as const;

export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

/** docs/05 §3.9 `TenantPurgeRun.cause`（TEXT + CHECK）。 */
export const TENANT_PURGE_CAUSES = ['TENANT_PURGED', 'RETENTION'] as const;

export type TenantPurgeCause = (typeof TENANT_PURGE_CAUSES)[number];

/** docs/05 §3.9 `TenantPurgeRun.status`（TEXT + CHECK）。F-062 AC-7。 */
export const TENANT_PURGE_STATUSES = ['RUNNING', 'COMPLETED', 'FAILED'] as const;

export type TenantPurgeStatus = (typeof TENANT_PURGE_STATUSES)[number];

/** docs/05 §3.9 `SchedulerRun.status`（TEXT + CHECK）。 */
export const SCHEDULER_RUN_STATUSES = ['RUNNING', 'OK', 'FAILED'] as const;

export type SchedulerRunStatus = (typeof SCHEDULER_RUN_STATUSES)[number];

/** docs/05 §3.3 冒頭 `PlatformRole`（TEXT + CHECK）。CLAUDE.md §10.1。 */
export const PLATFORM_ROLES = ['PLATFORM_OWNER', 'PLATFORM_SUPPORT'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** docs/05 §3.10 `Subscription.billingState`（TEXT + CHECK）。 */
export const SUBSCRIPTION_BILLING_STATES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'] as const;

export type SubscriptionBillingState = (typeof SUBSCRIPTION_BILLING_STATES)[number];

/** docs/05 §3.10 `ImpersonationSession.endKind`（TEXT + CHECK。nullable）。F-060。 */
export const IMPERSONATION_END_KINDS = ['MANUAL', 'TIMEOUT', 'FORCED'] as const;

export type ImpersonationEndKind = (typeof IMPERSONATION_END_KINDS)[number];

/** docs/05 §3.10 `Announcement.kind`（TEXT + CHECK）。F-061。 */
export const ANNOUNCEMENT_KINDS = ['NOTICE', 'FEATURE_FLAG'] as const;

export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

/** docs/05 §3.10 `TenantRoleApprovalMode.mode`（TEXT + CHECK）。docs/03 §4.20。 */
export const TENANT_ROLE_APPROVAL_MODE_VALUES = ['PER_ITEM', 'AUTO'] as const;

export type TenantRoleApprovalModeValue = (typeof TENANT_ROLE_APPROVAL_MODE_VALUES)[number];

/**
 * docs/05 §3.10 `TenantMatchWeight.factor`（TEXT + CHECK）。[Issue #3]
 * 事業判断で重みを外出しし、ハードコードしない。
 */
export const MATCH_WEIGHT_FACTORS = [
  'MUST',
  'START_DATE',
  'NICE',
  'LOCATION',
  'PRICE',
  'YEARS',
] as const;

export type MatchWeightFactor = (typeof MATCH_WEIGHT_FACTORS)[number];
