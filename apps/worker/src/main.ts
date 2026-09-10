// apps/worker/src/main.ts
// 🔴 T-03-12 / T-07-11（docs/sprints/SP-03 §4 / SP-07 §4 / docs/05 §13.1）。
//    **ワーカーの起動エントリポイント**。コンテナはこのファイル（`node dist/main.js`）を実行する。
//
// 🔴 web と worker で別々の判定ロジックを書かない（SP-03 T-03-12）。呼ぶのは
//    `@ses/config` の `initializeRuntimeConfig` だけであり、`APP_ENV` の分岐も
//    「production でモックなら失敗」も「非本番に本番キーがあれば失敗」も、すべて
//    `packages/config` の 1 箇所が持つ。ここに条件分岐・フォールバックを足さない。
//
// 🔴 `index.ts`（ジョブ宣言の公開）と分ける理由: `index.ts` はライブラリとして import される
//    （テストが `SCHEDULED_JOBS` を読む）。import しただけで起動処理が走ると、
//    ジョブ宣言を読むだけのテストが環境変数の検証に落ちる。**起動する側**をここに閉じる。
//
// ============================================================================
// 🔴 `--verify-config`: 設定を検証して終了する経路（T-07-11。docs/05 §13.1）
// ============================================================================
// T-07-11 でワーカーが**常駐する**ようになったため、`tests/startup/startup-di.test.ts` が
// 表明していた「`node apps/worker/src/main.ts` が exit 0 で終了する」が成り立たなくなった。
// 🔴 採ったのは「検証だけして終了する引数を用意する」ほうである（テスト側で起動ログを見て
//    プロセスを殺す形にはしない）。理由は 3 つ:
//   ① **本番の運用に要る。** デプロイ前に「この環境変数一式で起動できるか」を、キューにも
//      Redis にも触れずに確かめられる（コンテナの `healthcheck` / CI の設定検証で使える）。
//   ② テストが「起動ログを見て SIGTERM を送る」形になると、**検証がタイミングに依存する**
//      （ログが出る前に殺せば偽陰性、遅ければ Redis へ繋ぎにいって環境依存になる）。
//   ③ 🔴 **`bootstrapWorker()` を必ず通ることは変わらない。** 引数の解釈は bootstrap の
//      **後ろ**にあり、設定が不正なら `--verify-config` の有無にかかわらず exit 1 になる。
//      「引数を付ければ検証を飛ばせる」形にはしていない。
import process from 'node:process';
import { formatStartupFailureLine } from '@ses/config';
import { bootstrapWorker } from './bootstrap.js';
import { startWorkerRuntime, type WorkerRuntime } from './runtime.js';

// 🔴 T-03-12 からの互換: 起動時 DI の呼び出しは `./bootstrap.ts` に切り出した
//    （**import しただけでワーカーが立ち上がる**ファイルに、テストから呼びたい関数を置かない）。
export { bootstrapWorker } from './bootstrap.js';

/** 🔴 設定を検証して**終了する**ための引数（docs/05 §13.1）。 */
export const VERIFY_CONFIG_FLAG = '--verify-config';

/**
 * ワーカー自身のログの接頭辞。
 *
 * 🔴 **`@ses/config` の `STARTUP_LINE_PREFIX`（`[ses:startup]`）を使わない。** あちらは
 *    「起動時 DI の解決結果が**プロセスにつき 1 行**」を数えるための目印であり
 *    （`tests/startup/startup-di.test.ts`）、ワーカーの都合の行を混ぜると多重初期化の
 *    検出が空振りする。
 */
const WORKER_LINE_PREFIX = '[ses:worker]';

/** 🔴 `--verify-config` で終了したことを運用が確認するための 1 行（起動ログとは別物）。 */
export const VERIFY_CONFIG_OK_LINE = `${WORKER_LINE_PREFIX} 設定の検証のみを行い、ワーカーは起動しませんでした。`;

/**
 * 🔴 起動の本体（`bootstrapWorker()` → 引数の解釈 → 配線）。
 *
 * 🔴 **順序を入れ替えないこと。** `bootstrapWorker()` を先に置くことが「どの引数で呼んでも
 *    設定の検証を通る」ことの担保である（`--verify-config` は検証の**スキップ**ではない）。
 */
export async function runWorkerMain(argv: readonly string[]): Promise<WorkerRuntime | null> {
  const config = bootstrapWorker();
  if (argv.includes(VERIFY_CONFIG_FLAG)) {
    process.stdout.write(`${VERIFY_CONFIG_OK_LINE}\n`);
    return null;
  }
  const runtime = startWorkerRuntime(config);
  // 🔴 スケジュールの登録が Redis に届くまで待ってから「待ち受け中」を名乗る。
  //    待たないと、登録に失敗しても「起動した」というログだけが残る（CLAUDE.md §11.1）。
  await runtime.ready;
  process.stdout.write(`${WORKER_LINE_PREFIX} queues: ${runtime.queues.join(' ')}\n`);
  return runtime;
}

/**
 * 🔴 停止時にキュー・ワーカー・Redis 接続を閉じる。
 *
 * 閉じ損ねると、実行中のジョブが途中で切られて BullMQ の `stalled` として再実行されうる
 * （`gate.run` は `attempts: 1` なので失敗として残る）。`SIGTERM` / `SIGINT` の両方を拾う。
 */
function installShutdownHandlers(runtime: WorkerRuntime): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    process.stdout.write(`${WORKER_LINE_PREFIX} ${signal} を受信しました。ワーカーを停止します。\n`);
    void runtime
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        process.stderr.write(`${formatStartupFailureLine(error)}\n`);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void runWorkerMain(process.argv.slice(2))
  .then((runtime) => {
    if (runtime !== null) installShutdownHandlers(runtime);
  })
  .catch((error: unknown) => {
    // 🔴 配線の失敗も起動の失敗として扱う（握り潰して「起動したが何も待ち受けていない」に
    //    しない。CLAUDE.md §11.1）。
    process.stderr.write(`${formatStartupFailureLine(error)}\n`);
    process.exit(1);
  });
