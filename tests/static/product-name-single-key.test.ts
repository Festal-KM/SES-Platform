// tests/static/product-name-single-key.test.ts
// 🔴 docs/05 §17.2 #35（T-10-01）: **プロダクト名のリテラルは `packages/i18n/src/glossary.ts` の `PRODUCT_NAME` の 1 行だけ**にあり、
//    製品コード（`apps/*` / `packages/*` / `prompts/` / E2E ハーネス）にも `packages/i18n/src/index.ts` にも直書きが無いことを構造で固定する
//    （CLAUDE.md §3.5 / §9-1 = 正式名称は Issue #1 で確認中 / docs/04 U-01 / `docs/sprints/SP-10` T-10-01「`app.name` の 1 キーに閉じ、
//    回答が来たら 1 箇所の差し替えで済むようにする」）。
//
// 🔴 なぜ静的検査か: `t('product.name')` を使う規律は、1 箇所でも `'SES Platform'` と書いた瞬間に「改称したのに古い名前が残る画面」を
//    生む。ユニットテストでは呼び出し側の直書きを見られないので、ソースを走査する。**コメントは対象外**（AST のノードだけを見る）。
//    テストファイル（`*.test.ts(x)` / `*.spec.ts` / `__fixtures__`）は対象外 —— 期待値としてプロダクト名を書くのは正しい使い方である。
//
// 検査の 3 面:
//   ① 製品コードの全走査: 文字列リテラル / テンプレートリテラル（head / middle / tail）/ JSX テキストに `PRODUCT_NAME` の綴りが無い。
//      大文字小文字・空白の個数の差（`ses platform` / `SES  Platform`）も拾う（綴りをずらして逃れる経路を残さない）。
//      `ses_platform`（DB 名）/ `ses-platform-e2e`（バケット名）のような技術識別子は表示名ではないので対象外。
//   ② `packages/i18n/src`: リテラルは `glossary.ts` の `PRODUCT_NAME` の初期化子 1 つだけ。`index.ts` は `PRODUCT_NAME` を参照して組み立てる
//      （`admin.console.issuer` のようにテンプレートで連結してよいが、綴りを書いてはならない）。
//   ③ `<title>`: `apps/web/app/layout.tsx` の `metadata.title` が `t('product.name')` の呼び出しである（ブラウザのタブに出る名前も 1 キー）。
//   合成ソース（`__fixtures__/product-name-single-key/`）で**違反を仕込むと落ちる**ことを対照として固定する。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { PRODUCT_NAME } from '../../packages/i18n/src/glossary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'product-name-single-key');

const GLOSSARY_FILE = path.join(repoRoot, 'packages', 'i18n', 'src', 'glossary.ts');
const I18N_SRC_DIR = path.join(repoRoot, 'packages', 'i18n', 'src');
const ROOT_LAYOUT_FILE = path.join(repoRoot, 'apps', 'web', 'app', 'layout.tsx');

/**
 * ① の走査対象（製品コード）。`packages/i18n/src` は ② で別に見る。
 *    `tests/e2e` のうち Playwright の spec（`*.spec.ts`）と `support/`（spec 専用の補助）はテストであり対象外、
 *    ハーネス（サーバ起動・seed・worker の起動）は製品と同じ文言経路を持つべき製品コードとして対象にする。
 */
const PRODUCT_CODE_ROOTS = [
  path.join(repoRoot, 'apps', 'web', 'app'),
  path.join(repoRoot, 'apps', 'web', 'lib'),
  path.join(repoRoot, 'apps', 'web', 'proxy.ts'),
  path.join(repoRoot, 'apps', 'web', 'instrumentation.ts'),
  path.join(repoRoot, 'apps', 'web', 'next.config.ts'),
  path.join(repoRoot, 'apps', 'worker', 'src'),
  path.join(repoRoot, 'packages', 'ai', 'src'),
  path.join(repoRoot, 'packages', 'config', 'src'),
  path.join(repoRoot, 'packages', 'connectors', 'src'),
  path.join(repoRoot, 'packages', 'db', 'src'),
  path.join(repoRoot, 'packages', 'db', 'seed'),
  path.join(repoRoot, 'packages', 'domain', 'src'),
  path.join(repoRoot, 'packages', 'ui', 'src'),
  path.join(repoRoot, 'prompts'),
  path.join(repoRoot, 'tests', 'e2e', 'harness'),
  path.join(repoRoot, 'tests', 'e2e', 'global-setup.ts'),
  path.join(repoRoot, 'tests', 'e2e', 'global-teardown.ts'),
];

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', '__fixtures__']);

/**
 * 綴りの揺れも拾う: 大文字小文字を無視し、語間の空白の個数を無視する。
 * 🔴 `ses_platform`（DB 名）/ `ses-platform-e2e`（バケット名）/ `x-ses-platform-signature`（ヘッダ名）のような
 *    **技術識別子は対象外**である（表示名ではなく、改称しても変えない・変えてはならない値）。語間が空白のものだけを表示名とみなす。
 */
const PRODUCT_NAME_PATTERN = new RegExp(
  `(?<![\\w-])${PRODUCT_NAME.split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')}(?![\\w-])`,
  'i',
);

// ============================================================================
// 共通ユーティリティ
// ============================================================================

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(file);
}

function listSourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return isTestFile(root) ? [] : [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSourceFiles(full);
    if (!/\.(ts|tsx|mts|cts)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) return [];
    if (isTestFile(entry.name)) return [];
    return [full];
  });
}

function parse(absolute: string): ts.SourceFile {
  return parseSource(readFileSync(absolute, 'utf8'), absolute);
}

function parseSource(text: string, name = 'synthetic.ts'): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

type Finding = { readonly file: string; readonly line: number; readonly text: string };

/** 文字列を持つノードの本文（リテラル / テンプレートの各断片 / JSX テキスト）。コメントは含まれない。 */
function textBearingNodes(source: ts.SourceFile): Array<{ readonly node: ts.Node; readonly text: string }> {
  const found: Array<{ readonly node: ts.Node; readonly text: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push({ node, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** ソース中のプロダクト名の直書き。 */
export function productNameFindings(file: string, source: ts.SourceFile): Finding[] {
  return textBearingNodes(source)
    .filter(({ text }) => PRODUCT_NAME_PATTERN.test(text))
    .map(({ node, text }) => ({ file: toRepoRelative(file), line: lineOf(source, node), text: text.trim() }));
}

/** `glossary.ts` の `PRODUCT_NAME` 宣言の初期化子（文字列リテラルでなければ `null`）。 */
function productNameDeclaration(source: ts.SourceFile): { readonly node: ts.Node; readonly value: string } | null {
  let result: { readonly node: ts.Node; readonly value: string } | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'PRODUCT_NAME' &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer)
    ) {
      result = { node: node.initializer, value: node.initializer.text };
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

/** `export const metadata = { title: <expr> }` の `title` の初期化子のテキスト。 */
function metadataTitleExpressionText(source: ts.SourceFile): string | null {
  let result: string | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'metadata' && node.initializer !== undefined) {
      let initializer: ts.Expression = node.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'title') {
            result = property.initializer.getText(source);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

// ============================================================================
// ① 製品コードに直書きが無い
// ============================================================================

describe('🔴 §17.2 #35 ① 製品コードにプロダクト名の直書きが無い（`t(\'product.name\')` だけが出所）', () => {
  const files = PRODUCT_CODE_ROOTS.flatMap(listSourceFiles);

  it('走査対象が空振りしていない（apps/web / apps/worker / packages / prompts / E2E ハーネスを含む）', () => {
    expect(files.length).toBeGreaterThan(200);
    const relative = files.map(toRepoRelative);
    expect(relative.some((file) => file.startsWith('apps/web/app/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('apps/worker/src/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('packages/connectors/src/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('packages/ui/src/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('tests/e2e/harness/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('packages/i18n/'))).toBe(false);
  });

  // 🔴 T-12-10: 走査対象（`apps/**` / `packages/**` の全ソース）が増えて既定の 5 秒に収まらなく
  //    なったため、この 1 本にだけ明示のタイムアウトを置く。**検査の範囲は 1 ファイルも狭めない**
  //    —— 狭めると「プロダクト名の直書き」の検出が静かに抜ける（`§17.2 #35 ①` の趣旨そのもの）。
  it(
    '文字列 / テンプレート / JSX テキストのどこにもプロダクト名（綴りの揺れを含む）が無い',
    () => {
      const findings = files.flatMap((file) => productNameFindings(file, parse(file)));
      expect(findings).toEqual([]);
    },
    30_000,
  );
});

// ============================================================================
// ② packages/i18n はリテラル 1 つだけ
// ============================================================================

describe('🔴 §17.2 #35 ② `packages/i18n/src` のリテラルは `glossary.ts` の `PRODUCT_NAME` の 1 行だけ', () => {
  const files = listSourceFiles(I18N_SRC_DIR);

  it('`glossary.ts` に `PRODUCT_NAME` の文字列リテラル宣言があり、その値が export と一致する', () => {
    const declaration = productNameDeclaration(parse(GLOSSARY_FILE));
    expect(declaration).not.toBeNull();
    expect(declaration?.value).toBe(PRODUCT_NAME);
  });

  it('`packages/i18n/src` 全体で綴りが現れるのは `glossary.ts` の宣言 1 箇所だけ（`index.ts` は参照で組み立てる）', () => {
    const findings = files.flatMap((file) => productNameFindings(file, parse(file)));
    const glossary = parse(GLOSSARY_FILE);
    const declaration = productNameDeclaration(glossary);
    expect(findings).toEqual([
      { file: toRepoRelative(GLOSSARY_FILE), line: lineOf(glossary, declaration!.node), text: PRODUCT_NAME },
    ]);
  });

  it('`product.name` と名称を含む文言（`admin.console.issuer`）は `PRODUCT_NAME` の参照で組まれている', () => {
    const index = parse(path.join(I18N_SRC_DIR, 'index.ts'));
    const initializers = new Map<string, string>();
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) {
        initializers.set(node.name.text, node.initializer.getText(index));
      }
      ts.forEachChild(node, visit);
    };
    visit(index);
    expect(initializers.get('product.name')).toBe('PRODUCT_NAME');
    expect(initializers.get('admin.console.issuer')).toContain('${PRODUCT_NAME}');
  });
});

// ============================================================================
// ③ <title>
// ============================================================================

describe('🔴 §17.2 #35 ③ ルートレイアウトの `<title>` は `t(\'product.name\')`', () => {
  it('`apps/web/app/layout.tsx` の `metadata.title` が `t(\'product.name\')` の呼び出し', () => {
    expect(metadataTitleExpressionText(parse(ROOT_LAYOUT_FILE))).toBe("t('product.name')");
  });
});

// ============================================================================
// 対照（合成ソースで検出器が働く）
// ============================================================================

describe('対照: 合成ソースで違反を仕込むと検出される', () => {
  const fixture = (name: string): string => path.join(fixturesDir, name);

  it('文字列 / テンプレート先頭 / JSX テキスト / 綴りの揺れ（小文字・空白 2 つ）の 6 箇所を拾い、名称を含まないテンプレートと技術識別子（ses_platform / ses-platform-e2e）は拾わない', () => {
    const file = fixture('violation.tsx');
    const findings = productNameFindings(file, parse(file));
    expect(findings.map((finding) => finding.line)).toEqual([2, 4, 5, 6, 7, 9]);
  });

  it('`t(\'product.name\')` と `PRODUCT_NAME` の参照だけのソースは 0 件（コメント中の綴りは数えない）', () => {
    const file = fixture('clean.ok.tsx');
    expect(productNameFindings(file, parse(file))).toEqual([]);
  });

  it('`metadata.title` が文字列だと ③ の検査が別の値を返す', () => {
    const source = parseSource(`export const metadata = { title: 'Some Name' };`, 'layout.tsx');
    expect(metadataTitleExpressionText(source)).toBe("'Some Name'");
  });
});
