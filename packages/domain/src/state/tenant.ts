// packages/domain/src/state/tenant.ts
// 状態機械の型置き場（T-01-07。docs/05 §2.1 / §3.3 / §5.4）。
// CLAUDE.md §4.2 の Tenant ステートマシン（契約のライフサイクル）。
// 🔴 T-02-10: 遷移表と transition() をここに置いた（docs/05 §10.3 / §15.3 / §13.6）。
//    ロール判定（停止は PLATFORM_OWNER のみ。docs/05 §5.4）と管理平面の操作は SP-10 以降の範囲。
// 🔴 packages/domain は何にも依存しない（CLAUDE.md §2.1）。

import { createStateMachine, type TransitionTable } from './machine.js';

/** docs/05 §3.3 `enum TenantLifecycleState`（5 状態がすべて）。 */
export const TENANT_LIFECYCLE_STATES = [
  'SANDBOX',
  'ACTIVE',
  'SUSPENDED',
  'CLOSING',
  'PURGED',
] as const;

export type TenantLifecycleState = (typeof TENANT_LIFECYCLE_STATES)[number];

/**
 * CLAUDE.md §4.2 の Tenant ステートマシン（**この表が遷移の全体である**）。
 *
 * 🔴 `SANDBOX → ACTIVE` はデータを引き継ぐ（別環境へコピーしない。CLAUDE.md §11.1）。
 * 🔴 `SUSPENDED` はデータを消さない。`CLOSING` は新規作成不可・エクスポートのみ。
 *    `PURGED` は終端（個人情報の削除）。
 * 🔴 停止（`ACTIVE → SUSPENDED`）を実行できるのは `PLATFORM_OWNER` だけだが、
 *    **それはロールの判定であり遷移表の話ではない**（docs/05 §5.4。ここに actor を持ち込むと
 *    純粋関数でなくなる）。表に無い遷移は `PLATFORM_OWNER` でも 422（F-062 AC-5）。
 */
export const TENANT_LIFECYCLE_TRANSITIONS = {
  SANDBOX: ['ACTIVE', 'CLOSING'],
  ACTIVE: ['SUSPENDED', 'CLOSING'],
  SUSPENDED: ['ACTIVE', 'CLOSING'],
  CLOSING: ['PURGED'],
  PURGED: [],
} as const satisfies TransitionTable<TenantLifecycleState>;

export const tenantMachine = createStateMachine(
  'Tenant',
  TENANT_LIFECYCLE_STATES,
  TENANT_LIFECYCLE_TRANSITIONS,
);
