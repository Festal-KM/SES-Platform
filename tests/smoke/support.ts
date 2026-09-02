// tests/smoke/support.ts
// T-01-02: docker-compose.yml の 5 サービスへの疎通確認で使う共有ヘルパ。
//
// 🔴 新規 npm 依存 (dotenv / pg / ioredis 等) を増やさないため、Node 標準モジュールのみで
// .env 読み込み・TCP/HTTP 疎通確認・リトライを自前実装する
// （プログラマ agent は新規依存の追加をマニフェスト宣言のみに留める規約のため）。
// ルート tsconfig.json は `types: []` で ambient global を無効化しているので、
// Node の組み込み値は `node:*` の明示 import 経由で取得する（global の `process` 等には頼らない）。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * .env を最小限のパーサで読み込み、未設定の process.env にのみ反映する
 * （KEY=VALUE / # コメント / 空行 / 前後の単一・二重引用符のみ対応）。
 */
export function loadDotEnv(filePath: string = path.join(REPO_ROOT, '.env')): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function envOrDefault(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export function envIntOrDefault(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function isForceSkip(): boolean {
  return ['1', 'true'].includes(envOrDefault('SKIP_SMOKE_TESTS', '').toLowerCase());
}

/** 生ソケットで TCP 接続できるかどうかだけを確認する（プロトコルは検査しない）。 */
export function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/** Redis の RESP プロトコルで PING を送り、+PONG 応答を確認する。 */
export function redisPing(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('PONG')) finish(true);
    });
    socket.connect(port, host, () => {
      socket.write('PING\r\n');
    });
  });
}

/** clamd のシンプルコマンドプロトコル（改行終端の `n` プレフィクス）で PING を送り PONG を確認する。 */
export function clamdPing(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('PONG')) finish(true);
    });
    socket.connect(port, host, () => {
      socket.write('nPING\n');
    });
  });
}

/** HTTP GET が 2xx を返すかどうかだけを確認する（fetch を使わず node:http のみで実装）。 */
export function httpOk(url: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      resolve(status >= 200 && status < 300);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/** `probe` が true を返すまで、`timeoutMs` の予算内で `intervalMs` 間隔でリトライする。 */
export async function waitFor(
  probe: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs?: number },
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() >= deadline) return false;
    await delay(intervalMs);
  }
}

export function isDockerComposeAvailable(): boolean {
  try {
    execFileSync('docker', ['compose', 'version'], { cwd: REPO_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * `serviceNames` の全サービスが `docker compose ps` 上で `running` 状態かどうかを 1 回で判定する。
 * docker compose CLI 自体は使えるが `docker compose up -d` していない場合に、
 * 個々の疎通確認（最大 60〜600 秒のリトライ）に入る前に即座に判定するためのゲート
 * （code-reviewer 指摘 #1 の推奨事項: スタック未起動時は待たずに明示的に失敗させる）。
 */
export function isStackRunning(serviceNames: readonly string[]): boolean {
  try {
    const output = execFileSync('docker', ['compose', 'ps', '--status=running', '--services'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const running = new Set(
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
    return serviceNames.every((name) => running.has(name));
  } catch {
    return false;
  }
}

/**
 * postgres コンテナ内で psql を実行し、標準出力を返す
 * （新規 DB クライアント依存を増やさないための `docker compose exec` 経由）。
 */
export function execPsql(sql: string): string {
  const user = envOrDefault('POSTGRES_USER', 'ses');
  const db = envOrDefault('POSTGRES_DB', 'ses_platform');
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, '-tAc', sql],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
}

/** `execPsql` を「実行できるようになるまで」リトライする（コンテナ起動直後の受付待ち）。 */
export async function waitForPsql(sql: string, options: { timeoutMs: number; intervalMs?: number }): Promise<string> {
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return execPsql(sql);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    await delay(intervalMs);
  }
}
