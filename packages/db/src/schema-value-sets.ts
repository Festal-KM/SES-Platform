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
 */
export const SCAN_STATUSES = ['SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED'] as const;

export type ScanStatus = (typeof SCAN_STATUSES)[number];

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
