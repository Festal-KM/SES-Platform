// tests/static/execute-guard.test.ts
// docs/05 §17.2 #7:「🔴 実行系ルート一覧の全ファイルが `requireExecutable` を呼ぶ（AST 走査）」。
// T-03-04（docs/sprints/SP-03-auth-audit-admin0.md）。
//
// 🔴 なぜこのテストが要るか（docs/05 §6.2 / `docs/03` 申し送り 11-①）:
//    `requireExecutable` は `F-004` と同じ経路に置かなければならない。ロールごとの分岐に散らすと
//    `SUSPENDED` / `CLOSING` の抜け穴になる。「レビューで気をつける」では、ルートが増えるたびに
//    抜ける。**実行系ルートが増えるたびに、このテストが自動で対象に加える**構造にする。
//
// 🔴 対象は列挙ではなく**全部から引く**（docs/05 §17.2 #20 ③と同じ向き）:
//    `apps/web/app/**/route.ts` を走査し、**状態を変える HTTP メソッド（POST / PUT / PATCH /
//    DELETE）を export しているルートすべて**に `requireExecutable` を要求する。
//    例外は `EXEMPT_ROUTES` に**理由つきで**書く。新しいルートは既定で検査対象に入る。
//
// 🔴 「閲覧・エクスポートに `requireExecutable` を掛けろ」ではない。`CLOSING` では
//    「閲覧と返却（エクスポート）のみ実行できる」（`F-004 AC-8` / `F-064 AC-5`）ため、
//    GET だけのルートは対象外である。ダウンロード / エクスポートに要るのは `requireNotViewer`。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webAppDir = path.join(repoRoot, 'apps', 'web', 'app');
const fixturesDir = path.join(here, '__fixtures__', 'execute-guard');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo']);

/** 🔴 状態を変える HTTP メソッド。これを export するルートは実行系とみなす。 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** ガードの出所。ここから import された識別子だけを「ガードを通した」根拠にする。 */
const GUARDS_MODULE_SUFFIX = '/api/guards';

const EXECUTE_GUARD = 'requireExecutable';

/**
 * 🔴 `requireExecutable` を要求しないルートと、その理由。
 *
 * **理由なしで足さない。** ここに 1 行足すことは「テナントが停止中 / 解約手続き中でも
 * この操作は通す」という判断であり、`F-004 AC-7` / `AC-8` の例外を作ることに等しい。
 *
 * 🔴 いずれも「認証コンテキスト（`AuthenticatedTenantCtx`）が存在しない経路」である。
 *    `requireExecutable` は ctx のライフサイクル状態を見るガードなので、ctx を作れない
 *    経路には**掛けようがない**（掛けたいなら ctx を作れるようにする必要がある）。
 *    ⚠️ 将来ここに「ctx はあるが実行させたい」ルート（`POST /api/data-exports` など。
 *    `F-064 AC-5`「返却は `CLOSING` でも実行できる」）を足すときは、その旨を書く。
 */
const EXEMPT_ROUTES: Readonly<Record<string, string>> = {
  'apps/web/app/api/(main)/auth/signin/route.ts':
    '未認証経路（docs/05 §6.3 #1）。ctx を作る前の資格情報照合であり、テナントが確定していない。',
  'apps/web/app/api/(main)/auth/signout/route.ts':
    'セッション破棄（#4）。未認証でも 204 を返す（セッションの有無を漏らさない）。' +
    '解約手続き中でもサインアウトはできなければならない。',
  'apps/web/app/api/(main)/auth/password-reset/route.ts':
    '未認証経路（#5）。行由来コンテキスト（docs/05 §4.4.2）のみを使う。',
  'apps/web/app/api/(main)/auth/password-reset/confirm/route.ts':
    '未認証経路（#5b）。トークン照合で得た行が分離キーの出所。',
  'apps/web/app/api/(main)/auth/2fa/setup/route.ts':
    '2FA 未設定の OWNER / ADMIN が使う操作（#3）。定義上 ctx を作れない（docs/05 §6.2）。',
  'apps/web/app/api/(main)/auth/2fa/verify/route.ts':
    '第 2 要素の提示（#2）。同上、ctx が生成される前の経路である。',
  'apps/web/app/api/(main)/invitations/[token]/accept/route.ts':
    '未認証経路（#7）。所属は招待行から決まり、受諾時点では ctx が無い。',
};

type RouteAnalysis = {
  /** export されている HTTP メソッド名。 */
  readonly exportedMethods: ReadonlySet<string>;
  /**
   * 🔴 `lib/api/guards` の **`requireExecutable` 本体**に束縛されたローカル名。
   *
   * 判定は import の**元名**（`propertyName`）で行い、記録するのは**ローカル名**である。
   *   - `import { requireRole as requireExecutable }` … 元名が違うので**記録されない**
   *     （名前だけ `requireExecutable` に見せかけた偽装が素通りしない）
   *   - `import { requireExecutable as guard }` … 元名が一致するので `guard` を記録する
   *     （正当な alias を誤検知しない）
   */
  readonly executeGuardBindings: ReadonlySet<string>;
  /** ファイル中でコードとして参照されている識別子（コメントは含まない）。 */
  readonly referencedIdentifiers: ReadonlySet<string>;
};

function analyzeRoute(sourceText: string, fileName: string): RouteAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const exportedMethods = new Set<string>();
  const executeGuardBindings = new Set<string>();
  const referencedIdentifiers = new Set<string>();

  function hasExportModifier(node: ts.Node): boolean {
    return (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
  }

  function visit(node: ts.Node): void {
    // export async function POST(…) {}
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      exportedMethods.add(node.name.text);
    }
    // export const POST = withApiRoute(…)
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exportedMethods.add(declaration.name.text);
      }
    }
    // import { requireExecutable } from '../../lib/api/guards'
    // import { requireExecutable as guard } from '../../lib/api/guards'
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith(GUARDS_MODULE_SUFFIX)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          // 🔴 元名（alias が無ければローカル名と同じ）で判定し、ローカル名を記録する。
          const importedName = (element.propertyName ?? element.name).text;
          if (importedName === EXECUTE_GUARD) executeGuardBindings.add(element.name.text);
        }
      }
    }
    if (ts.isIdentifier(node)) referencedIdentifiers.add(node.text);

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { exportedMethods, executeGuardBindings, referencedIdentifiers };
}

/** 実行系（状態を変えるメソッドを export している）か。 */
function isMutatingRoute(analysis: RouteAnalysis): boolean {
  return [...analysis.exportedMethods].some((method) => MUTATING_METHODS.has(method));
}

/**
 * 🔴 `lib/api/guards` の `requireExecutable` **本体**に束縛された名前を、
 *    コード上で参照しているか。
 *
 *    根拠にしないもの:
 *      - コメントでの言及（AST の識別子ではない）
 *      - 同名のローカル関数（guards モジュールからの束縛が無い）
 *      - `import { requireRole as requireExecutable }`（元名が違う＝別のガード）
 */
function callsExecuteGuard(analysis: RouteAnalysis): boolean {
  return [...analysis.executeGuardBindings].some((localName) =>
    analysis.referencedIdentifiers.has(localName),
  );
}

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listRouteFiles(full);
    }
    return /^route\.(ts|tsx|mts|cts)$/.test(entry.name) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function readFixture(name: string): RouteAnalysis {
  return analyzeRoute(readFileSync(path.join(fixturesDir, name), 'utf8'), name);
}

const routeFiles = listRouteFiles(webAppDir).map((file) => ({
  file: toRepoRelative(file),
  analysis: analyzeRoute(readFileSync(file, 'utf8'), file),
}));

const mutatingRoutes = routeFiles.filter((route) => isMutatingRoute(route.analysis));
const requiredRoutes = mutatingRoutes.filter((route) => !(route.file in EXEMPT_ROUTES));

describe('🔴 実行系ルートは例外なく requireExecutable を通る（docs/05 §17.2 #7 / §6.2）', () => {
  it('対照: apps/web/app 配下に Route Handler が存在する（テストが空振りしていない）', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it('対照: 状態を変えるメソッドを export しているルートが存在する', () => {
    expect(mutatingRoutes.length).toBeGreaterThan(0);
  });

  it('🔴 対照: 免除されていない実行系ルートが 1 本以上ある（規則が空振りしていない）', () => {
    expect(requiredRoutes.map((route) => route.file)).not.toEqual([]);
  });

  it('免除されていない実行系ルートのすべてが requireExecutable を通している', () => {
    const missing = requiredRoutes
      .filter((route) => !callsExecuteGuard(route.analysis))
      .map((route) => route.file);
    expect(missing).toEqual([]);
  });

  it('🔴 免除リストに死んだ項目が無い（ファイルが実在し、かつ実行系である）', () => {
    const routesByFile = new Map(routeFiles.map((route) => [route.file, route]));
    for (const file of Object.keys(EXEMPT_ROUTES)) {
      const route = routesByFile.get(file);
      expect(route, `免除リストの ${file} が存在しません（リネーム / 削除の取り残し）`).toBeDefined();
      if (route) expect(isMutatingRoute(route.analysis)).toBe(true);
    }
  });

  it('🔴 免除にはすべて理由が書かれている', () => {
    for (const [file, reason] of Object.entries(EXEMPT_ROUTES)) {
      expect(reason.length, `${file} の免除理由が空です`).toBeGreaterThan(20);
    }
  });
});

describe('検出ロジックの対照（fixture）', () => {
  it('違反: POST があるのに requireExecutable が無い', () => {
    const analysis = readFixture('missing-guard.violation.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('🔴 違反: コメントで言及しているだけでは通らない', () => {
    const analysis = readFixture('comment-only.violation.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('🔴 違反: 同名のローカル関数を自前で定義した偽装は通らない', () => {
    const analysis = readFixture('decoy-identifier.violation.ts');
    expect(analysis.referencedIdentifiers.has(EXECUTE_GUARD)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('🔴 違反: 別のガードを requireExecutable という名前で import した偽装は通らない', () => {
    const analysis = readFixture('alias-spoof.violation.ts');
    // ファイル中に識別子としては現れる（名前だけの一致では判定できない）。
    expect(analysis.referencedIdentifiers.has(EXECUTE_GUARD)).toBe(true);
    // 🔴 元名が `requireRole` なので、requireExecutable への束縛は 1 つも無い。
    expect([...analysis.executeGuardBindings]).toEqual([]);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('適合: 本体を alias して使う正当な形（requireExecutable as executableGuard）', () => {
    const analysis = readFixture('alias-legit.ok.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect([...analysis.executeGuardBindings]).toEqual(['executableGuard']);
    expect(callsExecuteGuard(analysis)).toBe(true);
  });

  it('適合: guards から import して宣言している', () => {
    const analysis = readFixture('with-guard.ok.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(true);
  });

  it('適合: GET だけのルートは対象外（CLOSING でも閲覧はできる。F-004 AC-8）', () => {
    const analysis = readFixture('read-only.ok.ts');
    expect(analysis.exportedMethods.has('GET')).toBe(true);
    expect(isMutatingRoute(analysis)).toBe(false);
  });
});
