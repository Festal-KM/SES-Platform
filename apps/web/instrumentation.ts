// apps/web/instrumentation.ts
// 🔴 T-03-12（docs/sprints/SP-03 §4 / docs/05 §13.1 / CLAUDE.md §11.1 / docs/02 章 7.6 NFR-ENV-2〜4）。
//    **`apps/web` の起動時 DI の呼び出し側**。Next.js は新しいサーバインスタンスの初期化時
//    （`next start` / `next dev` の `prepare`）に `register()` を 1 回だけ呼ぶ。
//
// 🔴 ここが無かったときに何が壊れていたか:
//    `loadAppEnv` / `resolveConnectorSelection` は実装済みだったが、どこからも呼ばれておらず、
//    環境変数の不備は**最初のリクエストが来て初めて 500 になる**（実測: `/admin/signin` は
//    200 を返し、アプリは「起動したように見える」）。`production` でモック実装が選ばれても
//    プロセスは止まらない。これは §11.1 が名指しで避けている「成功したように見えて実際には
//    送信されていない」壊れ方である。
//
// 🔴 判定ロジックをここに書かない。`@ses/config` の `initializeRuntimeConfig` 1 箇所を
//    `apps/worker` と共有する（web と worker で別々の判定を書くと必ず片方が古くなる）。
// 🔴 リクエストごとの `if (APP_ENV === ...)` を作らない。差し替えの判断は起動時のこの 1 回で終わる。
//
// 🔴 `process` はグローバルを使う（`node:process` を import しない）。Next.js は
//    instrumentation を Edge ランタイム向けにもコンパイルすることがあり、Edge 向けの
//    ビルドに Node 組み込みモジュールの import があるとビルドが落ちるためである。
import { formatStartupFailureLine, initializeRuntimeConfig } from '@ses/config';

/**
 * Next.js が起動時に 1 回だけ呼ぶフック。
 *
 * 🔴 **Edge ランタイムでは何もしない。**
 *    - Edge の `process.env` は Node ランタイムと同じ内容を持たない（Next.js の Edge ランタイムは
 *      環境変数を限定して渡す）。ここで検証すると「Edge だけ検証に落ちる」偽陽性になる。
 *    - Edge で動くのは `proxy.ts` だけであり、そこはパスと Cookie の有無しか見ない
 *      （DB・コネクタ・`packages/db` を一切 import しない。`proxy.ts` 冒頭）。
 *      つまり Edge 側に「差し替えるべき外部連携」が存在しない。
 *    - Node ランタイムの `register()` は**サーバ起動時に必ず走る**ため、ここを迂回して
 *      アプリが立ち上がる経路は無い。
 *    🔴 条件は「Edge のときだけ skip」と書く（「Node のときだけ実行」と書かない）。
 *      `NEXT_RUNTIME` が未設定の実行経路が増えたときに、既定が「検証する」側に倒れるため。
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  try {
    initializeRuntimeConfig(process.env, (line) => {
      process.stdout.write(`${line}\n`);
    });
  } catch (error) {
    // 🔴 握りつぶさない / モックにフォールバックしない。ここでの catch は
    //    「例外を無かったことにする」ためではなく、**より強い失敗に変換する**ためである:
    //    Next.js は `register()` の例外を捕捉したうえでプロセスを生かし続け、
    //    ポートを開いたまま全リクエストに 500 を返す（実測）。それでは「起動に失敗した」と
    //    言えない（コンテナは Running のまま、ロードバランサから見ると生存している）。
    //    そのままプロセスを落として、起動失敗として観測できる状態にする。
    // 🔴 文面の組み立ては `@ses/config` に置く（worker と同じ 1 行にする / 値をログに出さない）。
    process.stderr.write(`${formatStartupFailureLine(error)}\n`);
    process.exit(1);
  }
}
