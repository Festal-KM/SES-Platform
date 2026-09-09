// packages/ai/src/gate/reservation.ts
// 🔴 `gate.hold-release`（docs/05 §9.3 / `F-027 AC-5`）が「上限に余地があるか」を判定するための、
//    **`gate-inspector` 1 回ぶんの下限**の見積り。T-07-10。
//
// ============================================================================
// 🔴 なぜ「下限」なのか（平均でも最大でもない）
// ============================================================================
// 保留行が持っているのは `(target_type, target_id, content_hash)` だけであり、**再実行したときの
// 入力の長さは分からない**（対象を読み直せば分かるが、それは検査の半分をここで走らせることになる）。
// したがって見積りは「どんな `gate-inspector` の呼び出しでも、少なくともこれだけは要る」量にする:
//   ①出力トークンは**常に上限まで予約される**（`spec.maxOutputTokens`。`reserveAiCost` の引数）
//   ②入力はプロンプトの地の文（システム指示）が必ず載る
// この 2 つの合計が下限である。
//
// 🔴 **向きが重要である。** 下限を使うと「入るはずが実際は入らなかった」ことは起こりうるが、
//    その場合 `gate.run` は**もう一度保留にするだけ**で害は無い（同じ行・同じ `heldSince`）。
//    逆に多めに見積もると、**上限より大きい見積りで永久に復帰しない**保留を作りうる ——
//    直す元データが無いのに止まり続ける、いちばん質の悪い壊れ方である（`BR-18` と同型）。
//
// 🔴 プロンプトの版が上がれば地の文の長さも変わるが、**この関数はロール定義から組み立てるので
//    自動的に追随する**（数値をここに書き写さない）。
import { maskedTemplate } from '../mask.js';
import { gateInspectorSpec, type GateInspectorInput } from '../roles/gate-inspector.js';
import { estimateInputTokens } from '../run.js';

/** コスト予約の見積りに要る 2 つの量（`AiCostReserveInput` の同名の項目にそのまま渡す）。 */
export type AiReservationFloor = {
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
};

/**
 * 🔴 検査する内容が**空**の入力（＝ どの実行でも必ず下回らない下限）。
 *
 * 欄が 1 つも無い入力は `gateInspectorInputSchema` が拒む（`min(1)`）ため、
 * **本文が空の欄を 1 つ**置く。`runRole` を通さない（`buildPrompt` だけを呼ぶ）ので
 * この入力が LLM へ送られることは無い。
 */
const FLOOR_INPUT: GateInspectorInput = {
  audienceKind: 'PARTNER',
  sections: [{ field: 'body', text: maskedTemplate`` }],
};

/**
 * `gate-inspector` を 1 回呼ぶために最低限予約される量を返す。
 *
 * 🔴 **`runRole` と同じ見積り関数**（`estimateInputTokens`）を通す。別式にすると、
 *    「復帰させたのに予約に失敗する」「余地があるのに復帰しない」がどちらも起こりうる。
 */
export function gateInspectorReservationFloor(): AiReservationFloor {
  const prompt = gateInspectorSpec.buildPrompt(FLOOR_INPUT);
  return {
    estimatedInputTokens: estimateInputTokens(prompt.system) + estimateInputTokens(prompt.user),
    maxOutputTokens: gateInspectorSpec.maxOutputTokens,
  };
}
