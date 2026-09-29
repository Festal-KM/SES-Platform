// tests/static/ui-dependency-single-path.test.ts
// 🔴 `docs/05` §17.7.1 **(i)**: **UI 刷新で入る新規依存の入口を 1 本に固定する**
//    （`docs/05` §17.2 #10 / #10b の「単一経路」と同じ発想。`ai-single-path.test.ts` の形）。
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// 刷新で入る依存は 3 系統ある —— `lucide-react`（アイコン）/ `tailwind-merge` + `cva`（クラス合成）/
// `@radix-ui/*`（overlay）。入口が散ると次の壊れ方をする。
//
//   - `lucide-react` … 🔴 `docs/04` §3.1 は**セットを 1 つに固定**し、**比喩アイコン（きらめき /
//     稲妻 / ロケット / 脳 / 電球）を使わない**と定めている。画面から直接 import できるなら、
//     その規約は「気をつける」に戻る。**閉じた写像（`packages/ui/src/icons.ts`）に無い名前は
//     型エラー**にするのが唯一の担保である。
//   - `tailwind-merge` … 🔴 `cn()` が `extendTailwindMerge` で semantic 名と 6 トークンを登録して
//     いなければ `cn('text-cell','text-fg-muted')` が `text-cell` を**黙って落とす**（`docs/05`
//     §2.3.3 規律 2。**見た目だけ壊れテストは緑**）。2 本目の `twMerge` は登録の無い素の合成になる。
//   - `@radix-ui/*` … (b)② と同じ。部品の実装詳細であり画面から使わせない。
//
// 加えて **クライアント境界**を守る（⑤⑥）。`packages/ui` は既定でサーバのまま描け、
// overlay だけが `./client` に入る。🔴 **`@ses/ui/client` を import する側が `'use client'` を
// 宣言していなければ、その画面が暗黙にクライアントへ移る**（`client-db-boundary.test.ts` の
// 前提が崩れる）。
//
// 検査（(i) の ①〜⑥）:
//   ① `lucide-react` の import が `packages/ui/src/icons.ts` の 1 本
//   ② `tailwind-merge` の import が `packages/ui/src/lib/cn.ts` の 1 本
//   ③ `class-variance-authority` / `@radix-ui/*` の import が `packages/ui/src/**` だけ
//   ④ `packages/ui/src/**` に `next/` と `@ses/i18n` の import が 1 つも無い（`docs/05` §2.3.1）
//   ⑤ `@ses/ui/client` を import するファイルは自身が `'use client'` を宣言している
//   ⑥ `packages/ui/package.json` の `exports` のサブパスが `"."` と `"./client"` だけ
//
// ⚠️ **①②⑥ は「唯一の入口の外に無い」形で書く。** 着手時（2026-09-30）は `lucide-react` が未導入
//    （`T-22-05` が入れる）で、`exports` も未設定（`T-22-03` が `"."` / `"./client"` を置く）である。
//    「ちょうど 1 本ある」と書くと **段① の途中で赤くなり、赤い検査は緩められる**（`SP-22` §4.1 の
//    段① の行は「(i) が無条件 green」= 段① の**終わり**の状態）。**「外に無い」なら 0 本でも 1 本でも
//    正しく、入口が増えた瞬間に落ちる** —— 守りたいのは「散らないこと」である。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';

const APPS_WEB = path.join(repoRoot, 'apps', 'web');
const PACKAGES = path.join(repoRoot, 'packages');

type ImportRef = { readonly file: string; readonly line: number; readonly module: string };

/** import / export / `import()` / `require()` のモジュール指定子をすべて拾う。 */
export function moduleReferences(file: string, source: ts.SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  const push = (node: ts.Node, module: string): void => {
    refs.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, module });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) push(node, node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteralLike(expression)) push(node, expression.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const argument = node.arguments[0];
      if ((isDynamicImport || isRequire) && argument !== undefined && ts.isStringLiteralLike(argument)) {
        push(node, argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

/** ファイル先頭の `'use client'` ディレクティブ。 */
export function declaresUseClient(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  if (first === undefined || !ts.isExpressionStatement(first)) return false;
  return ts.isStringLiteralLike(first.expression) && first.expression.text === 'use client';
}

function parse(absolute: string): ts.SourceFile {
  return ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** 走査対象: `apps/web` の全実装 + `packages/**` の全実装（依存が別パッケージへ漏れる経路も見る）。 */
const scanned = [
  ...collectSourceFiles(APPS_WEB, ['.ts', '.tsx']),
  ...collectSourceFiles(PACKAGES, ['.ts', '.tsx']),
].map((absolute) => ({
  file: toRepoRelative(absolute),
  source: parse(absolute),
}));

const allRefs = scanned.flatMap(({ file, source }) => moduleReferences(file, source));

function refsTo(predicate: (module: string) => boolean): ImportRef[] {
  return allRefs.filter((ref) => predicate(ref.module));
}

function outside(refs: readonly ImportRef[], allowed: (file: string) => boolean): string[] {
  return refs.filter((ref) => !allowed(ref.file)).map((ref) => `${ref.file}:${ref.line} ${ref.module}`);
}

describe('🔴 (i) UI 刷新の新規依存の入口が 1 本である（docs/05 §17.7.1 (i)）', () => {
  it('走査が空振りしていない（`apps/web` と `packages/ui` の両方から import を拾えている）', () => {
    expect(scanned.length).toBeGreaterThan(200);
    expect(allRefs.length).toBeGreaterThan(200);
    expect(allRefs.some((ref) => ref.file.startsWith('apps/web/'))).toBe(true);
    expect(allRefs.some((ref) => ref.file.startsWith('packages/ui/src/'))).toBe(true);
    // 実在する単一経路（`tailwind-merge`）を現に 1 本拾えていること（検出器の実証）。
    expect(refsTo((module) => module === 'tailwind-merge').map((ref) => ref.file)).toEqual([
      'packages/ui/src/lib/cn.ts',
    ]);
  });

  it('① `lucide-react` の import が `packages/ui/src/icons.ts` の外に無い', () => {
    expect(
      outside(refsTo((module) => module === 'lucide-react' || module.startsWith('lucide-react/')), (file) => file === 'packages/ui/src/icons.ts'),
      '🔴 docs/04 §3.1: アイコンのセットを 1 つに固定し、比喩アイコンを使わない。' +
        '入口は `packages/ui/src/icons.ts` の閉じた写像だけで、写像に無い名前は型エラーになる',
    ).toEqual([]);
  });

  it('② `tailwind-merge` の import が `packages/ui/src/lib/cn.ts` の外に無い', () => {
    expect(
      outside(refsTo((module) => module === 'tailwind-merge'), (file) => file === 'packages/ui/src/lib/cn.ts'),
      '🔴 docs/05 §2.3.3 規律 2: `extendTailwindMerge` の登録を通らない合成は ' +
        '`cn("text-cell","text-fg-muted")` で `text-cell` を黙って落とす（見た目だけ壊れテストは緑）',
    ).toEqual([]);
  });

  it('③ `class-variance-authority` / `@radix-ui/*` の import が `packages/ui/src/**` の外に無い', () => {
    expect(
      outside(
        refsTo((module) => module === 'class-variance-authority' || module.startsWith('@radix-ui/')),
        (file) => file.startsWith('packages/ui/src/'),
      ),
      '🔴 バリアント定義と overlay の実装詳細は部品の内側に閉じる（(b)② と同じ規律）',
    ).toEqual([]);
  });

  it('④ `packages/ui/src/**` に `next/` と `@ses/i18n` の import が 1 つも無い', () => {
    const violations = allRefs
      .filter((ref) => ref.file.startsWith('packages/ui/src/'))
      .filter((ref) => ref.module === 'next' || ref.module.startsWith('next/') || ref.module === '@ses/i18n')
      .map((ref) => `${ref.file}:${ref.line} ${ref.module}`);
    expect(
      violations,
      '🔴 docs/05 §2.3.1: `packages/ui` は `next/*` と `@ses/i18n` に依存しない' +
        '（文言は props / リンクは `linkComponent` prop）。依存すると部品が Next 専用になり、' +
        '文言が部品の中に入って `no-hardcoded-copy` の射程から逃げる',
    ).toEqual([]);
  });

  it('⑤ `@ses/ui/client` を import するファイルは自身が `use client` を宣言している', () => {
    const violations = scanned
      .filter(({ source }) => !declaresUseClient(source))
      .flatMap(({ file, source }) =>
        moduleReferences(file, source)
          .filter((ref) => ref.module === '@ses/ui/client' || ref.module.startsWith('@ses/ui/client/'))
          .map((ref) => `${ref.file}:${ref.line}`),
      );
    expect(
      violations,
      '🔴 docs/05 §17.7.1 (i)⑤: クライアント境界を暗黙に増やさない。' +
        'サーバコンポーネントが `@ses/ui/client` を import すると、その画面が丸ごと' +
        'クライアントバンドルへ移り `client-db-boundary.test.ts` の前提が崩れる',
    ).toEqual([]);
  });

  it('⑥ `packages/ui/package.json` の `exports` のサブパスが `"."` と `"./client"` だけである', () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages', 'ui', 'package.json'), 'utf8')) as {
      readonly exports?: Record<string, unknown> | string;
    };
    expect(
      unexpectedExportSubpaths(manifest.exports),
      '🔴 docs/05 §2.3.1: バレルは `"."` と `"./client"` の 2 つだけ' +
        '（`packages/connectors` の `"."` / `"./aws"` と同じ形）。' +
        '深い import を開くと、参照していない側までバンドルに引き込まれる',
    ).toEqual([]);
  });
});

/** `exports` に許される以外のサブパスを返す（未設定なら空 = 単一エントリのまま）。 */
export function unexpectedExportSubpaths(exportsField: unknown): string[] {
  if (exportsField === undefined || exportsField === null) return [];
  if (typeof exportsField === 'string') return [];
  if (typeof exportsField !== 'object') return ['exports がオブジェクトでも文字列でもない'];
  const allowed = new Set(['.', './client']);
  return Object.keys(exportsField as Record<string, unknown>).filter((key) => !allowed.has(key));
}

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (i) の検出器', () => {
  const parseText = (text: string, name = 'x.tsx'): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('静的 import / 型 import / re-export / 動的 import / require のすべてを拾う', () => {
    const source = parseText(
      [
        "import { Dialog } from '@radix-ui/react-dialog';",
        "import type { LucideIcon } from 'lucide-react';",
        "export { X } from 'tailwind-merge';",
        "const m = await import('class-variance-authority');",
        "const n = require('@radix-ui/react-tabs');",
      ].join('\n'),
    );
    expect(moduleReferences('x.tsx', source).map((ref) => ref.module)).toEqual([
      '@radix-ui/react-dialog',
      'lucide-react',
      'tailwind-merge',
      'class-variance-authority',
      '@radix-ui/react-tabs',
    ]);
  });

  it('🔴 コメント中の import と、名前の似たパッケージを拾わない', () => {
    expect(moduleReferences('x.tsx', parseText("// import 'lucide-react';\nexport const A = 1;"))).toEqual([]);
    expect(
      moduleReferences('x.tsx', parseText("import x from 'lucide-react-native';")).map((ref) => ref.module),
    ).toEqual(['lucide-react-native']);
    // 接頭辞一致で `lucide-react-native` を `lucide-react` 扱いしない（①の述語の形）。
    const isLucide = (module: string): boolean => module === 'lucide-react' || module.startsWith('lucide-react/');
    expect(isLucide('lucide-react-native')).toBe(false);
    expect(isLucide('lucide-react/icons/check')).toBe(true);
  });

  it('⑤ `use client` の検出が先頭のディレクティブだけを見る', () => {
    expect(declaresUseClient(parseText("'use client';\nexport const A = 1;"))).toBe(true);
    expect(declaresUseClient(parseText('"use client";\nexport const A = 1;'))).toBe(true);
    // 🔴 途中に書いても Next.js のディレクティブとしては効かない。検出も効かせない。
    expect(declaresUseClient(parseText("export const A = 1;\n'use client';"))).toBe(false);
    expect(declaresUseClient(parseText("// 'use client'\nexport const A = 1;"))).toBe(false);
  });

  it('⑥ `exports` の判定（未設定 / 2 つ / 深い import）', () => {
    expect(unexpectedExportSubpaths(undefined)).toEqual([]);
    expect(unexpectedExportSubpaths({ '.': './dist/index.js', './client': './dist/index.client.js' })).toEqual([]);
    expect(
      unexpectedExportSubpaths({ '.': 'x', './client': 'y', './components/*': 'z' }),
      '🔴 深い import を開いた瞬間に落ちる',
    ).toEqual(['./components/*']);
    expect(unexpectedExportSubpaths({ './lib/cn': 'x' })).toEqual(['./lib/cn']);
  });
});
