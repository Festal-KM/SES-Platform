import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('本番のseed指定はDB操作より前に拒否する', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../aws-migrate.mjs', import.meta.url)), '--seed-demo'], {
    env: { ...process.env, APP_ENV: 'production' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /サンプル投入はデモ/);
  assert.ok(!result.stdout.includes('DBロールを確認'));
});
test('通常のアプリは管理用パスワードが混入すると起動前に拒否し、値を出さない', () => {
  const secret = 'fixture-password-must-not-appear';
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../aws-start.mjs', import.meta.url)), 'web'], {
    env: { ...process.env, DB_ADMIN_PASSWORD: secret }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /通常のアプリにDB_ADMIN_PASSWORD/);
  assert.ok(!result.stderr.includes(secret));
});
