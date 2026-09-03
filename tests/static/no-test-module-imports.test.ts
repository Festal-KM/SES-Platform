// tests/static/no-test-module-imports.test.ts
// T-03-04（T-03-01 の code-reviewer 推奨。docs/sprints/SP-03-auth-audit-admin0.md）。
//
// 🔴 何を閉じるテストか:
//    本リポジトリの静的走査テスト（`auth-db-callers` / `execute-guard` / `domain-purity` /
//    `ai-single-path` …）は、いずれも **`*.test.ts` を走査対象から除外する**。
//    ユニットテストが `vi.mock('@ses/db', …)` のように禁止対象の識別子を「モックの定義」として
//    書くためであり、そこで落とすと検査自体が形骸化する。
//
//    その除外は、裏返すと**抜け道**でもある: 本番コードを `foo.test.ts` と名づければ、
//    どの走査テストからも見えなくなる。ただしその「隠したコード」が実際に効くには、
//    **本番のモジュールから import されなければならない**。
//    したがって「非テストソースが `.test` モジュールを import していない」ことを 1 本押さえれば、
//    全走査テストに共通する抜け道がまとめて閉じる。
//
// 🔴 このテストは特定の機能ではなく**走査テストの前提**を守るものである。走査テストが増えても
//    このファイルを増やす必要は無い。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 走査対象のルート（出荷される実装が置かれる場所）。 */
const SOURCE_ROOTS = ['apps', 'packages'];

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

/** `./foo.test` / `./foo.test.js` / `../bar/baz.test.ts` のいずれも拾う。 */
const TEST_MODULE_PATTERN = /\.test(\.(ts|tsx|mts|cts|js|mjs|cjs))?$/;

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(absolutePath);
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

/** 静的 import / re-export / 動的 import / require() のモジュール指定子をすべて集める。 */
function moduleSpecifiersOf(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) specifiers.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

const allFiles = SOURCE_ROOTS.flatMap((root) => listSourceFiles(path.join(repoRoot, root)));
const productionFiles = allFiles.filter((file) => !isTestFile(file));

describe('🔴 非テストソースが *.test モジュールを import していない（走査テストの前提）', () => {
  it('対照: 走査対象のソースが存在する', () => {
    expect(productionFiles.length).toBeGreaterThan(0);
  });

  it('対照: 除外（*.test.ts）が走査対象を消し去っていない', () => {
    expect(allFiles.length).toBeGreaterThan(productionFiles.length);
  });

  it('apps/** と packages/** の非テストソースに .test モジュールの import が 0 件', () => {
    const offenders = productionFiles.flatMap((file) =>
      moduleSpecifiersOf(readFileSync(file, 'utf8'), file)
        .filter((specifier) => TEST_MODULE_PATTERN.test(specifier))
        .map((specifier) => `${path.relative(repoRoot, file).split(path.sep).join('/')} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('対照: 検出ロジックが .test の import を実際に拾う', () => {
    const source = [
      "import { a } from './secret.test';",
      "export { b } from '../other/thing.test.js';",
      "const c = await import('./late.test.ts');",
      "const d = require('./legacy.test.cjs');",
      "import { safe } from './normal';",
    ].join('\n');
    const found = moduleSpecifiersOf(source, 'sample.ts').filter((specifier) =>
      TEST_MODULE_PATTERN.test(specifier),
    );
    expect(found).toEqual([
      './secret.test',
      '../other/thing.test.js',
      './late.test.ts',
      './legacy.test.cjs',
    ]);
  });
});
