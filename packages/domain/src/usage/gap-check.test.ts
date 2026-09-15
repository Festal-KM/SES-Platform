// packages/domain/src/usage/gap-check.test.ts
// 🔴 欠測判定の定義を固定する（docs/05 §9.8 `usage.gap-check` / `F-026 AC-4`）。T-10-02。
//
//   ① `SEAT_COUNT` は期待日すべてに行が要る（無ければ `GAP_MISSING`）
//   ② `AI_COST_USD` は **`AiUsage` に行がある日だけ**を見る（使わなかった日は欠測ではない）
//   ③ 行はあるが合計が食い違えば `GAP_MISMATCH`（書式差は不一致にしない）
//   ④ 窓は `[max(作成日 + 1, 今日 − lookback), 昨日]`（今日は対象外。🔴 作成日そのものも対象外 ——
//      01:00 JST 以降に開設されたテナントには作成日の SEAT_COUNT 行が原理的に無く、入れると永久に欠測になる）
import { describe, expect, it } from 'vitest';
import { detectUsageGaps, usageGapWindow } from './gap-check.js';

describe('usageGapWindow', () => {
  it('🔴 今日を含めず、lookback 日前から昨日まで', () => {
    expect(usageGapWindow({ todayKey: '2026-09-16', lookbackDays: 3, tenantCreatedDayKey: '2026-01-01' })).toEqual([
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ]);
  });

  it('🔴 テナント作成日とそれより前は期待しない（期待するのは作成日の翌日から）', () => {
    expect(usageGapWindow({ todayKey: '2026-09-16', lookbackDays: 7, tenantCreatedDayKey: '2026-09-14' })).toEqual([
      '2026-09-15',
    ]);
  });

  it('作成日が昨日なら空（作成日の SEAT_COUNT 行は seat-snapshot の時刻次第で存在しない）', () => {
    expect(usageGapWindow({ todayKey: '2026-09-16', lookbackDays: 7, tenantCreatedDayKey: '2026-09-15' })).toEqual([]);
  });

  it('作成日が今日なら空（まだ 1 日も終わっていない）', () => {
    expect(usageGapWindow({ todayKey: '2026-09-16', lookbackDays: 7, tenantCreatedDayKey: '2026-09-16' })).toEqual([]);
  });

  it('lookbackDays が 1 未満・非整数なら例外', () => {
    expect(() => usageGapWindow({ todayKey: '2026-09-16', lookbackDays: 0, tenantCreatedDayKey: '2026-01-01' })).toThrow(RangeError);
  });
});

describe('detectUsageGaps', () => {
  const days = ['2026-09-13', '2026-09-14', '2026-09-15'];

  it('欠測が無ければ空', () => {
    expect(
      detectUsageGaps({
        expectedDays: days,
        seatCountDays: new Set(days),
        aiUsageUsdByDay: new Map([['2026-09-14', '1.5']]),
        aiCostCounterUsdByDay: new Map([['2026-09-14', '1.500000']]),
      }),
    ).toEqual([]);
  });

  it('① SEAT_COUNT: 期待日に行が無ければ GAP_MISSING', () => {
    expect(
      detectUsageGaps({
        expectedDays: days,
        seatCountDays: new Set(['2026-09-13', '2026-09-15']),
        aiUsageUsdByDay: new Map(),
        aiCostCounterUsdByDay: new Map(),
      }),
    ).toEqual([{ kind: 'GAP_MISSING', metric: 'SEAT_COUNT', periodKey: '2026-09-14', expected: null, observed: null }]);
  });

  it('🔴 ② AI_COST_USD: AiUsage が無い日は欠測ではない / ある日にカウンタが無ければ GAP_MISSING', () => {
    const findings = detectUsageGaps({
      expectedDays: days,
      seatCountDays: new Set(days),
      aiUsageUsdByDay: new Map([['2026-09-15', '0.031500']]),
      aiCostCounterUsdByDay: new Map([['2026-09-13', '9.000000']]), // AiUsage の無い日のカウンタは見ない
    });
    expect(findings).toEqual([
      { kind: 'GAP_MISSING', metric: 'AI_COST_USD', periodKey: '2026-09-15', expected: '0.031500', observed: null },
    ]);
  });

  it('③ 合計が食い違えば GAP_MISMATCH（期待値と観測値の両方を載せる）', () => {
    expect(
      detectUsageGaps({
        expectedDays: days,
        seatCountDays: new Set(days),
        aiUsageUsdByDay: new Map([['2026-09-14', '2.000000']]),
        aiCostCounterUsdByDay: new Map([['2026-09-14', '1.750000']]),
      }),
    ).toEqual([
      { kind: 'GAP_MISMATCH', metric: 'AI_COST_USD', periodKey: '2026-09-14', expected: '2.000000', observed: '1.750000' },
    ]);
  });

  it('窓の外の日は見ない', () => {
    expect(
      detectUsageGaps({
        expectedDays: ['2026-09-15'],
        seatCountDays: new Set(['2026-09-15']),
        aiUsageUsdByDay: new Map([['2026-09-01', '5']]),
        aiCostCounterUsdByDay: new Map(),
      }),
    ).toEqual([]);
  });
});
