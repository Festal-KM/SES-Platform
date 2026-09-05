import { defineConfig } from 'vitest/config';

// 🔴 tests/smoke/**（docker-compose 依存のスモークテスト）と
// tests/isolation/**（Testcontainers 依存の分離検証）はここに含めない。
// CI の `pnpm test:unit`（本設定）が Docker 依存にならないようにするため。
// それぞれ vitest.smoke.config.ts / `pnpm test:smoke`（code-reviewer 指摘 #1 / SP-01 T-01-02）と
// vitest.isolation.config.ts / `pnpm test:isolation`（SP-01 T-01-04）の専用経路で走らせる。
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      // packages/db/seed/**（シードの引数解釈・環境ガード・ID 生成。DB を要らない部分）。
      'packages/*/seed/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // 🔴 T-03-01: apps/web は Next.js（App Router）になり `src/` を持たない。
      //    フレームワーク非依存のロジックは `apps/web/lib/**` に置き、ここで拾う
      //    （`app/**` はルート定義とビューであり、ユニットテストを置かない）。
      'apps/*/lib/**/*.test.ts',
      'tests/static/**/*.test.ts',
      // 🔴 T-03-12: 起動経路の検証（`apps/web` の instrumentation / `apps/worker` の main を
      //    子プロセスで実際に起動する）。DB を要らないので tests/isolation（Testcontainers）
      //    には置かず、**CI で毎回走る `test:unit` に載せる**（起動時 DI の担保が
      //    スキップされうる場所にあってはならない）。ビルド済みの packages/config/dist を使う
      //    ため、CI の実行順（build → test）に依存する（tests/startup/startup-di.test.ts 冒頭）。
      'tests/startup/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/e2e/**',
      'tests/smoke/**',
      'tests/isolation/**',
    ],
  },
});
