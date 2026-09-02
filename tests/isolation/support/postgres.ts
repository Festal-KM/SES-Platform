// tests/isolation/support/postgres.ts
// docs/05 §17.1「結合（DB あり）: Vitest + Testcontainers（PostgreSQL）」の起動手順。
// docs/05 §17.6 globalSetup の ①コンテナ起動 ②ロールと GRANT の適用 ③マイグレーション
// （app_migrator）④RLS ポリシーと GRANT ⑤seed に相当する最小版（T-01-04 の 2 表ぶん）。
//
// 🔴 ロールのパスワードはリポジトリに置かない（CLAUDE.md §3.5）。起動のたびに生成し、
//    そのプロセス内でだけ使う。コンテナはランダムポートで localhost にのみ公開される。
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { SEED_SQL } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

const DB_PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'db');
const PRISMA_CLI = path.join(DB_PACKAGE_DIR, 'node_modules', 'prisma', 'build', 'index.js');
// 🔴 5 ロールの定義は packages/db/prisma/sql/000_roles.sql が唯一の真実（T-01-05。docs/05 §4.2）。
//    ローカル docker-compose（docker/postgres/initdb/000-roles.sh）と同じファイルを実行する。
const ROLES_SQL_HOST_PATH = path.join(DB_PACKAGE_DIR, 'prisma', 'sql', '000_roles.sql');
const ROLES_SQL_CONTAINER_PATH = '/opt/ses/000_roles.sql';
const RLS_SQL_HOST_PATH = path.join(DB_PACKAGE_DIR, 'prisma', 'sql', '010_rls.sql');
const RLS_SQL_CONTAINER_PATH = '/opt/ses/010_rls.sql';
const SEED_SQL_CONTAINER_PATH = '/opt/ses/020_seed.sql';

// docs/03 §5.2「PostgreSQL ^17」。docker-compose.yml（T-01-02）と同じタグに揃える。
const POSTGRES_IMAGE = 'postgres:17-bookworm';
const DATABASE_NAME = 'ses_isolation';

/** 二重防御の検証で使う 2 表（docs/05 §4.7）。 */
export const BUSINESS_TABLES = ['tenants', 'engineers'] as const;

/** docs/05 §4.2 の 5 ロール。 */
export const ROLE_NAMES = [
  'app_migrator',
  'app_tenant',
  'app_platform',
  'app_platform_write',
  'app_share_probe',
] as const;

export type IsolationDatabase = {
  /** app_tenant ロール（🔴 BYPASSRLS を持たない）。主平面のアプリ経路が使う。 */
  readonly tenantUrl: string;
  /** 接続を 1 本に固定した app_tenant。SET LOCAL がトランザクション外へ漏れないことの検証に使う。 */
  readonly singleConnectionTenantUrl: string;
  /** app_migrator ロール（テーブル所有者）。RLS の一時 DISABLE にのみ使う。 */
  readonly migratorUrl: string;
  /** app_platform ロール（管理平面の読み取り専用。docs/05 §4.2 / §5.2）。ログイン確認にのみ使う。 */
  readonly platformUrl: string;
  /** app_platform_write ロール（docs/05 §4.2 / §5.2）。ログイン確認にのみ使う。 */
  readonly platformWriteUrl: string;
  readonly stop: () => Promise<void>;
};

function connectionUrl(options: {
  user: string;
  password: string;
  host: string;
  port: number;
  connectionLimit?: number;
}): string {
  const params = ['sslmode=disable'];
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

function psql(file: string): string[] {
  return ['psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DATABASE_NAME, '-f', file];
}

/**
 * PostgreSQL コンテナを起動し、スキーマ・RLS・シードを適用して接続文字列を返す。
 * 🔴 ホストの 5432 は使わない（Testcontainers がランダムポートを割り当てる）。
 */
export async function startIsolationDatabase(): Promise<IsolationDatabase> {
  const superPassword = randomBytes(24).toString('hex');
  const migratorPassword = randomBytes(24).toString('hex');
  const tenantPassword = randomBytes(24).toString('hex');
  const platformPassword = randomBytes(24).toString('hex');
  const platformWritePassword = randomBytes(24).toString('hex');

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE_NAME)
    .withUsername('postgres')
    .withPassword(superPassword)
    .withCopyFilesToContainer([
      { source: ROLES_SQL_HOST_PATH, target: ROLES_SQL_CONTAINER_PATH },
      { source: RLS_SQL_HOST_PATH, target: RLS_SQL_CONTAINER_PATH },
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

  // ① 5 ロールの作成（packages/db/prisma/sql/000_roles.sql を唯一の定義として適用する。
  //    ローカル docker-compose の docker/postgres/initdb/000-roles.sh と同じファイル）。
  //    パスワードはこのプロセス内で生成した値を psql の -v 変数として渡す（CLAUDE.md §3.5）。
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

  // ② スキーマの適用。🔴 app_migrator で実行するため、テーブル所有者は app_migrator になる
  //    （docs/05 §4.2。所有者と実行時ロールを分けないと FORCE ROW LEVEL SECURITY が意味を持たない）。
  //    Prisma のマイグレーション本体は SP-02 で作る。ここでは schema.prisma を唯一の
  //    真実として db push し、手書き DDL との乖離が起きない形にする。
  execFileSync(
    process.execPath,
    [PRISMA_CLI, 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: DB_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: migratorUrl },
      stdio: 'pipe',
    },
  );

  // ③ RLS ポリシーと GRANT（packages/db/prisma/sql/010_rls.sql を唯一の定義として適用する）
  await execOrThrow(container, psql(RLS_SQL_CONTAINER_PATH), 'RLS ポリシーの適用');

  // ④ seed。superuser で投入する（app_tenant は tenants に INSERT 権限を持たない）。
  await container.copyContentToContainer([
    { content: SEED_SQL, target: SEED_SQL_CONTAINER_PATH },
  ]);
  await execOrThrow(container, psql(SEED_SQL_CONTAINER_PATH), 'シードの投入');

  return {
    tenantUrl: connectionUrl({ user: 'app_tenant', password: tenantPassword, host, port, connectionLimit: 5 }),
    singleConnectionTenantUrl: connectionUrl({
      user: 'app_tenant',
      password: tenantPassword,
      host,
      port,
      connectionLimit: 1,
    }),
    migratorUrl,
    platformUrl: connectionUrl({ user: 'app_platform', password: platformPassword, host, port, connectionLimit: 1 }),
    platformWriteUrl: connectionUrl({
      user: 'app_platform_write',
      password: platformWritePassword,
      host,
      port,
      connectionLimit: 1,
    }),
    stop: async () => {
      await container.stop();
    },
  };
}
