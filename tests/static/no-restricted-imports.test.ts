// tests/static/no-restricted-imports.test.ts
// docs/05 §17.2 #3: eslint.config.mjs の依存方向ルール①②③（CLAUDE.md §2.1）を、
// わざと違反させた fixture で「lint が落ちること」を検証する。
// SDK の単一経路（rule④）は tests/static/ai-single-path.test.ts で検証する。
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
const fixturesDir = path.join(here, '__fixtures__', 'no-restricted-imports');

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

// ESLint インスタンスの構築自体は数 ms で終わる（flat config は遅延解決のため）。
// 実際に重いのは初回の lintText() で発生する flat config の解決 + typescript-eslint のロードで、
// これが Vitest 既定 timeout (5000ms) を超えうる。ここで 1 回空 lint して解決コストを
// beforeAll の timeout 予算（30000ms）に寄せておくことで、各 it は解決済みの状態から
// 数十 ms で終わるようにする。
let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: repoRoot });
  await eslint.lintText('', { filePath: path.join(repoRoot, 'packages/domain/src/__warmup__.ts') });
}, 30000);

/**
 * fixture の内容を、あたかも `spoofedRelativePath` に置かれたファイルであるかのように lint する。
 * 実体は tests/static/__fixtures__ 配下にあるが、依存方向ルールはファイルパスで判定されるため、
 * 検査したいゾーン（packages/domain 等）に見せかけて実行する。
 */
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

function hasRule(messages: ESLint.LintResult['messages'], ruleId: string): boolean {
  return ruleIds(messages).includes(ruleId);
}

describe('依存方向の ESLint ルール①②③（CLAUDE.md §2.1 / docs/05 §2.2）', () => {
  it('① packages/* から apps/* をパッケージ名で import すると検出する（解決に依存しない照合）', async () => {
    const result = await lintAs(
      readFixture('apps-import-bare.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('① packages/* から apps/* を相対パス（.js specifier）で import すると検出する', async () => {
    const result = await lintAs(
      readFixture('apps-import-relative.violation.ts'),
      'packages/db/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('① ルール①は db/ai/connectors 以外の packages/*（例: config）にも一律で効く', async () => {
    const result = await lintAs(
      readFixture('config-import-apps-bare.violation.ts'),
      'packages/config/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が他の @ses/* パッケージに依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-package.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が他の @ses/* パッケージのサブパスに依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-package-subpath.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が Node の I/O (fs) に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-node-io.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が Node の I/O のサブパス（node:fs/promises 等）に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-node-io-subpath.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    // fixture は node:fs/promises / fs/promises / node:timers/promises / node:stream/promises の 4 本を import する。
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });

  it('② packages/domain が Node の I/O を動的 import (import()) しても検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-node-io-dynamic.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-syntax')).toBe(true);
  });

  it('③ packages/db が packages/ai に依存すると検出する', async () => {
    const result = await lintAs(readFixture('db-import-ai.violation.ts'), 'packages/db/src/__violation__.ts');
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/db が packages/ai のサブパス（@ses/ai/run）に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('db-import-ai-subpath.violation.ts'),
      'packages/db/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/db が packages/ai を動的 import (import()) しても検出する', async () => {
    const result = await lintAs(
      readFixture('db-import-ai-dynamic.violation.ts'),
      'packages/db/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-syntax')).toBe(true);
  });

  it('③ packages/ai が packages/connectors に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('ai-import-connectors.violation.ts'),
      'packages/ai/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/ai が packages/connectors のサブパス（@ses/connectors/email）に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('ai-import-connectors-subpath.violation.ts'),
      'packages/ai/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/connectors が packages/db に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('connectors-import-db.violation.ts'),
      'packages/connectors/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('対照: packages/domain の正常系は違反 0 件', async () => {
    const result = await lintAs(readFixture('domain-clean.ok.ts'), 'packages/domain/src/index.ts');
    expect(result.errorCount).toBe(0);
  });
});
