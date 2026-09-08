// tests/static/prompt-registry-single-path.test.ts
// docs/05 §17.2 #25 / §7.7（T-07-05）: 🔴 **製品プロンプトの読み込み口を 1 本に固定する。**
//
// なぜ静的検査が要るか:
//   ① ESLint（`no-restricted-imports`）は「`packages/ai` 以外は `@ses/prompts` を import できない」
//      までしか言えない。`packages/ai` の**中**で読み込みが散ると、`runRole` を経ない
//      プロンプトの組み立て（＝ 版の記録を伴わない生成）がパッケージ内部で成立する。
//   ② プロンプト側が何かを import できると、そこから DB・LLM・ファイル I/O に到達しうる。
//      「プロンプトはデータであって実行主体ではない」（CLAUDE.md §12.3）を構造で保つ。
//   ③ 版（`{role}.v{n}`）とファイル名がずれると、生成物に保存された版から文面を再現できない
//      （`BR-13`）。ファイル名・`version` リテラル・登録表の 3 つを突き合わせる。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages', 'prompts', 'scripts'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 `@ses/prompts` を import してよい唯一のファイル（docs/05 §7.7 / §7.13）。 */
const ALLOWED_PROMPT_READERS = ['packages/ai/src/prompts.ts'];

const PROMPTS_ROLES_DIR = path.join(repoRoot, 'prompts', 'roles');

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

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** import / export ... from / 動的 import / require の**モジュール指定子**を集める。 */
function moduleSpecifiers(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const [first] = node.arguments;
      if ((isDynamicImport || isRequire) && first !== undefined && ts.isStringLiteral(first)) {
        specifiers.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

const sourceFiles = SCAN_ROOTS.flatMap((root) => {
  const dir = path.join(repoRoot, root);
  try {
    return statSync(dir).isDirectory() ? listSourceFiles(dir) : [];
  } catch {
    return [];
  }
}).filter((file) => !isTestFile(file));

const promptReaders = sourceFiles
  .filter((file) =>
    moduleSpecifiers(readFileSync(file, 'utf8'), file).some(
      (specifier) => specifier === '@ses/prompts' || specifier.startsWith('@ses/prompts/'),
    ),
  )
  .map(toRepoRelative)
  .sort();

const promptSourceFiles = listSourceFiles(PROMPTS_ROLES_DIR);

describe('🔴 製品プロンプトの読み込み口（docs/05 §7.7 / CLAUDE.md §2.1）', () => {
  it('対照: 走査対象のソースが十分にある（テストが空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    expect(promptSourceFiles.length).toBeGreaterThan(0);
  });

  it('@ses/prompts を import する非テストソースは packages/ai/src/prompts.ts の 1 本だけ', () => {
    expect(promptReaders).toEqual([...ALLOWED_PROMPT_READERS].sort());
  });

  it('🔴 許可されているのは 1 ファイルだけである（増やすときは docs/05 §7.7 と併せて人間が判断する）', () => {
    expect(ALLOWED_PROMPT_READERS).toHaveLength(1);
  });
});

describe('🔴 プロンプトはデータである（何にも依存しない。CLAUDE.md §12.3）', () => {
  it.each(promptSourceFiles.map(toRepoRelative))('%s は相対 import しか持たない', (relative) => {
    const specifiers = moduleSpecifiers(readFileSync(path.join(repoRoot, relative), 'utf8'), relative);
    const external = specifiers.filter((specifier) => !specifier.startsWith('./') && !specifier.startsWith('../'));
    expect(external, `外部 import があります: ${external.join(', ')}`).toEqual([]);
  });

  it.each(promptSourceFiles.map(toRepoRelative))('%s は自分のディレクトリの外を参照しない', (relative) => {
    const specifiers = moduleSpecifiers(readFileSync(path.join(repoRoot, relative), 'utf8'), relative);
    // 🔴 `../../packages/ai/src/mask.js` のような相対パスでの脱出を塞ぐ（依存の循環そのもの）。
    expect(specifiers.filter((specifier) => specifier.startsWith('../'))).toEqual([]);
  });
});

describe('🔴 版とファイル名と登録表の一致（BR-13 の再現性）', () => {
  const versionFiles = promptSourceFiles
    .map(toRepoRelative)
    .filter((relative) => /\.v[0-9]+\.ts$/.test(relative));

  it('対照: 版付きのプロンプトファイルが 1 つ以上ある', () => {
    expect(versionFiles.length).toBeGreaterThan(0);
  });

  it.each(versionFiles)('%s の version リテラルがファイル名と一致する', (relative) => {
    const expected = path.basename(relative).replace(/\.ts$/, '');
    const text = readFileSync(path.join(repoRoot, relative), 'utf8');
    expect(text).toContain(`version: '${expected}'`);
  });

  it.each(versionFiles)('%s が prompts/roles/index.ts の登録表に現れる（古い版を消さない）', (relative) => {
    const index = readFileSync(path.join(PROMPTS_ROLES_DIR, 'index.ts'), 'utf8');
    const moduleName = path.basename(relative).replace(/\.ts$/, '');
    expect(index).toContain(`./${moduleName}.js`);
    expect(index).toContain(`'${moduleName}'`);
  });
});
