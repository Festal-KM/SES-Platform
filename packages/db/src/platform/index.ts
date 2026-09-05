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
