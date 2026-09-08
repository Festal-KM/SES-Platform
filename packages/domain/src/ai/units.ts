// packages/domain/src/ai/units.ts
// 🔴 **利用者に見せる「1 件」の定義**（`P-A-18` / docs/05 §7.6「件数の加算」/ docs/03 §7.6.1）。
//    T-07-03。
//
// ============================================================================
// 🔴 この表が守っていること
// ============================================================================
// ① **合成単位は代表ロールの実行回数で数える**（docs/03 §7.6.3-6）。
//    スキルシート解析 1 件 = `sheet-parser` の実行 1 回であり、`skill-normalizer` を
//    別途 1 件と数えない（未知語の有無で「同じ 1 件の解析」が 1 件にも 2 件にも見えるため）。
// ② **根拠文は「根拠文が付いた候補の数」で数える**（10 候補を 1 リクエストにまとめても 10 件）。
//    利用者にとっての単位はリクエストではなく候補である。
// ③ 🔴 **`gate-inspector` は数えない**（`F-026 AC-6` / `F-027 AC-7`）。`AiUsage`（金額）には
//    記録するが、利用者向けクォータの分母・分子に入れない。**記録しないのではなく見せ方の問題**。
// ④ 🔴 **システムの再試行は加算しない**（金額にだけ計上する）。これは本表ではなく
//    `runRole` の手順 6b（成功 1 回につき 1 度だけ `countUnit` を呼ぶ）が担保する。
//
// ============================================================================
// 🔴 件数は金額から割り戻さない（`F-026 AC-6` / docs/03 §7.6.3-1）
// ============================================================================
// **本モジュールは `./pricing.js` を import しない。** 件数の算出に単価が 1 つも現れないことが、
// 「1 件あたり標準原価を変更しても過去の件数消費と残量表示が変化しない」ことの機械的な根拠である
// （`units.test.ts` と `tests/static/ai-usage-cost-single-path.test.ts` がこれを固定する）。

import type { AiRole } from './roles.js';

/**
 * 利用者に見せる 4 単位（docs/03 §7.6.1）。
 *
 * 🔴 値は `UsageCounter.metric`（docs/05 §3.8 の CHECK）の `AI_UNIT_*` と**同一の文字列**である。
 *    `packages/db` 側の `UsageCounterMetric` に代入されるため、綴りがずれればコンパイルで落ちる
 *    （`packages/domain` は `packages/db` に依存できないので、突合はこの代入が担う）。
 * 🔴 **メーターを金額で 1 本作らない**（docs/03 §7.6.3-5）。単位ごとに 1 本である。
 */
export const AI_UNIT_METRICS = [
  'AI_UNIT_SHEET_PARSE',
  'AI_UNIT_MATCH_RATIONALE',
  'AI_UNIT_PROPOSAL_DRAFT',
  'AI_UNIT_RENEWAL_SUMMARY',
] as const;

export type AiUnitMetric = (typeof AI_UNIT_METRICS)[number];

/**
 * 「1 回の成功で何件と数えるか」の数え方。
 *
 * - `PER_CALL` … 実行 1 回 = 1 件
 * - `PER_RATIONALE` … 🔴 **根拠文が付いた候補の数**（`match-explainer` のみ）
 *
 * 🔴 数え方を関数（クロージャ）ではなく**データ**で持つ。表が「何を 1 件とするか」の一次資料で
 *    あり続けるようにするためで、判定は `resolveAiUnitCount` の 1 本に集める。
 */
export type AiUnitCountKind = 'PER_CALL' | 'PER_RATIONALE';

export type AiUnitDefinition = {
  readonly metric: AiUnitMetric;
  readonly countKind: AiUnitCountKind;
};

/**
 * 🔴 ロール → 利用者向け件数の写像（docs/05 §7.6 の `ROLE_UNIT`）。
 *
 * 🔴 `null` は「**数えない**」であり「記録しない」ではない。6 ロールすべてを列挙し、
 *    新しいロールが増えたときに**書き忘れがコンパイルエラーになる**形にしてある
 *    （`Record<AiRole, …>` は全キー必須）。
 */
export const ROLE_UNIT: Readonly<Record<AiRole, AiUnitDefinition | null>> = {
  'sheet-parser': { metric: 'AI_UNIT_SHEET_PARSE', countKind: 'PER_CALL' },
  // 🔴 スキルシート解析 1 件は `sheet-parser` の 1 回で数え済み。ここで数えると二重計上になる。
  'skill-normalizer': null,
  'match-explainer': { metric: 'AI_UNIT_MATCH_RATIONALE', countKind: 'PER_RATIONALE' },
  // 🔴 ゲートはクォータの対象外（`F-027 AC-7`）。`AiUsage` には必ず記録される。
  'gate-inspector': null,
  'proposal-drafter': { metric: 'AI_UNIT_PROPOSAL_DRAFT', countKind: 'PER_CALL' },
  'renewal-advisor': { metric: 'AI_UNIT_RENEWAL_SUMMARY', countKind: 'PER_CALL' },
};

/**
 * 🔴 `match-explainer` の出力から件数を読むためのフィールド名（docs/05 §7.1 の出力スキーマ
 *    `{ rationales: { ref, matched, missing, comment }[] }`）。
 *
 * ⚠️ ロールの出力スキーマ側でこの名前を変えたら、ここも同時に変えること
 *    （`units.test.ts` が名前を固定しているので、片方だけ変えると落ちる）。
 */
export const MATCH_EXPLAINER_RATIONALES_FIELD = 'rationales';

export type AiUnitCount = {
  readonly metric: AiUnitMetric;
  /** 加算する件数（0 になることがある。0 のときカウンタは動かさない）。 */
  readonly quantity: number;
};

/**
 * 🔴 成功した 1 回の `runRole` を、利用者に見せる件数へ写す（純粋関数）。
 *
 * @param output 🔴 **検証済みの出力**（`spec.outputSchema.safeParse` を通ったもの）。
 *   `unknown` で受けるのは、ロールごとに型が違う 1 本の経路（`AiUsageRecorder.countUnit`）を
 *   通るためである。
 * @returns 数えない ロール（`skill-normalizer` / `gate-inspector`）は `null`。
 *
 * 🔴 期待する形でなければ**例外にする**（0 件として黙って通さない）。0 で通すと
 *    「使われたのに残量が減らない ＝ 請求できない」状態が静かに積み上がる。
 */
export function resolveAiUnitCount(role: AiRole, output: unknown): AiUnitCount | null {
  const definition = ROLE_UNIT[role];
  if (definition === null) return null;
  if (definition.countKind === 'PER_CALL') return { metric: definition.metric, quantity: 1 };

  const rationales =
    typeof output === 'object' && output !== null
      ? (output as Record<string, unknown>)[MATCH_EXPLAINER_RATIONALES_FIELD]
      : undefined;
  if (!Array.isArray(rationales)) {
    throw new TypeError(
      `ロール ${role} の出力に ${MATCH_EXPLAINER_RATIONALES_FIELD} の配列がありません。` +
        '件数（根拠文が付いた候補の数）を数えられないため記録を中断します（docs/03 §7.6.1）。',
    );
  }
  return { metric: definition.metric, quantity: rationales.length };
}
