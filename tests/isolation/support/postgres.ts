// tests/isolation/support/postgres.ts
// docs/05 §17.1「結合（DB あり）: Vitest + Testcontainers（PostgreSQL）」の起動手順。
// docs/05 §17.6 globalSetup の ①コンテナ起動 ②マイグレーション（app_migrator）
// ③ロールと GRANT の適用 ④seed に相当する最小版（T-01-04 の 2 表ぶん）。
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
const RLS_SQL_HOST_PATH = path.join(DB_PACKAGE_DIR, 'prisma', 'sql', '010_rls.sql');
const RLS_SQL_CONTAINER_PATH = '/opt/ses/010_rls.sql';
const SEED_SQL_CONTAINER_PATH = '/opt/ses/020_seed.sql';

// docs/03 §5.2「PostgreSQL ^17」。docker-compose.yml（T-01-02）と同じタグに揃える。
const POSTGRES_IMAGE = 'postgres:17-bookworm';
const DATABASE_NAME = 'ses_isolation';

/** 二重防御の検証で使う 2 表（docs/05 §4.7）。 */
export const BUSINESS_TABLES = ['tenants', 'engineers'] as const;

export type IsolationDatabase = {
  /** app_tenant ロール（🔴 BYPASSRLS を持たない）。主平面のアプリ経路が使う。 */
  readonly tenantUrl: string;
  /** 接続を 1 本に固定した app_tenant。SET LOCAL がトランザクション外へ漏れないことの検証に使う。 */
  readonly singleConnectionTenantUrl: string;
  /** app_migrator ロール（テーブル所有者）。RLS の一時 DISABLE にのみ使う。 */
  readonly migratorUrl: string;
  readonly stop: () => Promise<void>;
};

function buildRolesSql(migratorPassword: string, tenantPassword: string): string {
  // 🔴 CREATE ROLE は T-01-05（docs/05 §4.2 の 5 ロール）の範囲。ここは二重防御の検証に
  //    必要な 2 ロールだけを、テストコンテナの初期化スクリプトとして作る。
  //    本番のロール設計・パスワード管理を先取りしない。
  return [
    `CREATE ROLE app_migrator LOGIN PASSWORD '${migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;`,
    `CREATE ROLE app_tenant LOGIN PASSWORD '${tenantPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;`,
    // public スキーマの所有者を app_migrator にする（PostgreSQL 15 以降は既定で
    // PUBLIC に CREATE 権限が無いため、これが無いとマイグレーションがテーブルを作れない）。
    'ALTER SCHEMA public OWNER TO app_migrator;',
    'GRANT USAGE ON SCHEMA public TO app_tenant;',
    '',
  ].join('\n');
}

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

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE_NAME)
    .withUsername('postgres')
    .withPassword(superPassword)
    .withCopyContentToContainer([
      {
        content: buildRolesSql(migratorPassword, tenantPassword),
        target: '/docker-entrypoint-initdb.d/000_roles.sql',
      },
    ])
    .withCopyFilesToContainer([
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

  // ② スキーマの適用。🔴 app_migrator で実行するため、テーブル所有者は app_migrator になる
  //    （docs/05 §4.2。所有者と実行時ロールを分けないと FORCE ROW LEVEL SECURITY が意味を持たない）。
  //    Prisma のマイグレーション本体は SP-02 / T-01-05 で作る。ここでは schema.prisma を唯一の
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
    stop: async () => {
      await container.stop();
    },
  };
}
