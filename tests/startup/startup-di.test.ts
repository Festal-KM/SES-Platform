// tests/startup/startup-di.test.ts
// 🔴 T-03-12 の完了判定 1〜3（docs/sprints/SP-03 §4 / §5「T-03-12 の起動経路検証」）。
//    `CLAUDE.md` §11.1 / `docs/05` §13.1 / `docs/02` 章 7.6 NFR-ENV-2〜4。
//
// 🔴 T-01-03 の関数単体テスト（`packages/config/src/*.test.ts`）との違い:
//    あちらは `loadAppEnv` / `resolveConnectorSelection` が正しく throw するかを見る。
//    **本ファイルは「呼び出し側（起動エントリ）を含む経路」を、実際に子プロセスを起動して見る。**
//    T-03-12 以前は関数単体テストが全部 green のまま、アプリはどこからも呼んでおらず、
//    `production` でモックが選ばれてもプロセスが止まらなかった（実測: 不正な env のまま
//    `next start` が 200 を返した）。その差をここで埋める。
//
// 🔴 外部 API を叩かない。起動エントリが行うのは環境変数の検証とコネクタ「種別」の決定だけであり、
//    DB・S3・メールへの接続は起こらない。
//
// 🔴 置き場所について: DB を要らないので `tests/isolation/**`（Testcontainers）には置かず、
//    `pnpm test:unit` の対象（`vitest.config.ts` の include）にしてある。**CI で毎回走る**
//    ことが要件（起動経路の担保がスキップされうる場所に無いこと）。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// 🔴 `@ses/config` をパッケージ名で import しない（ルートの package.json は依存に持たない）。
//    `tests/e2e/harness/web-server.ts` と同じ扱いで、実装のソースを相対 import する。
//    起動ログの目印は**実装から取る**（テスト側に文字列を書き写すと、実装だけ変わっても
//    テストが「1 行も出ていない」を検出できずに緑のままになる）。
import { STARTUP_LINE_PREFIX } from '../../packages/config/src/startup.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 🔴 起動エントリを読み込んで、起動時に呼ばれるのと同じ関数を呼ぶだけの実行体。 */
const RUNNER = path.join(here, 'harness', 'run-entry.ts');
/** 🔴 ワーカーの起動エントリ**そのもの**（コンテナが実行する `node dist/main.js` と同じ内容）。 */
const WORKER_ENTRY = path.join(repoRoot, 'apps', 'worker', 'src', 'main.ts');

/**
 * 🔴 子プロセスは `@ses/config` を **ビルド済みの `dist`** 経由で解決する
 *    （Node の型除去は `./foo.js` → `./foo.ts` の読み替えをしないため、`src` は実行できない）。
 *    未ビルドのまま走ると「起動に失敗した」ように見えて検証にならないので、明示的に落とす。
 *    CI は `pnpm run build` を test の前に実行している（.github/workflows/ci.yml）。
 */
const CONFIG_DIST = path.join(repoRoot, 'packages', 'config', 'dist', 'index.js');

type RunResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * 🔴 `NODE_ENV` をリテラルで持つ理由は `tests/e2e/harness/web-server.ts` と同じ:
 *    Next.js が `NodeJS.ProcessEnv` を `NODE_ENV: 'development' | 'production' | 'test'` で
 *    拡張しており（`apps/web/next-env.d.ts` 経由でこのプロジェクトにも載る）、
 *    `spawnSync` の `env` に渡す型が必須プロパティを要求するためである。
 */
type SpawnEnv = Record<string, string | undefined> & {
  NODE_ENV: 'development' | 'production' | 'test';
};

/**
 * OS が要求する最低限だけを引き継ぎ、そこに検証対象の env を重ねる
 * （開発者の `.env` 由来の値が混ざると、何を検証しているのか分からなくなる。
 * `tests/e2e/harness/web-server.ts` と同じ方針）。
 */
function spawnEnv(env: Record<string, string | undefined>): SpawnEnv {
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'production' && nodeEnv !== 'test') {
    throw new Error(`テストの env に妥当な NODE_ENV がありません: ${String(nodeEnv)}`);
  }
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ...env,
    NODE_ENV: nodeEnv,
  };
}

function run(
  entry: string,
  env: Record<string, string | undefined>,
  args: readonly string[] = [],
): RunResult {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    env: spawnEnv(env),
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function startupLinesOf(result: RunResult): string[] {
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(STARTUP_LINE_PREFIX));
}

/**
 * 🔴 web / worker の 2 経路に同じ検証をかける（片方だけ守られている状態を作らない）。
 *    worker は起動エントリ（`main.ts`）を直接実行する。web は Next.js が呼ぶ `register()` を
 *    harness 経由で呼ぶ（`register()` は export された関数であり、単体では何も起動しないため）。
 */
const ENTRIES: readonly (readonly [label: string, script: string, args: string[]])[] = [
  ['apps/web（instrumentation.ts の register）', RUNNER, ['web']],
  ['apps/worker（src/main.ts）', WORKER_ENTRY, []],
];

/** 多重初期化の確認用（1 プロセス内で 2 回初期化を試みる）。 */
const REPEAT_RUNS: readonly (readonly [label: string, args: string[]])[] = [
  ['apps/web', ['web', 'repeat']],
  ['apps/worker', ['worker', 'repeat']],
];

describe('🔴 起動時 DI の呼び出し側（T-03-12。CLAUDE.md §11.1 / docs/05 §13.1）', () => {
  it('前提: packages/config がビルド済みである（未ビルドだと検証が空振りする）', () => {
    expect(
      existsSync(CONFIG_DIST),
      `${CONFIG_DIST} がありません。先に \`pnpm run build\` を実行してください。`,
    ).toBe(true);
  });

  describe.each(ENTRIES)('%s', (_label, script, args) => {
    it('development では正常に起動し、解決結果の起動ログがプロセスにつき 1 行だけ出る', () => {
      const result = run(script, buildValidEnv('development'), args);

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);

      const lines = startupLinesOf(result);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('APP_ENV=development');
      // development の選択（docs/05 §13.1 の表）。送信系は mock、ローカル実サービスは real。
      expect(lines[0]).toContain('email=mock');
      expect(lines[0]).toContain('esign=mock');
      expect(lines[0]).toContain('objectStore=real');
    });

    it('🔴 起動ログにシークレットの値が現れない（CLAUDE.md §3.5 / docs/05 §13.4 規則 6）', () => {
      const env = buildValidEnv('development');
      const result = run(script, env, args);
      const output = `${result.stdout}${result.stderr}`;

      for (const variable of [
        'AUTH_SECRET',
        'AUTH_PLATFORM_SECRET',
        'TOKEN_ENCRYPTION_KEY',
        'ANON_REFERENCE_HMAC_SECRET',
        'WEBHOOK_PATH_SECRET',
        'DATABASE_URL',
        'PLATFORM_DATABASE_URL',
        'PLATFORM_WRITE_DATABASE_URL',
        'S3_SECRET_ACCESS_KEY',
      ]) {
        const value = env[variable];
        expect(value, `${variable} がフィクスチャに無い（対照が空振りしている）`).toBeTruthy();
        expect(output, `${variable} の値が起動ログに現れている`).not.toContain(value);
      }
    });

    it('🔴 production でモック実装が選択される env なら起動に失敗する（NFR-ENV-3）', () => {
      // production の枝はスキーマ上 mock を選べない（docs/05 §13.4 規則 1）。
      // 「モックを選ぼうとした env」で起動を試み、**プロセスが立ち上がらない**ことを見る。
      const result = run(
        script,
        buildValidEnv('production', {
          MALWARE_SCANNER: 'mock',
          ESIGN_PROVIDER_DEFAULT: 'mock',
          ESIGN_ENABLED_PROVIDERS: 'mock',
        }),
        args,
      );

      expect(result.status).not.toBe(0);
      expect(startupLinesOf(result)).toEqual([]);
      expect(result.stderr).toContain('MALWARE_SCANNER');
    });

    it('🔴 非本番に本番の API キーが設定されていたら起動に失敗する（NFR-ENV-4）', () => {
      const result = run(
        script,
        buildValidEnv('staging', { STRIPE_SECRET_KEY: 'sk_live_not_a_real_key_for_tests' }),
        args,
      );

      expect(result.status).not.toBe(0);
      expect(startupLinesOf(result)).toEqual([]);
      expect(result.stderr).toContain('STRIPE_SECRET_KEY');
      // 🔴 変数名と理由だけを出す。値（キーそのもの）は出さない。
      expect(result.stderr).not.toContain('sk_live_not_a_real_key_for_tests');
    });

    it('🔴 非本番に本番の AWS アカウント ID が設定されていたら起動に失敗する（NFR-ENV-4）', () => {
      const productionAccountId = buildValidEnv('production').AWS_ACCOUNT_ID;
      const result = run(
        script,
        buildValidEnv('demo', { AWS_ACCOUNT_ID: productionAccountId }),
        args,
      );

      expect(result.status).not.toBe(0);
      expect(startupLinesOf(result)).toEqual([]);
      expect(result.stderr).toContain('AWS_ACCOUNT_ID');
    });
  });

  describe.each(REPEAT_RUNS)(
    '%s: 2 回目以降の初期化で再検証が走らない（多重初期化を作らない）',
    (_label, args) => {
      it('起動ログは 1 行のまま。キャッシュ済みの値がそのまま返る', () => {
        // 実行体は初期化を 2 回試みたうえで、**必ず検証に落ちる source** で
        // `initializeRuntimeConfig` を呼ぶ。キャッシュが効いていれば例外にならず、
        // 1 回目に解決した APP_ENV がそのまま返る。
        const result = run(RUNNER, buildValidEnv('development'), args);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(startupLinesOf(result)).toHaveLength(1);
        expect(result.stdout).toContain('[harness] cached-app-env=development');
        expect(result.stdout).not.toContain('UNEXPECTED_SECOND_LOG');
      });
    },
  );

  it('Edge ランタイムでは検証しない（Node ランタイムの register が起動時に必ず走るため迂回にならない）', () => {
    // 🔴 意図的な仕様（`apps/web/instrumentation.ts` の JSDoc）。Edge の `process.env` は
    //    Node ランタイムと同じ内容を持たず、Edge で動く `proxy.ts` は DB もコネクタも触らない。
    //    Node ランタイムの `register()` はサーバ起動時に必ず走るので、ここを skip しても
    //    「不正な env でアプリが起動できてしまう」ことにはならない（上の 3 ケースがそれを示す）。
    const result = run(
      RUNNER,
      { ...buildValidEnv('development', { AUTH_SECRET: undefined }), NEXT_RUNTIME: 'edge' },
      ['web'],
    );

    expect(result.status).toBe(0);
    expect(startupLinesOf(result)).toEqual([]);
  });
});
