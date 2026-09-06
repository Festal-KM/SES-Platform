// tests/e2e/harness/web-server.ts
// docs/05 §17.6 globalSetup の ⑤「`APP_ENV=development` でアプリを起動」⑥「外向きネットワークの
// 遮断を確認」。
//
// 🔴 環境変数は `@ses/config/testing` の `buildValidEnv('development')` を土台にする。
//    「妥当な env の組み立て方」を E2E 用に書き直さない（`packages/config/src/testing/fixtures.ts`
//    冒頭の意図。docs/05 §13.2 と同じ発想）。上書きするのは**この実行でしか決まらない値**
//    （DB の接続文字列と `APP_URL`）だけである。
// 🔴 `APP_ENV` を `development` 以外にしない。全コネクタがモックに解決される唯一の環境であり、
//    E2E はここでしか回さない（`CLAUDE.md` §11 / docs/03 §4.17）。
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
// 🔴 `@ses/config/testing` をパッケージ名で import しない: ルートの `package.json` は
//    `@ses/config` を依存に持たず（テストが必要とするのはこの 1 関数だけ）、そのためだけに
//    ワークスペースの依存関係を増やしたくない。**実装は同じファイル**であり、
//    `tests/isolation/**` が `apps/web/lib/**` を相対 import しているのと同じ扱いである。
import { buildValidEnv } from '../../../packages/config/src/testing/fixtures.js';
import { E2E_BASE_URL, E2E_HOST, E2E_PORT } from './endpoint.js';
import type { E2eObjectStorage } from './object-storage.js';
import { ARTIFACT_DIR, NETWORK_GUARD, NEXT_CLI, WEB_APP_DIR } from './paths.js';
import type { E2eDatabase } from './postgres.js';

const READY_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * `spawn` に渡す環境変数。
 * 🔴 `NODE_ENV` を必須かつリテラルにするのは、Next.js が `NodeJS.ProcessEnv` を
 *    `NODE_ENV: 'development' | 'production' | 'test'` で拡張しているため
 *    （`apps/web/next-env.d.ts` 経由でこのプロジェクトにも載る）。
 */
type EnvRecord = Record<string, string | undefined> & { NODE_ENV: 'production' };

export type WebServer = {
  readonly baseUrl: string;
  readonly pid: number | undefined;
  readonly logPath: string;
  readonly stop: () => Promise<void>;
};

function buildEnv(
  database: E2eDatabase,
  objectStorage: E2eObjectStorage,
  guardMarker: string,
): EnvRecord {
  const base = buildValidEnv('development', {
    APP_URL: E2E_BASE_URL,
    DATABASE_URL: database.tenantUrl,
    PLATFORM_DATABASE_URL: database.platformUrl,
    PLATFORM_WRITE_DATABASE_URL: database.platformWriteUrl,
    // 🔴 `next start` は本番モードのビルドを配信する。`APP_ENV` は `development` のまま
    //    （`NODE_ENV` と `APP_ENV` は別物であり、`packages/config` も両者を結び付けていない）。
    NODE_ENV: 'production',
    // 🔴 T-05-10（K-7）: `objectStore` は development で `real`（`connector-selection.ts`
    //    `developmentSelection()`）であり、モックにフォールバックしない（`CLAUDE.md` §11.1）。
    //    `docker-compose.yml` 既定の固定ポート（9000）ではなく、`harness/object-storage.ts` が
    //    起動した E2E 専用の使い捨て MinIO インスタンスを指す（`docker compose up -d` の実行を
    //    前提にしない。PostgreSQL と同じ方針）。
    S3_ENDPOINT: objectStorage.endpoint,
    S3_ACCESS_KEY_ID: objectStorage.accessKeyId,
    S3_SECRET_ACCESS_KEY: objectStorage.secretAccessKey,
    S3_BUCKET: objectStorage.bucket,
    S3_REGION: objectStorage.region,
    S3_FORCE_PATH_STYLE: 'true',
  });

  return {
    // 🔴 `next start` は本番モードのビルドを配信する（`buildValidEnv` の上書きと同値）。
    //    @types/node の `ProcessEnv` が `NODE_ENV` を必須にしているため明示する。
    NODE_ENV: 'production',
    // 🔴 親プロセスの環境を丸ごと引き継がない（開発者の `.env` 由来の値が混ざると、
    //    何を検証しているのか分からなくなる）。OS が要求する最低限だけを引き継ぐ。
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ...base,
    PORT: String(E2E_PORT),
    HOSTNAME: E2E_HOST,
    SES_E2E_GUARD_MARKER: guardMarker,
    // 🔴 外向き通信の遮断フックをアプリコードより先に読み込ませる。
    //    `pathToFileURL` により、リポジトリのパスに空白があっても NODE_OPTIONS が壊れない。
    NODE_OPTIONS: `--import ${pathToFileURL(NETWORK_GUARD).href}`,
  };
}

/** `.next` のビルド。CI は `pnpm run build` 済みのため `SES_E2E_SKIP_BUILD=1` で省く。 */
function buildWebApp(): void {
  if (process.env.SES_E2E_SKIP_BUILD === '1') return;
  execFileSync(process.execPath, [NEXT_CLI, 'build'], {
    cwd: WEB_APP_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  onTimeout: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(onTimeout());
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function isServing(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/signin`, { redirect: 'manual' });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * アプリを起動し、**外向き通信の遮断が有効であること**を確認してから返す。
 *
 * 🔴 遮断の確認は「フックが自己診断に成功して出力した目印を受け取る」ことで行う。
 *    目印は起動のたびに生成した値であり、古いプロセスの出力と取り違えない。
 * 🔴 疎通確認より**先に**遮断を確認する。順序を逆にすると、遮断が効いていない状態で
 *    テストが走り始める窓ができる。
 */
export async function startWebServer(
  database: E2eDatabase,
  objectStorage: E2eObjectStorage,
): Promise<WebServer> {
  buildWebApp();

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const logPath = path.join(ARTIFACT_DIR, 'web-server.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });

  const guardMarker = `[e2e-network-guard] ready ${randomUUID()}`;
  const child = spawn(
    process.execPath,
    [NEXT_CLI, 'start', '--hostname', E2E_HOST, '--port', String(E2E_PORT)],
    // `stdio` は既定の `'pipe'`（明示すると `spawn` のオーバーロードが一意に決まらない）。
    { cwd: WEB_APP_DIR, env: buildEnv(database, objectStorage, guardMarker) },
  );

  let output = '';
  let hasExited = false;
  const capture = (chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    output += text;
    logStream.write(text);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.on('exit', () => {
    hasExited = true;
  });

  const fail = (reason: string): string =>
    `${reason}\n--- アプリの出力 (${logPath}) ---\n${output.slice(-4000)}`;

  try {
    // ⑥ 外向きネットワークの遮断（docs/05 §17.6 / §17.4）。
    await waitFor(
      () => {
        if (hasExited) throw new Error(fail('アプリのプロセスが起動直後に終了しました。'));
        return output.includes(guardMarker);
      },
      READY_TIMEOUT_MS,
      () => fail('外向きネットワークの遮断が確認できませんでした（遮断フックの目印が来ません）。'),
    );

    await waitFor(
      async () => {
        if (hasExited) throw new Error(fail('アプリのプロセスが終了しました。'));
        return isServing(E2E_BASE_URL);
      },
      READY_TIMEOUT_MS,
      () => fail(`アプリが ${E2E_BASE_URL} で応答しません。`),
    );
  } catch (error) {
    child.kill('SIGKILL');
    logStream.end();
    throw error;
  }

  return {
    baseUrl: E2E_BASE_URL,
    pid: child.pid,
    logPath,
    stop: async () => {
      if (!hasExited) {
        child.kill();
        await waitFor(
          () => hasExited,
          SHUTDOWN_TIMEOUT_MS,
          () => 'stop-timeout',
        ).catch(() => {
          child.kill('SIGKILL');
        });
      }
      logStream.end();
    },
  };
}
