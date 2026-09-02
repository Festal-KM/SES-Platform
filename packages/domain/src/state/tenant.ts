// packages/domain/src/state/tenant.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.3 / §5.4）。
// CLAUDE.md §4.2 の Tenant ステートマシン（契約のライフサイクル）。
// 🔴 canTransition() 等の遷移ロジックは、テナントのライフサイクル操作を実装するスプリントで追加する
//    （docs/05 §5.4。`packages/domain/src/state/tenant.ts` の純粋関数 `canTransition(from, to, actor)`）。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

/** docs/05 §3.3 `enum TenantLifecycleState`（5 状態がすべて）。 */
export const TENANT_LIFECYCLE_STATES = [
  'SANDBOX',
  'ACTIVE',
  'SUSPENDED',
  'CLOSING',
  'PURGED',
] as const;

export type TenantLifecycleState = (typeof TENANT_LIFECYCLE_STATES)[number];
