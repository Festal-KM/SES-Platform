// packages/config/src/startup.ts
// 🔴 T-03-12（docs/sprints/SP-03 §4）。**起動時 DI の唯一の入口**（docs/05 §13.1 / CLAUDE.md §11.1）。
//
// 背景: `loadAppEnv`（環境変数の Zod 検証）と `resolveConnectorSelection`（`APP_ENV` による
// 外部連携の差し替え）は T-01-03 で実装したが、**どのアプリからも呼ばれていなかった**。
// 関数として正しくても起動時に 1 回も呼ばれなければ、`production` でモック実装が選択されても
// プロセスは止まらない ——「成功したように見えて実際には送信されていない」（§11.1 が名指しで
// 避けている壊れ方）そのものである。
//
// 🔴 判定は**このファイル 1 箇所**に置く。`apps/web`（`instrumentation.ts`）と
//    `apps/worker`（`src/main.ts`）は、どちらも `initializeRuntimeConfig` を呼ぶだけで、
//    自前の判定・自前のフォールバックを持たない（二重実装は必ず片方が古くなる）。
// 🔴 例外を握りつぶさない。検証・選択に失敗したらそのまま throw し、呼び出し側が
//    プロセスを落とす。モックへのフォールバックをここにも呼び出し側にも書かない。
// 🔴 `packages/config` は `process` に依存しない（`load-env.ts` 冒頭の理由）。
//    環境変数の出所（`process.env`）とログの出力先は、呼び出し側が引数で渡す。

import { resolveConnectorSelection, type ConnectorSelection } from './connector-selection.js';
import { loadAppEnv, type EnvSource } from './load-env.js';
import type { AppEnv } from './schema.js';

/** 起動時に 1 度だけ解決される、プロセス全体の設定。 */
export interface RuntimeConfig {
  readonly env: AppEnv;
  readonly connectors: ConnectorSelection;
}

/** 起動ログの出力先。`apps/*` が `process.stdout.write` 等を渡す。 */
export type StartupLogger = (line: string) => void;

/**
 * 🔴 キャッシュを **`globalThis` に置く**理由（モジュールスコープの `let` にしない）:
 *    `apps/web` は Next.js のバンドラを通り、`instrumentation.ts` と Route Handler は
 *    別のチャンクに出力される。バンドラがモジュールを複製した場合、モジュールスコープの
 *    キャッシュは**チャンクごとに別物**になり、「プロセスにつき 1 回」が破れる
 *    （＝ 起動ログが 2 行出て、環境変数の検証も 2 回走る）。
 *    `Symbol.for` はプロセス内で共有されるシンボルレジストリを引くため、
 *    バンドルのされ方によらず 1 つの格納場所を指す。
 */
const RUNTIME_CONFIG_KEY = Symbol.for('@ses/config#runtimeConfig');

type RuntimeConfigStore = typeof globalThis & {
  [RUNTIME_CONFIG_KEY]?: RuntimeConfig;
};

function store(): RuntimeConfigStore {
  return globalThis as RuntimeConfigStore;
}

/**
 * 🔴 起動ログの目印。テスト（`tests/startup/**`）がこの接頭辞の出現回数で
 *    「プロセスにつき 1 回」を判定する。値を変えるときはテストも一緒に直す。
 */
export const STARTUP_LINE_PREFIX = '[ses:startup]';

/**
 * 起動ログの 1 行。
 *
 * 🔴 **シークレットを出さない**（CLAUDE.md §3.4 / §3.5 / docs/05 §13.4 規則 6）。
 *    出すのは `APP_ENV` と、コネクタ区分ごとの実装種別（`real` / `mock` /
 *    `sandboxRecipientScoped`）だけである。接続文字列・API キー・鍵は 1 つも含めない。
 *    「どの環境で、どの外部連携が実接続なのか」は運用時に最初に知りたい情報であり、
 *    ここを削ると `production` でモックが混ざった事故に気づく手掛かりが無くなる。
 */
export function formatStartupLine(runtime: RuntimeConfig): string {
  const { connectors } = runtime;
  // 🔴 並びは固定（診断のたびに列が動くとログの差分が読めない）。
  const kinds = [
    `email=${connectors.email}`,
    `objectStore=${connectors.objectStore}`,
    `malwareScanner=${connectors.malwareScanner}`,
    `esign=${connectors.esign}`,
    `billing=${connectors.billing}`,
    `ai=${connectors.ai}`,
  ].join(' ');
  return `${STARTUP_LINE_PREFIX} APP_ENV=${runtime.env.APP_ENV} connectors: ${kinds}`;
}

/**
 * 起動に失敗したときに標準エラーへ出す 1 行。
 *
 * 🔴 web と worker で**同じ文面**にする（片方だけ書式が変わると、ログ検索や監視の
 *    条件を 2 本持つことになる）。
 * 🔴 「変数名と理由」だけを出す（docs/05 §13.4 規則 5 / 規則 6）。`EnvValidationError` の
 *    メッセージは値を含まない設計であり、ここでもスタックトレースや原因オブジェクトを
 *    丸ごと出さない（環境変数の値がログに混ざる経路を作らない）。
 */
export function formatStartupFailureLine(error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  return `${STARTUP_LINE_PREFIX} 起動時の設定検証に失敗しました。プロセスを終了します: ${detail}`;
}

/**
 * 🔴 環境変数の検証と外部連携の選択を、**プロセスにつき 1 回**行う。
 *
 * - 1 回目: `loadAppEnv` → `resolveConnectorSelection` を実行し、結果をキャッシュして
 *   起動ログを 1 行出す。いずれかが失敗したら **throw する**（キャッシュしない）。
 * - 2 回目以降: キャッシュをそのまま返す。**再検証も再解決もしない**（`source` を読み直さない）。
 *   ログも出さない（多重初期化を作らない）。
 *
 * 🔴 リクエストごとに呼ばれても安全だが、**リクエストごとの `APP_ENV` 分岐を書かないこと**
 *    （CLAUDE.md §11.1）。差し替えの判断はここ 1 箇所で終わっている。
 */
export function initializeRuntimeConfig(source: EnvSource, log: StartupLogger): RuntimeConfig {
  const cached = store()[RUNTIME_CONFIG_KEY];
  if (cached !== undefined) return cached;

  // 🔴 失敗したらそのまま伝播させる。ここで catch してモックに倒す経路を作らない。
  const env = loadAppEnv(source);
  const connectors = resolveConnectorSelection(env);

  const runtime: RuntimeConfig = { env, connectors };
  store()[RUNTIME_CONFIG_KEY] = runtime;
  log(formatStartupLine(runtime));
  return runtime;
}

/**
 * @internal `packages/config` 自身のユニットテスト専用。
 * 🔴 `index.ts` から re-export しない（`package.json` の `exports` も `.` と `./testing` しか
 *    公開していないため、アプリコードからは到達できない）。プロセス内のキャッシュを
 *    アプリが消せると「起動時に 1 回」の保証が崩れる。
 */
export function resetRuntimeConfigForTesting(): void {
  delete store()[RUNTIME_CONFIG_KEY];
}
