import { defineConfig } from 'vitest/config';

// tests/perf/** 専用の Vitest 設定（`pnpm test:perf`）。T-12-02（`docs/sprints/SP-12-phase1-hardening.md` §4）。
// docs/05 §17.3 #20 / `docs/03` §3.7.2「検証方法」/ `CLAUDE.md` §7（複合検索 p95 1 秒）。
//
// 🔴 CI の毎回実行には載せない（`.github/workflows/ci.yml` は触らない）。`seed:perf`（1 万 / 1 万 / 匿名共有 2,000）の
//    投入だけで 2〜3 分、計測を含めて 10 分前後かかる。実行は手動 / リリース前とし、結果は `docs/dev-plan.md` §8 に記録する。
//    既定の `pnpm test:unit`（vitest.config.ts）と `pnpm test:isolation` のどちらの include にも `tests/perf/**` は入らない。
//
// 🔴 `vitest.isolation.config.ts` と同じ Testcontainers ハーネス（PostgreSQL 17 + Redis）を使う。ローカルの共有 DB は使わない
//    （migration の副作用を残さないため。T-12-01 と同じ理由）。
//
// 🔴 直列実行（`fileParallelism: false` = maxWorkers 1）。計測は 1 リクエストずつのレイテンシであり、並列に走らせると
//    同じコンテナの CPU を奪い合って p95 が実態と離れる。
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    // コンテナ起動 + マイグレーション + `seed:perf`（初回 158 秒の実測。T-12-01）が beforeAll に入る。投入込みで 15 分。
    hookTimeout: 900_000,
    testTimeout: 900_000,
  },
});
