// tests/static/ai-single-path.test.ts
// docs/05 §17.2 #10: @anthropic-ai/sdk の import は packages/ai/src/client.ts のみ
// （CLAUDE.md §3.2 ④）。依存方向ルール①②③は tests/static/no-restricted-imports.test.ts で検証する。
//
// fixture 自体は本体のビルド対象に含めず（vitest / tsc の include から除外）、
// ここで文字列として読み込み、ESLint#lintText に架空の filePath を与えて検査する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'ai-single-path');

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

async function lintAs(content: string, spoofedRelativePath: string) {
  const eslint = new ESLint({ cwd: repoRoot });
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

describe('@anthropic-ai/sdk の単一経路ルール（CLAUDE.md §3.2 ④ / docs/05 §17.2 #10）', () => {
  it('packages/ai/src/client.ts 以外での @anthropic-ai/sdk の静的 import を検出する', async () => {
    const result = await lintAs(
      readFixture('sdk-import-outside-client.violation.ts'),
      'apps/worker/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('@anthropic-ai/sdk のサブパス（@anthropic-ai/sdk/core）の静的 import を検出する', async () => {
    const result = await lintAs(
      readFixture('sdk-subpath-import.violation.ts'),
      'apps/web/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('@anthropic-ai/sdk の動的 import (await import(...)) を検出する', async () => {
    const result = await lintAs(
      readFixture('sdk-dynamic-import.violation.ts'),
      'apps/worker/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });

  it('@anthropic-ai/sdk のサブパスの動的 import を検出する', async () => {
    const result = await lintAs(
      readFixture('sdk-dynamic-subpath-import.violation.ts'),
      'apps/web/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });

  it('scripts/** からの @anthropic-ai/sdk の import を検出する（scripts/** も lint 対象）', async () => {
    const result = await lintAs(
      readFixture('sdk-import-from-scripts.violation.ts'),
      'scripts/__violation__.mjs',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-imports'])).toBe(true);
  });

  it('scripts/**（.cjs）からの @anthropic-ai/sdk の require() を検出する', async () => {
    const result = await lintAs(
      readFixture('sdk-require-from-scripts.violation.ts'),
      'scripts/__violation__.cjs',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });

  it('無置換のテンプレートリテラルによる @anthropic-ai/sdk の動的 import を検出する', async () => {
    const result = await lintAs(
      readFixture('sdk-dynamic-template-literal-import.violation.ts'),
      'apps/worker/src/__violation__.ts',
    );
    expect(hasAnyRule(result.messages, ['no-restricted-syntax'])).toBe(true);
  });

  it('対照: packages/ai/src/client.ts だけは @anthropic-ai/sdk を import できる（唯一の例外経路）', async () => {
    const result = await lintAs(readFixture('ai-client-allowed.ok.ts'), 'packages/ai/src/client.ts');
    expect(hasAnyRule(result.messages, ['no-restricted-imports', 'no-restricted-syntax'])).toBe(false);
  });
});
