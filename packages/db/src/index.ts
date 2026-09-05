// packages/db/src/index.ts
// 🔴 主平面から使ってよいものだけを export する（docs/05 §2.1）。
//    生 PrismaClient / TenantDb 型 / 生 SQL の入口は export しない。
export { configureTenantDb, disconnectTenantDb } from './client.js';
export type { TenantDbOptions } from './client.js';
// 🔴 T-03-07 / T-03-08: 管理平面の接続プール 2 本（docs/03 §4.3.3 / docs/05 §4.2）。
//    **主平面とは別の PrismaClient・別の DB ロール（app_platform / app_platform_write）**。
// 🔴 ここで export するのは**起動時の初期化と切断だけ**である。`withPlatformRead` /
//    `withPlatformWrite` は `@ses/db/platform` サブパスにあり、`@ses/db` からは到達できない
//    （主平面のコードから import できないことを ESLint で担保する。docs/03 申し送り 2）。
export {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  disconnectPlatformReadDb,
  disconnectPlatformWriteDb,
} from './platform-client.js';
export type { PlatformReadDbOptions, PlatformWriteDbOptions } from './platform-client.js';
// 🔴 T-03-07: 運営者認証（F-055 / API-A1）。テナントの User とは別テーブル・別認証（BR-36）。
export {
  confirmPlatformTwoFactorEnrollment,
  consumePlatformRecoveryCode,
  loadPlatformUserFacts,
  PLATFORM_TWO_FACTOR_FAILED_AUDIT_ACTION,
  readPlatformTwoFactorCredential,
  readRecentPlatformTwoFactorFailures,
  recordPlatformAuditLog,
  startPlatformTwoFactorEnrollment,
  TWO_FACTOR_SUBJECT_TYPE_PLATFORM_USER,
  withPlatformAuthLookup,
} from './platform-auth.js';
export type {
  PlatformAuthUser,
  PlatformIdentity,
  PlatformTwoFactorEnrollmentResult,
  PlatformUserFacts,
} from './platform-auth.js';
// 🔴 T-03-07: 運営者 ctx の唯一の生成器（2FA 未充足なら生成しない。F-055 AC-3）。
// 🔴 T-03-10: `PLATFORM_OWNER` 専用操作（API-A4 / A5。CLAUDE.md §10.1 / BR-44）のゲート。
export {
  PlatformRoleNotAllowedError,
  requirePlatformOwner,
  resolvePlatformCtx,
} from './platform-context.js';
export type {
  AuthenticatedPlatformCtx,
  PlatformOwnerCtx,
  PlatformSession,
} from './platform-context.js';
export {
  HostOnlyContextError,
  PartnerScopeTargetError,
  requireHost,
  requiresTwoFactor,
  resolveTenantCtx,
  // 🔴 T-03-10: ジョブ文脈（docs/05 §9.2）。**`apps/web` から呼ばない**
  //    （呼び出し元の限定は tests/static/auth-db-callers.test.ts が走査する）。
  SYSTEM_ACTOR_ID,
  systemTenantCtx,
  TENANT_ROLES,
  // 🔴 T-03-02: 2 要素認証のゲート（docs/05 §6.2 / F-003 AC-2 / BR-30）。
  TWO_FACTOR_REQUIRED_ROLES,
  TWO_FACTOR_REQUIREMENT_REASONS,
  TWO_FACTOR_SESSION_STATES,
  TwoFactorRequiredError,
  twoFactorSessionState,
} from './context.js';
// 🔴 T-03-01: ロール / テナント状態を DB で確定する唯一の関数（docs/05 §4.3 / F-003 AC-1）。
//    セッション（JWT）に書かれたロールを信じる実装を apps/web 側で書けないようにするために、
//    「認証で確定した分離キー → DB のロール」の写像を packages/db に閉じる。
export { loadTenantMembership } from './auth-context.js';
export type { TenantIdentity, TenantMembershipFacts } from './auth-context.js';
// 🔴 T-03-01: AuditLog の書き込み（docs/05 §16.1 / F-005）。行の組み立てはここが唯一の出所。
// 🔴 T-03-05: recordAuditLog は withApiRoute の audit オプションが使う ctx 版（§16.1）。
export { AuditLogWriteError, recordAuditLog, recordAuthAuditLog, writeAuditLog } from './audit.js';
export type { AuditLogEntry, AuditLogWriter, AuditSummary } from './audit.js';
export type {
  AuthenticatedTenantCtx,
  DeviceKind,
  HostTenantCtx,
  JobIdentity,
  MainSession,
  RequestMeta,
  SystemTenantCtx,
  TenantLifecycleState,
  TenantRole,
  TwoFactorRequiredRole,
  TwoFactorRequirementReason,
  TwoFactorSessionState,
} from './context.js';
// 🔴 T-03-02: 秘匿値の暗号化（docs/05 §8.6 / docs/03 §4.4 / BR-25）。**この経路以外で暗号化しない。**
export { configureTokenEncryption, EncryptedString, TokenEncryptionError } from './crypto.js';
export type { EncryptionAad, TokenEncryptionOptions } from './crypto.js';
// 🔴 T-03-02: TwoFactorCredential（docs/05 §6.3 #2 #3）。RLS の C7 SELF により本人の行のみ。
export {
  confirmTwoFactorEnrollment,
  consumeRecoveryCode,
  readRecentTwoFactorFailures,
  readTwoFactorCredential,
  startTwoFactorEnrollment,
  TWO_FACTOR_FAILED_AUDIT_ACTION,
  TWO_FACTOR_SUBJECT_TYPE_USER,
} from './two-factor.js';
export type {
  TwoFactorCredentialRow,
  TwoFactorEnrollmentInput,
  TwoFactorEnrollmentResult,
} from './two-factor.js';
export {
  AI_ROLES,
  AI_USAGE_FAILURE_KINDS,
  AI_USAGE_PURPOSES,
  ANNOUNCEMENT_KINDS,
  APPROVAL_MODE_CONFIGURABLE_ROLES,
  AUDIT_ACTOR_KINDS,
  AUDIT_DEVICE_KINDS,
  CHAT_THREAD_KINDS,
  CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS,
  CONTRACT_DOCUMENT_SENT_VIAS,
  CONTRACT_KINDS,
  DATA_EXPORT_KINDS,
  DATA_EXPORT_STATUSES,
  EMAIL_DISPATCH_STATUSES,
  EMAIL_EVENT_TYPES,
  EMAIL_RECIPIENT_CLASSES,
  ENGINEER_AVAILABILITIES,
  ENGINEER_SKILL_SOURCES,
  ESIGN_SIGNING_ORDERS,
  EXTENSION_REVIEW_DECISIONS,
  GATE_LAYERS,
  GATE_VERDICTS,
  IMPERSONATION_END_KINDS,
  MATCH_WEIGHT_FACTORS,
  ORDER_PAYMENT_STATES,
  PLATFORM_ROLES,
  PROJECT_STATUSES,
  PROPOSAL_EVENT_KINDS,
  REMOTE_MODES,
  REQUIREMENT_KINDS,
  REVIEW_GATE_EXECUTIONS,
  REVIEW_GATE_TARGET_TYPES,
  SCAN_STATUSES,
  SCHEDULER_RUN_STATUSES,
  SEND_ATTEMPT_ENTITY_TYPES,
  SEND_ATTEMPT_STATUSES,
  SKILL_ALIAS_ORIGINS,
  SKILL_ALIAS_STATUSES,
  SKILL_SHEET_EXTRACTION_STATUSES,
  SUBSCRIPTION_BILLING_STATES,
  TASK_KINDS,
  TASK_STATES,
  TENANT_PURGE_CAUSES,
  TENANT_PURGE_STATUSES,
  TENANT_ROLE_APPROVAL_MODE_VALUES,
  TENANT_SENDING_DOMAIN_STATES,
  TWO_FACTOR_SUBJECT_TYPES,
  USAGE_COUNTER_METRICS,
  USAGE_COUNTER_PERIOD_KINDS,
  WEBHOOK_PROVIDERS,
} from './schema-value-sets.js';
export type {
  AiRole,
  AiUsageFailureKind,
  AiUsagePurpose,
  AnnouncementKind,
  ApprovalModeConfigurableRole,
  AuditActorKind,
  AuditDeviceKind,
  ChatThreadKind,
  ContractDocumentExternalProvider,
  ContractDocumentSentVia,
  ContractKind,
  DataExportKind,
  DataExportStatus,
  EmailDispatchStatus,
  EmailEventType,
  EmailRecipientClass,
  EngineerAvailability,
  EngineerSkillSource,
  EsignSigningOrder,
  ExtensionReviewDecision,
  GateLayer,
  GateVerdict,
  ImpersonationEndKind,
  MatchWeightFactor,
  OrderPaymentState,
  PlatformRole,
  ProjectStatus,
  ProposalEventKind,
  RemoteMode,
  RequirementKind,
  ReviewGateExecution,
  ReviewGateTargetType,
  ScanStatus,
  SchedulerRunStatus,
  SendAttemptEntityType,
  SendAttemptStatus,
  SkillAliasOrigin,
  SkillAliasStatus,
  SkillSheetExtractionStatus,
  SubscriptionBillingState,
  TaskKind,
  TaskState,
  TenantPurgeCause,
  TenantPurgeStatus,
  TenantRoleApprovalModeValue,
  TenantSendingDomainState,
  TwoFactorSubjectType,
  UsageCounterMetric,
  UsageCounterPeriodKind,
  WebhookProvider,
} from './schema-value-sets.js';
export {
  CrossTenantWriteError,
  PARTNER_BASE_TABLE_MODELS,
  PARTNER_VIEW_MODELS,
  PartnerBaseTableAccessError,
  PartnerViewWriteError,
  ReadOnlyModelWriteError,
  TENANT_SCOPE_EXCLUDED_MODELS,
  TENANT_SCOPE_STRATEGY_DECLARATIONS,
  TENANT_SCOPE_SYSTEM_ONLY_MODELS,
  SystemOnlyModelAccessError,
  TenantRelationWriteError,
  UnscopedOperationError,
} from './scope-injection.js';
export type { TenantScopeStrategyKind } from './scope-injection.js';
// 🔴 テナント文脈を持たない経路（docs/05 §4.4.2）。この 5 本以外を作らない。
export {
  withAuthLookup,
  withInvitationAccept,
  withInvitationToken,
  withPasswordResetConfirm,
  withPasswordResetIssue,
} from './row-context.js';
export type {
  AuthLookupUser,
  InvitationAcceptInput,
  InvitationRow,
  InvitationTokenRow,
  PasswordResetConfirmInput,
  PasswordResetIssueInput,
} from './row-context.js';
export {
  withHostTenant,
  withPartnerScope,
  withSystemScope,
  withTenant,
} from './with-tenant.js';
// 🔴 T-04-02: メール送信の単一経路の宛先分類（docs/05 §8.2）。**呼び出し側に自己申告させない。**
//    `platformRecipientClass`（分類外）はここから export しない（`@ses/db/platform` だけが出す）。
export { isAccountMailRecipientClass, resolveRecipientClass } from './recipient.js';
export type {
  AccountMailRecipientClass,
  OutsiderRecipientClass,
  RecipientClass,
  RecipientLookupDb,
  RecipientSubject,
  TenantRecipientClass,
} from './recipient.js';
// 🔴 T-04-03: EmailDispatch を書く唯一の経路（docs/05 §3.9 / §9.4）。
//    `dedupeKey` の UNIQUE と `QUEUED` からの CAS がここに閉じている＝迂回した INSERT が書けない。
export {
  closeHeldEmailDispatch,
  dispatchRecipientHash,
  dispatchTokenHashPrefix,
  EMAIL_DISPATCH_HOLD_STATUSES,
  EmailDispatchConflictError,
  emailDispatchDedupeKey,
  failEmailDispatch,
  holdEmailDispatch,
  listHeldEmailDispatches,
  markEmailDispatchMocked,
  markEmailDispatchSent,
  readEmailDailyCount,
  readEmailDispatch,
  requeueHeldEmailDispatch,
  reserveEmailDailyQuota,
  reserveEmailDispatch,
  suppressEmailDispatch,
} from './email-dispatch.js';
export type {
  EmailDispatchHoldStatus,
  EmailDispatchInput,
  EmailDispatchReservation,
  EmailDispatchRow,
  HeldEmailDispatchCloseReason,
  HeldEmailDispatchRow,
} from './email-dispatch.js';
// 🔴 T-04-05: 保留（`HELD_*`）に入った `account.mail` の復帰（docs/05 §8.3 / §9.4）。
//    平文トークンは残っていないため、復帰は**トークンの再発行**でしか行えない。
export { reissueHeldInvitationToken } from './account-mail-reissue.js';
export type { AccountMailReissueOutcome, InvitationReissueInput } from './account-mail-reissue.js';
// 🔴 T-04-05: 招待 / パスワード再設定トークンの平文とハッシュの対応（docs/05 §3.3 の列の契約）。
//    `apps/web`（発行）と `apps/worker`（再発行）が**同じ実装**を使うための唯一の出所。
export { generateSecretToken, hashSecretToken } from './tokens.js';
// 🔴 T-04-04: TenantSendingDomain（docs/05 §3.9 / §8.3 / docs/03 §3.2.7）を読み書きする唯一の経路。
//    `verifiedAt` が NULL の間、取引先へ届く送信は実行されない（`BR-51` / `F-001 AC-4`）。
export {
  applySendingDomainProvision,
  expireSendingDomain,
  listSendingDomains,
  listVerifiedSendingDomains,
  markSendingDomainVerified,
  readSendingDomain,
  registerSendingDomain,
  resolveVerifiedSendingDomain,
} from './tenant-sending-domain.js';
export type {
  SendingDomainRegistration,
  SendingDomainRow,
  VerifiedSendingDomainRow,
} from './tenant-sending-domain.js';
// 🔴 T-04-03: Webhook 受信（docs/05 §8.5）。C0 SYSTEM_ONLY の 2 表に触れる唯一の経路。
export {
  markWebhookDeliveryFailed,
  markWebhookDeliveryProcessed,
  readWebhookDelivery,
  recordEmailEvent,
  recordWebhookDelivery,
} from './webhook-delivery.js';
export type {
  EmailEventInput,
  JsonObject,
  JsonValue,
  WebhookDeliveryInput,
  WebhookDeliveryPayload,
  WebhookDeliveryRecord,
} from './webhook-delivery.js';
// 🔴 T-03-10: UsageCounter の計測フック（CLAUDE.md §10.6 / F-026 / docs/05 §7.6 / §9.8）。
//    `usage_counters` を書いてよい唯一の経路（生 SQL の ON CONFLICT はここに閉じる）。
export {
  incrementUsageCounter,
  recordUsageCounterSnapshot,
  snapshotSeatCount,
} from './usage-counters.js';
export type {
  SeatSnapshotOptions,
  SeatSnapshotResult,
  UsageCounterValue,
  UsageCounterWrite,
} from './usage-counters.js';
// 🔴 経路 5（docs/05 §4.9）の読み取りの型。`TenantDb` / `HostTenantDb` と違い、
//    API 層が `toPartnerView()` の入力型として参照するため export する。
export type { PartnerScopeDb, PartnerScopeTarget } from './with-tenant.js';
