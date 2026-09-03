// tests/isolation/support/postgres.ts
// docs/05 §17.1「結合（DB あり）: Vitest + Testcontainers（PostgreSQL）」の起動手順。
// docs/05 §17.6 globalSetup の ①コンテナ起動 ②ロールの作成 ③マイグレーション（app_migrator。
// スキーマ + RLS ポリシー + GRANT）④seed に相当する最小版。
// T-01-04（tenants / engineers の 2 表）→ T-02-01（docs/05 §3.3 の 7 表を追加。
// `prisma db push` → `prisma migrate deploy` に切り替え）→ T-02-06（RLS をマイグレーションへ移設）。
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
// 🔴 6 ロールの定義は packages/db/prisma/sql/000_roles.sql が唯一の真実（T-01-05。docs/05 §4.2。
//    app_assignment_owner_probe は T-02-08 で追加）。
//    ローカル docker-compose（docker/postgres/initdb/000-roles.sh）と同じファイルを実行する。
const ROLES_SQL_HOST_PATH = path.join(DB_PACKAGE_DIR, 'prisma', 'sql', '000_roles.sql');
const ROLES_SQL_CONTAINER_PATH = '/opt/ses/000_roles.sql';
// 🔴 T-02-06: RLS（ENABLE + FORCE / ポリシー / GRANT）は packages/db/prisma/sql/010_rls.sql を
//    廃止し、prisma/migrations/20260903050000_rls_policies/migration.sql へ移した
//    （docs/05 §2.1「RLS もマイグレーションに含む」）。したがって起動手順は
//    「①ロール → ②migrate deploy（スキーマ + RLS + GRANT）→ ③seed」の 3 段になり、
//    旧「④RLS ポリシーと GRANT」のステップは無くなった。
const SEED_SQL_CONTAINER_PATH = '/opt/ses/020_seed.sql';

// docs/03 §5.2「PostgreSQL ^17」。docker-compose.yml（T-01-02）と同じタグに揃える。
const POSTGRES_IMAGE = 'postgres:17-bookworm';
const DATABASE_NAME = 'ses_isolation';

/** 二重防御の検証で使う 2 表（docs/05 §4.7）。 */
export const BUSINESS_TABLES = ['tenants', 'engineers'] as const;

/** docs/05 §4.2 の 6 ロール。 */
export const ROLE_NAMES = [
  'app_migrator',
  'app_tenant',
  'app_platform',
  'app_platform_write',
  'app_share_probe',
  // 🔴 T-02-08: assignments ← engineers(engineer_id) の SECURITY DEFINER 継承トリガ専用
  //    （docs/05 §4.2 / §4.4.1。code-reviewer 指摘 1）。
  'app_assignment_owner_probe',
] as const;

export type IsolationDatabase = {
  /** app_tenant ロール（🔴 BYPASSRLS を持たない）。主平面のアプリ経路が使う。 */
  readonly tenantUrl: string;
  /**
   * 🔴 PostgreSQL のスーパーユーザー。**合成データの投入（`seed:isolation`）にだけ使う**。
   *    app_tenant は `tenants` に INSERT できず、テーブル所有者 app_migrator も
   *    FORCE ROW LEVEL SECURITY により適用ポリシーが 0 件で読み書きできない（docs/05 §4.2 / §4.4）。
   *    したがって母集団の投入は superuser でしか行えない。**検証のクエリには使わない**
   *    （superuser は RLS を素通りするため、テストが空振りする）。
   */
  readonly superuserUrl: string;
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
export type StartIsolationDatabaseOptions = {
  /**
   * 投入する母集団の種類。
   * - `fixtures`（既定）: `tests/isolation/support/fixtures.ts` の固定 SQL（T-02-06 / T-02-07 の最小実証）
   * - `none`: 何も投入しない。🔴 `seed:isolation`（`@ses/db/seed`）を呼ぶテストが使う
   *   （docs/05 §17.5「DB のフィクスチャは使わない。`packages/db/seed` のプリセットを使う」/ §17.6 ④）
   */
  readonly seed?: 'fixtures' | 'none';
};

export async function startIsolationDatabase(
  options: StartIsolationDatabaseOptions = {},
): Promise<IsolationDatabase> {
  const superPassword = randomBytes(24).toString('hex');
  const migratorPassword = randomBytes(24).toString('hex');
  const tenantPassword = randomBytes(24).toString('hex');
  const platformPassword = randomBytes(24).toString('hex');
  const platformWritePassword = randomBytes(24).toString('hex');

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE_NAME)
    .withUsername('postgres')
    .withPassword(superPassword)
    .withCopyFilesToContainer([{ source: ROLES_SQL_HOST_PATH, target: ROLES_SQL_CONTAINER_PATH }])
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

  // ① 6 ロールの作成（packages/db/prisma/sql/000_roles.sql を唯一の定義として適用する。
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
  //    🔴 T-02-01（docs/05 §4.2「マイグレーションのみ（CI / デプロイ）」）から `prisma migrate deploy`
  //    に切り替えた（T-01-04 は `db push` だった）。適用する内容は
  //    `packages/db/prisma/migrations/**/migration.sql` を唯一の真実とする
  //    （`migrate deploy` は shadow database を使わず、migration.sql をそのまま適用するだけの
  //    コマンドのため、schema.prisma との突き合わせが起きない。列挙相当フィールドを
  //    Prisma の `enum` にしなかった理由は schema.prisma 冒頭コメント参照）。
  //    🔴 T-02-06 以降、この 1 コマンドで RLS の ENABLE + FORCE・ポリシー C0〜C8・GRANT まで
  //    適用される（20260903050000_rls_policies）。ロールが実在することが前提のため ① の後に置く。
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: migratorUrl },
    stdio: 'pipe',
  });

  // ③ seed。superuser で投入する（app_tenant は tenants に INSERT 権限を持たない。
  //    superuser は RLS を素通りするため、C0〜C8 のポリシー適用後も投入できる）。
  //    🔴 `seed: 'none'` のときは投入しない（呼び出し側が `seed:isolation` を実行する）。
  if ((options.seed ?? 'fixtures') === 'fixtures') {
    await container.copyContentToContainer([
      { content: SEED_SQL, target: SEED_SQL_CONTAINER_PATH },
    ]);
    await execOrThrow(container, psql(SEED_SQL_CONTAINER_PATH), 'シードの投入');
  }

  return {
    tenantUrl: connectionUrl({ user: 'app_tenant', password: tenantPassword, host, port, connectionLimit: 5 }),
    superuserUrl: connectionUrl({
      user: 'postgres',
      password: superPassword,
      host,
      port,
      connectionLimit: 1,
    }),
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
