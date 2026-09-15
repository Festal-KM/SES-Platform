// apps/web/lib/state/invalid-transition.ts
// 🔴 `CLAUDE.md` §4.2 に無い遷移が要求されたときの**記録と 422 への写像の 1 実装**（docs/05 §15.3 /
//    `F-024 AC-1`「状態は変化せず、エラーが記録される」/ `BR-33`「サイレントに無視しない」）。T-09-02。
//
// 状態機械は `packages/domain` の `transition()`（5 機械共通）であり、遷移の判定はそこにしか無い。
// ここにあるのは判定の**後始末**だけである:
//   ① `packages/domain` の `InvalidStateTransitionError` を受け取ったら `AuditLog(state.invalid_transition,
//      { entity, from, to })` を**別トランザクション**で書く —— 業務トランザクションは巻き戻るので、その中には書けない
//   ② API 境界の 422 型（`lib/api/errors` の `InvalidStateTransitionError`）に写して投げ直す
//   ③ それ以外の例外はそのまま投げ直す
//
// 🔴 T-08-06（提案依頼）で確立した形をそのまま関数にした。提案（#48 / #39）・提案依頼（#33 / #34 / #35）が
//    同じ 1 本を呼ぶ（docs/05 §15.3「5 機械すべてに適用 … 同じ `transition()` の仕組みを使う」の後始末側）。
//    経路ごとに書き直すと、どれか 1 つが記録を忘れる。
// 🔴 `summary` は `{ entity, from, to }` だけ（docs/05 §15.3）。本文・単価・提案先を載せない。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/domain` のみ）。
import { recordAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { InvalidStateTransitionError as DomainInvalidStateTransitionError } from '@ses/domain';
import { InvalidStateTransitionError } from '../api/errors';

/** docs/05 §15.3 / §16.1 の action。 */
export const INVALID_TRANSITION_AUDIT_ACTION = 'state.invalid_transition';

export type InvalidTransitionAuditTarget = {
  /** `AuditLog.targetType`（`'Proposal'` / `'ProposalRequest'` …）。 */
  readonly targetType: string;
  readonly targetId: string;
  readonly ipAddress: string | null;
};

/**
 * 🔴 遷移表に無い遷移なら `state.invalid_transition` を別トランザクションで記録してから 422 型で投げ直す。
 *    それ以外の例外はそのまま投げ直す。**常に throw する**（戻り値は無い）。
 *
 * 使い方: `try { await withTenant(ctx, …) } catch (error) { return rethrowWithInvalidTransitionAudit(ctx, target, error); }`
 */
export async function rethrowWithInvalidTransitionAudit(
  ctx: AuthenticatedTenantCtx,
  target: InvalidTransitionAuditTarget,
  error: unknown,
): Promise<never> {
  if (!(error instanceof DomainInvalidStateTransitionError)) throw error;
  await recordAuditLog(ctx, {
    action: INVALID_TRANSITION_AUDIT_ACTION,
    actorKind: 'USER',
    actorId: ctx.userId,
    targetType: target.targetType,
    targetId: target.targetId,
    summary: { entity: error.entity, from: error.from, to: error.to },
    ipAddress: target.ipAddress,
    deviceKind: ctx.deviceKind,
  });
  // 🔴 API 境界の 422 への写像は `toAppError` も行う（判定を二重に持たない）。ここでは型だけ揃える。
  throw new InvalidStateTransitionError(error.entity, error.from, error.to);
}
