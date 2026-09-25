#!/usr/bin/env node
/**
 * scripts/railway-predeploy.mjs
 *
 * Railway の `deploy.preDeployCommand`（`railway.json`）。**コンテナの中**で DB を使える状態にする。
 * Railway の PostgreSQL は内部ネットワーク専用（公開 TCP プロキシ無し）なので、マイグレーションと
 * シードを外から流せない。デプロイのたびにここが実行される。
 *
 * 🔴 `SES_DB_BOOTSTRAP === '1'` のときだけ実行する。web / worker は `railway.json` を共有するため、
 *    このガードが無いと 1 回のリリースで同じ処理が 2 回流れる（worker のデプロイでも走る）。
 *    web サービスにだけ `SES_DB_BOOTSTRAP=1` を立てる。
 *
 * 手順（各段階の開始と完了を 1 行ずつ出す。失敗箇所がログで分かるように）:
 *   1. TLS の確認（🔴 最初に行う）
 *   2. `packages/db/prisma/sql/000_roles.sql` を psql で適用（ロール定義の唯一の出所）
 *   3. `prisma migrate deploy`（`app_migrator`）
 *   4. 合成データの投入（`SES_SEED_PRESETS`。既定 `demo,isolation`）
 *
 * 🔴 ログに接続文字列・パスワードを 1 文字も出さない。出すのはホスト名とロール名だけである
 *    （`CLAUDE.md` §3.5 / `packages/config` の「検証結果に環境変数の値そのものを含めない」と同じ規律）。
 *
 * 🔴 環境の判定（合成データを投入してよい環境か）をここに書かない。`@ses/config` の
 *    `assertSeedableAppEnv` が唯一の出所であり、シード CLI の内側（`runSeed` の先頭）で必ず通る
 *    （`packages/config/src/seed-guard.ts`）。ここで `APP_ENV` を見比べると判定が 2 箇所になる。
 *
 * 依存ゼロ（Node.js の標準機能のみ）。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_PREFIX = '[ses:railway:predeploy]';

const BOOTSTRAP_VAR = 'SES_DB_BOOTSTRAP';
const SUPERUSER_URL_VAR = 'SES_POSTGRES_SUPERUSER_URL';
const MIGRATION_URL_VAR = 'SES_MIGRATION_DATABASE_URL';
const SEED_PRESETS_VAR = 'SES_SEED_PRESETS';

/** 🔴 `MIGRATION_DATABASE_URL` という名前は使えない（`packages/config` が実行時環境での設定を禁止している。docs/05 §13.4 規則 3）。 */
const DEFAULT_SEED_PRESETS = 'demo,isolation';

/** `000_roles.sql` が `:'var'` で参照する psql 変数 → 値を持つ環境変数。ローカルの docker/postgres/initdb/000-roles.sh と同じ名前。 */
const ROLE_PASSWORD_VARS = Object.freeze({
  app_migrator_password: 'APP_MIGRATOR_PASSWORD',
  app_tenant_password: 'APP_TENANT_PASSWORD',
  app_platform_password: 'APP_PLATFORM_PASSWORD',
  app_platform_write_password: 'APP_PLATFORM_WRITE_PASSWORD',
});

const ROLES_SQL_RELATIVE = path.join('packages', 'db', 'prisma', 'sql', '000_roles.sql');
const SEED_CLI_RELATIVE = path.join('packages', 'db', 'dist', 'seed', 'cli.js');

/** `SELECT 1` + 自分の接続が TLS かどうか（`-At` 出力は `1|t` の形）。 */
const TLS_PROBE_SQL =
  "select 1, coalesce((select ssl::text from pg_stat_ssl where pid = pg_backend_pid()), 'unknown')";

/** 想定済みの失敗（原因と対処が言える失敗）。スタックトレースを出さずにメッセージだけを出す。 */
class PredeployError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PredeployError';
  }
}

function log(line) {
  process.stdout.write(`${LOG_PREFIX} ${line}\n`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new PredeployError(`${name} が未設定です（値はログに出しません）。docs/DEPLOY-DEMO-RAILWAY.md の環境変数表を参照。`);
  }
  return value;
}

/**
 * 🔴 例外・psql の出力を 1 行に畳んでから出す。接続文字列は載せない（libpq のエラーは
 *    ホスト・ポート・ユーザーまでしか含まない）。長すぎる出力は切る。
 */
function oneLine(text) {
  const joined = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' / ');
  return joined.length > 600 ? `${joined.slice(0, 600)}…` : joined;
}

/**
 * 🔴 パースに失敗しても**値を例外メッセージに載せない**。
 *    Node の `ERR_INVALID_URL` は `input` プロパティに元の文字列を持ち、エラーオブジェクトを
 *    そのまま出力すると接続文字列（＝パスワード）がログに出る。
 */
function parsePostgresUrl(raw, variableName) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new PredeployError(`${variableName} を URL として解釈できません（値はログに出しません）。`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new PredeployError(`${variableName} のスキームが postgresql:// ではありません。`);
  }
  if (parsed.hostname === '' || parsed.username === '' || parsed.pathname.replace(/^\//, '') === '') {
    throw new PredeployError(`${variableName} にホスト / ユーザー / データベース名のいずれかが含まれていません。`);
  }
  return parsed;
}

/**
 * 接続情報を libpq の環境変数に展開する。
 *
 * 🔴 なぜ URL をそのまま psql の引数に渡さないか: 引数に渡すとパスワードが argv に載る
 *    （同じコンテナ内の `ps` から見える）。libpq の環境変数なら argv に出ない。
 * 🔴 `PGSSLMODE` は URL の指定に関わらず `require` で固定する。`packages/config` は全環境で
 *    `sslmode=require` を要求しており（`hasSslModeRequire`）、ここだけ緩めると
 *    「アプリは TLS 必須なのにブートストラップだけ平文」という食い違いを作る。
 */
function libpqEnvFrom(raw, variableName) {
  const parsed = parsePostgresUrl(raw, variableName);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port === '' ? '5432' : parsed.port,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGSSLMODE: 'require',
  };
}

/** 🔴 Prisma / シードに渡す接続文字列にも `sslmode=require` を必ず付ける（緩める方向には書き換えない）。 */
function withSslModeRequire(raw, variableName) {
  const parsed = parsePostgresUrl(raw, variableName);
  parsed.searchParams.set('sslmode', 'require');
  return parsed.toString();
}

function roleNameOf(raw, variableName) {
  return decodeURIComponent(parsePostgresUrl(raw, variableName).username);
}

/**
 * psql を起動する。接続情報は libpq の環境変数で渡す（引数には載せない）。
 * 🔴 `-X`（.psqlrc を読まない）と `ECHO=none` を固定する。`000_roles.sql` は `\gexec` で
 *    `CREATE ROLE ... PASSWORD '...'` を組み立てるため、`ECHO` が `all` / `queries` だと
 *    **生成されたパスワード入りの SQL がログに出る**。既定は none だが、環境に左右されないよう明示する。
 */
function runPsql(pgEnv, args, { capture }) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'ECHO=none', ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...pgEnv },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error !== undefined && result.error.code === 'ENOENT') {
    throw new PredeployError(
      'psql が見つかりません。Railway のこのサービスに NIXPACKS_APT_PKGS=postgresql-client が設定されていない' +
        '（または builder が NIXPACKS になっていない）。設定してから再デプロイしてください。',
    );
  }
  if (result.error !== undefined) {
    throw new PredeployError(`psql の起動に失敗しました: ${result.error.message}`);
  }
  return result;
}

function runCommand(command, args, { env, label }) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error !== undefined && result.error.code === 'ENOENT') {
    throw new PredeployError(`${command} が見つかりません（${label}）。`);
  }
  if (result.error !== undefined) {
    throw new PredeployError(`${label} の起動に失敗しました: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new PredeployError(`${label} が失敗しました（exit code ${result.status}）。上の出力を参照。`);
  }
}

// ---------------------------------------------------------------------------
// 1. TLS の確認（🔴 最初に行う）
// ---------------------------------------------------------------------------

function assertTlsAvailable(pgEnv) {
  log(`1/4 TLS 確認: 開始（host=${pgEnv.PGHOST} port=${pgEnv.PGPORT} role=${pgEnv.PGUSER} sslmode=require）`);
  const probe = runPsql(pgEnv, ['-At', '-c', TLS_PROBE_SQL], { capture: true });
  if (probe.status !== 0) {
    throw new PredeployError(
      [
        '1/4 TLS 確認: 失敗。Railway の Postgres が TLS 非対応である可能性が高い。',
        '`packages/config` は全環境で接続文字列に sslmode=require を要求するため（schema.ts の hasSslModeRequire）、この構成では起動できない。',
        '🔴 sslmode を prefer / disable に落として先に進めてはならない（TLS 無しで顧客境界の DB に接続する経路を作らないため）。',
        'TLS を有効にした Postgres（自己署名でよい。sslmode=require は証明書検証をしない）に差し替えるか、TLS を終端するプロキシを挟むこと。',
        `psql の出力: ${oneLine(probe.stderr)}`,
      ].join('\n'),
    );
  }
  log(`1/4 TLS 確認: 完了（select 1 / pg_stat_ssl.ssl = ${oneLine(probe.stdout)}）`);
}

// ---------------------------------------------------------------------------
// 2. DB ロール（packages/db/prisma/sql/000_roles.sql）
// ---------------------------------------------------------------------------

/**
 * 🔴 ロール名・属性をこのスクリプトに書き写さない。`000_roles.sql` が唯一の定義であり
 *    （ローカル docker-compose と Testcontainers も同じファイルを実行する）、psql の `-v` 変数と
 *    `\gexec` を使うためシェル経由の psql でそのまま実行する以外の再現手段が無い。
 * 🔴 冪等（`WHERE NOT EXISTS` + `\gexec`）なので、再デプロイのたびに流れても安全である。
 *    既存ロールのパスワードは**更新しない**（ロールが既にあれば `CREATE ROLE` は 0 行 = 何もしない）。
 */
function applyDatabaseRoles(pgEnv) {
  const sqlPath = path.join(PROJECT_ROOT, ROLES_SQL_RELATIVE);
  if (!fs.existsSync(sqlPath)) {
    throw new PredeployError(`${ROLES_SQL_RELATIVE} が見つかりません（リポジトリの取り込みが不完全）。`);
  }
  log(`2/4 DB ロール: 開始（${ROLES_SQL_RELATIVE} を psql で適用。4 ロールのパスワードは環境変数から読む）`);

  const args = [];
  for (const [psqlVariable, envVariable] of Object.entries(ROLE_PASSWORD_VARS)) {
    // 🔴 値はここでしか触らない。ログにも例外メッセージにも出さない。
    args.push('-v', `${psqlVariable}=${requireEnv(envVariable)}`);
  }
  args.push('-q', '-f', sqlPath);

  const result = runPsql(pgEnv, args, { capture: false });
  if (result.status !== 0) {
    throw new PredeployError(
      `2/4 DB ロール: 失敗（exit code ${result.status}）。上の psql の出力を参照。` +
        `${SUPERUSER_URL_VAR} がスーパーユーザー（CREATE ROLE と ALTER SCHEMA public OWNER が可能）であることを確認すること。`,
    );
  }
  log('2/4 DB ロール: 完了（app_migrator / app_tenant / app_platform / app_platform_write と NOLOGIN の probe 群）');
}

// ---------------------------------------------------------------------------
// 3. マイグレーション（app_migrator）
// ---------------------------------------------------------------------------

/**
 * 🔴 `prisma migrate deploy` のコマンド文字列を 2 箇所に書かない。`@ses/db` の
 *    `migrate:deploy` スクリプトをそのまま呼ぶ。
 * 🔴 `DATABASE_URL` はこの子プロセスにだけ上書きする（`app_migrator`）。サービスの
 *    `DATABASE_URL`（`app_tenant`）はマイグレーションを実行できない（テーブル所有者ではない）。
 */
function migrateDeploy() {
  const raw = requireEnv(MIGRATION_URL_VAR);
  const url = withSslModeRequire(raw, MIGRATION_URL_VAR);
  log(`3/4 マイグレーション: 開始（prisma migrate deploy / role=${roleNameOf(raw, MIGRATION_URL_VAR)}）`);
  runCommand('pnpm', ['--filter', '@ses/db', 'run', 'migrate:deploy'], {
    env: { DATABASE_URL: url },
    label: '3/4 マイグレーション（pnpm --filter @ses/db run migrate:deploy）',
  });
  log('3/4 マイグレーション: 完了');
}

// ---------------------------------------------------------------------------
// 4. 合成データの投入
// ---------------------------------------------------------------------------

/**
 * 🔴 `--reset` を付けない。付けると再デプロイのたびに対象テナントの業務データを消してしまう。
 *    `--reset` 無しで投入済みのプリセットを指定した場合、`runSeed` は**何も書かず** `ALREADY_SEEDED`
 *    で正常終了する契約である（`packages/db/seed/index.ts` の `readSeedPresence`。F-053 AC-2 / API-A16）。
 *    したがって再デプロイのたびにこの段階が流れても安全であり、データは増えない。
 * 🔴 環境ガード（`demo` / `development` 以外では実行できない）は `runSeed` の先頭にある
 *    （`assertSeedableAppEnv`）。ここで `APP_ENV` を判定しない。
 * 🔴 `SES_SEED_PRESETS=` が空なら 1 件も投入しない（「既定に倒す」をしない）。
 */
function seedPresets(superuserRaw) {
  const raw = process.env[SEED_PRESETS_VAR] ?? DEFAULT_SEED_PRESETS;
  const presets = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (presets.length === 0) {
    log(`4/4 シード: ${SEED_PRESETS_VAR} が空のため 1 件も投入しません。`);
    return;
  }

  const cliPath = path.join(PROJECT_ROOT, SEED_CLI_RELATIVE);
  if (!fs.existsSync(cliPath)) {
    throw new PredeployError(`${SEED_CLI_RELATIVE} が見つかりません（@ses/db のビルドが完了していない）。`);
  }
  // 🔴 投入には RLS の適用ポリシーを持たない特権接続が要る（app_tenant は tenants に INSERT できず、
  //    app_migrator も FORCE ROW LEVEL SECURITY で読み書きできない。docs/05 §4.2 / §4.4）。
  const seedUrl = withSslModeRequire(superuserRaw, SUPERUSER_URL_VAR);

  for (const preset of presets) {
    log(`4/4 シード: 開始（preset=${preset} / role=${roleNameOf(superuserRaw, SUPERUSER_URL_VAR)}）`);
    runCommand(process.execPath, [cliPath, `--preset=${preset}`], {
      env: { SEED_DATABASE_URL: seedUrl },
      label: `4/4 シード（preset=${preset}）`,
    });
    log(`4/4 シード: 完了（preset=${preset}。投入済みなら ALREADY_SEEDED で何も書かない）`);
  }
}

// ---------------------------------------------------------------------------

function main() {
  if (process.env[BOOTSTRAP_VAR] !== '1') {
    log(`${BOOTSTRAP_VAR} が '1' ではないため、DB のブートストラップを行いません（worker サービスではこれが正常）。`);
    return;
  }

  const superuserRaw = requireEnv(SUPERUSER_URL_VAR);
  const pgEnv = libpqEnvFrom(superuserRaw, SUPERUSER_URL_VAR);

  assertTlsAvailable(pgEnv);
  applyDatabaseRoles(pgEnv);
  migrateDeploy();
  seedPresets(superuserRaw);
  log('完了（DB ロール → マイグレーション → 合成データ）');
}

try {
  main();
} catch (error) {
  // 🔴 エラーオブジェクトをそのまま出力しない（`ERR_INVALID_URL` の `input` などに
  //    接続文字列が入りうる）。名前とメッセージだけを出す。
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${LOG_PREFIX} ${name === 'PredeployError' ? '' : `${name}: `}${message}\n`);
  process.exitCode = 1;
}
