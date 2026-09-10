// apps/worker/src/bootstrap.ts
// 🔴 起動時 DI の呼び出し（docs/05 §13.1 / CLAUDE.md §11.1）。T-03-12 で `main.ts` に置いたものを
//    T-07-11 で切り出した。
//
// 🔴 なぜ `main.ts` から分けたか: `main.ts` は **import しただけでワーカーが起動する**
//    エントリになった（T-07-11 で常駐するようになった）。起動経路テストの harness
//    （`tests/startup/harness/run-entry.ts`）は「初期化を 2 回試みてキャッシュが効くこと」を
//    確かめたいだけであり、そのために Redis へ繋ぐワーカーを立てるわけにはいかない。
//    **「設定を解決する側」と「起動する側」を分ける**（`index.ts` と `main.ts` を分けたのと同じ理由）。
//
// 🔴 web と worker で別々の判定ロジックを書かない（SP-03 T-03-12）。呼ぶのは
//    `@ses/config` の `initializeRuntimeConfig` だけであり、`APP_ENV` の分岐も
//    「production でモックなら失敗」も「非本番に本番キーがあれば失敗」も、すべて
//    `packages/config` の 1 箇所が持つ。ここに条件分岐・フォールバックを足さない。
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
