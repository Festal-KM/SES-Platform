import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includeCiSource } from './ci-source.mjs';
test('配備に必要なソースを含め、秘密値・生成物・Git情報を含めない', () => {
  for (const file of ['apps/web/lib/auth/credentials.ts', 'packages/db/prisma/schema.prisma', 'scripts/aws-bootstrap-development.sh', '.env.example', 'pnpm-lock.yaml']) assert.equal(includeCiSource(file), true, file);
  for (const file of ['', '.git/config', '.env', 'apps/web/.env.local', 'packages/config/dist/index.js', 'apps/web/.next/server.js', 'apps/web/node_modules/foo/index.js', 'infra/aws/../../.env', '/tmp/key', 'docs/DEV-ACCOUNTS.md']) assert.equal(includeCiSource(file), false, file);
});
