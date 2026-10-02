// tests/static/ui-primitive-single-impl.test.ts
// 🔴 `docs/05` §17.7.1 **(b)**: **プリミティブの二重実装が無い。**
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §5-13 の実測（`SP-22` §3.4-2）: `Dialog` / `Drawer` / `DropdownMenu` / `Tooltip` /
// `Tabs` / `Toast` / `Skeleton` / `EmptyState` が**実装に 1 つも無い**（`role="dialog"` の出現 0 件）。
// これから 19 部品を入れる。そのとき最も起きやすい壊れ方は「**画面側にもう 1 つ作る**」である ——
// 部品が 2 つあると、①`focus-visible` のリングが 2 系統になり ②`Drawer` に実行系を置かないという
// §11-25 の規約が片方だけで守られ ③`StatusBadge` の色が画面側で決められて §7.4 の意味の対応が崩れる。
//
// 検査（(b) の ①〜④）:
//   ① `role="dialog"` / `role="alertdialog"` を出すソースが `packages/ui/src/components/**` の 1 箇所
//   ② `@radix-ui/*` の import が `packages/ui/src/components/**` だけ
//   ③ `apps/web` に 8 部品を**宣言**するソースが無い（`export function <名前>` / `export const <名前> =`）
//      🔴 **props を組み立てて渡すだけの `_shell/**` は宣言ではない**（`docs/05` §17.7.1 (b)③）
//   ④ `IconButton` / `SearchInput` / `StatusBadge` が**独立ファイルを持たない**
//      （`button.tsx` / `input.tsx` / `badge.tsx` の中のバリアントである。`docs/04` §5-13）
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';
import { describeRatchetInvariants, violationLinesByFile } from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_B } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_B } from './support/ui-ratchet-baseline.js';

const APPS_WEB = path.join(repoRoot, 'apps', 'web');
const UI_SRC = path.join(repoRoot, 'packages', 'ui', 'src');
const UI_COMPONENTS_DIR = 'packages/ui/src/components/';

/** 🔴 部品として `packages/ui` にしか存在してはならない名前（`docs/05` §17.7.1 (b)③）。 */
const SINGLE_IMPL_COMPONENTS = [
  'AppShell',
  'PageHeader',
  'DataTable',
  'Drawer',
  'EmptyState',
  'Skeleton',
  'Toast',
  'StatusBadge',
  // ✅ 2026-10-02（人間のブリーフ）: 共通フレームの 8 部品。
  // 🔴 **ここに足すことが「共通フレーム」の意味である。** ブリーフの目的は
  //    「複数人がそれぞれ別の画面を担当しても、1 つの統一された SaaS に見えること」であり、
  //    **画面側に `KpiCard` 相当を自作されたらその目的は達成できない**（面・影・余白・色の決定が
  //    画面に戻る）。`packages/ui` の 1 箇所にしか無いことを機械で固定する。
  // ⚠️ `Timeline` / `RankedList` / `RailCard` は `components/rail-card.tsx` の 3 export であり、
  //    ファイル数ではなく**宣言の場所**を見る検査なのでそのまま働く。
  'KpiCard',
  'KpiCardRow',
  'SectionHeader',
  'PageGreeting',
  'RailCard',
  'Timeline',
  'RankedList',
  'Avatar',
  'GlobalSearchBox',
] as const;

/** 🔴 独立ファイルを持ってはならない部品 → 実装が入るべきファイル（`docs/04` §5-13 / `T-22-04`）。 */
const VARIANT_ONLY_COMPONENTS: ReadonlyArray<readonly [component: string, host: string]> = [
  ['IconButton', 'button.tsx'],
  ['SearchInput', 'input.tsx'],
  ['StatusBadge', 'badge.tsx'],
];

function parse(absolute: string): ts.SourceFile {
  return ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

type Finding = { readonly file: string; readonly line: number; readonly detail: string };

// ============================================================================
// ① `role="dialog"` / `role="alertdialog"` を出すソース
// ============================================================================
/** JSX 属性 `role` に `dialog` / `alertdialog` のリテラルを与えているソースを拾う。 */
export function dialogRoleFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    // JSX: `role="dialog"` / `role={'dialog'}`
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'role' && node.initializer !== undefined) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (value !== undefined && ts.isStringLiteralLike(value) && /^(?:alert)?dialog$/.test(value.text)) {
        findings.push({ file, line: lineOf(source, node), detail: `role="${value.text}"` });
      }
    }
    // オブジェクト / 変数経由（`const role = 'dialog'` / `{ role: 'alertdialog' }`）も同じ穴である。
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'role') {
      const value = node.initializer;
      if (ts.isStringLiteralLike(value) && /^(?:alert)?dialog$/.test(value.text)) {
        findings.push({ file, line: lineOf(source, node), detail: `role: '${value.text}'` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

// ============================================================================
// ② `@radix-ui/*` の import
// ============================================================================
export function radixImportFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const moduleSpecifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined;
    if (moduleSpecifier !== undefined && ts.isStringLiteralLike(moduleSpecifier) && moduleSpecifier.text.startsWith('@radix-ui/')) {
      findings.push({ file, line: lineOf(source, node), detail: moduleSpecifier.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

// ============================================================================
// ③ 部品の「宣言」
// ============================================================================
/**
 * `export function <名前>` / `export const <名前> = …` の形で部品名を宣言しているか。
 * 🔴 **`export type` / `export interface` は宣言ではない**（`AppShellProps` のような props 型は、
 *    値を渡すだけの側にも要る。`docs/05` §17.7.1 (b)③ の「props を組み立てて渡すだけの
 *    `_shell/**` は宣言ではない」に合わせる）。
 */
export function componentDeclarationFindings(
  file: string,
  source: ts.SourceFile,
  names: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && isExported(node)) {
      if (names.includes(node.name.text)) {
        findings.push({ file, line: lineOf(source, node), detail: `export function ${node.name.text}` });
      }
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          findings.push({ file, line: lineOf(source, node), detail: `export const ${declaration.name.text}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

// ============================================================================
// 走査
// ============================================================================
const appFiles = collectSourceFiles(APPS_WEB, ['.tsx', '.ts']);
const uiFiles = collectSourceFiles(UI_SRC, ['.tsx', '.ts']);
const allFiles = [...appFiles, ...uiFiles];

const dialogRoleFiles = [
  ...new Set(allFiles.flatMap((absolute) => dialogRoleFindings(toRepoRelative(absolute), parse(absolute)).map((f) => f.file))),
].sort();
const radixFindings = allFiles.flatMap((absolute) => radixImportFindings(toRepoRelative(absolute), parse(absolute)));
const declarationFindings = appFiles.flatMap((absolute) =>
  componentDeclarationFindings(toRepoRelative(absolute), parse(absolute), SINGLE_IMPL_COMPONENTS),
);
const declarationLines = violationLinesByFile(declarationFindings);

describeRatchetInvariants({
  label: '(b)③ apps/web 側の部品の宣言',
  allowlist: UI_RATCHET_ALLOWLIST_B,
  baseline: UI_RATCHET_BASELINE_B,
  actual: declarationLines,
  scannedFileCount: appFiles.length,
});

describe('🔴 (b) プリミティブの二重実装が無い（docs/05 §17.7.1 (b)）', () => {
  it('走査が空振りしていない（apps/web と packages/ui の両方を見ている）', () => {
    expect(appFiles.length).toBeGreaterThan(80);
    expect(uiFiles.length).toBeGreaterThanOrEqual(15);
  });

  it('① `role="dialog"` / `role="alertdialog"` を出すソースが `packages/ui/src/components/**` を出ない', () => {
    const outside = dialogRoleFiles.filter((file) => !file.startsWith(UI_COMPONENTS_DIR));
    expect(
      outside,
      '🔴 overlay は `packages/ui/src/components/{dialog,drawer}.tsx` の 1 箇所で描く（docs/05 §2.3.1）。' +
        'キーボード操作・フォーカストラップ・スクリーンリーダ対応を 2 箇所で持つと必ず片方が古くなる',
    ).toEqual([]);
  });

  it('① `role="dialog"` を出すソースが多くとも 1 ファイルである（`Drawer` は `Dialog` 派生）', () => {
    expect(
      dialogRoleFiles.length,
      '🔴 `Drawer` は `Dialog` 派生として実装し、別依存・別実装を足さない（docs/05 §2.3.1 / §2.3.3）',
    ).toBeLessThanOrEqual(1);
  });

  it('② `@radix-ui/*` の import が `packages/ui/src/components/**` を出ない', () => {
    const outside = radixFindings.filter((finding) => !finding.file.startsWith(UI_COMPONENTS_DIR));
    expect(
      outside.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
      '🔴 Radix は部品の実装詳細である。画面から直接使うと `focus-visible` のリングと ' +
        '`aria-*` の付け方が画面ごとに分かれる（docs/05 §17.7.1 (i)③ と同じ規律）',
    ).toEqual([]);
  });

  it('③ `apps/web` に 8 部品を宣言するソースが無い（許可リストの外）', () => {
    const violations = declarationFindings
      .filter((finding) => !UI_RATCHET_ALLOWLIST_B.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} ${finding.detail}`);
    expect(
      violations,
      `🔴 ${SINGLE_IMPL_COMPONENTS.join(' / ')} は \`packages/ui\` にしか存在しない。` +
        'props を組み立てて渡すだけのファイル（`_shell/**`）は宣言ではない',
    ).toEqual([]);
  });

  it('④ `IconButton` / `SearchInput` / `StatusBadge` が独立ファイルを持たない', () => {
    const componentsDir = path.join(UI_SRC, 'components');
    const existing = existsSync(componentsDir) ? readdirSync(componentsDir) : [];
    const forbidden = ['icon-button.tsx', 'search-input.tsx', 'status-badge.tsx'].filter((name) =>
      existing.includes(name),
    );
    expect(
      forbidden,
      `🔴 docs/04 §5-13: これらは既存の ${VARIANT_ONLY_COMPONENTS.map(([, host]) => host).join(' / ')} の` +
        'バリアントとして実装し、新しいファイルを起こさない（8 状態を 2 箇所で持たないため）',
    ).toEqual([]);
  });

  it('④ バリアントの宿主ファイルが実在する（対照: 走査対象のディレクトリを間違えていない）', () => {
    const componentsDir = path.join(UI_SRC, 'components');
    const existing = existsSync(componentsDir) ? readdirSync(componentsDir) : [];
    for (const [, host] of VARIANT_ONLY_COMPONENTS) {
      expect(existing, `${host} が無い（走査先が違う）`).toContain(host);
    }
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (b) の検出器', () => {
  const parseText = (text: string, name = 'x.tsx'): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('① JSX 属性・オブジェクトのどちらの形でも `role="dialog"` を拾う', () => {
    expect(
      dialogRoleFindings('x.tsx', parseText('export const A = () => <div role="dialog" />;')).map((f) => f.detail),
    ).toEqual(['role="dialog"']);
    expect(
      dialogRoleFindings('x.tsx', parseText("export const A = () => <div role={'alertdialog'} />;")).map((f) => f.detail),
    ).toEqual(['role="alertdialog"']);
    expect(dialogRoleFindings('x.ts', parseText("export const p = { role: 'dialog' };", 'x.ts')).map((f) => f.detail)).toEqual([
      "role: 'dialog'",
    ]);
  });

  it('🔴 ① `role="button"` / コメント中の `role="dialog"` は拾わない', () => {
    expect(dialogRoleFindings('x.tsx', parseText('export const A = () => <div role="button" />;'))).toEqual([]);
    expect(dialogRoleFindings('x.tsx', parseText('// <div role="dialog" />\nexport const A = 1;'))).toEqual([]);
    expect(dialogRoleFindings('x.tsx', parseText('export const A = () => <div role="dialogue" />;'))).toEqual([]);
  });

  it('② `@radix-ui/*` の import を拾い、名前の似た別パッケージは拾わない', () => {
    expect(
      radixImportFindings('x.tsx', parseText("import * as D from '@radix-ui/react-dialog';")).map((f) => f.detail),
    ).toEqual(['@radix-ui/react-dialog']);
    expect(radixImportFindings('x.tsx', parseText("import x from 'radix-ui-clone';"))).toEqual([]);
    expect(radixImportFindings('x.tsx', parseText("// import '@radix-ui/react-dialog';\nexport const A = 1;"))).toEqual([]);
  });

  it('③ `export function` / `export const` を拾い、`export type` は拾わない', () => {
    expect(
      componentDeclarationFindings('x.tsx', parseText('export function DataTable() { return null; }'), ['DataTable']).map(
        (f) => f.detail,
      ),
    ).toEqual(['export function DataTable']);
    expect(
      componentDeclarationFindings('x.tsx', parseText('export const Drawer = () => null;'), ['Drawer']).map((f) => f.detail),
    ).toEqual(['export const Drawer']);
    expect(
      componentDeclarationFindings('x.tsx', parseText('export type AppShellProps = { a: 1 };'), ['AppShell', 'AppShellProps']),
    ).toEqual([]);
    // 🔴 props を組み立てて渡すだけの形（import して使う）は宣言ではない。
    expect(
      componentDeclarationFindings(
        'x.tsx',
        parseText("import { AppShell } from '@ses/ui';\nexport function Shell() { return <AppShell nav={[]} />; }"),
        ['AppShell'],
      ),
    ).toEqual([]);
    // export されていない内部関数も宣言ではない（部品として外へ出ない）。
    expect(componentDeclarationFindings('x.tsx', parseText('function Toast() { return null; }'), ['Toast'])).toEqual([]);
  });
});
