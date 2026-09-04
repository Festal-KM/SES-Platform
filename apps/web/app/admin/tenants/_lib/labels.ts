// apps/web/app/admin/tenants/_lib/labels.ts
// `A-002` / `A-003` で共通の表示ラベル（docs/04 §A-002 / §A-003）。
//
// 🔴 文言は `packages/i18n` に集約する（CLAUDE.md §3.5）。ここは
//    `TenantLifecycleState` / 環境種別からメッセージキーへの写像だけを持つ
//    （テンプレートリテラルで動的にキーを組み立てない。誤ったキーの参照をコンパイルで防ぐ）。
import type { TenantLifecycleState } from '@ses/db';
import type { MessageKey } from '@ses/i18n';

export const TENANT_LIFECYCLE_STATE_MESSAGE_KEYS: Readonly<Record<TenantLifecycleState, MessageKey>> = {
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
