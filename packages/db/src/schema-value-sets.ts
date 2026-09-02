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
