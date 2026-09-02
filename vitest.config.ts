import { defineConfig } from 'vitest/config';

// 🔴 tests/smoke/**（docker-compose 依存のスモークテスト）はここに含めない。
// CI の `pnpm test:unit`（本設定）が Docker 依存にならないようにするため。
// スモークテストは vitest.smoke.config.ts / `pnpm test:smoke` の専用経路で走らせる
// （code-reviewer 指摘 #1 / SP-01 T-01-02）。
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/static/**/*.test.ts',
      'tests/isolation/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'tests/smoke/**'],
  },
});
