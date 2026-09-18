// tests/perf/support/stats.test.ts
// T-12-02: 百分位（最近接順位法）と計測ループの純粋関数。DB を要らない（`pnpm test:perf` で本体の前に走る）。
import { describe, expect, it } from 'vitest';
import { measure, percentile, renderReport, summarize } from './stats.js';

describe('percentile（最近接順位法）', () => {
  it('N = 60 で p50 = 30 番目 / p95 = 57 番目 / p99 = 60 番目（最大値）', () => {
    const sorted = Array.from({ length: 60 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 95)).toBe(57);
    expect(percentile(sorted, 99)).toBe(60);
    expect(percentile(sorted, 100)).toBe(60);
  });

  it('補間しない（実在する標本の値だけを返す）', () => {
    const sorted = [10, 20, 30];
    expect(percentile(sorted, 50)).toBe(20);
    expect(percentile(sorted, 95)).toBe(30);
    expect(percentile(sorted, 1)).toBe(10);
  });

  it('標本 0 件と範囲外の p は RangeError', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
  });
});

describe('summarize / measure / renderReport', () => {
  it('summarize は昇順に並べ替えてから百分位と平均を出す（入力順に依存しない）', () => {
    const summary = summarize([5, 1, 4, 2, 3]);
    expect(summary).toEqual({ n: 5, min: 1, p50: 3, p95: 5, p99: 5, max: 5, mean: 3 });
  });

  it('measure はウォームアップを標本に含めず、直列に samples 回だけ記録する', async () => {
    const calls: number[] = [];
    let inFlight = 0;
    const durations = await measure(
      async () => {
        inFlight += 1;
        expect(inFlight).toBe(1);
        calls.push(calls.length);
        await Promise.resolve();
        inFlight -= 1;
      },
      { samples: 7, warmup: 3 },
    );
    expect(calls).toHaveLength(10);
    expect(durations).toHaveLength(7);
    for (const duration of durations) expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('renderReport は予算との比較を green / 未達 で描く', () => {
    const report = renderReport('t', [
      { label: 'a', summary: summarize([100, 200]), budgetMs: 1_000 },
      { label: 'b', summary: summarize([1_500, 900]), budgetMs: 1_000, note: 'x' },
    ]);
    expect(report).toContain('| a | 2 | 100.0 | 100.0 | 200.0 | 200.0 | 200.0 | 150.0 | 1000 | green |  |');
    expect(report).toContain('| b | 2 | 900.0 | 900.0 | 1500.0 | 1500.0 | 1500.0 | 1200.0 | 1000 | 未達 | x |');
  });
});
