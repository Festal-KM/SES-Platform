import { defineConfig } from 'vitest/config';

// tests/isolation/** 専用の Vitest 設定（`pnpm test:isolation`）。
// docs/05 §17.1「結合（DB あり）: Vitest + Testcontainers（PostgreSQL）」。
//
// 🔴 既定の `pnpm test:unit`（vitest.config.ts）から分離する。分離テストは Docker を要求するため、
//    同じスイートに入れると Docker の無い環境でユニットテストごと落ちる
//    （tests/smoke/** と同じ扱い。T-01-02 の前例）。
//    ただし本スイートは CI で毎回走らせること（SP-01 T-01-08 / docs/dev-plan.md §6.4 R-05）。
//
// 🔴 直列実行にする（docs/05 §17.6「分離検証のシナリオは直列（workers: 1）」）。
//    RLS の設定漏れは他テストの副作用で偽陽性・偽陰性になるため。
export default defineConfig({
  test: {
    include: ['tests/isolation/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // fileParallelism: false は maxWorkers を 1 に固定する（= 直列）。
    fileParallelism: false,
    // コンテナ起動 + マイグレーション + シードが beforeAll に入る。
    hookTimeout: 600_000,
    testTimeout: 120_000,
  },
});
