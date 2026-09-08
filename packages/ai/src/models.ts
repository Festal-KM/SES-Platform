// packages/ai/src/models.ts
// 🔴 ロールごとにモデルを設定可能にする（CLAUDE.md §12.3 / docs/05 §7.1 / `F-036`）。
//    **モデル ID をコードに直書きしない。** 既定値の出所は `packages/config` の
//    `ANTHROPIC_MODEL_DEFAULT`（`claude-sonnet-5`）/ `ANTHROPIC_MODEL_CHEAP`
//    （`claude-haiku-4-5-20251001`）であり、起動時にここへ渡される。
//
// 🔴 なぜハードコードしないか（docs/03 §3.3.1）: Haiku 4.5 の退役コミットは Sonnet 5 より
//    8 か月以上早い。差し替えが設定で済まないと、退役のたびにコード変更とデプロイが要る。

import type { AiRole } from '@ses/domain';
import type { ModelTier } from './roles/types.js';

/** 起動時に解決済みのモデル ID（段 → ID）。 */
export type ModelCatalog = Readonly<Record<ModelTier, string>>;

export type RoleModelQuery = {
  readonly tenantId: string;
  readonly role: AiRole;
  readonly tier: ModelTier;
};

/**
 * ロール × テナントで使うモデル ID を決める。
 *
 * ⚠️ **テナント別の上書き（`TenantRoleModel`）を読む実装は SP-14 の範囲**である。
 *    その実装は本ポートを満たす形で `packages/db` 側の読み取りを行い、
 *    行が無ければ `catalogRoleModelResolver` に委譲する（既定へのフォールバック）。
 */
export type RoleModelResolver = {
  resolve(query: RoleModelQuery): Promise<string>;
};

/**
 * テナント別の上書きを持たない既定の解決器（段 → 環境変数で与えられた ID）。
 *
 * 🔴 未知の段に落ちない（`ModelTier` は 2 値の union であり、`catalog` は全段を必須で持つ）。
 */
export function catalogRoleModelResolver(catalog: ModelCatalog): RoleModelResolver {
  return {
    resolve(query: RoleModelQuery): Promise<string> {
      return Promise.resolve(catalog[query.tier]);
    },
  };
}
