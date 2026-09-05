// apps/web/lib/tenants/labels.ts
// `TenantLifecycleState` / `Tenant.environment` から文言キーへの写像。
//
// 🔴 主平面（`S-035`）と管理平面（`A-002` / `A-003` / `A-014`）の**両方**が使うため、
//    どちらの区画にも属さない `lib/` に置く。管理平面のファイル
//    （`app/admin/**`。`@ses/db/platform` を import できる唯一の区画）を主平面から
//    参照させない —— 参照が生まれると、主平面のコードが分離バイパスへ 1 ホップで届く。
// 🔴 文言そのものは `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。ここは写像だけを持ち、
//    テンプレートリテラルでキーを組み立てない（誤ったキーの参照をコンパイルで防ぐ）。
import type { TenantLifecycleState, TenantRole } from '@ses/db';
import type { MessageKey } from '@ses/i18n';

/**
 * ロールの表示名（`docs/04` §S-035 / §S-014 の「ロール」列）。T-04-09。
 * 🔴 `Record<TenantRole, …>` にすることで、ロールが増えたら文言の割り当てをコンパイラが強制する。
 */
export const TENANT_ROLE_MESSAGE_KEYS: Readonly<Record<TenantRole, MessageKey>> = {
  OWNER: 'members.role.OWNER',
  ADMIN: 'members.role.ADMIN',
  SALES: 'members.role.SALES',
  PARTNER_ADMIN: 'members.role.PARTNER_ADMIN',
  PARTNER_SALES: 'members.role.PARTNER_SALES',
  VIEWER: 'members.role.VIEWER',
};

/**
 * 🔴 ロール変更の確認ステップで出す「その結果できなくなること / できるようになること」
 *    （`docs/04` §S-035「操作と結果」）。T-04-09。
 *    内容は `CLAUDE.md` §10.1 のロール階層の表そのものである。
 */
export const TENANT_ROLE_CAPABILITY_MESSAGE_KEYS: Readonly<Record<TenantRole, MessageKey>> = {
  OWNER: 'members.roleCapability.OWNER',
  ADMIN: 'members.roleCapability.ADMIN',
  SALES: 'members.roleCapability.SALES',
  PARTNER_ADMIN: 'members.roleCapability.PARTNER_ADMIN',
  PARTNER_SALES: 'members.roleCapability.PARTNER_SALES',
  VIEWER: 'members.roleCapability.VIEWER',
};

export const TENANT_LIFECYCLE_STATE_MESSAGE_KEYS: Readonly<
  Record<TenantLifecycleState, MessageKey>
> = {
  SANDBOX: 'admin.tenants.lifecycleState.SANDBOX',
  ACTIVE: 'admin.tenants.lifecycleState.ACTIVE',
  SUSPENDED: 'admin.tenants.lifecycleState.SUSPENDED',
  CLOSING: 'admin.tenants.lifecycleState.CLOSING',
  PURGED: 'admin.tenants.lifecycleState.PURGED',
};

/** 🔴 `Tenant.environment` は TEXT + CHECK（`production`|`sandbox`|`demo`）。未知値は生値を出す。 */
export function tenantEnvironmentMessageKey(environment: string): MessageKey | null {
  switch (environment) {
    case 'production':
      return 'admin.tenants.environment.production';
    case 'sandbox':
      return 'admin.tenants.environment.sandbox';
    case 'demo':
      return 'admin.tenants.environment.demo';
    default:
      return null;
  }
}
