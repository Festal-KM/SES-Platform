// tests/static/startup-di-callers.test.ts
// 🔴 T-03-12 の完了判定 4（docs/sprints/SP-03 §4 / §5「静的テスト: 起動時 DI 呼び出しの走査」）。
//
// 何を守るテストか:
//   `apps/web/instrumentation.ts` と `apps/worker/src/main.ts` から起動時 DI の呼び出しが
//   消えても、**他のテストは全部 green のままになる**（アプリは動き、環境変数の不備は
//   最初のリクエストまで表面化しない）。それが T-03-12 以前の状態そのものだったので、
//   「呼び出しが存在すること」を機械的に固定する。
//
// 検査は 2 段に分ける（呼び出しの連鎖を 1 本ずつ押さえる）:
//   ① `instrumentation.ts` / `main.ts` が `@ses/config` の `initializeRuntimeConfig` を呼ぶ
//   ② `packages/config/src/startup.ts` が `loadAppEnv` と `resolveConnectorSelection` を呼ぶ
//   → ①②のどちらが消えても落ちる = 「起動時に `loadAppEnv` が呼ばれる」ことの担保になる。
//
// 加えて 🔴 **入口が 1 つであること**も見る（web と worker で別々の判定を書かない。
// `apps/**` が `loadAppEnv` / `resolveConnectorSelection` を直接呼ばない）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 Next.js が起動時に `register()` を呼ぶファイル。名前も場所も規約であり、動かせない。 */
const WEB_ENTRY = 'apps/web/instrumentation.ts';
/** 🔴 ワーカーの起動エントリ（docs/05 §13.1「`apps/worker` は `src/main.ts`」）。 */
const WORKER_ENTRY = 'apps/worker/src/main.ts';
/** 🔴 判定の単一実装（`APP_ENV` 分岐と production のモック検出を持つ唯一の場所）。 */
const CONFIG_STARTUP = 'packages/config/src/startup.ts';

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

function read(repoRelative: string): string {
  return readFileSync(path.join(repoRoot, repoRelative), 'utf8');
}

/**
 * 🔴 コメントではなく **AST 上の呼び出し**を見る（`readFileSync` + 正規表現だと
 *    「コメントに関数名を書いただけ」で緑になる）。
 *    `initializeRuntimeConfig(...)` / `config.initializeRuntimeConfig(...)` の両形を拾う。
 */
function callsFunction(sourceText: string, fileName: string, functionName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === functionName) found = true;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.name) &&
        callee.name.text === functionName
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** 静的 import / 動的 import / require のモジュール指定子を集める。 */
function importsModule(sourceText: string, fileName: string, moduleName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === moduleName
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

describe('🔴 起動時 DI が起動エントリから呼ばれている（T-03-12 / CLAUDE.md §11.1）', () => {
  it('対照: Next.js が読む起動フックのファイルが規約どおりの場所にある', () => {
    // ファイル名・場所は Next.js の規約であり、変えると `register()` が呼ばれなくなる
    // （呼ばれなくても画面は動いてしまうため、ここで場所ごと固定する）。
    expect(() => read(WEB_ENTRY)).not.toThrow();
    expect(() => read(WORKER_ENTRY)).not.toThrow();
    expect(() => read(CONFIG_STARTUP)).not.toThrow();
  });

  it(`${WEB_ENTRY} が register() を export している（Next.js が呼ぶ入口）`, () => {
    const source = read(WEB_ENTRY);
    const sourceFile = ts.createSourceFile(WEB_ENTRY, source, ts.ScriptTarget.ES2023, true);
    const hasExportedRegister = sourceFile.statements.some(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === 'register' &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true,
    );
    expect(hasExportedRegister).toBe(true);
  });

  it.each([WEB_ENTRY, WORKER_ENTRY])('%s が initializeRuntimeConfig を呼ぶ', (entry) => {
    const source = read(entry);
    expect(importsModule(source, entry, '@ses/config')).toBe(true);
    expect(callsFunction(source, entry, 'initializeRuntimeConfig')).toBe(true);
  });

  it.each(['loadAppEnv', 'resolveConnectorSelection'])(
    `${CONFIG_STARTUP} が %s を呼ぶ（起動エントリからの呼び出し連鎖の 2 段目）`,
    (functionName) => {
      expect(callsFunction(read(CONFIG_STARTUP), CONFIG_STARTUP, functionName)).toBe(true);
    },
  );

  it('対照: 検出ロジックが「コメントに書いただけ」を呼び出しとみなさない', () => {
    const source = ['// initializeRuntimeConfig(process.env, log);', 'export const x = 1;'].join('\n');
    expect(callsFunction(source, 'sample.ts', 'initializeRuntimeConfig')).toBe(false);
  });

  it('対照: 検出ロジックが実際の呼び出しを拾う（名前空間 import 形も含む）', () => {
    const direct = 'initializeRuntimeConfig(source, log);';
    const namespaced = 'config.initializeRuntimeConfig(source, log);';
    expect(callsFunction(direct, 'sample.ts', 'initializeRuntimeConfig')).toBe(true);
    expect(callsFunction(namespaced, 'sample.ts', 'initializeRuntimeConfig')).toBe(true);
  });
});

describe('🔴 起動時 DI の入口が 1 つである（web と worker で別々の判定を書かない）', () => {
  const appSourceFiles = listSourceFiles(path.join(repoRoot, 'apps')).filter(
    (file) => !isTestFile(file),
  );

  it('対照: apps/** に走査対象のソースが存在する', () => {
    expect(appSourceFiles.length).toBeGreaterThan(0);
  });

  it.each(['loadAppEnv', 'resolveConnectorSelection', 'assertNoMockInProduction'])(
    'apps/** の非テストソースが %s を直接呼ばない（判定は packages/config の 1 箇所）',
    (functionName) => {
      const offenders = appSourceFiles
        .filter((file) => callsFunction(readFileSync(file, 'utf8'), file, functionName))
        .map(toRepoRelative);
      expect(offenders).toEqual([]);
    },
  );

  it('🔴 apps/** がテスト用のキャッシュ解除（resetRuntimeConfigForTesting）に触れない', () => {
    // 触れると「起動時に 1 回」の保証をアプリ側から崩せる。`@ses/config` の index からも
    // export していない（`packages/config/src/index.ts`）が、走査でも押さえる。
    const offenders = appSourceFiles
      .filter((file) =>
        callsFunction(readFileSync(file, 'utf8'), file, 'resetRuntimeConfigForTesting'),
      )
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });

  it('initializeRuntimeConfig を呼ぶ apps/** のファイルが起動経路に限られる', () => {
    const callers = appSourceFiles
      .filter((file) => callsFunction(readFileSync(file, 'utf8'), file, 'initializeRuntimeConfig'))
      .map(toRepoRelative)
      .sort();
    expect(callers).toEqual(
      [
        WEB_ENTRY,
        WORKER_ENTRY,
        // 🔴 instrumentation を経由しない実行経路（結合テストが `apps/web/lib/**` を直接呼ぶ場合）
        //    でも同じ 1 箇所を通って初期化されるようにするための唯一の例外。
        //    キャッシュ済みなら再検証も再ログも起きない（`initializeRuntimeConfig` の契約）。
        'apps/web/lib/db/bootstrap.ts',
      ].sort(),
    );
  });
});
