// apps/web/lib/tenants/labels.ts
// `TenantLifecycleState` / `Tenant.environment` から文言キーへの写像。
//
// 🔴 主平面（`S-035`）と管理平面（`A-002` / `A-003` / `A-014`）の**両方**が使うため、
//    どちらの区画にも属さない `lib/` に置く。管理平面のファイル
//    （`app/admin/**`。`@ses/db/platform` を import できる唯一の区画）を主平面から
//    参照させない —— 参照が生まれると、主平面のコードが分離バイパスへ 1 ホップで届く。
// 🔴 文言そのものは `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。ここは写像だけを持ち、
//    テンプレートリテラルでキーを組み立てない（誤ったキーの参照をコンパイルで防ぐ）。
import type { TenantLifecycleState } from '@ses/db';
import type { MessageKey } from '@ses/i18n';

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
