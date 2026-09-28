// apps/web/next.config.ts
// 🔴 最小構成。設定に APP_ENV による分岐を書かない（差し替えは packages/config の
//    resolveConnectorSelection 1 箇所。CLAUDE.md §11.1 / docs/05 §13.1）。
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 🔴 型エラー・ビルドエラーを握りつぶさない（既定値だが、後から緩められないよう明示する）。
  typescript: { ignoreBuildErrors: false },
  // 🔴 @node-rs/argon2 はネイティブアドオン。サーバ側で外部化してバンドルさせない。
  // 🔴 @anthropic-ai/sdk は `@ses/ai` のバレル経由で載る（T-08-06 が依頼メッセージの商流照合に
  //    `mask()` を使うため）。Web は LLM を呼ばないので、SDK 本体をバンドルへ取り込まない
  //    （docs/05 §7.9 ⑥ / §6.5「#31 / #32 / #35 の実装の決着」）。
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client', '@anthropic-ai/sdk'],
  // 🔴 Next 16 は `next dev` のたびに apps/web/AGENTS.md と apps/web/CLAUDE.md を生成する。
  //    本リポジトリの `CLAUDE.md`（ルート）は全エージェントの一次資料であり、`apps/web` に同名の
  //    別ファイルが生えると、そこで作業するエージェントが二次的な指示を読んでしまう。生成を止める。
  agentRules: false,
};

/**
 * 🔴 `next.config.ts` が読まれる**フェーズ**のうち、`NODE_ENV=development` を許すもの。
 *
 * `next dev` は development が正しい。`next info` は成果物を作らない診断コマンドである。
 * 🔴 **列挙は「許す側」に置く。** 「ビルドのフェーズ名」を列挙する向きにすると、Next が
 *    フェーズ名を変えた日に**ガードが黙って効かなくなる**。許す側に置けば、最悪の壊れ方は
 *    「dev でも production を要求して即座に落ちる」= すぐ気づける方向になる。
 *    値は Next の `PHASE_DEVELOPMENT_SERVER` / `PHASE_INFO`（`next/constants`）。
 *    🔴 `next/constants` を import しない —— `next.config.ts` は Next 自身が SWC で
 *    トランスパイルして `require` する特殊な読み込み経路にあり（`next/dist/build/next-config-ts/
 *    transpile-config.js`）、ここに実行時 import を増やすと、この門番自体が読み込みに失敗して
 *    無効化されうる。文字列は `tests/static/build-node-env-guard.test.ts` が固定する。
 */
const NODE_ENV_EXEMPT_PHASES: readonly string[] = ['phase-development-server', 'phase-info'];

/**
 * 🔴 **`NODE_ENV=production`（または未設定）以外で成果物を作らせない。**
 *
 * 何が起きるか（2026-09-28 に実測。`pnpm --filter @ses/web run build` で再現・解消の両方を確認）:
 * 環境に `NODE_ENV=development` があると、`next build` は production のバンドルを出力する一方で、
 * **事前生成のワーカーだけが React の development 版を内蔵した描画ランタイムを読み込む**
 * （`next/dist/server/route-modules/app-page/module.compiled.js` が `process.env.NODE_ENV ===
 * 'development'` で `app-page-turbo.runtime.dev.js` を選ぶ）。React が 2 つ同居するため、
 * アプリ側チャンクの `useContext`（Next 自身の `layout-router`）が読む dispatcher が null になり、
 *   `TypeError: Cannot read properties of null (reading 'useContext')`
 * で `/_global-error` の事前生成が落ちる。`/_global-error` は Next が `isStatic: true` に
 * **ハードコード**している合成ページ（`next/dist/build/utils.js` の `isPageStatic`。
 * `get-static-info-including-layouts.js` はこのルートだけレイアウトの設定継承も飛ばす）であり、
 * ルートレイアウトの `force-dynamic` でも静的生成から外せない。つまり**必ずここで落ちる**。
 * 上流は未修正（vercel/next.js #97046 / #99265 ほか。いずれも repro 不足で自動クローズ）。
 *
 * 決め手になった観測: **失敗したビルドの事前生成だけが React の development 版の警告**
 * （`Each child in a list should have a unique "key" prop.`）を出していた。production の React は
 * この警告を持たない = 事前生成が dev の React を読んでいた証拠である。
 *
 * 🔴 **実測の表（同じ実験を繰り返さないこと）**。上 2 行だけが唯一の対照実験で、
 *    「`NODE_ENV` 以外は 1 文字も違わない」比較である:
 *    | 条件 | 結果 |
 *    |---|---|
 *    | `NODE_ENV` 未設定（外枠あり・全画面。cold / warm で各 1 回） | **成功** |
 *    | `NODE_ENV=development`（他は一切同じ） | **失敗**（`/_global-error`） |
 *    | `app/(main)/layout.tsx` をファイルごと退避 | 成功 —— ただし `NODE_ENV` と**交絡していた**。原因ではない |
 *    | 中身が `return <>{children}</>` だけの最小レイアウト | 失敗 |
 *    | レイアウトの `dynamic` / `runtime` を外す | 失敗（どちらも無関係。`(main)/layout.tsx` の 🔴） |
 *    | 自前の `app/global-error.tsx` を置く | 失敗（そもそも事前生成の対象ではない。同ファイルの 🔴） |
 *    | `next build --webpack` | 失敗（Turbopack 固有ではない。ランタイム選択は共通） |
 *
 * 🔴 **`NODE_ENV` をここで `production` に書き換えて「通す」ことはしない。** `development` の
 *    `NODE_ENV` が環境にあるということは、その shell には開発用の `APP_ENV`・接続先・モック選択も
 *    載っているということである。片方だけ黙って昇格させると、`CLAUDE.md` §11.1 が名指しで避けている
 *    「成功したように見えて、実際には違うもの」（dev ビルドの React を積んだ成果物）になる。
 *    **止めて、変数名を出す。**
 *
 * 🔴 `packages/config` の `loadAppEnv` を通さずに `process.env` を直接読む唯一の場所である。
 *    理由: この判定はビルドの入口（環境変数がまだ揃っていない時点）で成立しなければならず、
 *    `DATABASE_URL` 等の runtime の契約に依存させられない。読むのは `NODE_ENV` 1 つだけ。
 *
 * @param phase Next が渡すフェーズ名（`next/constants` の `PHASE_*`）。
 * @param nodeEnv `process.env.NODE_ENV`。未設定なら Next が `production` を割り当てる（安全側）。
 */
export function assertProductionNodeEnv(phase: string, nodeEnv: string | undefined): void {
  if (NODE_ENV_EXEMPT_PHASES.includes(phase)) return;
  if (nodeEnv === undefined || nodeEnv === '' || nodeEnv === 'production') return;
  throw new Error(
    `NODE_ENV=${nodeEnv} のまま Next.js の ${phase} を実行しています。` +
      'ビルドと本番起動は NODE_ENV=production（または未設定）でのみ行えます。' +
      'この状態では事前生成のワーカーだけが React の development 版を読み込み、' +
      "/_global-error の事前生成が TypeError: Cannot read properties of null (reading 'useContext') で落ちます。" +
      'シェルの NODE_ENV を外してから実行してください' +
      '（.env / .env.development.local を source したシェルがそのままビルドに使われるのが典型的な原因です）。',
  );
}

/**
 * 🔴 設定を**フェーズ関数**で返す（Next.js の公式な形）。オブジェクトを直接 export すると、
 *    Next がフェーズを渡す口が無くなり上の門番を置けない。設定の中身はフェーズで変えない
 *    （`APP_ENV` による分岐を書かないのと同じ理由。冒頭の 🔴）。
 */
export default function nextConfigForPhase(phase: string): NextConfig {
  assertProductionNodeEnv(phase, process.env.NODE_ENV);
  return nextConfig;
}
