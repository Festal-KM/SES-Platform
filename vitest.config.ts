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
      'apps/*/src/**/*.test.ts',
      'tests/static/**/*.test.ts',
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
