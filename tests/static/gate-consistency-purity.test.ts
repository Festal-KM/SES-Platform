// tests/static/gate-consistency-purity.test.ts
// docs/05 §17.2 #9:「🔴 `decideConsistency` の**引数型に AI 由来の型が現れない**（`BR-61`）」。
// T-07-07（docs/sprints/SP-07-ai-layer-gate.md）。
//
// ============================================================================
// 🔴 なぜ「引数型」を機械で見張るのか
// ============================================================================
// 整合層の合否は機械的な照合だけで決まる（`CLAUDE.md` §3.3 / §12.3 / `F-020 AC-3`）。この規律は
// 一度でも破ると**壊れたことが誰にも見えない**: 合否が LLM の応答で揺れても画面は同じ形で
// PASS / FAIL を出すため、承認の根拠にも監査の根拠にもならなくなったことに気づけない。
// 「レビューで気をつける」で守れる性質ではないので、**渡せる型が無い**という構造で守り、
// その構造自体をここで検査する。
//
// 検査は 4 つある（いずれも fixture で検出ロジックの対照を取る）:
//   ① 引数型の**出所** … 引数から到達できる型の宣言が `packages/domain/src/gate/**` の中で閉じている
//      （`packages/ai` / `prompts/` / `@anthropic-ai/sdk` の型は、どう名前を変えてもここで落ちる）
//   ② 引数型の**語彙** … 型名・プロパティ名に AI 由来の語（`ai` / `warning` / `prompt` …）が無い
//      （domain の中で `aiWarnings` を再宣言する迂回を塞ぐ。①だけでは通ってしまう）
//   ③ **引数の数** … 引数は 1 つだけ（第 2 引数に AI の結果を足す抜け道を塞ぐ）
//   ④ **呼び出し式** … `decideConsistency(...)` の実引数に AI 由来の識別子が現れない
//      （T-07-06 のパイプラインで `as` を 1 つ書かれると型検査だけでは止まらない）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'gate-consistency-purity');

const TARGET_FILE = 'packages/domain/src/gate/consistency.ts';
const FUNCTION_NAME = 'decideConsistency';

/** 🔴 引数型の宣言が置かれてよい場所（ゲートのドメインモジュールの中だけ）。 */
const ALLOWED_ORIGIN_PREFIX = 'packages/domain/src/gate/';

const SCAN_ROOTS = ['apps', 'packages', 'prompts', 'scripts'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * 🔴 AI 由来を示す語（識別子をトークンに割ってから完全一致で見る）。
 *
 * 部分一致にしない —— `available` / `mail` / `fail` が `ai` に当たってしまい、検査が
 * 「動いているのにいつも赤い」か「例外だらけ」のどちらかに壊れる。
 */
const FORBIDDEN_TOKENS = new Set([
  'ai',
  'llm',
  'anthropic',
  'claude',
  'model',
  'models',
  'prompt',
  'prompts',
  'inspector',
  'warn',
  'warning',
  'warnings',
  'rationale',
  'draft',
  'completion',
  'token',
  'tokens',
]);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ['lib.es2023.d.ts'],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

// ============================================================================
// 共通ユーティリティ
// ============================================================================

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** 識別子を小文字トークンに割る（camelCase / PascalCase / snake_case / kebab-case）。 */
function tokenize(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => (part.length === 0 ? [] : [part.toLowerCase()]));
}

function forbiddenNames(names: Iterable<string>): string[] {
  return [...names]
    .filter((name) => tokenize(name).some((token) => FORBIDDEN_TOKENS.has(token)))
    .sort();
}

function isLibFile(fileName: string): boolean {
  return /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]/.test(fileName);
}

// ============================================================================
// ①②③ 引数型の解析（TypeScript の型チェッカで到達できる全体を見る）
// ============================================================================

type ParameterAnalysis = {
  readonly parameterCount: number;
  /** 引数から到達できる型名・プロパティ名。 */
  readonly names: ReadonlySet<string>;
  /** それらの宣言ファイル（repo 相対。TypeScript の lib は除く）。 */
  readonly origins: ReadonlySet<string>;
  /** モジュール解決の失敗（型が `any` に潰れて検査が空振りするのを防ぐ）。 */
  readonly unresolvedImports: readonly string[];
};

function analyzeParameters(entryFile: string): ParameterAnalysis {
  const program = ts.createProgram([entryFile], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryFile);
  if (sourceFile === undefined) throw new Error(`${entryFile} を読み込めませんでした。`);

  const unresolvedImports = program
    .getSemanticDiagnostics(sourceFile)
    .filter((diagnostic) => diagnostic.code === 2307 || diagnostic.code === 2792)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));

  let target: ts.FunctionDeclaration | undefined;
  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === FUNCTION_NAME) target = node;
  });
  if (target === undefined) {
    throw new Error(`${entryFile} に ${FUNCTION_NAME} の関数宣言が見つかりません。`);
  }
  const parameters = target.parameters;

  const names = new Set<string>();
  const origins = new Set<string>();
  const visited = new Set<number>();

  function recordSymbol(symbol: ts.Symbol | undefined): boolean {
    if (symbol === undefined) return false;
    const name = symbol.getName();
    // 匿名の型リテラル（`__type`）・インデックス（`__index`）は名前を持たない。
    if (!name.startsWith('__')) names.add(name);
    const declarations = symbol.getDeclarations() ?? [];
    let libOnly = declarations.length > 0;
    for (const declaration of declarations) {
      const fileName = declaration.getSourceFile().fileName;
      if (isLibFile(fileName)) continue;
      libOnly = false;
      origins.add(toRepoRelative(fileName));
    }
    return libOnly;
  }

  function walk(type: ts.Type, location: ts.Node): void {
    const id = (type as unknown as { id?: number }).id;
    if (id !== undefined) {
      if (visited.has(id)) return;
      visited.add(id);
    }

    const aliasIsLibOnly = recordSymbol(type.aliasSymbol);
    const symbolIsLibOnly = recordSymbol(type.getSymbol());

    if (type.isUnionOrIntersection()) {
      for (const member of type.types) walk(member, location);
    }
    for (const argument of type.aliasTypeArguments ?? []) walk(argument, location);
    const objectFlags = (type as ts.ObjectType).objectFlags ?? 0;
    if ((type.flags & ts.TypeFlags.Object) !== 0 && (objectFlags & ts.ObjectFlags.Reference) !== 0) {
      for (const argument of checker.getTypeArguments(type as ts.TypeReference)) {
        walk(argument, location);
      }
    }

    // 🔴 組み込み型（`Array` / `String` …）のメンバまでは辿らない。辿ると lib の中を延々と
    //    歩くだけで、検査したい「我々が宣言した形」がノイズに埋もれる。型引数は上で辿っている。
    if (aliasIsLibOnly || symbolIsLibOnly) return;

    for (const property of checker.getPropertiesOfType(type)) {
      names.add(property.getName());
      recordSymbol(property);
      walk(checker.getTypeOfSymbolAtLocation(property, location), location);
    }
  }

  for (const parameter of parameters) {
    walk(checker.getTypeAtLocation(parameter), parameter);
  }

  return { parameterCount: parameters.length, names, origins, unresolvedImports };
}

// ============================================================================
// ④ 呼び出し式の解析
// ============================================================================

type CallSite = {
  readonly file: string;
  readonly identifiers: readonly string[];
};

function analyzeCallSites(sourceText: string, fileName: string): CallSite[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const calls: CallSite[] = [];

  function collectIdentifiers(node: ts.Node, into: string[]): void {
    if (ts.isIdentifier(node)) into.push(node.text);
    ts.forEachChild(node, (child) => {
      collectIdentifiers(child, into);
    });
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === FUNCTION_NAME
    ) {
      const identifiers: string[] = [];
      for (const argument of node.arguments) collectIdentifiers(argument, identifiers);
      calls.push({ file: toRepoRelative(path.resolve(fileName)), identifiers });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

/** ファイルが外部を指す記述（import / export / `import(...)` 型 / 動的 import）の集合。 */
function moduleReferences(absolutePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    // `import('...').Foo`（型の位置での参照。型チェッカ側では別名が消えることがある）
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteralLike(literal)) specifiers.push(literal.text);
    }
    // `await import('...')`
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
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

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

const productionSources = SCAN_ROOTS.flatMap((root) => {
  const dir = path.join(repoRoot, root);
  try {
    return statSync(dir).isDirectory() ? listSourceFiles(dir) : [];
  } catch {
    return [];
  }
}).filter((file) => !isTestFile(file));

const analysis = analyzeParameters(path.join(repoRoot, TARGET_FILE));

describe('🔴 decideConsistency の引数型に AI 由来の型が現れない（docs/05 §17.2 #9 / BR-61）', () => {
  it('対照: 解析が空振りしていない（型が解決され、我々の宣言に到達している）', () => {
    expect(analysis.unresolvedImports).toEqual([]);
    // 引数型の骨格。ここが欠けたら「型が any に潰れているのに緑」になっている。
    for (const expected of ['ConsistencyInput', 'subject', 'snapshot', 'requirements', 'registeredSkills']) {
      expect([...analysis.names]).toContain(expected);
    }
  });

  it('🔴 ③ 引数は 1 つだけ（第 2 引数に AI の結果を足す抜け道を作らない）', () => {
    expect(analysis.parameterCount).toBe(1);
  });

  it('🔴 ① 引数から到達できる型の宣言が packages/domain/src/gate/** に閉じている', () => {
    const outside = [...analysis.origins].filter((origin) => !origin.startsWith(ALLOWED_ORIGIN_PREFIX)).sort();
    expect(outside).toEqual([]);
    expect(analysis.origins.size).toBeGreaterThan(0);
  });

  it('🔴 ② 型名・プロパティ名に AI 由来の語が 1 つも無い', () => {
    expect(forbiddenNames(analysis.names)).toEqual([]);
  });

  it('🔴 consistency.ts が gate モジュールの外を 1 つも参照していない（到達経路そのものが無い）', () => {
    // 🔴 ①（型チェッカによる出所の検査）だけでは、**プリミティブに解決される型別名**
    //    （`type X = (typeof ARR)[number]` など）が別名を失って出所を持たなくなる。
    //    そこで「ファイルが外を指す記述を 1 つも持たない」ことを構文でも固定する:
    //    import 宣言・export 宣言・**`import(...)` 型**・動的 import のすべてを見る。
    const specifiers = moduleReferences(path.join(repoRoot, TARGET_FILE));
    expect(specifiers.length).toBeGreaterThan(0);
    // 同じディレクトリの相対参照だけ（`@ses/ai` も `../` も無い）。
    expect(specifiers.filter((specifier) => !specifier.startsWith('./'))).toEqual([]);
  });
});

describe('🔴 ④ decideConsistency の呼び出しに AI 由来の値を渡していない', () => {
  const callSites = productionSources.flatMap((file) =>
    analyzeCallSites(readFileSync(file, 'utf8'), file),
  );

  it('対照: 走査対象のソースが十分にある', () => {
    expect(productionSources.length).toBeGreaterThan(50);
  });

  it('実引数に AI 由来の識別子が現れない', () => {
    // ⚠️ T-07-06（`gate.run` のパイプライン）が最初の呼び出し元になる。それまでは 0 件であり、
    //    検出ロジックが動くことは下の fixture が保証している（0 件でも空振りにしない）。
    const violations = callSites
      .map((call) => ({ file: call.file, forbidden: forbiddenNames(call.identifiers) }))
      .filter((entry) => entry.forbidden.length > 0);
    expect(violations).toEqual([]);
  });
});

describe('検出ロジックの対照（fixture）', () => {
  function analyzeFixture(name: string): ParameterAnalysis {
    return analyzeParameters(path.join(fixturesDir, name));
  }

  const fixturePrefix = toRepoRelative(fixturesDir);

  it('適合: 自ファイルで閉じた無害な引数型は、どの検査にも掛からない', () => {
    const clean = analyzeFixture('clean.ok.ts');
    expect(clean.parameterCount).toBe(1);
    expect(forbiddenNames(clean.names)).toEqual([]);
    expect([...clean.origins]).toEqual([`${fixturePrefix}/clean.ok.ts`]);
  });

  it('🔴 違反: 引数型に AI の警告が現れる（②が捕まえる）', () => {
    const violation = analyzeFixture('ai-warnings.violation.ts');
    expect(forbiddenNames(violation.names)).toEqual(['GateInspectorWarning', 'aiWarnings']);
    // 出所は自ファイル内なので①では捕まらない —— だから語彙の検査を別に置いている。
    expect([...violation.origins]).toEqual([`${fixturePrefix}/ai-warnings.violation.ts`]);
  });

  it('🔴 違反: 引数型が他ファイル由来の型を含む（①が捕まえる。名前は無害）', () => {
    const violation = analyzeFixture('foreign-type.violation.ts');
    expect(forbiddenNames(violation.names)).toEqual([]);
    expect([...violation.origins].sort()).toEqual([
      `${fixturePrefix}/foreign-type.violation.ts`,
      `${fixturePrefix}/role-output.helper.ts`,
    ]);
  });

  it('🔴 違反: 第 2 引数に AI の結果を足す（③が捕まえる）', () => {
    const violation = analyzeFixture('second-parameter.violation.ts');
    expect(violation.parameterCount).toBe(2);
    expect(forbiddenNames(violation.names)).toEqual(['InspectorResult', 'warnings']);
  });

  it('適合: 呼び出し側が永続化された値だけを渡している', () => {
    const file = path.join(fixturesDir, 'call-clean.ok.ts');
    const calls = analyzeCallSites(readFileSync(file, 'utf8'), file);
    expect(calls).toHaveLength(1);
    expect(forbiddenNames(calls[0]?.identifiers ?? [])).toEqual([]);
  });

  it('🔴 違反: 呼び出し側が gate-inspector の出力を流し込んでいる（④が捕まえる）', () => {
    const file = path.join(fixturesDir, 'call-with-ai-warnings.violation.ts');
    const calls = analyzeCallSites(readFileSync(file, 'utf8'), file);
    expect(calls).toHaveLength(1);
    expect(forbiddenNames(calls[0]?.identifiers ?? [])).toEqual([
      'aiResult',
      'aiWarnings',
      'consistencyWarnings',
    ]);
  });
});
