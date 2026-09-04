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

/**
 * docs/05 §3.3 `Tenant.environment`（テナントの種別）。
 * 🔴 `packages/config` の `APP_ENV`（デプロイ環境。5 値）とは**別物**である
 *    （schema.prisma の `Tenant.environment` のコメント）。
 */
export const TENANT_ENVIRONMENTS = ['production', 'sandbox', 'demo'] as const;

export type TenantEnvironment = (typeof TENANT_ENVIRONMENTS)[number];

/**
 * 🔴 **開設（`F-001`）は遷移ではない**（docs/02 章 5.4 の規則）。したがって開設時に置ける
 *    初期状態は `SANDBOX`（見込み客の試用）と `ACTIVE`（本契約）の 2 つだけである。
 *
 * この配列を `TENANT_LIFECYCLE_STATES` から導出しない: 「開設できる状態」と
 * 「存在しうる状態」は別の概念であり、状態が増えたときに自動で開設可能になってはならない
 * （`PURGED` で開設できる API は、それ自体が事故である）。
 */
export const TENANT_CREATION_STATES = ['SANDBOX', 'ACTIVE'] as const;

export type TenantCreationState = (typeof TENANT_CREATION_STATES)[number];

/**
 * 開設時の `environment` と `lifecycleState` の整合（docs/02 章 5.4 の規則）。
 *
 * - 「見込み客の試用として開設すれば初期状態は `SANDBOX`」→ `sandbox` ⇒ `SANDBOX`
 * - 「`demo` 環境のテナントは `ACTIVE` として扱う」→ `demo` ⇒ `ACTIVE`
 * - 本契約（`production`）は `ACTIVE`
 *
 * 🔴 **開設時にだけ成り立つ規則である。** 試用から本契約への移行（`SANDBOX → ACTIVE`）は
 *    データを引き継ぐ状態遷移であり `environment` を書き換えない（`CLAUDE.md` §11.1 /
 *    docs/05 §5.2「`name` / `environment` は開設時にしか書けない」）。したがって
 *    移行後は `environment='sandbox'` かつ `ACTIVE` の組み合わせが正当に存在する。
 *    この関数を「不変条件」として遷移側で使い回さないこと。
 */
export function isValidTenantCreation(input: {
  readonly environment: TenantEnvironment;
  readonly lifecycleState: TenantCreationState;
}): boolean {
  return (input.environment === 'sandbox') === (input.lifecycleState === 'SANDBOX');
}
