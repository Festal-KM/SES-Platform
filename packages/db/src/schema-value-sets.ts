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
