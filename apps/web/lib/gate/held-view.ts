// apps/web/lib/gate/held-view.ts
// 🔴 保留中のゲート行（`execution='HELD_AI_COST_LIMIT'`）を `GateHeldView` に写す**唯一の実装**
//    （docs/05 §11.7 / `F-027 AC-5` / `F-027 AC-6`）。
//
// 🔴 **T-12-10 で `apps/web/lib/proposals/gate.ts` から移した**（docs/05 §11.11「T-12-10 の実装の
//    決着」⑤）。呼び出し元が 3 つになったためである:
//      ① `#40  GET /api/proposals/{id}/gate`        （`readProposalGateResult`）
//      ② `#40b GET /api/proposals/{id}/gate-results`（`readProposalGateResults`）
//      ③ 🔴 案件の公開の状態と `S-013` セクション 4  （`lib/projects/publish-state.ts`）
//    **移動であり、挙動は 1 ビットも変えていない**（書き写すと「保留の説明が画面ごとに違う」に
//    なる。`toGateResultView` が `execution` と `held` の有無の一致を要求しているのも同じ理由）。
//
// 🔴 **`usageHref`（`S-038` への導線）を足さない**（`docs/04` `U-19` / T-12-18 ③）。
//    上限の引き上げは運営者だけができる（`F-057`）ので、テナント側の導線を作らない。
// 🔴 **金額（USD）を載せない**（`F-027 AC-6`）。利用者に見せるのは理由キー・時刻・引き上げの主体だけ。
import { gateHoldTimestamps, type ReviewGateResultRow } from '@ses/db';
import type { GateHeldView } from '@ses/domain';
import { InternalError } from '../api/errors';

/**
 * 🔴 `#39`（提案のゲートの手動再実行）の入口。**ここが `GateHeldView.rerun.manual` の唯一の出所**
 *    であり、案件の公開には対応する手動の入口が無い（`docs/05` §6.8。「再検査だけをもう一度実行する」
 *    エンドポイントを置かない）。したがって呼び出し側が `rerun` を渡す。
 */
export const PROPOSAL_GATE_MANUAL_RERUN = 'POST /api/proposals/{id}/gate';

/**
 * 保留行の `GateHeldView`。`DONE` の行は `undefined`
 * （`toGateResultView` は `execution` と `held` の有無が一致しないと `RangeError` を投げる）。
 *
 * @param rerun 再開の経路。🔴 **自動（`gate.hold-release`）は常にある。** 手動の入口がある対象
 *        （提案）だけが `manual` を持つ。案件の公開は自動のみである（`docs/05` §6.8）。
 */
export function heldViewFor(
  row: ReviewGateResultRow,
  now: Date,
  rerun: GateHeldView['rerun'],
): GateHeldView | undefined {
  if (row.execution !== 'HELD_AI_COST_LIMIT') return undefined;
  if (row.heldSince === null) {
    // 保留行は `held_since` を必ず持つ（`holdReviewGate`）。壊れていたら握り潰さない。
    throw new InternalError('review_gates の保留行に held_since がありません。');
  }
  const timestamps = gateHoldTimestamps({ heldSince: row.heldSince, now });
  return {
    heldReasonKey: 'gate.held.aiCostLimit',
    heldSince: timestamps.heldSince,
    resetAt: timestamps.resetAt,
    // 🔴 上限の引き上げは運営者だけができる（`F-057`）。テナント側の導線を作らない。
    limitRaise: 'PLATFORM_OPERATOR',
    rerun,
  };
}

/** 提案（#40 / #40b）の再開経路。🔴 自動（`gate.hold-release`）と手動（#39）の**両方**がある。 */
export const PROPOSAL_GATE_RERUN: GateHeldView['rerun'] = {
  auto: true,
  manual: PROPOSAL_GATE_MANUAL_RERUN,
};

/**
 * 🔴 案件の公開（T-12-10）の再開経路。**自動だけである。**
 *
 * 🔴 `manual: null` は「手動の再実行の入口が存在しない」ことを表す（`docs/05` §6.8 /
 *    `docs/04` §S-013「『再検査だけをもう一度実行する』ボタンも置かない」）。提案の入口
 *    （`POST /api/proposals/{id}/gate`）を書き写すと、案件の応答に**存在しない操作**を広告する。
 *    保留からの復帰は `gate.hold-release` が上限のリセット後に自動で行う（`AC-12`）。
 */
export const PROJECT_PUBLISH_GATE_RERUN: GateHeldView['rerun'] = { auto: true, manual: null };
