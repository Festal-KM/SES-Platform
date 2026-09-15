// packages/domain/src/usage/gap-check.ts
// 🔴 日次の計測の**連続性の判定**（docs/05 §9.8 `usage.gap-check` / `F-026 AC-4`「欠測 0 件が目標」）。T-10-02。
//
// ============================================================================
// 🔴 何を「欠測」と呼ぶか（判定の定義はここ 1 箇所）
// ============================================================================
// 計測には「毎日必ず行があるもの」と「出来事があった日にだけ行があるもの」がある。混ぜると
// 「AI を使わなかった日」が欠測に見えてしまい、欠測 0 件という目標が最初から成立しない。
//
//   - `SEAT_COUNT`（日次スナップショット）… テナントが存在する日は**必ず**行がある。
//     無ければ `GAP_MISSING`（`usage.seat-snapshot` がその日に走らなかった）。
//   - `AI_COST_USD`（金額）… 正は `AiUsage`（docs/03 §4.15「AI: `AiUsage` の 1 行 = 1 呼び出し。
//     `UsageCounter` はその日次ロールアップ」）。**`AiUsage` に行がある日**にカウンタが無ければ
//     `GAP_MISSING`、合計が食い違えば `GAP_MISMATCH`。`AiUsage` が無い日は欠測ではない。
//   - 🔴 `AI_UNIT_*`（件数）は**対象外**（`AiUsage` の行数から数え直さない。docs/05 §9.8 / §7.6）。
//   - `EMAIL_COUNT` は対象外（正が予約行そのものであり、独立した突き合わせ先が無い。
//     docs/05 §8.7「`UsageCounter`（DB）が正」）。
//   - `STORAGE_BYTES` は `usage.storage-reconcile`（`storage-reconcile.ts`）が別に検算する。
//
// 🔴 判定は純粋関数であり、「どの日を期待するか」「観測された行」はすべて引数で受ける。
//    DB を読んで材料を揃えるのは `packages/db`（`usage-gap-check.ts`）である。

import { parseUsdMicros } from './usd.js';
import { compareDayKeys, enumerateDayKeys, shiftDayKey } from './day-keys.js';

/** 連続性の検査対象（上記の定義）。 */
export type UsageGapMetric = 'SEAT_COUNT' | 'AI_COST_USD';

export type UsageGapFinding = {
  /** `GAP_MISSING` = 行が無い / `GAP_MISMATCH` = 行はあるが正と食い違う（`AI_COST_USD` のみ）。 */
  readonly kind: 'GAP_MISSING' | 'GAP_MISMATCH';
  readonly metric: UsageGapMetric;
  /** 暦日キー（`YYYY-MM-DD`）。 */
  readonly periodKey: string;
  /** 正の値（`AI_COST_USD` = `AiUsage` の合計 USD）。`SEAT_COUNT` は正を持たないので `null`。 */
  readonly expected: string | null;
  /** カウンタの値。行が無ければ `null`。 */
  readonly observed: string | null;
};

export type UsageGapWindowInput = {
  /** 判定を行う日（`usagePeriodKey('DAY', now)`）。🔴 **この日自身は対象外**（まだ 1 日が終わっていない）。 */
  readonly todayKey: string;
  /** 遡る日数（`packages/config` の `USAGE_GAP_CHECK_LOOKBACK_DAYS`）。 */
  readonly lookbackDays: number;
  /**
   * テナントが作られた日。🔴 **作成日そのものも期待しない**（期待するのは作成日の翌日から）。
   * `usage.seat-snapshot` は 01:00 JST に「その時点で存在するテナント」へファンアウトするため、
   * 01:00 より後に開設されたテナントには作成日の `SEAT_COUNT` 行が原理的に存在しない（開設時に
   * スナップショットを取る経路も無い）。作成日を窓に入れると、その行が**解消不能な `GAP_MISSING`**
   * として永久に残り、`F-026 AC-4`「欠測 0 件」が全テナントで不成立になる（T-10-02 レビュー指摘）。
   * `AI_COST_USD` は呼び出し時に `ai-cost-guard` が DAY 行を作るため、作成日を外しても取りこぼさない。
   */
  readonly tenantCreatedDayKey: string;
};

/**
 * 🔴 期待される暦日の列（`[max(作成日 + 1, 今日 − lookback), 昨日]`。作成日の翌日 = そのテナント向けに
 *    `usage.seat-snapshot` が初めて走りうる日）。
 *
 * 遡る幅を持つのは、`usage.gap-check` 自身が 1〜数日走らなかった場合に、復帰した日に
 * それまでの欠測をまとめて拾うためである（`docs/03` §4.6「ジョブが 1 日止まっても翌日に取り返す」）。
 */
export function usageGapWindow(input: UsageGapWindowInput): readonly string[] {
  if (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 1) {
    throw new RangeError(`lookbackDays は 1 以上の整数である必要があります（${input.lookbackDays}）。`);
  }
  const yesterday = shiftDayKey(input.todayKey, -1);
  const earliest = shiftDayKey(input.todayKey, -input.lookbackDays);
  const firstExpected = shiftDayKey(input.tenantCreatedDayKey, 1);
  const from = compareDayKeys(firstExpected, earliest) > 0 ? firstExpected : earliest;
  return enumerateDayKeys(from, yesterday);
}

export type UsageGapInput = {
  /** 期待される暦日の列（`usageGapWindow` の結果）。 */
  readonly expectedDays: readonly string[];
  /** `UsageCounter(DAY,'SEAT_COUNT')` が存在する日。 */
  readonly seatCountDays: ReadonlySet<string>;
  /** 🔴 正: `AiUsage` を JST の暦日で集計した USD（行がある日だけ）。 */
  readonly aiUsageUsdByDay: ReadonlyMap<string, string>;
  /** `UsageCounter(DAY,'AI_COST_USD').value`（行がある日だけ）。 */
  readonly aiCostCounterUsdByDay: ReadonlyMap<string, string>;
};

/**
 * 🔴 欠測・不一致の判定（純粋関数）。
 *
 * 戻り値は `A-005`（docs/05 §16.5「計測欠測」）の材料であり、**件数・日付・金額**だけを持つ。
 * 個人情報も本文も含まない（`BR-40`）。
 */
export function detectUsageGaps(input: UsageGapInput): readonly UsageGapFinding[] {
  const findings: UsageGapFinding[] = [];
  for (const day of input.expectedDays) {
    if (!input.seatCountDays.has(day)) {
      findings.push({ kind: 'GAP_MISSING', metric: 'SEAT_COUNT', periodKey: day, expected: null, observed: null });
    }
    const expectedUsd = input.aiUsageUsdByDay.get(day);
    if (expectedUsd === undefined) continue;
    const observedUsd = input.aiCostCounterUsdByDay.get(day);
    if (observedUsd === undefined) {
      findings.push({ kind: 'GAP_MISSING', metric: 'AI_COST_USD', periodKey: day, expected: expectedUsd, observed: null });
      continue;
    }
    // 🔴 金額は micro-USD の整数で比べる（文字列の書式差〔`1.5` と `1.500000`〕を不一致にしない）。
    if (parseUsdMicros(expectedUsd) !== parseUsdMicros(observedUsd)) {
      findings.push({ kind: 'GAP_MISMATCH', metric: 'AI_COST_USD', periodKey: day, expected: expectedUsd, observed: observedUsd });
    }
  }
  return findings;
}
