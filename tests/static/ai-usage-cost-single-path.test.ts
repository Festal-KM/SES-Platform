// tests/static/ai-usage-cost-single-path.test.ts
// 🔴 T-07-03。金額（単価表）と件数（`ROLE_UNIT`）の**置き場所と使われ方**を固定する。
//
// 何を守るテストか（型では表現できない 4 つ）:
//   ① 🔴 **金額を持つのは 1 箇所**（docs/05 §7.9 ④）。単価表の宣言は
//      `packages/domain/src/ai/pricing.ts` だけであり、`docs/03` §3.3.1 の表と合わせて 2 箇所に留まる。
//   ② 🔴 **`packages/ai` は金額を知らない**（同 §7.9 ④）。`AiUsageRecordInput` に
//      `estimatedCostUsd` が無い状態は、型では守れない（domain は `packages/ai` からも
//      import できるので、いつでも足せてしまう）。
//   ③ 🔴 **件数は金額から割り戻さない**（`F-026 AC-6` / docs/03 §7.6.3-1）。
//      `units.ts` が `pricing.ts` を参照しないことが、「1 件あたり標準原価を見直しても
//      過去の期間の件数消費と残量表示が変化しない」ことの根拠である。
//   ④ 🔴 **件数の加算経路が 1 本**（`P-A-18`）。`resolveAiUnitCount` を呼ぶ非テストソースは
//      `packages/db/src/ai-usage.ts`（＝ `countUnit` の実装）だけである。ここが増えると、
//      `AiUsage` の行数から数え直す実装や、呼び出し側が「1 件」を自分で決める実装が混ざる。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 単価表を宣言してよい唯一の場所（docs/05 §7.9 ④ / §7.11 ①）。 */
const PRICING_MODULE = 'packages/domain/src/ai/pricing.ts';
/** 🔴 件数の写像表を宣言してよい唯一の場所（`P-A-18`）。 */
const UNITS_MODULE = 'packages/domain/src/ai/units.ts';
/** 🔴 `AiUsageRecorder`（ポート）の実装本体。件数の加算と金額の算出はここに閉じる。 */
const RECORDER_MODULE = 'packages/db/src/ai-usage.ts';

/**
 * 🔴 推定コストを算出してよい場所。
 *
 * `packages/db/src/**` に限る —— 記録（T-07-03）と、呼び出し前の予約（T-07-04 の
 * `AiCostGuard.reserve`。同じ単価で見積もる）はどちらも DB 側の実装である。
 * 🔴 **`packages/ai` と `apps/**` はここに入らない**（金額を組み立てる経路を業務コードに作らない）。
 */
const COST_CALLER_PREFIX = 'packages/db/src/';

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

/** 🔴 テストは走査対象外（本リポジトリの全走査テストと同じ規約）。 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

function parse(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
}

/**
 * 1 ファイルから、本テストが問うことのできる事実を**1 回の走査で**すべて集める。
 *
 * 🔴 T-07-04: 以前は「検査する名前 1 つにつき 1 回パースする」形だったため、走査回数が
 *    **ファイル数 × 検査の数**になっていた（`apps` + `packages` の全ソースを 4 往復する）。
 *    ファイルが増えるにつれ 5 秒の既定タイムアウトに触れるようになったので、
 *    `tests/static/startup-di-callers.test.ts`（T-06-09）と同じ整理に寄せた。
 *    🔴 **判定の内容は変えていない** —— 集合への所属判定は、以前の「その名前が 1 つでも
 *    現れるか」と同値である。
 */
type FileFacts = {
  /** `const X = ...` / `function X` / `class X` の**宣言**（re-export は含まない）。 */
  readonly declared: ReadonlySet<string>;
  /** `foo(...)` / `ns.foo(...)` の**呼び出し**（識別子の言及だけでは真にならない）。 */
  readonly called: ReadonlySet<string>;
  /** AST 上に現れる識別子（コメントでの言及は含まれない）。 */
  readonly identifiers: ReadonlySet<string>;
};

function collectFacts(sourceText: string, fileName: string): FileFacts {
  const sourceFile = parse(sourceText, fileName);
  const declared = new Set<string>();
  const called = new Set<string>();
  const identifiers = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declared.add(node.name.text);
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      declared.add(node.name.text);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) called.add(callee.text);
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        called.add(callee.name.text);
      }
    }
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { declared, called, identifiers };
}

/** 静的 import / 動的 import / re-export のモジュール指定子を集める。 */
function moduleSpecifiers(sourceText: string, fileName: string): string[] {
  const sourceFile = parse(sourceText, fileName);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteralLike).text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

const sourceFiles = SCAN_ROOTS.flatMap((root) => listSourceFiles(path.join(repoRoot, root))).filter(
  (file) => !isTestFile(file),
);

/** 🔴 全ソースを 1 回だけ走査して事実を集める（以降の検査はこの表を引くだけ）。 */
const factsByFile = new Map<string, FileFacts>(
  sourceFiles.map((file) => [file, collectFacts(readFileSync(file, 'utf8'), file)]),
);

function factsOf(file: string): FileFacts {
  const facts = factsByFile.get(file);
  if (facts === undefined) throw new Error(`走査対象に含まれていません: ${file}`);
  return facts;
}

describe('🔴 AI の金額と件数の単一経路（docs/05 §7.9 ④ / §7.11 / F-026 AC-6）', () => {
  it('対照: 走査対象のソースが十分にある（テストが空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    // 🔴 ②の検査は「`packages/ai` に違反が無い」ことを見る。走査から `packages/ai` が
    //    丸ごと落ちていても緑になるため、母集団に含まれていることを別に固定する。
    const aiFiles = sourceFiles.map(toRepoRelative).filter((file) => file.startsWith('packages/ai/'));
    expect(aiFiles.length).toBeGreaterThan(5);
    expect(aiFiles).toContain('packages/ai/src/run.ts');
  });

  it('① 単価表（AI_MODEL_PRICING）を宣言する非テストソースは 1 つだけ', () => {
    const declarers = sourceFiles
      .filter((file) => factsOf(file).declared.has('AI_MODEL_PRICING'))
      .map(toRepoRelative);
    expect(declarers).toEqual([PRICING_MODULE]);
  });

  it('🔴 ② packages/ai は単価表にも推定コストにも触れない（AiUsageRecordInput に金額が無い状態を保つ）', () => {
    // 🔴 コメントでの言及は許す（AST 上の識別子の出現だけを見る）。
    const forbidden = ['AI_MODEL_PRICING', 'estimateAiCostUsd', 'resolveAiModelPrice'];
    const offenders = sourceFiles
      .filter((file) => toRepoRelative(file).startsWith('packages/ai/'))
      .filter((file) => forbidden.some((name) => factsOf(file).identifiers.has(name)))
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });

  it('② 推定コストを算出する非テストソースは packages/db/src/** に限る', () => {
    const callers = sourceFiles
      .filter((file) => factsOf(file).called.has('estimateAiCostUsd'))
      .map(toRepoRelative);
    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) {
      expect(caller.startsWith(COST_CALLER_PREFIX)).toBe(true);
    }
  });

  it('🔴 ③ 件数の写像（units.ts）が単価（pricing.ts）を参照しない', () => {
    const source = readFileSync(path.join(repoRoot, UNITS_MODULE), 'utf8');
    const specifiers = moduleSpecifiers(source, UNITS_MODULE);
    expect(specifiers.some((specifier) => specifier.includes('pricing'))).toBe(false);
    expect(specifiers).toEqual(['./roles.js']);
  });

  it('🔴 ④ 件数の解決（resolveAiUnitCount）を呼ぶ非テストソースは記録側の 1 本だけ', () => {
    const callers = sourceFiles
      .filter((file) => factsOf(file).called.has('resolveAiUnitCount'))
      .map(toRepoRelative);
    expect(callers).toEqual([RECORDER_MODULE]);
  });

  it('④ 件数の写像表（ROLE_UNIT）を宣言する非テストソースも 1 つだけ', () => {
    const declarers = sourceFiles
      .filter((file) => factsOf(file).declared.has('ROLE_UNIT'))
      .map(toRepoRelative);
    expect(declarers).toEqual([UNITS_MODULE]);
  });
});
