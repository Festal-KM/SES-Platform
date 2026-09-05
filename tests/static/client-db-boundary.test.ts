// tests/static/client-db-boundary.test.ts
// 🔴 P0 再発防止（T-04-06 Iteration 3。e2e-tester 報告）。
//
// 何が起きたか: `apps/web/lib/settings/sending-domain-fact.ts`（`'use client'` コンポーネントから
// import される）が `SENDING_DOMAIN_NOT_REQUIRED` を**値**として `./sending-domains`
// （`@ses/db` に依存するサーバ専用モジュール）から import していた。同じ import 文に型のみの
// 項目が並んでいたため見落とされやすく、その値 import 1 本のせいでモジュール全体が
// クライアントバンドルへ含まれ、`packages/db` のトップレベル `Prisma.sql`` `` がブラウザで
// throw した（`sqltag is unable to run in this browser environment`。ハイドレーションで crash）。
//
// 🔴 何を担保するか: `'use client'` を宣言したファイルから辿れる**値 import**の閉包に
//    `@ses/db` が 1 つも現れないこと。**型のみ import（`import type` /
//    全項目が `type` 修飾された named import）は実行時の依存にならないため辺として数えない**
//    （数えると、`sending-domain-screen.tsx` が `sending-domains.ts` の型だけを読む正当な
//    import まで誤検出してしまう）。
//
// 🔴 実バンドルではなく**ソースの import グラフ**を静的に検査する（webpack/Turbopack を
//    起動しない。他の tests/static/** と同じ「構造を固定する」方針）。
//
// 🔴 Iteration 5（code-reviewer 指摘。3 件）で埋めた穴:
//    ①走査は `apps/web/**` の相対 import と `@/` エイリアスだけを深追いし、他の `@ses/*`
//    パッケージへは越境しない。これが安全な前提として成立するのは、`eslint.config.mjs` の
//    `PACKAGE_ZONES` が `packages/config` / `ui` / `i18n`（クライアントから値 import
//    されうる）にも `forbiddenSesPackages: ['@ses/db', '@ses/ai', '@ses/connectors']` を
//    持つためである（以前は db/ai/connectors の三者間しか塞いでおらず、config/ui/i18n が
//    将来 `@ses/db` を値 import しても lint に掛からない穴があった）。
//    ②`@/` エイリアス（`apps/web/tsconfig.json` の `paths`）は解決して走査を続け、
//    解決できない場合は黙認せず例外を投げる（`findValueDbEdge` 内）。
//    ③`export * as ns from '...'`（名前空間 re-export）を値の辺として拾う
//    （`exportFromPattern` の節に `\*(?:\s+as\s+\w+)?` を追加）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const webAppDir = path.join(webRoot, 'app');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) return [];
    // 🔴 テストファイルはクライアントバンドルへ出荷されない（auth-db-callers.test.ts と同じ理由）。
    return /\.test\.(ts|tsx)$/.test(entry.name) ? [] : [full];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** コメントを落とす（雑だが import 文の判定用途には十分。auth-db-callers.test.ts と同じ方針）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

function isUseClientFile(source: string): boolean {
  const stripped = stripComments(source).trimStart();
  return /^['"]use client['"]\s*;?/.test(stripped);
}

/** 1 項目（named import/export の 1 要素）が `type` 修飾されているか。 */
function isTypeOnlyItem(item: string): boolean {
  return /^type\s+/.test(item.trim());
}

/**
 * clause（`import`/`export` と `from` の間）が値を 1 つも持ち込まないか。
 * - `{ A, type B }` … 全項目が `type` 修飾なら true（値の辺にならない）
 * - `{}` … 何も持ち込まないので true
 * - `* as X` / default import / 混在（`Foo, { Bar }`）… 常に false（値の辺になる）
 */
function clauseHasNoValue(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed === '' || trimmed.startsWith('*')) return trimmed === '';
  const braceMatch = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (braceMatch === null) return false;
  const items = (braceMatch[1] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length === 0) return true;
  return items.every(isTypeOnlyItem);
}

export type ImportEdge = { readonly specifier: string; readonly valueEdge: boolean };

/**
 * ソース 1 ファイル分の import/export-from/動的 import を辺として抽出する。
 * 🔴 型のみ（`import type` 全体 / 全項目 `type` 修飾）は `valueEdge: false` で返す
 *    （実行時の依存にならないため。TypeScript のコンパイル時消去と同じ判定基準）。
 */
export function extractEdges(source: string): readonly ImportEdge[] {
  const code = stripComments(source);
  const edges: ImportEdge[] = [];

  const importFromPattern = /import\s+(type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(importFromPattern)) {
    const leadingType = m[1];
    const clause = m[2] ?? '';
    const specifier = m[3] ?? '';
    edges.push({ specifier, valueEdge: leadingType === undefined && !clauseHasNoValue(clause) });
  }

  // 副作用のみの import '...'（"from" を伴わない。例: `import './tailwind.css';`）。
  const sideEffectPattern = /import\s*['"]([^'"]+)['"]\s*;/g;
  for (const m of code.matchAll(sideEffectPattern)) {
    edges.push({ specifier: m[1] ?? '', valueEdge: true });
  }

  // export ... from '...'（re-export）。`* as ns`（名前空間 re-export）も拾う
  // 🔴 code-reviewer 指摘 #3: 以前は裸の `\*` にしか一致せず、`export * as ns from '...'`
  //    が false negative になっていた（`clauseHasNoValue` 自体は `*` 始まりを正しく
  //    「値の辺」と判定できるのに、そこへ到達する前に regex が不一致で捨てていた）。
  const exportFromPattern = /export\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{[\s\S]*?\})\s+from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(exportFromPattern)) {
    const leadingType = m[1];
    const clause = m[2] ?? '';
    const specifier = m[3] ?? '';
    edges.push({ specifier, valueEdge: leadingType === undefined && !clauseHasNoValue(clause) });
  }

  // 動的 import('...')。
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(dynamicPattern)) {
    edges.push({ specifier: m[1] ?? '', valueEdge: true });
  }

  return edges;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** `apps/web/tsconfig.json` の `paths: { "@/*": ["./*"] }`（apps/web 基準）。現在使用 0 件だが
 *  黙って素通りさせない（code-reviewer 指摘 #2）。 */
const ALIAS_PREFIX = '@/';

function isAliasSpecifier(specifier: string): boolean {
  return specifier.startsWith(ALIAS_PREFIX);
}

/** 拡張子探索の候補（`.ts` → `.tsx` → `index.ts` → `index.tsx`）を共通化する。 */
function resolveCandidates(basePath: string): string | null {
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** TS の `.js` specifier 規約（NodeNext）を含め、実ソースファイルへ解決する。 */
export function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  const fromDir = path.dirname(fromFile);
  const base = specifier.replace(/\.js$/, '');
  return resolveCandidates(path.resolve(fromDir, base));
}

/** `@/foo` → `apps/web/foo`。解決できなければ `null`（呼び出し側が fail-closed で扱う）。 */
export function resolveAliasModule(specifier: string): string | null {
  const base = specifier.slice(ALIAS_PREFIX.length).replace(/\.js$/, '');
  return resolveCandidates(path.join(webRoot, base));
}

const TARGET_PACKAGE = '@ses/db';

function isTargetPackageSpecifier(specifier: string): boolean {
  return specifier === TARGET_PACKAGE || specifier.startsWith(`${TARGET_PACKAGE}/`);
}

/**
 * `rootFile` から**値 import だけ**を辿り、`@ses/db` に到達する経路があれば返す（無ければ `null`）。
 *
 * 🔴 相対 import と `@/` エイリアスは `apps/web/**` 内を深追いする。**それ以外の `@ses/*`
 *    パッケージへは越境しない** —— `packages/domain` は `forbidAllSes`、`packages/db` /
 *    `ai` / `connectors` は三者間の相互依存を禁止、`packages/config` / `ui` / `i18n`
 *    （クライアントコンポーネントから現に値 import されうる 3 パッケージ）は
 *    `forbiddenSesPackages: ['@ses/db', '@ses/ai', '@ses/connectors']` を持つ
 *    （`eslint.config.mjs` の `PACKAGE_ZONES`。`no-restricted-imports.test.ts` が固定する）。
 *    つまり **`@ses/*` のどのパッケージも内部で `@ses/db` を値 import できない**ことが
 *    ESLint 側の担保として揃っており、ここで同じ検査を二重に行う必要が無い
 *    （code-reviewer 指摘 #1。以前のコメントは db/ai/connectors の三者間しか
 *    触れておらず、config/ui/i18n の欠落を見落としていた）。
 * 🔴 `@/` は黙って無視しない（同 #2）。解決できれば通常の相対 import と同様に走査を続け、
 *    **解決できない場合は例外を投げて呼び出し元（`it`）を fail させる**（黙認の禁止）。
 */
export function findValueDbEdge(rootFile: string): string | null {
  const visited = new Set<string>();
  const queue: { readonly file: string; readonly chain: readonly string[] }[] = [
    { file: rootFile, chain: [toRepoRelative(rootFile)] },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const { file, chain } = next;
    if (visited.has(file)) continue;
    visited.add(file);

    const edges = extractEdges(readFileSync(file, 'utf8'));
    for (const edge of edges) {
      if (!edge.valueEdge) continue;
      if (isTargetPackageSpecifier(edge.specifier)) {
        return [...chain, edge.specifier].join(' -> ');
      }

      let resolved: string | null = null;
      if (isRelativeSpecifier(edge.specifier)) {
        resolved = resolveRelativeModule(file, edge.specifier);
      } else if (isAliasSpecifier(edge.specifier)) {
        resolved = resolveAliasModule(edge.specifier);
        if (resolved === null) {
          throw new Error(
            `@/ エイリアスの値 import を解決できません: '${edge.specifier}'（${toRepoRelative(file)}）。` +
              '黙って素通りさせない（code-reviewer 指摘 #2）。',
          );
        }
      } else {
        continue;
      }

      if (resolved !== null && resolved.startsWith(webRoot) && !visited.has(resolved)) {
        queue.push({ file: resolved, chain: [...chain, toRepoRelative(resolved)] });
      }
    }
  }
  return null;
}

const allWebAppFiles = listSourceFiles(webAppDir);
const useClientFiles = allWebAppFiles.filter((file) => isUseClientFile(readFileSync(file, 'utf8')));

describe('パーサの自己診断（型のみ import を値の辺として数えない）', () => {
  it('`import type { ... }`（節全体が type）は値の辺にならない', () => {
    const edges = extractEdges("import type { Foo, Bar } from '@ses/db';\n");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => !e.valueEdge)).toBe(true);
  });

  it('全項目が `type` 修飾された named import は値の辺にならない', () => {
    const edges = extractEdges("import { type Foo, type Bar } from '@ses/db';\n");
    expect(edges.every((e) => !e.valueEdge)).toBe(true);
  });

  it('1 つでも `type` 修飾が無い named import は値の辺になる', () => {
    const edges = extractEdges("import { Foo, type Bar } from '@ses/db';\n");
    expect(edges.some((e) => e.valueEdge)).toBe(true);
  });

  it('名前空間 import (`* as X`) は値の辺になる', () => {
    const edges = extractEdges("import * as db from '@ses/db';\n");
    expect(edges.some((e) => e.valueEdge)).toBe(true);
  });

  it('`export type * from` は値の辺にならない一方、`export * from` は値の辺になる', () => {
    const typeOnly = extractEdges("export type * from '@ses/db';\n");
    const value = extractEdges("export * from '@ses/db';\n");
    expect(typeOnly.every((e) => !e.valueEdge)).toBe(true);
    expect(value.some((e) => e.valueEdge)).toBe(true);
  });

  it('回帰（code-reviewer 指摘 #3）: `export * as ns from` は値の辺になる（以前は不一致だった）', () => {
    const edges = extractEdges("export * as ns from '@ses/db';\n");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.valueEdge)).toBe(true);
  });

  it('`export type * as ns from`（節全体が type）は値の辺にならない', () => {
    const edges = extractEdges("export type * as ns from '@ses/db';\n");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => !e.valueEdge)).toBe(true);
  });

  it('回帰: 今回の壊れた形（値 import と型のみ import が同じ節に混在）を検出できる', () => {
    const source = [
      'import {',
      '  SENDING_DOMAIN_NOT_REQUIRED,',
      '  type SendingDomainListView,',
      '  type SendingDomainResponseState,',
      "} from './sending-domains';",
      '',
    ].join('\n');
    const edges = extractEdges(source);
    expect(edges.some((e) => e.valueEdge && e.specifier === './sending-domains')).toBe(true);
  });

  it('対照: 修正後の形（型のみ import + 別モジュールからの値 import）は @ses/db 側へ値の辺を持たない', () => {
    const source = [
      "import { SENDING_DOMAIN_NOT_REQUIRED } from './sending-domain-constants';",
      "import type { SendingDomainListView, SendingDomainResponseState } from './sending-domains';",
      '',
    ].join('\n');
    const edges = extractEdges(source);
    const sendingDomainsEdges = edges.filter((e) => e.specifier === './sending-domains');
    expect(sendingDomainsEdges.length).toBeGreaterThan(0);
    expect(sendingDomainsEdges.every((e) => !e.valueEdge)).toBe(true);
  });
});

describe('`@/` エイリアス（code-reviewer 指摘 #2。apps/web/tsconfig.json の paths）', () => {
  const fixturesDir = path.join(here, '__fixtures__', 'client-db-boundary');

  it('`@/` の値 import は辺として抽出される', () => {
    const edges = extractEdges("import { Foo } from '@/lib/settings/sending-domain-fact';\n");
    expect(
      edges.some((e) => e.valueEdge && e.specifier === '@/lib/settings/sending-domain-fact'),
    ).toBe(true);
  });

  it('`resolveAliasModule` が `apps/web/` 基準で実ファイルへ解決できる', () => {
    const resolved = resolveAliasModule('@/lib/settings/sending-domain-fact');
    expect(resolved).toBe(path.join(webRoot, 'lib', 'settings', 'sending-domain-fact.ts'));
  });

  it('対照: 存在しない `@/` specifier は解決できない（null）', () => {
    expect(resolveAliasModule('@/__this_does_not_exist__')).toBeNull();
  });

  it('解決できない `@/` の値 import は黙認せず、走査が例外で fail する', () => {
    const fixture = path.join(fixturesDir, 'alias-unresolvable.tsx');
    expect(() => findValueDbEdge(fixture)).toThrow(/@\/ エイリアス/);
  });

  it('解決できる `@/` の値 import は走査を継続し、@ses/db への到達も検出できる', () => {
    const fixture = path.join(fixturesDir, 'alias-reaches-db.tsx');
    const hit = findValueDbEdge(fixture);
    expect(hit).not.toBeNull();
    expect(hit).toContain('@ses/db');
    expect(hit).toContain('lib/settings/sending-domains.ts');
  });
});

describe('クライアントコンポーネントの import 閉包に @ses/db が現れない（T-04-06 P0 再発防止）', () => {
  it('対照: use client ファイルが実際に存在する（空振り防止）', () => {
    expect(useClientFiles.length).toBeGreaterThan(0);
  });

  it('対照: 実ファイルの値 import が正しく抽出される（sending-domain-screen.tsx → sending-domain-fact.ts）', () => {
    const screenFile = path.join(
      webAppDir,
      '(main)',
      'settings',
      'sending-domains',
      'sending-domain-screen.tsx',
    );
    const edges = extractEdges(readFileSync(screenFile, 'utf8'));
    const valueSpecifiers = edges.filter((e) => e.valueEdge).map((e) => e.specifier);
    expect(valueSpecifiers).toContain('../../../../lib/settings/sending-domain-fact');
    // 🔴 `@ses/db` からの型のみ import は残っているが、値としては現れない（自己診断と同じ基準）。
    const dbEdges = edges.filter((e) => e.specifier === '@ses/db');
    expect(dbEdges.length).toBeGreaterThan(0);
    expect(dbEdges.every((e) => !e.valueEdge)).toBe(true);
  });

  it('対照: 相対 specifier が実ファイルへ解決できる', () => {
    const screenFile = path.join(
      webAppDir,
      '(main)',
      'settings',
      'sending-domains',
      'sending-domain-screen.tsx',
    );
    const resolved = resolveRelativeModule(screenFile, '../../../../lib/settings/sending-domain-fact');
    expect(resolved).toBe(path.join(webRoot, 'lib', 'settings', 'sending-domain-fact.ts'));
  });

  it.each(useClientFiles.map(toRepoRelative))('%s の値 import の閉包に @ses/db が現れない', (relFile) => {
    const absFile = path.join(repoRoot, relFile);
    expect(findValueDbEdge(absFile)).toBeNull();
  });
});
