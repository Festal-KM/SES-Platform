// tests/static/db-raw-access.test.ts
// T-01-06（docs/sprints/SP-01-bootstrap.md）: withTenant / withHostTenant を経ない DB アクセス経路を
// ESLint で塞ぐ（CLAUDE.md §3.1 / docs/05 §1.4 / §4.3）。
//   ①生 @prisma/client の import は packages/db 内部のみ許可
//   ②@ses/db から PrismaClient を named import することは常に禁止（防御的ルール）
//   ③@ses/db/testing サブパスの import は tests/isolation/** のみ許可
//   ④$queryRaw / $queryRawUnsafe / $executeRaw / $executeRawUnsafe の直接呼び出しは
//     packages/db/src/** と tests/isolation/** のみ許可
//
// fixture 自体は本体のビルド対象に含めず（vitest / tsc の include から除外）、
// ここで文字列として読み込み、ESLint#lintText に架空の filePath を与えて検査する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'db-raw-access');

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

// 解決コストを beforeAll に寄せる（ai-single-path.test.ts / no-restricted-imports.test.ts と同じ理由）。
let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: repoRoot });
  await eslint.lintText('', { filePath: path.join(repoRoot, 'packages/domain/src/__warmup__.ts') });
}, 30000);

async function lintAs(content: string, spoofedRelativePath: string) {
  const filePath = path.join(repoRoot, spoofedRelativePath);
  const [result] = await eslint.lintText(content, { filePath });
  if (!result) {
    throw new Error(`lintText did not return a result for ${spoofedRelativePath}`);
  }
  return result;
}

function ruleIds(messages: ESLint.LintResult['messages']): string[] {
  return messages.map((m) => m.ruleId).filter((id): id is string => id !== null);
}

function hasAnyRule(messages: ESLint.LintResult['messages'], ruleIdsToFind: string[]): boolean {
  const found = ruleIds(messages);
  return ruleIdsToFind.some((id) => found.includes(id));
}

describe('① @prisma/client の直接 import は packages/db 内部のみ許可（CLAUDE.md §3.1 / docs/05 §4.3）', () => {
  it('apps/web からの静的 import を検出する', async () => {
    const result = await lintAs(
      readFixture('prisma-client-import.violation.ts'),
      'apps/web/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('packages/connectors からのサブパス import（@prisma/client/runtime/library）を検出する', async () => {
    const result = await lintAs(
      readFixture('prisma-client-subpath-import.violation.ts'),
      'packages/connectors/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('apps/worker からの動的 import (import()) を検出する', async () => {
    const result = await lintAs(
      readFixture('prisma-client-dynamic-import.violation.ts'),
      'apps/worker/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });
});

describe('② @ses/db から PrismaClient を named import することは常に禁止（防御的ルール）', () => {
  it('apps/web からの named import を検出する', async () => {
    const result = await lintAs(
      readFixture('ses-db-prisma-client-named-import.violation.ts'),
      'apps/web/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('packages/config（@ses/db 自体は制限されていないゾーン）からでも検出する', async () => {
    const result = await lintAs(
      readFixture('ses-db-prisma-client-named-import.violation.ts'),
      'packages/config/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });
});

describe('③ @ses/db/testing は tests/isolation/** 以外から import できない（docs/05 §4.7）', () => {
  it('apps/web からの import を検出する', async () => {
    const result = await lintAs(
      readFixture('ses-db-testing-import.violation.ts'),
      'apps/web/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('packages/config（@ses/db 自体は制限されていないゾーン）からでも検出する', async () => {
    const result = await lintAs(
      readFixture('ses-db-testing-import.violation.ts'),
      'packages/config/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });
});

describe('④ $queryRaw / $executeRaw の直接呼び出しは packages/db/src/** と tests/isolation/** のみ許可', () => {
  it('apps/web からの関数呼び出し形（$queryRaw(sql)）を検出する', async () => {
    const result = await lintAs(
      readFixture('raw-query-call.violation.ts'),
      'apps/web/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });

  it('packages/config からのタグ付きテンプレート形（$executeRaw`…`）を検出する', async () => {
    const result = await lintAs(
      readFixture('raw-execute-tagged-template.violation.ts'),
      'packages/config/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });
});

describe('対照: 許可された区画では違反 0 件', () => {
  it('packages/db は @prisma/client の import と $queryRaw / $executeRaw の直接呼び出しができる', async () => {
    const result = await lintAs(readFixture('db-package-allowed.ok.ts'), 'packages/db/src/__ok__.ts');
    expect(
      hasAnyRule(result.messages, ['no-restricted-imports', 'no-restricted-syntax']),
    ).toBe(false);
  });

  it('tests/isolation/** は @ses/db/testing の import と $queryRaw の直接呼び出しができる', async () => {
    const result = await lintAs(
      readFixture('isolation-allowed.ok.ts'),
      'tests/isolation/support/__ok__.ts',
    );
    expect(
      hasAnyRule(result.messages, ['no-restricted-imports', 'no-restricted-syntax']),
    ).toBe(false);
  });
});
