// tests/smoke/docker-services.test.ts
// T-01-02 (docs/sprints/SP-01-bootstrap.md): `docker compose up -d` 後の
// PostgreSQL / Redis / MinIO / MailHog / ClamAV への疎通スモークテスト。
//
// 実行: `pnpm test:smoke`（専用設定 vitest.smoke.config.ts 経由。事前に `docker compose up -d`
// すること）。既定の `pnpm test:unit`（vitest.config.ts）はこのファイルを収集しないため、
// CI が Docker 依存になることはない（本ファイル自体は Docker の有無に関わらず CI からは実行されない）。
// このファイルを直接 `pnpm test:smoke` で実行する環境向けに、Docker CLI が使えない場合は
// 自動的にスキップする。判定は SKIP_SMOKE_TESTS=1 の明示指定、または docker compose CLI が
// 使えないことで行う。CLI は使えるがスタックが起動していない場合は、待たずに即座に失敗させる
// （下記 beforeAll。個々のサービス疎通は waitFor で起動待ちを許容したうえで、それでも届かなければ失敗）。
import process from 'node:process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clamdPing,
  envIntOrDefault,
  envOrDefault,
  httpOk,
  isDockerComposeAvailable,
  isForceSkip,
  isStackRunning,
  loadDotEnv,
  redisPing,
  tcpProbe,
  waitFor,
  waitForPsql,
} from './support.js';

loadDotEnv();

const SKIP = isForceSkip() || !isDockerComposeAvailable();

const EXPECTED_SERVICES = ['postgres', 'redis', 'minio', 'mailhog', 'clamav'] as const;

const POSTGRES_HOST = envOrDefault('POSTGRES_HOST', 'localhost');
const POSTGRES_PORT = envIntOrDefault('POSTGRES_PORT', 5432);

const REDIS_HOST = envOrDefault('REDIS_HOST', 'localhost');
const REDIS_PORT = envIntOrDefault('REDIS_PORT', 6379);

const MINIO_HOST = envOrDefault('MINIO_HOST', 'localhost');
const MINIO_API_PORT = envIntOrDefault('MINIO_API_PORT', 9000);

const MAILHOG_HOST = envOrDefault('MAILHOG_HOST', 'localhost');
const MAILHOG_WEB_PORT = envIntOrDefault('MAILHOG_WEB_PORT', 8025);
const MAILHOG_SMTP_PORT = envIntOrDefault('MAILHOG_SMTP_PORT', 1025);

const CLAMAV_HOST = envOrDefault('CLAMAV_HOST', 'localhost');
const CLAMAV_PORT = envIntOrDefault('CLAMAV_PORT', 3310);

// ClamAV は初回起動時にウイルス定義 DB をダウンロードするため、他サービスより
// 大幅に長い起動待ちを許容する（SP-01 T-01-02 実装ガイド）。
const DEFAULT_TIMEOUT_MS = 60_000;
const CLAMAV_TIMEOUT_MS = 600_000;

describe.skipIf(SKIP)('docker-compose 開発コンテナの疎通（T-01-02）', () => {
  beforeAll(() => {
    if (!isStackRunning(EXPECTED_SERVICES)) {
      throw new Error(
        'docker-compose のスタックが起動していません。`docker compose up -d` を実行してから ' +
          '`pnpm test:smoke` を再実行してください（起動待ちのタイムアウトで判定せず、ここで即座に失敗させています）。',
      );
    }
  });

  it(
    'PostgreSQL: TCP 疎通',
    async () => {
      const reachable = await waitFor(() => tcpProbe(POSTGRES_HOST, POSTGRES_PORT), {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      expect(reachable).toBe(true);
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'PostgreSQL: pg_trgm 拡張が有効（完了判定。docs/03 §3.7.2）',
    async () => {
      const output = await waitForPsql('SELECT extname FROM pg_extension ORDER BY extname;', {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      const extensions = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      expect(extensions).toContain('pg_trgm');
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'PostgreSQL: pg_bigm は利用可能なら有効化される（docs/03 §3.7.2。未搭載でもテストは失敗させない）',
    async () => {
      const output = await waitForPsql('SELECT extname FROM pg_extension ORDER BY extname;', {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      const extensions = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const availableOutput = await waitForPsql(
        "SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm';",
        { timeoutMs: DEFAULT_TIMEOUT_MS, intervalMs: 2000 },
      );
      const isInstallable = availableOutput.trim() === '1';
      if (isInstallable) {
        expect(extensions).toContain('pg_bigm');
      } else {
        // docs/03 §3.7.2 (決定済み 2026-09-02): 公式 postgres イメージには同梱されないため
        // ローカルでは未搭載が既定。RDS/Aurora では利用可能なことを確認済み。
        expect(extensions).not.toContain('pg_bigm');
      }
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'Redis: PING → PONG',
    async () => {
      const ok = await waitFor(() => redisPing(REDIS_HOST, REDIS_PORT), {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      expect(ok).toBe(true);
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'MinIO: /minio/health/live が 200',
    async () => {
      const ok = await waitFor(() => httpOk(`http://${MINIO_HOST}:${MINIO_API_PORT}/minio/health/live`), {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      expect(ok).toBe(true);
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'MailHog: Web UI (API) が 200',
    async () => {
      const ok = await waitFor(() => httpOk(`http://${MAILHOG_HOST}:${MAILHOG_WEB_PORT}/api/v2/messages`), {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      expect(ok).toBe(true);
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'MailHog: SMTP (1025) TCP 疎通',
    async () => {
      const reachable = await waitFor(() => tcpProbe(MAILHOG_HOST, MAILHOG_SMTP_PORT), {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        intervalMs: 2000,
      });
      expect(reachable).toBe(true);
    },
    DEFAULT_TIMEOUT_MS + 10_000,
  );

  it(
    'ClamAV: clamd PING → PONG（初回はウイルス定義 DB ダウンロードで数分かかることを許容する）',
    async () => {
      const ok = await waitFor(() => clamdPing(CLAMAV_HOST, CLAMAV_PORT), {
        timeoutMs: CLAMAV_TIMEOUT_MS,
        intervalMs: 5000,
      });
      expect(ok).toBe(true);
    },
    CLAMAV_TIMEOUT_MS + 10_000,
  );
});

describe('docker-compose スモークテストのスキップ挙動（CI でも壊れない構造であることの検証）', () => {
  it('SKIP_SMOKE_TESTS=1 が真として解釈される', () => {
    const previous = process.env.SKIP_SMOKE_TESTS;
    process.env.SKIP_SMOKE_TESTS = '1';
    try {
      expect(isForceSkip()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.SKIP_SMOKE_TESTS;
      else process.env.SKIP_SMOKE_TESTS = previous;
    }
  });

  it('docker compose CLI が PATH に無い場合は isDockerComposeAvailable() が false を返す', () => {
    // PATH を空にして `docker` コマンド自体を解決不能にし、実際に false へ倒れることを確認する
    // （このマシンの Docker Desktop の有無に依存しない実効テスト。呼び出しは execFileSync 経由
    // なので PATH を空にするだけで ENOENT になる。テスト後は必ず元の PATH に戻す）。
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(isDockerComposeAvailable()).toBe(false);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});
