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

// ============================================================================
// 🔴 T-08-06: apps/web からの `@ses/ai` import を**マスキング系と型だけ**に固定する
// ============================================================================
//
// T-08-06 で `apps/web` が `@ses/ai` に依存するようになった（依頼メッセージの商流照合に `mask()` を使う。
// docs/05 §6.5「#31 の実装の決着」）。それ以前は**依存が無いこと自体**が「`apps/web` に LLM 呼び出しを
// 置かない」（docs/05 §1.2）の担保だったため、依存が入った以上は**import 名で**塞ぐ必要がある
// （`createAiClient` / `createRoleRunner` を `apps/web` で import できれば、`AiUsage` に残らない呼び出し経路が
// 書ける。`CLAUDE.md` §3.2「記録しない呼び出し経路を作らない」）。
//
// 🔴 **許可リスト方式**（`auth-db-callers.test.ts` と同じ向き）: バレルに実行系の名前が増えても、
//    許可リストに無い名前は既定で落ちる。禁止リスト（名前を列挙して塞ぐ）にすると、バレルへ名前を 1 つ足した
//    瞬間に穴が開く。
// 🔴 型だけの import（`import type` / `type` 修飾された named import）は実行時の依存にならないので許す。
// 🔴 名前空間 import・default import・動的 import・`require`・再 export は、名前で判定できないか
//    実行系に到達できるため、形そのものを違反とする。
// 🔴 ESLint ではなくここで見る理由: `apps/worker` は同じ名前（`createRoleRunner` / `gateInspectorSpec`）を
//    正当に import する。両者は CATCH_ALL_ZONE に同居しており、`apps/web` だけに `importNames` の制限を掛けるには
//    ゾーンを割る必要がある（flat config の「後勝ち・丸ごと置換」を避けるため、ファイル集合を重ねられない）。
//    ゾーンの分割は依存方向ルール全体の構造を動かすので、走査テストで固定する。

/** `apps/web` が `@ses/ai` から**値として** import してよい名前（これ以外は既定で禁止）。 */
const WEB_ALLOWED_AI_VALUE_IMPORTS: readonly string[] = ['mask', 'MASK_CATEGORIES', 'MASK_PLACEHOLDERS'];

const AI_PACKAGE = '@ses/ai';

function isAiModuleSpecifier(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    ts.isStringLiteralLike(node) &&
    (node.text === AI_PACKAGE || node.text.startsWith(`${AI_PACKAGE}/`))
  );
}

/**
 * `@ses/ai` への import のうち、許可されない形・名前を返す（空配列 = 違反なし）。
 * 戻り値は「どの形で何を持ち込もうとしたか」の説明であり、テストの失敗メッセージに使う。
 */
export function webAiImportViolations(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && isAiModuleSpecifier(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause !== undefined && !clause.isTypeOnly) {
        if (clause.name !== undefined) violations.push(`default import (${clause.name.text})`);
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          violations.push(`namespace import (* as ${bindings.name.text})`);
        }
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            const imported = (element.propertyName ?? element.name).text;
            if (!WEB_ALLOWED_AI_VALUE_IMPORTS.includes(imported)) violations.push(`named import (${imported})`);
          }
        }
      }
    }
    if (ts.isExportDeclaration(node) && isAiModuleSpecifier(node.moduleSpecifier) && !node.isTypeOnly) {
      if (node.exportClause === undefined) violations.push('export * from');
      else if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          if (element.isTypeOnly) continue;
          const exported = (element.propertyName ?? element.name).text;
          if (!WEB_ALLOWED_AI_VALUE_IMPORTS.includes(exported)) violations.push(`re-export (${exported})`);
        }
      } else violations.push('export * as ns from');
    }
    if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && isAiModuleSpecifier(argument)) {
        violations.push('dynamic import()');
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        isAiModuleSpecifier(argument)
      ) {
        violations.push('require()');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

describe('🔴 T-08-06: apps/web からの @ses/ai import はマスキング系（mask / MASK_*）と型だけ（docs/05 §1.2 / §6.5）', () => {
  it('fixture: apps/web からの createAiClient / createRoleRunner の import が検出される', () => {
    expect(
      webAiImportViolations(readFixture('web-ai-execution-import.violation.ts'), 'apps/web/lib/__violation__.ts'),
    ).toEqual(['named import (createAiClient)', 'named import (createRoleRunner)']);
  });

  it('fixture: 名前空間 import / 動的 import / 再 export も検出される', () => {
    expect(
      webAiImportViolations(readFixture('web-ai-namespace-import.violation.ts'), 'apps/web/lib/__violation__.ts'),
    ).toEqual(['namespace import (* as ai)']);
    expect(
      webAiImportViolations(readFixture('web-ai-dynamic-import.violation.ts'), 'apps/web/lib/__violation__.ts'),
    ).toEqual(['dynamic import()']);
    expect(
      webAiImportViolations(readFixture('web-ai-reexport.violation.ts'), 'apps/web/lib/__violation__.ts'),
    ).toEqual(['re-export (gateInspectorSpec)']);
  });

  it('対照 fixture: mask / MASK_* と型だけの import は違反なし', () => {
    expect(
      webAiImportViolations(readFixture('web-ai-mask-import.ok.ts'), 'apps/web/lib/__ok__.ts'),
    ).toEqual([]);
  });

  const webSourceFiles = listSourceFiles(path.join(repoRoot, 'apps', 'web')).filter((file) => !isTestFile(file));
  const webAiImporters = webSourceFiles
    .filter((file) => /['"]@ses\/ai(\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')))
    .map(toRepoRelative)
    .sort();

  it('対照: apps/web に @ses/ai を import する実ファイルがある（走査が空振りしていない）', () => {
    // T-08-06 の依頼メッセージの商流照合。ここが 0 件になったら、この検査自体の前提（依存の存在）を見直す。
    expect(webAiImporters).toContain('apps/web/lib/proposal-requests/message-check.ts');
  });

  // 🔴 T-12-10: `apps/web` のソースが増えて既定の 5 秒に収まらなくなったため、この 1 本にだけ
  //    明示のタイムアウトを置く。**走査対象は 1 ファイルも狭めない** —— 狭めると
  //    「`apps/web` から LLM を呼ぶ import」の検出が静かに抜ける（`CLAUDE.md` §3.2）。
  it(
    '🔴 apps/web の非テストソースに、許可リスト外の @ses/ai import が 1 つも無い',
    () => {
      const offenders = webSourceFiles
        .map((file) => ({
          file: toRepoRelative(file),
          violations: webAiImportViolations(readFileSync(file, 'utf8'), file),
        }))
        .filter((entry) => entry.violations.length > 0);
      expect(
        offenders,
        'apps/web は @ses/ai から mask / MASK_CATEGORIES / MASK_PLACEHOLDERS と型だけを import できます' +
          '（docs/05 §1.2「apps/web に LLM 呼び出しを置かない」/ CLAUDE.md §3.2）。' +
          'LLM を呼ぶ処理は apps/worker のジョブに置いてください。',
      ).toEqual([]);
    },
    30_000,
  );
});
