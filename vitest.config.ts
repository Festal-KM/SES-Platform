import { defineConfig } from 'vitest/config';

// 🔴 tests/smoke/**（docker-compose 依存のスモークテスト）と
// tests/isolation/**（Testcontainers 依存の分離検証）はここに含めない。
// CI の `pnpm test:unit`（本設定）が Docker 依存にならないようにするため。
// それぞれ vitest.smoke.config.ts / `pnpm test:smoke`（code-reviewer 指摘 #1 / SP-01 T-01-02）と
// vitest.isolation.config.ts / `pnpm test:isolation`（SP-01 T-01-04）の専用経路で走らせる。
export default defineConfig({
  // 🔴 T-04-06 Iteration 3: `apps/web/tsconfig.json` は Next.js（SWC/Babel）向けに
  //    `jsx: "preserve"` を設定している。Vite 8 の既定トランスフォーム（oxc）はこれを
  //    そのまま読み、JSX 構文を変換せず残すため `import-analysis` で構文エラーになる。
  //    `*.render.test.tsx`（`SendingDomainScreen` 等）が読み込む `.tsx` ソースのためだけに、
  //    Vitest 側の oxc 変換だけを上書きする（`apps/web/tsconfig.json` 自体は変更しない
  //    ＝ Next.js のビルドには影響しない）。React 19 の自動 JSX ランタイムに合わせる。
  oxc: { jsx: { runtime: 'automatic' } },
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
      // 🔴 T-04-06 Iteration 3（e2e-tester 報告）への限定的な例外: `*.render.test.tsx` の
      //    命名規約を付けたファイルだけを `app/**` からも拾う。理由は 2 つ:
      //    ①状態駆動の描画（例: `SendingDomainScreen` の 4 状態）は、この画面固有のロジックで
      //    あり `lib/**` に切り出しようがない（切り出すと画面と乖離した「型が合っているだけ」の
      //    検証になる）②E2E は development 固定（`bootstrap.ts` の `verificationRequired`）で
      //    `required=true` の分岐に到達できず、この粒度でしか担保できない。
      //    上記 2 点に当てはまらない画面には広げない（`app/**` は原則ユニットテスト対象外のまま）。
      'apps/*/app/**/*.render.test.tsx',
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
