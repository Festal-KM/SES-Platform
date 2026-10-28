#!/usr/bin/env node
// ECSの一回限りの管理タスク専用。アプリにはこの接続とパスワードを渡さない。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
function execute(command, args, env, input) {
  const result = spawnSync(command, args, { cwd: root, env, input, encoding: 'utf8' });
  // DBのエラーには秘密値が混ざるため、そのままログへ転送しない。
  if (result.error || result.status !== 0) {
    const code = /(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b/.exec(result.stderr ?? '')?.[1];
    throw new Error(`DB初期化またはmigrationに失敗しました（${command}${code ? ` / SQLSTATE ${code}` : ''}）。管理者がDBの状態を確認してください`);
  }
  return result.stdout;
}
try {
  const seed = process.argv.slice(2);
  if (seed.length && (seed.length !== 1 || seed[0] !== '--seed-demo' || process.env.APP_ENV !== 'demo')) throw new Error('サンプル投入はデモの明示的な初期化だけに限定します');
  if (!['demo', 'production'].includes(process.env.APP_ENV) || process.env.AWS_ISOLATION_MODE !== 'resource') throw new Error('AWSデモ・本番専用の管理タスクです');
  const connection = new URL(process.env.DATABASE_URL);
  const prefix = `ses-platform-${process.env.APP_ENV}-db.`;
  if (!connection.hostname.startsWith(prefix) || !connection.hostname.endsWith('.ap-northeast-1.rds.amazonaws.com') || connection.searchParams.get('sslmode') !== 'require') throw new Error('対象環境のDBに一致しません');
  const admin = { ...process.env, PGHOST: connection.hostname, PGPORT: '5432', PGDATABASE: 'ses_platform', PGSSLMODE: 'require', PGUSER: process.env.DB_ADMIN_USERNAME, PGPASSWORD: process.env.DB_ADMIN_PASSWORD };
  for (const key of ['DB_ADMIN_USERNAME', 'DB_ADMIN_PASSWORD', 'APP_MIGRATOR_PASSWORD', 'APP_TENANT_PASSWORD', 'APP_PLATFORM_PASSWORD', 'APP_PLATFORM_WRITE_PASSWORD']) if (!process.env[key]) throw new Error('管理タスクの設定が不足しています');
  const header = ['\\getenv app_migrator_password APP_MIGRATOR_PASSWORD', '\\getenv app_tenant_password APP_TENANT_PASSWORD', '\\getenv app_platform_password APP_PLATFORM_PASSWORD', '\\getenv app_platform_write_password APP_PLATFORM_WRITE_PASSWORD'].join('\n');
  // RDS管理者はSUPERUSERではない。所有者を変更する前に、作成したロールへの所属を付ける。
  const roles = readFileSync(resolve(root, 'packages/db/prisma/sql/000_roles.sql'), 'utf8').replace('ALTER SCHEMA public OWNER TO app_migrator;', "SELECT format('GRANT app_migrator TO %I', current_user)\\gexec\nALTER SCHEMA public OWNER TO app_migrator;");
  console.log('DBロールを確認します');
  execute('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], admin, `${header}\n${roles}`);
  connection.username = 'app_migrator'; connection.password = process.env.APP_MIGRATOR_PASSWORD;
  const migration = { ...process.env, DATABASE_URL: connection.toString() };
  console.log('migrationを適用します');
  execute('pnpm', ['--filter', '@ses/db', 'run', 'migrate:deploy'], migration);
  if (seed.length) {
    console.log('全停止下でデモの合成データを確認します');
    // このモードはアプリを全停止した管理者の初回投入専用。通常配備からは呼ばない。
    const owner = { ...admin, PGUSER: 'app_migrator', PGPASSWORD: process.env.APP_MIGRATOR_PASSWORD };
    const force = (enabled) => execute('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], owner,
      `SELECT format('ALTER TABLE %I.%I ${enabled ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY', n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity\\gexec\n`);
    try {
      force(false);
      const { DEMO_SEED_IDS } = await import('../packages/db/dist/seed/presets/demo.js');
      const ids = DEMO_SEED_IDS.tenants.map(tenant => tenant.tenantId);
      if (ids.length !== 2 || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('合成テナントの定義が不正です');
      const unknown = execute('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], owner,
        `SELECT count(*) FROM tenants WHERE id NOT IN (${ids.map(id => `'${id}'`).join(',')});\n`).trim();
      if (unknown !== '0') throw new Error('既知の合成テナント以外が存在するため、投入を中止しました');
      const fixtureEnv = { ...process.env, SEED_DATABASE_URL: connection.toString(), APP_ENV: 'demo' };
      execute(process.execPath, ['packages/db/dist/seed/cli.js', '--preset=demo'], fixtureEnv);
      execute(process.execPath, ['packages/db/dist/seed/role-accounts.js'], fixtureEnv);
    } finally { force(true); }
  }
  const invalid = execute('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], admin,
    "SELECT count(*) FROM pg_roles WHERE rolname IN ('app_migrator','app_tenant','app_platform','app_platform_write') AND (rolsuper OR rolbypassrls);\n").trim();
  if (invalid !== '0') throw new Error('アプリ用DBロールの権限検査に失敗しました');
  const unforced = execute('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], admin,
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;\n").trim();
  if (unforced !== '0') throw new Error('FORCE RLSの検査に失敗しました。アプリを起動せず、管理者が復旧してください');
  console.log('DBロールの準備とmigrationが完了しました。データのリセットは行っていません。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
