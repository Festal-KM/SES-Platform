#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const role = process.argv[2];
if (!['web', 'worker', 'verify', 'migrate'].includes(role)) throw new Error('AWS起動ロールを指定してください');
if (role !== 'migrate') {
  for (const key of ['DB_ADMIN_PASSWORD', 'APP_MIGRATOR_PASSWORD', 'MIGRATION_DATABASE_URL', 'SEED_DATABASE_URL', 'SES_POSTGRES_SUPERUSER_URL']) {
    if (process.env[key]) throw new Error(`通常のアプリに${key}を渡せません`);
  }
}
if (role === 'verify') {
  const { loadAppEnv } = await import('../packages/config/dist/index.js');
  loadAppEnv(process.env);
  console.log('実行環境の設定検査が完了しました');
  process.exit(0);
}
const cwd = role === 'web' ? resolve(root, 'apps/web') : root;
const args = role === 'web' ? [resolve(root, 'apps/web/node_modules/next/dist/bin/next'), 'start', '--hostname', '0.0.0.0', '--port', '3000']
  : role === 'migrate' ? [resolve(root, 'scripts/aws-migrate.mjs'), ...process.argv.slice(3)]
  : [resolve(root, 'apps/worker/dist/main.js'), ...(role === 'verify' ? ['--verify-config'] : [])];
const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('AWSアプリを起動できません'); process.exitCode = 1; });
