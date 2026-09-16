// packages/db/src/platform/index.ts
// 🔴 `@ses/db/platform` サブパスの唯一の入口（docs/05 §5.2 / docs/03 `program-design` 申し送り 2）。
//
// 🔴 **`@ses/db`（index.ts）からはここの中身を 1 つも re-export しない。**
//    主平面のコードが `withPlatform*` に到達する経路を、モジュールの形として作らない。
//    import 元の限定は `eslint.config.mjs` の ADMIN_PLANE_ZONE が行う
//    （`apps/web/app/admin/**` / `apps/web/app/api/admin/**` と `tests/isolation/**` のみ）。
//
// 🔴 `import 'server-only'` は追加していない（`packages/db/src/index.ts` 冒頭コメントと同じ
//    理由。T-04-06 Iteration 4 で検証済み）。
export {
  PLATFORM_ACTIONS,
  PLATFORM_READABLE_MODELS,
  PLATFORM_WRITE_DOMAIN_MODELS,
  PLATFORM_WRITE_DOMAINS,
  PlatformWriteDomainViolationError,
  withPlatformRead,
  withPlatformWrite,
} from '../platform.js';
export type {
  PlatformAction,
  PlatformChangeSnapshot,
  PlatformOp,
  PlatformReadDb,
  PlatformReadableModel,
  PlatformWriteDbFor,
  PlatformWriteDomain,
  PlatformWriteOp,
} from '../platform.js';

// 🔴 T-04-02: 分類外（運営者宛。`F-055`）の宛先分類。**`@ses/db` からは出さない** ——
//    テナント側のコードが「運営者宛」を名乗って実送信側（分類外）に倒す経路を、
//    モジュールの形として作らない（docs/05 §8.2 / CLAUDE.md §10.5 / §11.1）。
export { platformRecipientClass } from '../recipient.js';

// 画面 1 対 1 の専用クエリ関数（docs/05 §5.2）。
export { readAdminHomeSummary } from './queries/admin-home.js';
export type { AdminHomeSummary, PlatformRequestMeta } from './queries/admin-home.js';
// A-002 / A-003（テナント一覧・詳細。T-03-09）。
export { getPlatformTenantDetail, listPlatformTenants } from './queries/tenants.js';
export type {
  PlatformTenantListPage,
  PlatformTenantListQuery,
  PlatformRequestMeta as PlatformTenantRequestMeta,
} from './queries/tenants.js';
// A-014（テナントの開設 + 初期 OWNER 招待。API-A4 / API-A5。T-03-10）。
export {
  issueTenantOwnerInvitation,
  listRecentProvisionings,
  provisionTenant,
  TenantProvisioningInputError,
  TenantProvisioningRequestConflictError,
} from './queries/provisioning.js';
export type {
  OwnerInvitationInput,
  OwnerInvitationResult,
  PlatformProvisioningMeta,
  ProvisionTenantInput,
  ProvisionTenantResult,
  RecentProvisioningQuery,
} from './queries/provisioning.js';
// A-005（運用監視）の「計測欠測」「ストレージの乖離」の材料（T-10-02。画面は SP-11 T-11-04）。
export { listOpenUsageMeasurementFindings } from './queries/usage-findings.js';
export type {
  OpenUsageMeasurementFinding,
  OpenUsageMeasurementFindings,
} from './queries/usage-findings.js';
// `F-057` / `A-004`（運用者の利用量監視）の「上限接近・到達」の材料（T-10-03。画面は SP-11 / SP-20）。
export { listUsageLimitAlerts } from './queries/usage-limits.js';
export type { UsageLimitAlert, UsageLimitAlerts } from './queries/usage-limits.js';
// 応答のシリアライザ（docs/05 §5.5 第 2 層）。ルートが型を再宣言せずに参照できるようにする。
export {
  toPlatformTenantDetail,
  toPlatformTenantListItem,
} from '../serializers/platform/tenants.js';
export type {
  PlatformTenantDetailView,
  PlatformTenantListItemView,
} from '../serializers/platform/tenants.js';
export {
  PROVISIONING_INVITATION_STATES,
  toPlatformProvisioningItem,
} from '../serializers/platform/provisioning.js';
export type {
  PlatformProvisioningItemView,
  ProvisioningInvitationState,
} from '../serializers/platform/provisioning.js';
// `A-006`（監査ログ横断検索。API-A7 / `F-058`。T-11-03）。
// 🔴 応答は `toPlatformAuditLog` でマスク済み・固定形。`summary` の生 JSON は型として外に出ない。
export { searchPlatformAuditLogs } from './queries/audit-logs.js';
export type {
  PlatformAuditLogSearchPage,
  PlatformAuditLogSearchQuery,
} from './queries/audit-logs.js';
export { toPlatformAuditLog } from '../serializers/platform/audit-logs.js';
export type { PlatformAuditLogView } from '../serializers/platform/audit-logs.js';
// `A-005`（運用監視）の項目 11「送信ドメインが未検証・失効のテナント」の材料（`F-059 AC-5`。T-11-06。画面は T-11-04）。
// 🔴 応答は状態・日時・件数のみの固定 DTO。DNS レコードの値・失敗理由・業務データはフィールドとして存在しない。
export {
  listUnverifiedSendingDomains,
  UNVERIFIED_SENDING_DOMAIN_STATUSES,
} from './queries/sending-domains.js';
export type {
  UnverifiedSendingDomainItem,
  UnverifiedSendingDomainLifecycleState,
  UnverifiedSendingDomains,
  UnverifiedSendingDomainsMeta,
  UnverifiedSendingDomainStatus,
} from './queries/sending-domains.js';
