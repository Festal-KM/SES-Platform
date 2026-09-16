// packages/domain/src/quota/ai-unit.ts
// 🔴 利用者に見せる AI の**月次件数クォータ**の判定（docs/05 §5.8 `QuotaDecision` の
//    `ALLOW_OVERAGE` / §7.6「月次クォータ（件数）」/ docs/02 章 7.5 / `F-027`）。T-10-03。
//
// ============================================================================
// 🔴 超過しても止めない。従量課金へ移行する（`ALLOW_OVERAGE`）
// ============================================================================
// 月次クォータは「通常の利用の範囲」を示す約束であり、遮断器ではない（docs/03 §7.6.1）。
// したがって本関数は **`BLOCK` も `DEFER` も持たない** —— 戻り値の型にそれらが無いこと自体が、
// 「クォータ切れで AI 機能が止まる」実装を書けないことの担保である。
// 止めるのは「1 日の AI コスト上限」（`decideAiDailyCost`。遮断器）だけであり、両者を
// 1 つの関数に畳まない（docs/03 §7.6.3-4「超過時の挙動は単位ごとに変わらない」）。
//
// 🔴 `gate-inspector` の単位は存在しない（`AiUnitMetric` は 4 値。`F-027 AC-7`）。
// 🔴 金額を一切扱わない（件数は金額から割り戻さない。docs/03 §7.6.3-1）。
import type { AiUnitMetric } from '../ai/units.js';

/**
 * 判定結果。
 *
 * - `ALLOW`: クォータの範囲内。`remaining` は残り件数（`S-038` の「あと N 件」）。
 * - `ALLOW_OVERAGE`: 🔴 **クォータを使い切っているが実行してよい**（従量課金へ移行）。
 *   `overageCount` は超過が始まってからの件数（請求見込みの分子。docs/05 §5.9 の売上（超過従量））。
 */
export type AiUnitQuotaDecision =
  | { readonly kind: 'ALLOW'; readonly metric: AiUnitMetric; readonly remaining: number }
  | { readonly kind: 'ALLOW_OVERAGE'; readonly metric: AiUnitMetric; readonly overageCount: number };

export type AiUnitQuotaInput = {
  readonly metric: AiUnitMetric;
  /** `UsageCounter(MONTH,'AI_UNIT_*').value`（当月の消費件数）。 */
  readonly monthCount: number;
  /** 件数クォータ（`Plan.unitQuota*` に `Subscription.unitQuotaOverride` を適用した値、または既定値）。 */
  readonly quota: number;
};

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/**
 * 🔴 月次件数クォータの判定（純粋関数）。
 *
 * `monthCount < quota` なら `ALLOW`、それ以外は `ALLOW_OVERAGE`。
 * 「上限ちょうど」は**使い切った**状態であり、次の 1 件から超過になる
 * （`decideEmailRate` の `dailySent >= dailyLimit` と同じく、枠の消費数を数えている）。
 */
export function decideAiUnitQuota(input: AiUnitQuotaInput): AiUnitQuotaDecision {
  if (!Number.isInteger(input.quota) || input.quota <= 0) {
    throw new RangeError(`quota は 1 以上の整数である必要があります（受け取った値: ${input.quota}）。`);
  }
  assertNonNegativeInt('monthCount', input.monthCount);

  if (input.monthCount < input.quota) {
    return { kind: 'ALLOW', metric: input.metric, remaining: input.quota - input.monthCount };
  }
  return { kind: 'ALLOW_OVERAGE', metric: input.metric, overageCount: input.monthCount - input.quota };
}
