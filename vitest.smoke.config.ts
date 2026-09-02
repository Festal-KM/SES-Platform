import { defineConfig } from 'vitest/config';

// tests/smoke/** 専用の Vitest 設定（`pnpm test:smoke`）。
// docker-compose の 5 サービスへの疎通確認であり、`docker compose up -d` 済みの
// ローカル環境でのみ意味を持つ。CI の既定 `pnpm test:unit`（vitest.config.ts）から
// 独立させることで、Docker 未起動の CI 環境がこのファイルの収集対象にすらならないようにする
// （code-reviewer 指摘 #1 / SP-01 T-01-02）。
export default defineConfig({
  test: {
    include: ['tests/smoke/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
