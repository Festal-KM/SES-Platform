// 開発VMの一回限り／更新時の初期化。アプリとは別コンテナで実行する。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
const root = '/app';
let protectedValues = [];
function run(command, args, env = process.env, label = command) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    if (!env.DATABASE_URL && !env.SEED_DATABASE_URL) {
      let detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-6000);
      for (const value of protectedValues) detail = detail.replaceAll(value, '[redacted]');
      console.error(detail);
    }
    throw new Error(`${label}が失敗しました（終了コード${result.status}）`);
  }
  console.log(`${label}: 完了`);
}
try {
  const env = parseEnv(readFileSync(`${root}/.env`, 'utf8'));
  protectedValues = Object.entries(env).filter(([key, value]) => /PASSWORD|SECRET|KEY|_URL$/.test(key) && value.length >= 8).map(([, value]) => value);
  if (env.APP_ENV !== 'development' || env.AWS_ISOLATION_MODE !== 'resource') throw new Error('AWS開発環境専用です');
  // 依存のインストール・ビルドにDBの秘密値を渡さない。
  run('corepack', ['enable']);
  run('pnpm', ['install', '--frozen-lockfile', '--store-dir', '/app/.pnpm-store'], process.env, '依存のインストール');
  run('pnpm', ['-r', '--workspace-concurrency=1', '--filter', '@ses/worker...', '--filter', '@ses/ui...', 'run', 'build'], process.env, '共有パッケージとワーカーのビルド');
  run('pnpm', ['--filter', '@ses/web', 'run', 'build'], { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=4096' }, 'AWS上の画面確認用ビルド');
  const { loadAppEnv } = await import('../packages/config/dist/index.js');
  const runtime = loadAppEnv(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')));
  const values = Object.entries(runtime).filter(([, value]) => value !== undefined).map(([key, value]) => {
    const text = Array.isArray(value) ? value.join(',') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[\r\n]/.test(text)) throw new Error('環境変数に改行を含めることはできません');
    return `${key}=${text}`;
  });
  writeFileSync(`${root}/.runtime.env`, `${values.join('\n')}\n`, { mode: 0o600 });
  const migration = new URL(env.DATABASE_URL);
  migration.username = 'app_migrator'; migration.password = env.APP_MIGRATOR_PASSWORD;
  run('pnpm', ['--filter', '@ses/db', 'run', 'migrate:deploy'], { ...process.env, DATABASE_URL: migration.toString() }, 'DBマイグレーション');
  if (!existsSync(`${root}/.aws-development-seeded`)) {
    const seed = new URL(env.DATABASE_URL);
    seed.username = env.POSTGRES_USER; seed.password = env.POSTGRES_PASSWORD;
    run(process.execPath, ['packages/db/dist/seed/cli.js', '--preset=demo'], { ...process.env, APP_ENV: 'development', SEED_DATABASE_URL: seed.toString() }, '開発用合成データの投入');
    writeFileSync(`${root}/.aws-development-seeded`, 'demo\n', { mode: 0o600 });
  }
  console.log('開発アプリの起動準備が完了しました');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
