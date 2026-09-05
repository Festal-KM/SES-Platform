// apps/worker/src/main.ts
// 🔴 T-03-12（docs/sprints/SP-03 §4 / docs/05 §13.1 の「`apps/worker` は `src/main.ts` で 1 回だけ呼ぶ」）。
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
// 🔴 BullMQ の `Queue` / `Worker` の配線は SP-07 の範囲である（`src/jobs/index.ts` 冒頭）。
//    本ファイルは現時点では「起動時 DI を 1 回通す」ところまでを担う。配線を足すときも、
//    `bootstrapWorker()` が返した `RuntimeConfig` を使い、`process.env` を読み直さないこと。
import process from 'node:process';
import { formatStartupFailureLine, initializeRuntimeConfig, type RuntimeConfig } from '@ses/config';

/**
 * 環境変数の検証と外部連携の選択を 1 回だけ通す。
 *
 * 🔴 失敗したら**プロセスを終了する**（モックへのフォールバックを作らない。CLAUDE.md §11.1）。
 *    ワーカーは外部送信ジョブ（提案メール・契約書送付・電子署名依頼）の実行主体であり、
 *    設定が不正なまま起動すると「送ったつもりで送れていない」状態が本番まで残る。
 */
export function bootstrapWorker(): RuntimeConfig {
  try {
    return initializeRuntimeConfig(process.env, (line) => {
      process.stdout.write(`${line}\n`);
    });
  } catch (error) {
    // 🔴 文面の組み立ては `@ses/config` に置く（web と同じ 1 行にする / 値をログに出さない）。
    process.stderr.write(`${formatStartupFailureLine(error)}\n`);
    process.exit(1);
  }
}

bootstrapWorker();
