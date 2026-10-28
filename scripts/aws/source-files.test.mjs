import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedSource } from './source-files.mjs';

test('ログインに必要な認証ソースと設定例は転送する', () => {
  for (const file of ['apps/web/lib/auth/credentials.ts', 'apps/web/lib/auth/credentials.test.ts', '.env.example']) {
    assert.equal(isExcludedSource(file), false, file);
  }
});
test('秘密値と生成物は転送しない', () => {
  for (const file of ['.env', '.env.local', 'apps/web/.env.production', '.runtime.env', '.aws/credentials', 'private.key', 'apps/web/.next/server.js', 'packages/config/dist/index.js']) {
    assert.equal(isExcludedSource(file), true, file);
  }
});
