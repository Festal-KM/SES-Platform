// tests/static/domain-purity.test.ts
// T-01-07（docs/sprints/SP-01-bootstrap.md）/ docs/05 §17.2 #14:
// packages/domain に `Date` の直接参照・`process.env` / `process.*`・I/O import が無いことを検証する
// （CLAUDE.md §2.1「packages/domain は何にも依存しない。DB・ネットワーク・現在時刻の取得を持ち込まない」）。
//
// eslint.config.mjs の packages/domain ゾーン（forbidAllSes / forbidNodeIo）は import 経路をすでに
// 塞いでいる（tests/static/no-restricted-imports.test.ts が検証）。本テストはそれと重複しても構わない
// （import 系は AST でも二重に検査する）が、🔴 ESLint では検知できない「組み込みグローバルへの直接参照」
// （`new Date()` / `Date.now()` / `Math.random()` / `process.env` / タイマー呼び出し）を必ずカバーする。
//
// AST 走査は TypeScript compiler API（`typescript`）を直接使う。ESLint 基盤（lintText）を使う既存 3 本
// （no-restricted-imports / ai-single-path / db-raw-access）とは異なる経路のため、beforeAll の ESLint
// ウォームアップは不要（ESLint インスタンスを生成しない）。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const domainSrcDir = path.join(repoRoot, 'packages', 'domain', 'src');
const fixturesDir = path.join(here, '__fixtures__', 'domain-purity');

// eslint.config.mjs の NODE_IO_MODULE_NAMES と同じ列挙（単一の import 元が無いため意図的に複製。
// ずれた場合は tests/static/no-restricted-imports.test.ts 側の fixture が別途検知する）。
// `process` は明示 import（`node:process`）による迂回も塞ぐために追加する。
const NODE_IO_MODULE_NAMES = new Set([
  'fs',
  'net',
  'http',
  'https',
  'http2',
  'child_process',
  'dgram',
  'dns',
  'tls',
  'cluster',
  'worker_threads',
  'crypto',
  'timers',
  'stream',
  'process',
]);

const TIMER_CALL_NAMES = new Set([
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',
]);

type ViolationRule =
  | 'NEW_DATE'
  | 'DATE_STATIC_CALL'
  | 'MATH_RANDOM'
  | 'PROCESS_REFERENCE'
  | 'TIMER_CALL'
  | 'NODE_IO_IMPORT'
  | 'SES_IMPORT';

type Violation = {
  rule: ViolationRule;
  text: string;
  line: number;
};

function isIdentifierNamed(node: ts.Node, name: string): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === name;
}

function moduleBaseName(specifier: string): string {
  const withoutNodePrefix = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  return withoutNodePrefix.split('/')[0] ?? withoutNodePrefix;
}

/**
 * 与えられた TypeScript ソースを走査し、純粋性違反を列挙する。
 * 検査対象（docs/05 §17.2 #14 / 実装ガイド）:
 *   - `new Date()`（現在時刻の直接取得）
 *   - `Date.xxx()`（`Date.now()` を含む静的メソッド呼び出し）
 *   - `Math.random()`
 *   - `process.env` / `process.*`（プロパティ・要素アクセス）
 *   - タイマー（`setTimeout` 等）の呼び出し
 *   - Node I/O モジュールの import（静的 / 動的 import / require()）
 *   - `@ses/*` の import（静的 / 動的 import / require()）
 */
function findPurityViolations(sourceText: string, fileName: string): Violation[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const violations: Violation[] = [];

  function lineOf(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function report(rule: ViolationRule, node: ts.Node): void {
    violations.push({ rule, text: node.getText(sourceFile), line: lineOf(node) });
  }

  function checkModuleSpecifier(specifier: string, node: ts.Node): void {
    if (specifier.startsWith('@ses/')) {
      report('SES_IMPORT', node);
    }
    if (NODE_IO_MODULE_NAMES.has(moduleBaseName(specifier))) {
      report('NODE_IO_IMPORT', node);
    }
  }

  function visit(node: ts.Node): void {
    // new Date(...)
    if (ts.isNewExpression(node) && isIdentifierNamed(node.expression, 'Date')) {
      report('NEW_DATE', node);
    }

    // Date.xxx(...)（Date.now() を含む）
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isIdentifierNamed(node.expression.expression, 'Date')
    ) {
      report('DATE_STATIC_CALL', node);
    }

    // Math.random()
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isIdentifierNamed(node.expression.expression, 'Math') &&
      node.expression.name.text === 'random'
    ) {
      report('MATH_RANDOM', node);
    }

    // process.env / process.*（プロパティ・要素アクセス）
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isIdentifierNamed(node.expression, 'process')
    ) {
      report('PROCESS_REFERENCE', node);
    }

    // タイマー呼び出し（setTimeout 等の裸の識別子呼び出し）
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TIMER_CALL_NAMES.has(node.expression.text)) {
      report('TIMER_CALL', node);
    }

    // 静的 import / re-export
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      checkModuleSpecifier(node.moduleSpecifier.text, node);
    }

    // 動的 import（import('...')）。`ts.isImportCall` は型定義に無い内部 API のため、
    // 同じ判定（CallExpression の expression が ImportKeyword トークン）を手で書く。
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        checkModuleSpecifier(arg.text, node);
      }
    }

    // require('...')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        checkModuleSpecifier(arg.text, node);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

/** packages/domain/src 配下の .ts ファイルを再帰的に列挙する（dist / node_modules は対象外）。 */
function listDomainSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      files.push(...listDomainSourceFiles(full));
    } else if (statSync(full).isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('packages/domain の純粋性（CLAUDE.md §2.1 / docs/05 §17.2 #14）', () => {
  it('対照: このテスト自体が空振りしていない（packages/domain/src に 1 件以上のソースがある）', () => {
    const files = listDomainSourceFiles(domainSrcDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('packages/domain/src 配下の全ファイルに純粋性違反が 0 件', () => {
    const files = listDomainSourceFiles(domainSrcDir);
    const allViolations = files.flatMap((file) =>
      findPurityViolations(readFileSync(file, 'utf8'), file).map((v) => ({
        ...v,
        file: path.relative(repoRoot, file),
      })),
    );
    expect(allViolations).toEqual([]);
  });

  it('違反 fixture: new Date() を検出する', () => {
    const violations = findPurityViolations(readFixture('new-date.violation.ts'), 'new-date.violation.ts');
    expect(violations.some((v) => v.rule === 'NEW_DATE')).toBe(true);
  });

  it('違反 fixture: Date.now() を検出する', () => {
    const violations = findPurityViolations(readFixture('date-now.violation.ts'), 'date-now.violation.ts');
    expect(violations.some((v) => v.rule === 'DATE_STATIC_CALL')).toBe(true);
  });

  it('違反 fixture: Math.random() を検出する', () => {
    const violations = findPurityViolations(readFixture('math-random.violation.ts'), 'math-random.violation.ts');
    expect(violations.some((v) => v.rule === 'MATH_RANDOM')).toBe(true);
  });

  it('違反 fixture: process.env を検出する', () => {
    const violations = findPurityViolations(readFixture('process-env.violation.ts'), 'process-env.violation.ts');
    expect(violations.some((v) => v.rule === 'PROCESS_REFERENCE')).toBe(true);
  });

  it('違反 fixture: process.env 以外の process.* を検出する', () => {
    const violations = findPurityViolations(
      readFixture('process-other.violation.ts'),
      'process-other.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'PROCESS_REFERENCE')).toBe(true);
  });

  it('違反 fixture: Node I/O モジュールの静的 import を検出する', () => {
    const violations = findPurityViolations(
      readFixture('node-io-import.violation.ts'),
      'node-io-import.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'NODE_IO_IMPORT')).toBe(true);
  });

  it('違反 fixture: @ses/* の静的 import を検出する', () => {
    const violations = findPurityViolations(readFixture('ses-import.violation.ts'), 'ses-import.violation.ts');
    expect(violations.some((v) => v.rule === 'SES_IMPORT')).toBe(true);
  });

  it('違反 fixture: @ses/* の動的 import (import()) を検出する', () => {
    const violations = findPurityViolations(
      readFixture('dynamic-ses-import.violation.ts'),
      'dynamic-ses-import.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'SES_IMPORT')).toBe(true);
  });

  it('違反 fixture: require() 経由の Node I/O import を検出する', () => {
    const violations = findPurityViolations(
      readFixture('require-node-io.violation.ts'),
      'require-node-io.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'NODE_IO_IMPORT')).toBe(true);
  });

  it('違反 fixture: タイマー（setTimeout）を検出する', () => {
    const violations = findPurityViolations(readFixture('timer.violation.ts'), 'timer.violation.ts');
    expect(violations.some((v) => v.rule === 'TIMER_CALL')).toBe(true);
  });

  it('対照: 純粋関数のみの fixture は違反 0 件（`now: Date` の型注釈は誤検知しない）', () => {
    const violations = findPurityViolations(readFixture('clean.ok.ts'), 'clean.ok.ts');
    expect(violations).toEqual([]);
  });
});
