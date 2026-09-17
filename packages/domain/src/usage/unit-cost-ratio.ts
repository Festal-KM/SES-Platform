// packages/domain/src/usage/unit-cost-ratio.ts
// 🔴 「件数 × 1 件あたり標準原価」に対する**実原価の倍率**（docs/02 `F-063 AC-5`「件数と金額の対応が同一画面で確認でき、
//    1 件あたり標準原価の改定時に両者の乖離を検知できる」/ docs/03 §7.6.1 / §7.6.3-2 / docs/05 §6.9 API-A6）。T-11-02。
//
// ============================================================================
// 🔴 2 つの「倍率」を混同しない
// ============================================================================
//   ① 基準ユニット比（`baselineRatio`。docs/03 §7.5-3 / docs/05 §5.9）…… テナントの AI 原価 ÷ 基準ユニット（30 席）の
//      月間 AI 原価 $12.82（`PRICING_RULESET_V1.aiBaselineCostUsd`）。**「どれだけ大きい客か」**の指標で、`A-011` の並び順
//   ② 🔴 本ファイル（`unitCostRatio`）…… 4 単位のロールの実原価 ÷ Σ(件数 × 1 件あたり標準原価)。**「1 件あたりの実原価が
//      docs/03 §7.6.1 の表からどれだけ離れているか」**の指標。1.0 なら表どおり、1.5 なら 1 件あたり 1.5 倍かかっている
//      （pdf に偏った / 長い出力 / モデル変更）。**この値が動いたら §7.6.2 の件数クォータの再計算が要る**（`pm` 申し送り 7）
//
// 🔴 件数は金額から割り戻さない（docs/03 §7.6.3-1）。ここは逆向き —— 件数と金額を**別々に計測した結果**を突き合わせて
//    乖離を出すだけであり、どちらの値も変えない。`units.ts`（件数の写像）は本ファイルを import しない。
// 🔴 `gate-inspector` / `skill-normalizer` は単位を持たない（`ROLE_UNIT` が `null`）。分母にも分子にも入れない
//    （`skill-normalizer` の原価は §7.6.1 の `sheetParse` の標準原価 $0.033 に含まれているため、分子は `sheet-parser` +
//     `skill-normalizer` の合計とする）。
import type { AiRole } from '../ai/roles.js';
import { AI_UNIT_METRICS, ROLE_UNIT, type AiUnitMetric } from '../ai/units.js';
import { parseUsdMicros } from './usd.js';

/**
 * 🔴 1 件あたり標準原価（USD。docs/03 §7.6.1 の表。xlsx / docx 基準）。**v1（2026-09-16）。暫定** ——
 *    Phase 2 の実測原価が出た時点で docs/03 §7.6.1 / §7.6.2 と同時に版を上げる（値を書き換えない）。
 *    `PRICING_RULESET_V1` と同じく「金額を持つのは 1 パッケージ」の規律で domain に置く。
 */
export const AI_UNIT_STANDARD_COST_USD_V1: Readonly<Record<AiUnitMetric, string>> = {
  AI_UNIT_SHEET_PARSE: '0.033',
  AI_UNIT_MATCH_RATIONALE: '0.004',
  AI_UNIT_PROPOSAL_DRAFT: '0.021',
  AI_UNIT_RENEWAL_SUMMARY: '0.017',
};

/** 単位に原価を計上するロール（`ROLE_UNIT` から引く。`skill-normalizer` は `sheetParse` の一部）。 */
const UNIT_COST_ROLES: Readonly<Record<AiUnitMetric, readonly AiRole[]>> = (() => {
  const map = {} as Record<AiUnitMetric, AiRole[]>;
  for (const metric of AI_UNIT_METRICS) map[metric] = [];
  for (const [role, definition] of Object.entries(ROLE_UNIT) as [AiRole, (typeof ROLE_UNIT)[AiRole]][]) {
    if (definition !== null) map[definition.metric].push(role);
  }
  // 🔴 docs/03 §7.6.1: スキルシート解析 1 件の標準原価 $0.033 は `skill-normalizer` の $0.006 を含む。
  map.AI_UNIT_SHEET_PARSE.push('skill-normalizer');
  return map;
})();

export type UnitCostRatioInput = {
  /** 当月の件数（4 単位。無い単位は省略可 = 0）。 */
  readonly unitCounts: Readonly<Partial<Record<AiUnitMetric, number>>>;
  /** 当月のロール別実原価（USD 十進文字列。無いロールは省略可 = 0）。 */
  readonly costByRoleUsd: Readonly<Partial<Record<AiRole, string>>>;
  readonly standardCostUsd?: Readonly<Record<AiUnitMetric, string>>;
};

export type UnitCostRatio = {
  /** Σ(件数 × 標準原価)（micro-USD）。 */
  readonly standardMicros: bigint;
  /** 単位を持つロールの実原価の合計（micro-USD）。 */
  readonly actualMicros: bigint;
  /**
   * 実原価 ÷ 標準原価（小数）。🔴 件数が 0 のとき `null`（0 割りを 0 倍にしない。「まだ何も使っていない」と
   * 「標準どおり」は別のことである）。
   */
  readonly ratio: number | null;
};

function assertCount(metric: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${metric} の件数は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/**
 * 🔴 倍率の算出（純粋関数）。分子・分母を**同じ micro-USD の整数**から出し、表示用の小数は最後に 1 回だけ作る。
 */
export function computeUnitCostRatio(input: UnitCostRatioInput): UnitCostRatio {
  const standard = input.standardCostUsd ?? AI_UNIT_STANDARD_COST_USD_V1;
  let standardMicros = 0n;
  let actualMicros = 0n;
  for (const metric of AI_UNIT_METRICS) {
    const count = input.unitCounts[metric] ?? 0;
    assertCount(metric, count);
    standardMicros += BigInt(count) * parseUsdMicros(standard[metric]);
    for (const role of UNIT_COST_ROLES[metric]) {
      const cost = input.costByRoleUsd[role];
      if (cost !== undefined) actualMicros += parseUsdMicros(cost);
    }
  }
  return {
    standardMicros,
    actualMicros,
    ratio: standardMicros === 0n ? null : Number(actualMicros) / Number(standardMicros),
  };
}
