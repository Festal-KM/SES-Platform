// tests/startup/harness/run-entry.ts
// 🔴 T-03-12 の起動経路テスト（`tests/startup/startup-di.test.ts`）が子プロセスで実行する薄い実行体。
//
// やることは 1 つだけ ——「アプリの起動エントリを読み込んで、起動時に呼ばれるのと同じ関数を呼ぶ」。
// 🔴 **アプリの実装をここに複製しない。** 複製すると、起動エントリから呼び出しが消えても
//    この harness だけが緑になる（T-03-12 が塞いだ穴がそのまま再発する）。
//
// 🔴 1 ファイルにまとめてある理由: Node の型除去（`.ts` の直接実行）は `./foo.js` を
//    `./foo.ts` に読み替えないため、harness 同士の相対 import が実行時に解決できない。
//    共通処理を別ファイルに切り出すと、テスト専用に import 拡張子の設定を緩めることになる。
//
// 引数: `<target> [mode]`
//   target: `web`（`apps/web/instrumentation.ts` の `register()`）
//         / `worker`（`apps/worker/src/main.ts`。import 時点で起動する）
//   mode:   `boot`（既定。1 回だけ起動する）
//         / `repeat`（2 回目の初期化を試み、キャッシュが効いていることを確認する）
import process from 'node:process';

/** `apps/web/instrumentation.ts` の公開形（Next.js が期待する契約）。 */
type WebInstrumentation = {
  readonly register: () => void | Promise<void>;
};

/** `apps/worker/src/main.ts` の公開形。 */
type WorkerMain = {
  readonly bootstrapWorker: () => { readonly env: { readonly APP_ENV: string } };
};

/** `@ses/config` のうち、この harness が使う部分だけの最小の形。 */
type ConfigModule = {
  readonly initializeRuntimeConfig: (
    source: Readonly<Record<string, string | undefined>>,
    log: (line: string) => void,
  ) => { readonly env: { readonly APP_ENV: string } };
};

/**
 * 🔴 動的 import + 計算した URL を使う理由:
 *    `apps/web/instrumentation.ts` は Next.js（bundler 解決）の一部であり、
 *    `packages/config/dist/**` はビルド成果物である。どちらも `tests/**` から静的 import すると
 *    型解決の方式やビルド順に縛られる。ここで必要なのは**実行時の解決だけ**である。
 */
async function load<T>(relativePath: string): Promise<T> {
  return (await import(new URL(relativePath, import.meta.url).href)) as unknown as T;
}

const target = process.argv[2] ?? '';
const mode = process.argv[3] ?? 'boot';

if (target === 'web') {
  // Next.js が起動時に呼ぶのと同じ呼び出し。検証に失敗すればここでプロセスが終了する。
  const instrumentation = await load<WebInstrumentation>('../../../apps/web/instrumentation.ts');
  await instrumentation.register();
  if (mode === 'repeat') await instrumentation.register();
} else if (target === 'worker') {
  // `main.ts` は末尾で `bootstrapWorker()` を呼ぶ（= `node dist/main.js` と同じ挙動）。
  const main = await load<WorkerMain>('../../../apps/worker/src/main.ts');
  if (mode === 'repeat') main.bootstrapWorker();
} else {
  process.stderr.write(`[harness] unknown target: ${target}\n`);
  process.exit(2);
}

if (mode === 'repeat') {
  // 🔴 「2 回目以降の呼び出しで再解決・再検証が走らない」ことの確認（T-03-12 の実装要件）。
  //    **必ず検証に落ちる source** を渡す。キャッシュが効いていれば例外にならず、
  //    1 回目に解決した値がそのまま返る。再検証していれば異常終了する（= テストが落ちる）。
  const config = await load<ConfigModule>('../../../packages/config/dist/index.js');
  const cached = config.initializeRuntimeConfig({ APP_ENV: 'invalid-on-purpose' }, () => {
    // ここが呼ばれる = 2 回目以降もログを出している（多重初期化）。目印を残す。
    process.stdout.write('[harness] UNEXPECTED_SECOND_LOG\n');
  });
  process.stdout.write(`[harness] cached-app-env=${cached.env.APP_ENV}\n`);
}

export {};
