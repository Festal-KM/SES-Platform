// tests/e2e/harness/postgres.ts
// docs/05 §17.6 globalSetup の ①コンテナ起動 ②ロールの作成（`000_roles.sql`）
// ③マイグレーション（`app_migrator`。スキーマ + RLS + `GRANT`）に相当する部分。
//
// 🔴 `tests/isolation/support/postgres.ts` を流用**できない**理由（T-03-11 の申し送り 1）:
//    あちらは `sslmode=disable` で接続文字列を組み立てる。E2E は**アプリ本体を起動する**ため、
//    `packages/config` の起動時検証（§13.4 規則 4「`sslmode=require` を含めること」）を通らなければ
//    ならない。したがって E2E の PostgreSQL は **TLS を有効にして起動する**必要がある。
//    TLS の有効化手順はローカル docker-compose と同じ `docker/postgres/entrypoint-ssl.sh` を使い、
//    二重実装しない。
//
// 🔴 ロールのパスワードはリポジトリに置かない（`CLAUDE.md` §3.5）。起動のたびに生成し、
//    そのプロセス内でだけ使う。コンテナはランダムポートで 127.0.0.1 にのみ公開される。
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DB_PACKAGE_DIR, POSTGRES_SSL_ENTRYPOINT, PRISMA_CLI, ROLES_SQL } from './paths.js';

// docs/03 §5.2「PostgreSQL ^17」。docker-compose.yml / tests/isolation と同じタグに揃える。
const POSTGRES_IMAGE = 'postgres:17-bookworm';
const DATABASE_NAME = 'ses_e2e';

const ROLES_SQL_CONTAINER_PATH = '/opt/ses/000_roles.sql';
const SSL_ENTRYPOINT_CONTAINER_PATH = '/docker-entrypoint-ssl.sh';

export type E2eDatabase = {
  /** `app_tenant`（主平面。🔴 `BYPASSRLS` を持たない）。 */
  readonly tenantUrl: string;
  /** `app_platform`（管理平面の読み取り専用）。 */
  readonly platformUrl: string;
  /** `app_platform_write`（管理平面の書き込み）。 */
  readonly platformWriteUrl: string;
  /**
   * 🔴 PostgreSQL のスーパーユーザー。**合成データの投入（`seed:isolation`）にだけ使う**。
   *    アプリには渡さない（渡すと分離を素通りする接続をアプリが持つことになる）。
   */
  readonly seedUrl: string;
  readonly stop: () => Promise<void>;
};

function connectionUrl(options: {
  readonly user: string;
  readonly password: string;
  readonly host: string;
  readonly port: number;
  readonly connectionLimit?: number;
}): string {
  // 🔴 `sslmode=require` は必須（`packages/config` の起動時検証）。自己署名証明書のため
  //    検証は行わない（`require` は暗号化のみを要求する。docker-compose と同じ扱い）。
  const params = ['sslmode=require'];
  if (options.connectionLimit !== undefined) {
    params.push(`connection_limit=${options.connectionLimit}`);
  }
  return `postgresql://${options.user}:${options.password}@${options.host}:${options.port}/${DATABASE_NAME}?${params.join('&')}`;
}

async function execOrThrow(
  container: StartedPostgreSqlContainer,
  command: readonly string[],
  label: string,
): Promise<void> {
  const result = await container.exec([...command]);
  if (result.exitCode !== 0) {
    throw new Error(`${label} に失敗しました (exit ${result.exitCode}):\n${result.output}`);
  }
}

/**
 * PostgreSQL コンテナを TLS 付きで起動し、ロール・スキーマ・RLS・`GRANT` を適用する。
 * 🔴 シードは投入しない（`globalSetup` が `@ses/db/seed` の `runSeed` で行う。
 *    docs/05 §17.5「DB のフィクスチャは使わない。`packages/db/seed` のプリセットを使う」）。
 */
export async function startE2eDatabase(): Promise<E2eDatabase> {
  const superPassword = randomBytes(24).toString('hex');
  const migratorPassword = randomBytes(24).toString('hex');
  const tenantPassword = randomBytes(24).toString('hex');
  const platformPassword = randomBytes(24).toString('hex');
  const platformWritePassword = randomBytes(24).toString('hex');

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE_NAME)
    .withUsername('postgres')
    .withPassword(superPassword)
    // 🔴 TLS を有効にした起動スクリプトへ差し替える（docker-compose.yml と同じ）。
    .withEntrypoint(['bash', SSL_ENTRYPOINT_CONTAINER_PATH])
    .withCopyFilesToContainer([
      { source: POSTGRES_SSL_ENTRYPOINT, target: SSL_ENTRYPOINT_CONTAINER_PATH, mode: 0o755 },
      { source: ROLES_SQL, target: ROLES_SQL_CONTAINER_PATH },
    ])
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const migratorUrl = connectionUrl({
    user: 'app_migrator',
    password: migratorPassword,
    host,
    port,
    connectionLimit: 1,
  });

  // ① ロール（`packages/db/prisma/sql/000_roles.sql` が唯一の定義。docs/05 §4.2）。
  await execOrThrow(
    container,
    [
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      DATABASE_NAME,
      '-v',
      `app_migrator_password=${migratorPassword}`,
      '-v',
      `app_tenant_password=${tenantPassword}`,
      '-v',
      `app_platform_password=${platformPassword}`,
      '-v',
      `app_platform_write_password=${platformWritePassword}`,
      '-f',
      ROLES_SQL_CONTAINER_PATH,
    ],
    'ロールの作成',
  );

  // ② スキーマ + RLS + GRANT。🔴 `app_migrator` で実行する（テーブル所有者と実行時ロールを
  //    分けないと FORCE ROW LEVEL SECURITY が意味を持たない。docs/05 §4.2）。
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: migratorUrl },
    stdio: 'pipe',
  });

  return {
    tenantUrl: connectionUrl({
      user: 'app_tenant',
      password: tenantPassword,
      host,
      port,
      connectionLimit: 10,
    }),
    platformUrl: connectionUrl({
      user: 'app_platform',
      password: platformPassword,
      host,
      port,
      connectionLimit: 5,
    }),
    platformWriteUrl: connectionUrl({
      user: 'app_platform_write',
      password: platformWritePassword,
      host,
      port,
      connectionLimit: 5,
    }),
    seedUrl: connectionUrl({
      user: 'postgres',
      password: superPassword,
      host,
      port,
      connectionLimit: 1,
    }),
    stop: async () => {
      await container.stop();
    },
  };
}
