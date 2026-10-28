// AWS開発環境のアプリ。DB初期化は別コンテナで行い、ここに管理用の認証情報を渡さない。
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const role = process.argv[2];
if (!['web', 'worker'].includes(role) || process.env.APP_ENV !== 'development') throw new Error('AWS開発環境のweb / workerだけを起動できます');
for (const key of ['POSTGRES_PASSWORD', 'APP_MIGRATOR_PASSWORD', 'MIGRATION_DATABASE_URL', 'SEED_DATABASE_URL', 'SES_POSTGRES_SUPERUSER_URL']) {
  if (process.env[key]) throw new Error(`アプリに${key}を設定できません`);
}
const args = role === 'web'
  ? [resolve(root, 'apps/web/node_modules/next/dist/bin/next'), 'start', '--hostname', '0.0.0.0', '--port', '3000']
  : [resolve(root, 'apps/worker/dist/main.js')];
const child = spawn(process.execPath, args, { cwd: resolve(root, 'apps', role === 'web' ? 'web' : 'worker'), stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('開発アプリを起動できません'); process.exitCode = 1; });
