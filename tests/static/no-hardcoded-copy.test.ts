// tests/static/no-hardcoded-copy.test.ts
// 🔴 docs/05 §17.2 #36（T-10-01）: **ビュー（`apps/web/**/*.tsx` / `packages/ui/src/**/*.tsx`）に日本語の文言が直書きされていない**ことを
//    構造で固定する（CLAUDE.md §3.5「ユーザー向け文言は `packages/i18n` に集約する。コンポーネント内ハードコーディング禁止」/ docs/02 §7.11 `BR-32` /
//    docs/05 §15.2）。
//
// 🔴 なぜ静的検査か: 文言が 1 箇所に集まっている限り「同じ概念を別の語で呼んでいないか」「一括承認のような語が無いか」は
//    `packages/i18n` を読めば分かる。1 箇所でも画面に直書きされると、その保証は「たぶん」になる。lint で塞ぐのが本来だが、
//    本リポジトリの flat config はゾーン単位で `no-restricted-syntax` を丸ごと置換する構造で（`eslint.config.mjs` 冒頭の 🔴）、
//    `apps/web` だけに JSX テキストの禁止を足すには 3 ゾーンの選択子を同時に増やす必要がある。SP-12 へ申し送り、ここで同じ強度を持つ。
//
// 検査（AST のノードだけを見る。**コメントは対象外**）:
//   ① JSX テキストノード（`<p>こんにちは</p>`）に日本語の文字が無い
//   ② JSX 属性の値（`aria-label` / `title` / `placeholder` / `alt` を含む**すべての属性**。`label="…"` のような props 渡しも）が
//      日本語を含む文字列 / テンプレートリテラルでない（`{t('…')}` / `{messages.x}` / props 経由は許可）
//   ③ JSX の子の式（`{'こんにちは'}` / `{`…`}`）が日本語のリテラルでない
//   ④ それ以外の場所（`const label = '…'` / オブジェクトの値 / 関数の引数）の文字列 / テンプレートリテラルにも日本語が無い
//      —— 変数に置いてから JSX に流し込む経路（`const label = '…'; <p>{label}</p>`）を①〜③だけでは見られないため。
//      🔴 例外は **`new XxxError('…')` の引数だけ**（`assertNever` の網羅性違反のような開発者向けの文言。画面には出ず、
//      利用者向けの文言は `userMessageKey` で別に運ぶ。docs/05 §15.2）。`Error` で終わらないクラスの引数・`throw '…'` は対象。
//   走査対象から除くのは `*.test.tsx` / `*.render.test.tsx` / `__fixtures__` / `dist` / `.next` だけ。
//
// 🔴 「日本語の文字」= ひらがな / カタカナの**文字**（U+3041–U+3096 / U+30A1–U+30FA）/ CJK 統合漢字（U+4E00–U+9FFF）。
//    `・`（U+30FB。`skills.join('・')` の区切り）と `ー`（U+30FC）だけの文字列は語ではないので数えない
//    （語であれば必ず他の文字を伴う）。
//
// 🔴 許可リスト（`ALLOWED_HARDCODED_COPY`）はファイル単位 + 理由つきで、**使われていない項目があれば落ちる**（緩めるだけの穴にしない）。
//    T-10-01 時点の違反は 0 件であり、リストは空である。並走タスクの領域（`apps/web/app/(main)/audit-logs/**` = T-11-09）に
//    直書きが見つかった場合はここに理由つきで載せ、`docs/sprints/SP-12` へ申し送る。
//   合成ソース（`__fixtures__/no-hardcoded-copy/`）で**違反を仕込むと落ちる**ことを対照として固定する。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'no-hardcoded-copy');

/** 走査対象のルート。`.tsx` だけを拾う。 */
const VIEW_ROOTS = [path.join(repoRoot, 'apps', 'web'), path.join(repoRoot, 'packages', 'ui', 'src')];

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', '__fixtures__']);

/** 🔴 ひらがな / カタカナの文字（`・` `ー` を除く）/ CJK 統合漢字。 */
const JAPANESE_LETTER = /[ぁ-ゖァ-ヺ一-鿿]/;

type ViolationKind = 'jsx-text' | 'jsx-attribute' | 'jsx-child-literal' | 'literal';

type Finding = { readonly file: string; readonly line: number; readonly kind: ViolationKind; readonly text: string };

/**
 * 🔴 許可リスト（ファイル単位。理由を必ず書く）。項目が使われていなければテストが落ちる。
 *    T-10-01 時点では空。載せる場合は `docs/sprints/SP-12` に申し送りを書くこと。
 */
const ALLOWED_HARDCODED_COPY: ReadonlyMap<string, string> = new Map<string, string>([]);

// ============================================================================
// 共通ユーティリティ
// ============================================================================

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.tsx$/.test(file);
}

function listViewFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listViewFiles(full);
    if (!entry.name.endsWith('.tsx')) return [];
    if (isTestFile(entry.name)) return [];
    return [full];
  });
}

function parse(absolute: string): ts.SourceFile {
  return parseSource(readFileSync(absolute, 'utf8'), absolute);
}

function parseSource(text: string, name = 'synthetic.tsx'): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** 文字列 / テンプレートリテラルの本文（テンプレートは断片を連結。式は含まない）。 */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
  return null;
}

function isJsxContainer(node: ts.Node | undefined): boolean {
  return node !== undefined && (ts.isJsxElement(node) || ts.isJsxFragment(node));
}

/** ④ の例外: `new XxxError('…')` の直接の引数（開発者向けの例外メッセージ）。 */
function isErrorConstructorArgument(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined || !ts.isNewExpression(parent) || parent.arguments === undefined) return false;
  if (!parent.arguments.includes(node as ts.Expression)) return false;
  const callee = parent.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  return name.endsWith('Error');
}

/** ビューの日本語直書き。①〜④ を 1 度の走査で集める（同じノードを 2 つの種別で数えない）。 */
export function hardcodedCopyFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const counted = new Set<ts.Node>();
  const record = (node: ts.Node, kind: ViolationKind, text: string): void => {
    if (counted.has(node)) return;
    counted.add(node);
    findings.push({ file: toRepoRelative(file), line: lineOf(source, node), kind, text: text.trim().replace(/\s+/g, ' ') });
  };
  const visit = (node: ts.Node): void => {
    // ① JSX テキスト
    if (ts.isJsxText(node)) {
      if (JAPANESE_LETTER.test(node.text)) record(node, 'jsx-text', node.text);
      return;
    }
    // ② JSX 属性の値
    if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const initializer = node.initializer;
      const valueNode = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
      const text = valueNode === undefined ? null : literalText(valueNode);
      if (text !== null && JAPANESE_LETTER.test(text)) record(valueNode as ts.Node, 'jsx-attribute', `${node.name.getText(source)}=${text}`);
    }
    // ③ JSX の子の式に直接置かれたリテラル
    if (ts.isJsxExpression(node) && node.expression !== undefined && isJsxContainer(node.parent)) {
      const text = literalText(node.expression);
      if (text !== null && JAPANESE_LETTER.test(text)) record(node.expression, 'jsx-child-literal', text);
    }
    // ④ それ以外のリテラル（`new XxxError('…')` の引数だけを除く）
    const text = literalText(node);
    if (text !== null && JAPANESE_LETTER.test(text) && !isErrorConstructorArgument(node)) record(node, 'literal', text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings.sort((a, b) => a.line - b.line);
}

// ============================================================================
// 本体
// ============================================================================

describe('🔴 §17.2 #36 ビュー（apps/web / packages/ui の .tsx）に日本語の文言の直書きが無い', () => {
  const files = VIEW_ROOTS.flatMap(listViewFiles);
  const findings = files.flatMap((file) => hardcodedCopyFindings(file, parse(file)));
  const violations = findings.filter((finding) => !ALLOWED_HARDCODED_COPY.has(finding.file));

  it('走査対象が空振りしていない（主平面・管理平面・共有 UI を含む）', () => {
    expect(files.length).toBeGreaterThan(80);
    const relative = files.map(toRepoRelative);
    expect(relative.some((file) => file.startsWith('apps/web/app/(main)/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('apps/web/app/admin/'))).toBe(true);
    expect(relative.some((file) => file.startsWith('packages/ui/src/'))).toBe(true);
    expect(relative.some((file) => /\.test\.tsx$/.test(file))).toBe(false);
  });

  it('① JSX テキスト / ② 属性値 / ③ 子のリテラル / ④ その他のリテラル のいずれにも日本語が無い（許可リスト以外）', () => {
    expect(violations).toEqual([]);
  });

  it('🔴 許可リストの項目はすべて実際に使われている（使われていない許可を残さない）', () => {
    const filesWithFindings = new Set(findings.map((finding) => finding.file));
    const unused = [...ALLOWED_HARDCODED_COPY.keys()].filter((file) => !filesWithFindings.has(file));
    expect(unused).toEqual([]);
  });
});

// ============================================================================
// 対照（合成ソースで検出器が働く）
// ============================================================================

describe('対照: 合成ソースで違反を仕込むと検出される', () => {
  const fixture = (name: string): string => path.join(fixturesDir, name);

  it('4 種別を行番号つきで拾い、`new Error(…)` の引数だけは拾わない', () => {
    const file = fixture('violation.tsx');
    const findings = hardcodedCopyFindings(file, parse(file));
    expect(findings.map(({ line, kind }) => ({ line, kind }))).toEqual([
      { line: 4, kind: 'literal' },
      { line: 5, kind: 'literal' },
      // 6 行目 `new Notice('保存しました')` は `Error` で終わらないクラスなので対象。8 行目 `new Error(\`…\`)` は例外。
      { line: 6, kind: 'literal' },
      { line: 12, kind: 'jsx-text' },
      { line: 13, kind: 'jsx-attribute' },
      { line: 14, kind: 'jsx-attribute' },
      { line: 15, kind: 'jsx-attribute' },
      { line: 16, kind: 'jsx-child-literal' },
      { line: 17, kind: 'jsx-child-literal' },
    ]);
    expect(findings.find((finding) => finding.line === 13)?.text).toBe('aria-label=閉じる');
  });

  it('`t()` / `messages.*` / props 経由と、`・` の区切り・英数字だけのリテラルは 0 件（コメント中の日本語は数えない）', () => {
    const file = fixture('clean.ok.tsx');
    expect(hardcodedCopyFindings(file, parse(file))).toEqual([]);
  });

  it('カタカナ語（`サーバ`）は `ー` を含んでも拾い、`・` / `ー` だけの文字列は拾わない', () => {
    expect(hardcodedCopyFindings('x.tsx', parseSource(`export const a = 'サーバ';`)).map((f) => f.kind)).toEqual(['literal']);
    expect(hardcodedCopyFindings('x.tsx', parseSource(`export const a = ['・', 'ー', '・ー'];`))).toEqual([]);
  });
});
