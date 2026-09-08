// packages/domain/src/gate/decide.ts
// 🔴 品質ゲート 3 層の**合否の合成**（docs/05 §11.4）。T-07-06。純粋関数。
//
// ============================================================================
// 🔴 この関数が守っているもの
// ============================================================================
//   ① 1 層でも FAIL なら `GATE_FAILED`（`F-020` 処理④）
//   ② 🔴 **AI の失敗は PII 層・商流層を FAIL**（判定不能 = 送れない）。**PASS へ倒す枝が無い**
//      （`F-020` の AI 利用欄 / docs/05 §7.4 の `gate-inspector` の行）
//   ③ 🔴 **AI の指摘（警告）は合否を変えない**（`BR-61` / `F-020 AC-4`）。`aiWarnings` は
//      `findings` とは別の戻り値であり、`overall` の計算に一度も現れない
//   ④ 🔴 **整合層の合否は AI の成否に影響されない**（`F-027 AC-5`）。`decideConsistency` の
//      結果をそのまま通す
//   ⑤ 🔴 **機械的検出は AI の判定を上書きする**（AI の見落としに対する保険）。台帳の氏名や
//      公開範囲外の企業名が本文に残っていれば、AI が PASS と言っても FAIL である
//
// ============================================================================
// 🔴 ここに来ないもの: AI の日次コスト上限（HELD）
// ============================================================================
// `AiCostLimitExceededError`（= 呼ばなかった）を `ai: { ok: false }`（= 呼んで失敗した）に
// 写像してはならない（docs/05 §11.4 の最終行）。前者は `ReviewGate.execution` の属性であり、
// **合否を確定させない**（`gate.run` が HELD 行を書いて正常終了する。`F-027 AC-5`）。
// 混ぜると ①ゲート FAIL 率（`F-059`）が汚れ ②直すべき元データが無いのに「修正して再実行」を
// 促す誤った導線になる（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。
// 🔴 **本関数に「保留」を表す引数も戻り値も無い**ことが、その担保である。

import type { ConsistencyDecision } from './consistency.js';
import { type GateFinding, type GateLayer, type GateVerdict } from './types.js';

/** 1 層の結果（AI が返した層の判定と指摘）。 */
export type GateLayerResult = {
  readonly verdict: GateVerdict;
  readonly findings: readonly GateFinding[];
};

/**
 * `gate-inspector` の実行結果（docs/05 §11.4）。
 *
 * 🔴 失敗は `{ ok: false }` の**中身の無い形**である。失敗の理由（タイムアウト / スキーマ違反 /
 *    API エラー）で合否を分けないため —— どれであっても「検査を完了できなかった」であり、
 *    帰結は 1 つしかない（PII 層・商流層は判定不能 = FAIL）。
 */
export type GateAiOutcome =
  | {
      readonly ok: true;
      readonly pii: GateLayerResult;
      readonly commerce: GateLayerResult;
      /** 🔴 整合層の**警告**。合否には一切効かない（`BR-61`）。 */
      readonly warnings: readonly GateFinding[];
    }
  | { readonly ok: false };

export type GateDecisionInput = {
  readonly ai: GateAiOutcome;
  /** 🔴 機械的照合のみで決まる（`decideConsistency`。T-07-07）。AI の成否と独立。 */
  readonly consistency: ConsistencyDecision;
  /** 既知 PII 値（台帳の氏名等）の残存。🔴 `layer='PII'` 以外を渡すと `RangeError`。 */
  readonly mechanicalPii: readonly GateFinding[];
  /**
   * 公開範囲外の単価・エンド企業名・他社名の露出（`F-014 AC-3` / `F-020 AC-6`）。
   *
   * 🔴 §11.4 のスケッチには `mechanicalPii` しか無かったが、商流層にも同じ保険を置いた
   *    （差分は docs/05 §11.9 に記録）。理由: 「エンド企業名が公開範囲外に出ていないか」は
   *    `forbiddenTerms` との**完全一致の照合**で決まり、LLM の応答に委ねる必要が無い。
   *    委ねると `F-014 AC-3`（ゲート FAIL なら公開しない）が応答のゆらぎで通ることになる。
   */
  readonly mechanicalCommerce: readonly GateFinding[];
};

export type GateDecision = {
  readonly piiVerdict: GateVerdict;
  readonly commerceVerdict: GateVerdict;
  readonly consistencyVerdict: GateVerdict;
  /** 🔴 `ReviewGate.findings`。機械的検出 + AI の `BLOCK` + 整合層の指摘（docs/05 §11.8 ⑦-1）。 */
  readonly findings: readonly GateFinding[];
  /** 🔴 `ReviewGate.aiWarnings`。AI の `WARN` だけ（合否に効かない別の列）。 */
  readonly aiWarnings: readonly GateFinding[];
  readonly overall: 'PASS' | 'FAIL';
  readonly aiFailed: boolean;
};

function assertLayer(findings: readonly GateFinding[], layer: GateLayer, argument: string): void {
  for (const finding of findings) {
    if (finding.layer !== layer) {
      // 🔴 黙って通さない。層を取り違えた指摘は、承認画面で別の層の FAIL として表示され、
      //    「直すべき箇所」を誤って示す（`BR-18` の解消手段が空回りする）。
      throw new RangeError(
        `${argument} には layer='${layer}' の指摘だけを渡してください（受け取った値: '${finding.layer}'）。`,
      );
    }
  }
}

function blocks(findings: readonly GateFinding[]): readonly GateFinding[] {
  return findings.filter((finding) => finding.severity === 'BLOCK');
}

function warns(findings: readonly GateFinding[]): readonly GateFinding[] {
  return findings.filter((finding) => finding.severity === 'WARN');
}

/**
 * 層の合否。🔴 **`BLOCK` が 1 件でもあれば必ず FAIL**（AI が `verdict='PASS'` と言っても覆る）。
 *
 * `gate-inspector` の出力スキーマは `superRefine` で「PASS なのに BLOCK がある」応答を弾くが
 * （docs/05 §7.13 ④）、機械的検出は AI の外で足されるため、ここでも同じ規則を通す。
 */
function verdictOf(aiVerdict: GateVerdict, blocking: readonly GateFinding[]): GateVerdict {
  return aiVerdict === 'FAIL' || blocking.length > 0 ? 'FAIL' : 'PASS';
}

/**
 * 🔴 3 層の結果を 1 つの合否に合成する（docs/05 §11.4）。
 *
 * @throws RangeError 指摘の `layer` が引数の層と食い違うとき。
 */
export function decideGate(input: GateDecisionInput): GateDecision {
  assertLayer(input.mechanicalPii, 'PII', 'mechanicalPii');
  assertLayer(input.mechanicalCommerce, 'COMMERCE', 'mechanicalCommerce');
  assertLayer(input.consistency.findings, 'CONSISTENCY', 'consistency.findings');

  const mechanicalPiiBlocks = blocks(input.mechanicalPii);
  const mechanicalCommerceBlocks = blocks(input.mechanicalCommerce);

  if (!input.ai.ok) {
    // 🔴 判定不能 = FAIL。**PASS へフォールバックしない**（`F-020` の AI 利用欄）。
    //    整合層の合否だけは機械的照合の結果をそのまま残す（AI に依存しない層だから）。
    return {
      piiVerdict: 'FAIL',
      commerceVerdict: 'FAIL',
      consistencyVerdict: input.consistency.verdict,
      findings: [
        ...mechanicalPiiBlocks,
        ...mechanicalCommerceBlocks,
        ...blocks(input.consistency.findings),
      ],
      // 🔴 AI が失敗している以上、警告は 1 件も無い（`null` ではなく空配列。列は NOT NULL）。
      aiWarnings: [],
      overall: 'FAIL',
      aiFailed: true,
    };
  }

  assertLayer(input.ai.pii.findings, 'PII', 'ai.pii.findings');
  assertLayer(input.ai.commerce.findings, 'COMMERCE', 'ai.commerce.findings');
  assertLayer(input.ai.warnings, 'CONSISTENCY', 'ai.warnings');
  // 🔴 整合層の警告に `BLOCK` が混じっていたら**握り潰さない**。出力スキーマ側は
  //    `z.literal('WARN')` で作れない形にしてあるが（docs/05 §7.13 ④）、ここで黙って
  //    `aiWarnings` に流すと「合否に効かない指摘」として表示され、整合層の FAIL が消える。
  if (input.ai.warnings.some((warning) => warning.severity !== 'WARN')) {
    throw new RangeError(
      'ai.warnings に severity=BLOCK の指摘が含まれています。整合層の合否を AI が決める形は存在しません（BR-61 / docs/05 §11.4）。',
    );
  }

  const aiPiiBlocks = blocks(input.ai.pii.findings);
  const aiCommerceBlocks = blocks(input.ai.commerce.findings);

  const piiVerdict = verdictOf(input.ai.pii.verdict, [...mechanicalPiiBlocks, ...aiPiiBlocks]);
  const commerceVerdict = verdictOf(input.ai.commerce.verdict, [
    ...mechanicalCommerceBlocks,
    ...aiCommerceBlocks,
  ]);
  const consistencyVerdict = input.consistency.verdict;

  return {
    piiVerdict,
    commerceVerdict,
    consistencyVerdict,
    // 🔴 並びは層の順（PII → COMMERCE → CONSISTENCY）に固定する。承認画面が層ごとに
    //    まとめて描くため、入力の順で揺れると同じ結果が違う見え方になる。
    findings: [
      ...mechanicalPiiBlocks,
      ...aiPiiBlocks,
      ...mechanicalCommerceBlocks,
      ...aiCommerceBlocks,
      ...blocks(input.consistency.findings),
    ],
    // 🔴 `WARN` はすべてこちらへ寄せる（AI が PII / 商流層に付けた警告も含む）。
    //    `findings` に混ぜると「BLOCK のみが FAIL を作る」（docs/05 §3.6）が読み取れなくなる。
    aiWarnings: [...warns(input.ai.pii.findings), ...warns(input.ai.commerce.findings), ...input.ai.warnings],
    overall:
      piiVerdict === 'PASS' && commerceVerdict === 'PASS' && consistencyVerdict === 'PASS'
        ? 'PASS'
        : 'FAIL',
    aiFailed: false,
  };
}
