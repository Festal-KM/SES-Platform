// tests/e2e/harness/paths.ts
// E2E ハーネスが触れるリポジトリ内のパスを 1 箇所に集める。
//
// 🔴 相対パスの組み立てを各ファイルに散らさない。散らすと、ディレクトリを 1 段動かした
//    ときに「globalSetup だけが古いパスを見続ける」という静かな壊れ方をする。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** リポジトリのルート（tests/e2e/harness から 3 段上）。 */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

export const DB_PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'db');

/** Prisma CLI の実体（`node <path> migrate deploy` で呼ぶ。シェル解決に依存しない）。 */
export const PRISMA_CLI = path.join(DB_PACKAGE_DIR, 'node_modules', 'prisma', 'build', 'index.js');

/** 🔴 6 ロールの唯一の定義（docs/05 §4.2）。ローカル docker-compose と Testcontainers で共有する。 */
export const ROLES_SQL = path.join(DB_PACKAGE_DIR, 'prisma', 'sql', '000_roles.sql');

/**
 * 🔴 TLS 付きで PostgreSQL を起動する起動スクリプト。
 *    `packages/config` が `sslmode=require` を**無条件で要求する**（§13.4 規則 4）ため、
 *    E2E の DB も TLS を有効にしないとアプリが起動できない。
 *    ローカル docker-compose と同じファイルを使う（TLS の有効化手順を二重実装しない）。
 */
export const POSTGRES_SSL_ENTRYPOINT = path.join(
  REPO_ROOT,
  'docker',
  'postgres',
  'entrypoint-ssl.sh',
);

export const WEB_APP_DIR = path.join(REPO_ROOT, 'apps', 'web');

/** Next.js CLI の実体（`node <path> start` で呼ぶ。`.bin` のシェルスクリプトを避ける）。 */
export const NEXT_CLI = path.join(WEB_APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

/** 🔴 アプリのプロセスに `--import` で先読みさせる外向き通信の遮断フック。 */
export const NETWORK_GUARD = path.join(here, 'network-guard.mjs');

/** テスト実行時の生成物（サーバのログなど）。`.gitignore` の `test-results/` 配下に置く。 */
export const ARTIFACT_DIR = path.join(REPO_ROOT, 'test-results', 'e2e-harness');
