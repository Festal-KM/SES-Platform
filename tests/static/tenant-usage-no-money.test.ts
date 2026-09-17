// tests/static/tenant-usage-no-money.test.ts
// 🔴 docs/05 §17.2 #18（T-10-04）: **主平面に金額（USD / ドル / cost / price）の項目・文言が無い**ことを構造で固定する
//    （docs/02 `F-027 AC-6` / `AC-7` / `BR-24` / `CLAUDE.md` §2 課金「クォータと残量を利用者に見せる単位は金額ではなく件数」/
//    [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。
//
// ---------------------------------------------------------------------------
// 🔴 なぜ静的検査か
// ---------------------------------------------------------------------------
// `apps/web/lib/usage/view.types.test.ts` は `UsageView` / `BlockedNoticeView` の 2 型に閉じて「金額のキーが無い」を
// 型で固定する。しかし `F-027 AC-6` は**主平面の全画面・全応答**に対する要求であり、`GET /api/usage` 以外の応答
// （例: 別のルートが「参考情報」として AI 原価を返す）や、`S-038` の文言（例: 「残り $9 分」）に金額が混じる経路は
// 型テストでは見えない。ここでは 3 つの面を走査で固定する:
//
//   ① **主平面の応答型の閉包**: `apps/web/app/api/(main)/**/route.ts` から相対 import で到達できる `apps/web/**` の
//      全モジュールの**プロパティ名**（型リテラル / interface / オブジェクトリテラル / クラスのフィールド）に
//      `/[Uu]sd|USD|[Cc]ost|COST|[Pp]rice|PRICE|\$|ドル/` を含む名前が無い。
//      例外は 2 種類だけで、**どちらも列挙し、使われていない例外は落とす**（緩めるだけの穴にならない）:
//        (a) 業務データそのものの単価・金額（`unitPrice` / `offeredUnitPrice` / `amount` ほか。提案・案件・人材の
//            商流情報でありクォータでも残量でもない）。`usd` / `cost` の語を含む名前は**例外にできない**。
//        (b) 応答ではない起動時 DI / 認証パラメータのモジュール（`lib/db/bootstrap.ts` の運営者向けアクセサの型、
//            `lib/auth/password.ts` の argon2 パラメータ）。**名前の集合をスナップショットで固定**し、増えたら落ちる。
//            あわせて、運営者向けアクセサ（`adminUsageRuntime` / `providerSpendRuntime`）が主平面の閉包から
//            import されていないことを見る（金額の出所が主平面に接続されていない）。
//   ② **`S-038` の実装（`lib/usage/**` / `api/(main)/usage/**` / `app/(main)/settings/usage/**`）はさらに厳しく**:
//      識別子・文字列・テンプレート・JSX テキストのすべてに金額の語が無く、例外を持たない。
//      🔴 `gate-inspector` のキーが残量に無い（`AC-7`）: `lib/usage/**` にはプロパティ名にも `gate` / `inspector` が
//      無く、文字列リテラルは `'reviewGate'`（止まった理由）だけ。画面側で許すのは停止理由の写像
//      （`reviewGate` キーと `usage.stoppedFeature.reviewGate*` の文言キー）だけ。`AI_UNIT_KEYS` の 4 値に `gate` が無い。
//   ③ **`packages/i18n` の `usage.*` / `quota.*` / `error.quota.*` の文言**に金額の語が無い。「円」が現れてよいのは
//      `usage.billing.*`（超過分の請求見込み。残量の提示ではない）だけ。
//
// 🔴 コメントは対象外（AST のノードだけを見る。各ソースの説明文が引っかからないようにするため）。
// 🔴 合成ソース（`__fixtures__/tenant-usage-no-money/`）で**違反を仕込むと落ちる**ことを対照として固定する。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const fixturesDir = path.join(here, '__fixtures__', 'tenant-usage-no-money');

/**
 * 🔴 金額らしい名前・語（docs/05 §17.2 #18 の正規表現 + `amount` + 全大文字 + 記号 + カナ）。
 *    `amount` を含めるのは #18 が例外として `amount`（発注・請求の金額）を挙げているため —— 例外に挙がる語は検査の対象で
 *    なければ意味を持たない。
 */
const MONEY_PATTERN = /[Uu]sd|USD|[Cc]ost|COST|[Pp]rice|PRICE|[Aa]mount|AMOUNT|\$|ドル/;
/** 🔴 `gate-inspector` の残量（`F-027 AC-7`）。 */
const GATE_PATTERN = /gate|inspector/i;

const MAIN_API_DIR = path.join(webRoot, 'app', 'api', '(main)');
/** ② の対象（`S-038` の実装）。 */
const USAGE_DIRS = [
  path.join(webRoot, 'lib', 'usage'),
  path.join(webRoot, 'app', 'api', '(main)', 'usage'),
  path.join(webRoot, 'app', '(main)', 'settings', 'usage'),
];
const USAGE_VIEW_FILE = path.join(webRoot, 'lib', 'usage', 'view.ts');
const I18N_FILE = path.join(repoRoot, 'packages', 'i18n', 'src', 'index.ts');

/**
 * 🔴 例外 (a): 業務データそのものの単価・金額。**すべて `price` / `amount` の語だけで、`usd` / `cost` を含まない**
 *    （下の it が固定する）。使われていない名前があれば落ちる（緩めるだけのリストにしない）。
 *    - `unitPrice*` / `internalUnitPrice` / `offeredUnitPrice` … 提案・案件・人材の単価（商流情報。`CLAUDE.md` §3.2）
 *    - `priceMin` / `priceMax` / `priceBand` / `unitPriceMinYen` / `unitPriceMaxYen` … 匿名候補の
 *      単価レンジ（§3.1 経路 4 の 5 項目の 1 つ。`EngineerShare` の設定値を含む）
 *    - `unitPrices` … 提案依頼の本文検査（`message-check.ts`）が「単価を書かせない」ために持つ検出語の並び
 *    ⚠️ docs/05 §17.2 #18 が挙げる `amount`（発注・請求の金額。`Order`）は Phase 3（SP-17〜）まで主平面に現れないため
 *      まだ載せない（使われていない例外を置かない規律。`Order` の応答を作るタスクがここに足す）。
 */
const BUSINESS_DATA_MONEY_NAMES: ReadonlySet<string> = new Set([
  'internalUnitPrice',
  'offeredUnitPrice',
  'priceBand',
  'priceMax',
  'priceMin',
  'unitPrice',
  'unitPriceMax',
  'unitPriceMaxYen',
  'unitPriceMin',
  'unitPriceMinYen',
  'unitPrices',
]);

/**
 * 🔴 例外 (b): 応答ではないモジュールが持つ金額らしい名前の**スナップショット**（過不足があれば落ちる）。
 *    - `lib/db/bootstrap.ts` … 起動時 DI。`AdminUsageRuntime` / `ProviderSpendRuntime`（運営者向け。金額を含む）の型と
 *      その組み立て。主平面が読む `usageLimitsRuntime()` には金額のキーが無い（`view.types.test.ts` が固定する型の入力）。
 *    - `lib/auth/password.ts` … argon2 の `memoryCost` / `timeCost`（計算量のパラメータ。金額ではない）。
 */
const NON_RESPONSE_MODULE_MONEY_NAMES: ReadonlyMap<string, readonly string[]> = new Map([
  ['apps/web/lib/db/bootstrap.ts', ['aiDailyCostLimitUsd', 'aiMonthlyCostCapUsd', 'capUsd', 'providerCapUsd']],
  ['apps/web/lib/auth/password.ts', ['memoryCost', 'timeCost']],
]);

/**
 * 🔴 `lib/db/bootstrap.ts` のうち金額を返す（含む）アクセサ・型。主平面の閉包（bootstrap 自身を除く）から import されてはならない。
 *    `monitoringRuntime()` の戻り値 `MonitoringRuntime` は `providerSpend: ProviderSpendRuntime`（`capUsd`）を内包する。
 */
const ADMIN_ONLY_BOOTSTRAP_EXPORTS: ReadonlySet<string> = new Set([
  'adminUsageRuntime',
  'AdminUsageRuntime',
  'providerSpendRuntime',
  'ProviderSpendRuntime',
  'monitoringRuntime',
  'MonitoringRuntime',
]);

/**
 * 🔴 閉包の葉（ここから先の import は辿らない）: 起動時 DI の配線（`bootstrap.ts`）。両平面のアクセサを 1 箇所に束ねるため、
 *    運営者向けの型（`lib/admin-monitoring/runtime.ts` → `view.ts`。`capUsd` / `spentUsd`）を**型として** import している。
 *    ルートが bootstrap から得られるのは export されたアクセサの戻り値だけであり、金額を含むアクセサは上の
 *    `ADMIN_ONLY_BOOTSTRAP_EXPORTS` が主平面からの import を禁じる。bootstrap 自身のプロパティ名は例外 (b) で固定する。
 */
const CLOSURE_LEAVES: ReadonlySet<string> = new Set(['apps/web/lib/db/bootstrap.ts']);

/** ② で `gate` を含んでよい文字列リテラル（止まった理由の写像だけ）。 */
const ALLOWED_GATE_LITERALS_IN_SCREEN: ReadonlySet<string> = new Set([
  'reviewGate',
  'usage.stoppedFeature.reviewGate',
  'usage.stoppedFeature.reviewGate.consequence',
]);

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo']);

// ============================================================================
// 共通ユーティリティ
// ============================================================================

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(file) || /\.render\.test\.tsx$/.test(file);
}

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) return [];
    if (isTestFile(entry.name)) return [];
    return [full];
  });
}

function parse(absolute: string): ts.SourceFile {
  return ts.createSourceFile(
    absolute,
    readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function parseSource(text: string, name = 'synthetic.ts'): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

type Finding = { readonly file: string; readonly line: number; readonly name: string };

// ============================================================================
// ① 主平面の応答型の閉包
// ============================================================================

/** 相対 import / `@/` エイリアスを `apps/web` 内のファイルに解決する（解決できなければ例外 = 黙認しない）。 */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else if (specifier.startsWith('@/')) base = path.join(webRoot, specifier.slice(2));
  else return null; // パッケージ（`@ses/*` / `next/*` ほか）は越境しない
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile() && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  if (/\.css$/.test(specifier)) return null;
  throw new Error(`${toRepoRelative(fromFile)} の import '${specifier}' を解決できませんでした（検査が空振りする）。`);
}

function importSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** ルート群から相対 import で到達できる `apps/web/**` の非テストソース（ルート自身を含む）。 */
function mainPlaneClosure(roots: readonly string[]): ReadonlyMap<string, ts.SourceFile> {
  const closure = new Map<string, ts.SourceFile>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (closure.has(file)) continue;
    const source = parse(file);
    closure.set(file, source);
    if (CLOSURE_LEAVES.has(toRepoRelative(file))) continue;
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveImport(file, specifier);
      if (resolved !== null && !closure.has(resolved) && !isTestFile(resolved)) queue.push(resolved);
    }
  }
  return closure;
}

/** プロパティ名（型リテラル / interface / オブジェクトリテラル / クラスのフィールド）。 */
function propertyNames(source: ts.SourceFile): Array<{ readonly name: string; readonly node: ts.Node }> {
  const names: Array<{ readonly name: string; readonly node: ts.Node }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertySignature(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      const name = node.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
        names.push({ name: name.text, node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function moneyPropertyFindings(file: string, source: ts.SourceFile): Finding[] {
  return propertyNames(source)
    .filter(({ name }) => MONEY_PATTERN.test(name))
    .map(({ name, node }) => ({ file: toRepoRelative(file), line: lineOf(source, node), name }));
}

/** `lib/db/bootstrap` からの named import のうち、運営者向けアクセサ・型を拾う。 */
function adminOnlyBootstrapImports(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  source.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    if (!/(^|\/)db\/bootstrap(\.js)?$/.test(node.moduleSpecifier.text)) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) return;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (ADMIN_ONLY_BOOTSTRAP_EXPORTS.has(imported)) {
        findings.push({ file: toRepoRelative(file), line: lineOf(source, element), name: imported });
      }
    }
  });
  return findings;
}

// ============================================================================
// ② `S-038` の実装（識別子・文字列・テンプレート・JSX テキストのすべて）
// ============================================================================

function allTextTokens(source: ts.SourceFile): Array<{ readonly text: string; readonly node: ts.Node; readonly kind: 'identifier' | 'literal' | 'jsx' }> {
  const tokens: Array<{ readonly text: string; readonly node: ts.Node; readonly kind: 'identifier' | 'literal' | 'jsx' }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) tokens.push({ text: node.text, node, kind: 'identifier' });
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) tokens.push({ text: node.text, node, kind: 'literal' });
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) tokens.push({ text: node.text, node, kind: 'literal' });
    else if (ts.isJsxText(node)) tokens.push({ text: node.text, node, kind: 'jsx' });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tokens;
}

function moneyTokenFindings(file: string, source: ts.SourceFile): Finding[] {
  return allTextTokens(source)
    .filter(({ text }) => MONEY_PATTERN.test(text))
    .map(({ text, node }) => ({ file: toRepoRelative(file), line: lineOf(source, node), name: text }));
}

/**
 * `gate` / `inspector` の出現。`lib/usage/**` はプロパティ名に 1 つも無く、文字列は `'reviewGate'` だけ。
 * 画面・ルートはプロパティ名 `reviewGate`（止まった機能の写像）と、その文言キーだけ。
 */
function gateFindings(file: string, source: ts.SourceFile, mode: 'view' | 'screen'): Finding[] {
  const findings: Finding[] = [];
  for (const { name, node } of propertyNames(source)) {
    if (!GATE_PATTERN.test(name)) continue;
    if (mode === 'screen' && name === 'reviewGate') continue;
    findings.push({ file: toRepoRelative(file), line: lineOf(source, node), name: `property ${name}` });
  }
  for (const { text, node, kind } of allTextTokens(source)) {
    if (kind !== 'literal' || !GATE_PATTERN.test(text)) continue;
    const allowed = mode === 'view' ? text === 'reviewGate' : ALLOWED_GATE_LITERALS_IN_SCREEN.has(text);
    if (!allowed) findings.push({ file: toRepoRelative(file), line: lineOf(source, node), name: `literal '${text}'` });
  }
  return findings;
}

/** `AI_UNIT_KEYS = { ... }` の値（= `UsageView.aiUnits` のキー）。 */
function aiUnitKeyValues(source: ts.SourceFile): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'AI_UNIT_KEYS' &&
      node.initializer !== undefined
    ) {
      let initializer: ts.Expression = node.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) values.push(property.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

// ============================================================================
// ③ i18n
// ============================================================================

type I18nEntry = { readonly key: string; readonly value: string; readonly line: number };

/** `const ja = { 'a.b': '...', ... }` の項目。 */
function i18nEntries(source: ts.SourceFile): I18nEntry[] {
  const entries: I18nEntry[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ja' && node.initializer !== undefined) {
      let initializer: ts.Expression = node.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
      if (!ts.isObjectLiteralExpression(initializer)) return;
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isStringLiteral(property.name) || ts.isIdentifier(property.name) ? property.name.text : null;
        if (key === null) continue;
        const value = ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)
          ? property.initializer.text
          : null;
        if (value === null) continue;
        entries.push({ key, value, line: lineOf(source, property) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return entries;
}

const TENANT_USAGE_KEY_PREFIXES = ['usage.', 'quota.', 'error.quota.'];
const BILLING_KEY_PREFIX = 'usage.billing.';

function i18nMoneyFindings(entries: readonly I18nEntry[]): Finding[] {
  return entries
    .filter((entry) => TENANT_USAGE_KEY_PREFIXES.some((prefix) => entry.key.startsWith(prefix)))
    .filter((entry) => MONEY_PATTERN.test(entry.value))
    .map((entry) => ({ file: 'packages/i18n/src/index.ts', line: entry.line, name: `${entry.key} = ${entry.value}` }));
}

function i18nYenOutsideBillingFindings(entries: readonly I18nEntry[]): Finding[] {
  return entries
    .filter((entry) => TENANT_USAGE_KEY_PREFIXES.some((prefix) => entry.key.startsWith(prefix)))
    .filter((entry) => entry.value.includes('円') && !entry.key.startsWith(BILLING_KEY_PREFIX))
    .map((entry) => ({ file: 'packages/i18n/src/index.ts', line: entry.line, name: `${entry.key} = ${entry.value}` }));
}

// ============================================================================
// 実体の走査
// ============================================================================

const routeFiles = listSourceFiles(MAIN_API_DIR).filter((file) => /[\\/]route\.ts$/.test(file));
const closure = mainPlaneClosure(routeFiles);
const closureFiles = [...closure.keys()].map(toRepoRelative).sort();

const usageFiles = USAGE_DIRS.flatMap((dir) => listSourceFiles(dir));

describe('🔴 §17.2 #18 ① 主平面の応答型の閉包に金額の名前が無い（F-027 AC-6 / BR-24）', () => {
  it('対照: 走査が空振りしていない（ルートと閉包が実在し、S-038 の view を含む）', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(40);
    expect(closureFiles.length).toBeGreaterThanOrEqual(80);
    expect(closureFiles).toContain('apps/web/lib/usage/view.ts');
    expect(closureFiles).toContain('apps/web/app/api/(main)/usage/route.ts');
    // 管理平面のモジュール（金額を含む）が閉包に**入っていない**（入っていたら主平面から金額に到達できる）。
    expect(closureFiles.filter((file) => /^apps\/web\/lib\/admin-/.test(file))).toEqual([]);
    expect(closureFiles.filter((file) => /^apps\/web\/app\/(api\/)?admin\//.test(file))).toEqual([]);
  });

  it('🔴 金額らしいプロパティ名が、業務データの例外 (a) とスナップショット (b) 以外に 1 つも無い', () => {
    const violations: Finding[] = [];
    for (const [file, source] of closure) {
      const relative = toRepoRelative(file);
      const pinned = new Set(NON_RESPONSE_MODULE_MONEY_NAMES.get(relative) ?? []);
      for (const finding of moneyPropertyFindings(file, source)) {
        if (BUSINESS_DATA_MONEY_NAMES.has(finding.name)) continue;
        if (pinned.has(finding.name)) continue;
        violations.push(finding);
      }
    }
    expect(
      violations,
      '主平面の応答型の閉包に金額らしいプロパティ名があります（F-027 AC-6。金額は管理平面 API-A6 / A-011 に閉じる）:\n' +
        violations.map((v) => `  ${v.file}:${v.line} ${v.name}`).join('\n'),
    ).toEqual([]);
  });

  it('🔴 例外 (a) は price / amount の語だけで usd / cost を含まず、すべて実際に使われており、S-038 の実装には現れない', () => {
    for (const name of BUSINESS_DATA_MONEY_NAMES) {
      expect(name, `${name} は usd / cost を含む（業務データの例外にできない）`).not.toMatch(/[Uu]sd|USD|[Cc]ost|COST/);
      expect(MONEY_PATTERN.test(name), `${name} は金額のパターンに一致しない（例外にする必要が無い）`).toBe(true);
    }
    const used = new Set<string>();
    const inUsage = new Set<string>();
    const usageRelatives = new Set(usageFiles.map(toRepoRelative));
    for (const [file, source] of closure) {
      for (const finding of moneyPropertyFindings(file, source)) {
        if (!BUSINESS_DATA_MONEY_NAMES.has(finding.name)) continue;
        used.add(finding.name);
        if (usageRelatives.has(finding.file)) inUsage.add(finding.name);
      }
    }
    expect([...BUSINESS_DATA_MONEY_NAMES].filter((name) => !used.has(name)), '使われていない例外（リストから外す）').toEqual([]);
    expect([...inUsage], 'S-038 の実装に業務データの単価が現れている').toEqual([]);
  });

  it('🔴 例外 (b) のスナップショットが過不足なく一致し、対象はいずれも lib/usage の外にある', () => {
    for (const [relative, expected] of NON_RESPONSE_MODULE_MONEY_NAMES) {
      expect(relative.startsWith('apps/web/lib/usage/')).toBe(false);
      const absolute = path.join(repoRoot, ...relative.split('/'));
      const source = closure.get(absolute);
      expect(source, `${relative} が主平面の閉包に無い（スナップショットが古い。行ごと外す）`).toBeDefined();
      if (source === undefined) continue;
      const found = [...new Set(moneyPropertyFindings(absolute, source).map((f) => f.name))].sort();
      expect(found, `${relative} の金額らしい名前がスナップショットと違う（増えたなら応答に載っていないことを確かめてから更新する）`).toEqual(
        [...expected].sort(),
      );
    }
  });

  it('🔴 運営者向けの金額アクセサ（adminUsageRuntime / providerSpendRuntime）が主平面の閉包から import されていない', () => {
    const findings: Finding[] = [];
    for (const [file, source] of closure) {
      if (toRepoRelative(file) === 'apps/web/lib/db/bootstrap.ts') continue;
      findings.push(...adminOnlyBootstrapImports(file, source));
    }
    expect(findings).toEqual([]);
    // 対照: アクセサ（関数）は bootstrap に実在する（無ければ上の検査は自明に真）。型は bootstrap が宣言または型 import する。
    const bootstrap = closure.get(path.join(webRoot, 'lib', 'db', 'bootstrap.ts'));
    expect(bootstrap).toBeDefined();
    const declared = new Set<string>();
    bootstrap?.forEachChild((node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name !== undefined) declared.add(node.name.text);
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) declared.add(element.name.text);
      }
    });
    for (const name of ADMIN_ONLY_BOOTSTRAP_EXPORTS) expect(declared.has(name), `${name} が bootstrap.ts に無い`).toBe(true);
  });
});

describe('🔴 §17.2 #18 ② S-038 の実装（lib/usage / api usage / settings/usage）', () => {
  it('対照: 3 ディレクトリに実装が実在する', () => {
    expect(usageFiles.map(toRepoRelative)).toEqual(
      expect.arrayContaining([
        'apps/web/lib/usage/view.ts',
        'apps/web/lib/usage/format.ts',
        'apps/web/app/api/(main)/usage/route.ts',
        'apps/web/app/api/(main)/usage/blocked-notice/route.ts',
        'apps/web/app/(main)/settings/usage/page.tsx',
        'apps/web/app/(main)/settings/usage/usage-screen.tsx',
      ]),
    );
  });

  it('🔴 識別子・文字列・テンプレート・JSX テキストのどこにも金額の語が無い（例外なし）', () => {
    const findings = usageFiles.flatMap((file) => moneyTokenFindings(file, parse(file)));
    expect(findings, findings.map((f) => `  ${f.file}:${f.line} ${f.name}`).join('\n')).toEqual([]);
  });

  it('🔴 AC-7: lib/usage のプロパティ名に gate / inspector が無く、文字列は reviewGate（止まった理由）だけ', () => {
    const findings = listSourceFiles(USAGE_DIRS[0] as string).flatMap((file) => gateFindings(file, parse(file), 'view'));
    expect(findings).toEqual([]);
    const keys = aiUnitKeyValues(parse(USAGE_VIEW_FILE));
    expect(keys).toHaveLength(4);
    expect(keys.filter((key) => GATE_PATTERN.test(key))).toEqual([]);
  });

  it('🔴 AC-7: 画面・ルートで gate を含むのは停止理由の写像（reviewGate と usage.stoppedFeature.reviewGate*）だけ', () => {
    const files = [USAGE_DIRS[1] as string, USAGE_DIRS[2] as string].flatMap((dir) => listSourceFiles(dir));
    const findings = files.flatMap((file) => gateFindings(file, parse(file), 'screen'));
    expect(findings).toEqual([]);
  });
});

describe('🔴 §17.2 #18 ③ i18n の usage.* / quota.* に金額の語が無い。円は usage.billing.* だけ', () => {
  const entries = i18nEntries(parse(I18N_FILE));
  const tenantUsageEntries = entries.filter((entry) => TENANT_USAGE_KEY_PREFIXES.some((prefix) => entry.key.startsWith(prefix)));

  it('対照: 走査が空振りしていない（usage.* が実在し、請求見込みの円の文言が 1 つある）', () => {
    expect(tenantUsageEntries.length).toBeGreaterThanOrEqual(40);
    expect(entries.find((entry) => entry.key === 'usage.billing.unit')?.value).toBe('円');
  });

  it('🔴 金額の語（$ / USD / usd / cost / price / ドル）が無い', () => {
    expect(i18nMoneyFindings(entries)).toEqual([]);
  });

  it('🔴 「円」は usage.billing.* の値にだけ現れる', () => {
    expect(i18nYenOutsideBillingFindings(entries)).toEqual([]);
  });
});

describe('対照: 合成ソースに違反を仕込むと落ちる（検査そのものの空振りを防ぐ）', () => {
  const fixture = (name: string) => path.join(fixturesDir, name);

  it('① 型リテラル / オブジェクトリテラルの金額らしいプロパティ名を検出する', () => {
    const typeFile = fixture('response-cost-usd.violation.ts');
    expect(moneyPropertyFindings(typeFile, parse(typeFile)).map((f) => f.name)).toEqual(['costUsd', 'AI_COST_USD']);
    const objectFile = fixture('response-price-object.violation.ts');
    expect(moneyPropertyFindings(objectFile, parse(objectFile)).map((f) => f.name)).toEqual(['unitPriceUsd', 'total_cost']);
    const clean = fixture('clean.ok.ts');
    const cleanFindings = moneyPropertyFindings(clean, parse(clean)).filter((f) => !BUSINESS_DATA_MONEY_NAMES.has(f.name));
    expect(cleanFindings).toEqual([]);
  });

  it('① 運営者向けアクセサの import を検出する', () => {
    const source = parseSource("import { adminUsageRuntime, usageLimitsRuntime } from '../db/bootstrap';");
    expect(adminOnlyBootstrapImports('synthetic.ts', source).map((f) => f.name)).toEqual(['adminUsageRuntime']);
  });

  it('② 識別子・文字列・テンプレート・JSX の金額の語を検出する', () => {
    const source = parseSource(
      "const costUsd = 1; const label = '残り $9 分'; const tmpl = `あと ${n} ドル`; const x = <p>USD</p>;",
      'synthetic.tsx',
    );
    expect(moneyTokenFindings('synthetic.tsx', source).map((f) => f.name)).toEqual(['costUsd', '残り $9 分', ' ドル', 'USD']);
  });

  it('② gate-inspector のキー・文言を検出する（view モードでは reviewGate 以外のすべて）', () => {
    const gateFile = fixture('gate-unit-key.violation.ts');
    const expected = ['property AI_UNIT_GATE', 'property gateInspector', "literal 'gateInspector'", "literal 'gate-inspector'"];
    // `reviewGate`（止まった理由）だけは両モードで通る。それ以外の gate はすべて拾う。
    expect(gateFindings(gateFile, parse(gateFile), 'view').map((f) => f.name)).toEqual(expected);
    expect(gateFindings(gateFile, parse(gateFile), 'screen').map((f) => f.name)).toEqual(expected);
    expect(aiUnitKeyValues(parse(gateFile))).toEqual(['sheetParse', 'gateInspector']);
  });

  it('③ i18n の金額の語と、請求見込み以外の「円」を検出する', () => {
    const file = fixture('i18n-money.violation.ts');
    const entries = i18nEntries(parse(file));
    expect(entries.length).toBe(5);
    expect(i18nMoneyFindings(entries).map((f) => f.name)).toEqual([
      'usage.remaining = 残り $9 分',
      'quota.aiDaily = 上限 5 ドルに達しました',
      'usage.aiUnit.cost = cost per unit',
    ]);
    expect(i18nYenOutsideBillingFindings(entries).map((f) => f.name)).toEqual(['usage.remaining.yen = 残り 1,200 円分']);
  });
});
