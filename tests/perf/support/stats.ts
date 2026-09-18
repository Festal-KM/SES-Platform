// tests/perf/support/stats.ts
// T-12-02: レイテンシの標本から p50 / p95 / p99 を出す純粋関数と、計測ループ。I/O を持たない。
//
// 🔴 百分位は**最近接順位法**（nearest-rank）: 昇順に並べた標本の ⌈p/100 × N⌉ 番目（1 始まり）を採る。
//    補間しない —— 補間すると「実在しない値」が p95 になり、予算との比較が実測値と離れる。
//    N = 60 なら p50 = 30 番目 / p95 = 57 番目 / p99 = 60 番目（= 最大値）。
import { performance } from 'node:perf_hooks';

export type LatencySummary = {
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
};

/** 昇順の標本に対する最近接順位法の百分位。`p` は 0 < p <= 100。 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) throw new RangeError('標本が 0 件です。');
  if (!(p > 0 && p <= 100)) throw new RangeError(`百分位は 0 < p <= 100 で指定します: ${String(p)}`);
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.max(0, Math.min(rank, sortedAscending.length) - 1)] as number;
}

export function summarize(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    n: sorted.length,
    min: sorted[0] as number,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] as number,
    mean: sum / sorted.length,
  };
}

export type MeasureOptions = {
  /** 標本数（ウォームアップを除く）。 */
  readonly samples: number;
  /** 標本に含めない先行実行の回数。 */
  readonly warmup: number;
};

/**
 * `run` を `warmup + samples` 回**直列に**実行し、後半 `samples` 回の所要時間（ミリ秒）を返す。
 * 🔴 並列にしない（計測対象はスループットではなく 1 リクエストのレイテンシ）。
 */
export async function measure(run: () => Promise<void>, options: MeasureOptions): Promise<number[]> {
  for (let i = 0; i < options.warmup; i += 1) await run();
  const durations: number[] = [];
  for (let i = 0; i < options.samples; i += 1) {
    const startedAt = performance.now();
    await run();
    durations.push(performance.now() - startedAt);
  }
  return durations;
}

export type ReportRow = {
  readonly label: string;
  readonly summary: LatencySummary;
  readonly budgetMs: number;
  /** 補足（件数など）。 */
  readonly note?: string;
};

function ms(value: number): string {
  return value.toFixed(1);
}

/** `docs/dev-plan.md` §8 に貼れる Markdown の表。 */
export function renderReport(title: string, rows: readonly ReportRow[]): string {
  const lines = [
    `### ${title}`,
    '',
    '| 条件 | N | min | p50 | p95 | p99 | max | mean | 予算(p95) | 判定 | 補足 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const { summary } = row;
    lines.push(
      `| ${row.label} | ${String(summary.n)} | ${ms(summary.min)} | ${ms(summary.p50)} | ${ms(summary.p95)} | ${ms(summary.p99)} | ${ms(summary.max)} | ${ms(summary.mean)} | ${String(row.budgetMs)} | ${summary.p95 <= row.budgetMs ? 'green' : '未達'} | ${row.note ?? ''} |`,
    );
  }
  return lines.join('\n');
}
