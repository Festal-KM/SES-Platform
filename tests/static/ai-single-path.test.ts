// tests/static/ai-single-path.test.ts
// docs/05 §17.2 #10: @anthropic-ai/sdk の import は packages/ai/src/client.ts のみ
// （CLAUDE.md §3.2 ④）。依存方向ルール①②③は tests/static/no-restricted-imports.test.ts で検証する。
//
// 🔴 T-07-01 で 2 本目の検査を足した: **LLM を実際に呼ぶ場所（`createStructuredMessage` の
//    呼び出し）が `packages/ai/src/run.ts` だけであること。** SDK の import 元を 1 ファイルに
//    固定しても、`createAiClient()` が返したクライアントを業務コードが直接呼べるなら、
//    `runRole` を経ない = `AiUsage` に残らない呼び出しが成立してしまう（docs/05 §7.3 /
//    `F-026 AC-1`「呼び出し 1 回につき `AiUsage` 1 件」）。**import 経路と呼び出し経路は別物**であり、
//    両方を押さえて初めて「AI 呼び出しが単一経路に閉じている」と言える。
//
// fixture 自体は本体のビルド対象に含めず（vitest / tsc の include から除外）、
// ここで文字列として読み込み、ESLint#lintText に架空の filePath を与えて検査する。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'ai-single-path');

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

// ============================================================================
// 🔴 T-07-01: LLM を**呼ぶ**場所の固定（import 経路とは別の検査）
// ============================================================================

const SCAN_ROOTS = ['apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * 🔴 `AnthropicClient.createStructuredMessage` を呼んでよい唯一の場所（docs/05 §7.2 / §7.3）。
 *
 * `run.ts` は手順 3（コスト予約）→ 4（呼び出し）→ 5（`safeParse`）→ 6（`AiUsage` の記録）を
 * この順で必ず実行する。ここ以外から呼べるようになった瞬間、記録も上限ガードも素通りする経路が
 * 生まれる（`F-026 AC-1` / `F-027`）。
 * ⚠️ 実装（`AnthropicApiClient` / `MockAnthropicClient`）の**メソッド定義**は呼び出しではないため、
 *    ここには現れない（AST の `CallExpression` だけを見る）。
 */
const ALLOWED_LLM_CALL_SITES = ['packages/ai/src/run.ts'];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約）。
 *    テストは stub / mock を直接呼んで振る舞いを検証するのが仕事であり、ここで落とすと
 *    検査自体が形骸化する。「本番コードを `*.test.ts` に隠す」抜け道は
 *    `tests/static/no-test-module-imports.test.ts` が別途塞いでいる。
 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** `x.createStructuredMessage(...)` / `x['createStructuredMessage'](...)` の**呼び出し**を数える。 */
function callsLlm(sourceText: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'createStructuredMessage') found = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isElementAccessExpression(node.expression) &&
      ts.isStringLiteralLike(node.expression.argumentExpression) &&
      node.expression.argumentExpression.text === 'createStructuredMessage'
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

describe('🔴 LLM の呼び出し元が runRole の 1 箇所に閉じていること（docs/05 §7.3 / F-026 AC-1）', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => listSourceFiles(path.join(repoRoot, root))).filter(
    (file) => !isTestFile(file),
  );

  // 🔴 T-07-04: 全ソースの AST 走査は `it` の**外**で 1 回だけ行う（判定の内容は変えていない）。
  //    `it` の中に置くと、ファイルが増えるにつれ Vitest 既定の 5 秒タイムアウトに触れて
  //    **検査の中身とは無関係に赤くなる**（同じ整理を `ai-usage-cost-single-path.test.ts` にも入れた）。
  const llmCallers = sourceFiles
    .filter((file) => callsLlm(readFileSync(file, 'utf8'), file))
    .map(toRepoRelative)
    .sort();

  it('対照: 走査対象のソースが十分にある（テストが空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it('createStructuredMessage を呼ぶ非テストソースは許可リストと完全に一致する', () => {
    expect(llmCallers).toEqual([...ALLOWED_LLM_CALL_SITES].sort());
  });

  it('🔴 バレル（packages/ai/src/index.ts）がクライアントのポートを公開していない', () => {
    // 公開すると「`createAiClient()` の戻り値を直接呼ぶ」書き方が公開 API として成立してしまう。
    const barrel = readFileSync(path.join(repoRoot, 'packages/ai/src/index.ts'), 'utf8');
    const exportedNames = new Set<string>();
    const sourceFile = ts.createSourceFile('index.ts', barrel, ts.ScriptTarget.ES2023, true);
    function visit(node: ts.Node): void {
      if (ts.isExportDeclaration(node) && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) exportedNames.add(element.name.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    for (const forbidden of ['AnthropicClient', 'AnthropicApiClient', 'AiClientRequest', 'AiClientResponse']) {
      expect(exportedNames.has(forbidden)).toBe(false);
    }
  });
});
