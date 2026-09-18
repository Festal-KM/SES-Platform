// tests/static/engineer-share-list-contract.test.ts
// 🔴 T-11-11（docs/05 §17.2 #33。§6.4「#29 の改訂」）: **`S-015` の一覧の契約を型と構造で固定する**
//    （実データの検証は `tests/isolation/engineer-shares.test.ts`）。
//
//   ① `EngineerShareListView` が `CursorPage<EngineerShareCandidateView>` と同一で、`total` / `remaining` /
//      `page` / `ledgerEmpty` をキーとして持たない（型テスト。docs/05 §4.8）
//   ② `engineerShareListQuerySchema.shape` のキー集合が `['availableBy','cursor','limit','q','shared']`
//      （スナップショット。スキル・単価・勤務地・`skillMode` を足す変更を落とす）
//   ③ `engineerShareCursorSchema` が `s:` / `u:` の 2 形以外（UUID 単体・並びのキー `{bucket}:{date}:{sortRef}`・
//      空文字）を弾く
//   ④ `engineerShareBodySchema` に配列を受けるキーが無く、`/api/engineer-shares/route.ts` の export が `GET` だけ
//      （🔴 一括の共有 / 解除のエンドポイントが存在しない。`F-016 AC-1`。`engineer-shares.test.ts:291` と対）
//   ⑤ `apps/web/lib/engineer-shares/**` に `contains` / `mode: 'insensitive'` が現れない（フリーワードの照合は
//      `packages/db/src/search/free-word.ts` の 1 箇所。#22 `search-sql-single-path.test.ts` の走査対象に含まれることを対照で確認）
//   ⑥ T-12-17 ③: `i18n` の `次の 50 件`（`engineerShares.loadMore`）と `PAGE_SIZE_DEFAULT`（`packages/config/src/limits.ts`）
//      は手で同期している —— 値と文言の対照を固定する（`PAGE_SIZE_DEFAULT` を変えるとここが落ちる。文言を `t()` の
//      引数で組み立てる形には変えない = T-10-01 の決着「`t()` に引数は足さない」）
//
// 🔴 ④⑤は **AST** で見る（正規表現ではコメント中の `contains` / `export` を実物と区別できない）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CursorPage } from '../../apps/web/lib/api/pagination';
import { PAGE_SIZE_DEFAULT } from '../../packages/config/src/limits.js';
import { t } from '../../packages/i18n/src/index.js';
import {
  engineerShareBodySchema,
  engineerShareCursorSchema,
  engineerShareListQuerySchema,
} from '../../apps/web/lib/engineer-shares/schemas';
import type {
  EngineerShareCandidateView,
  EngineerShareListView,
} from '../../apps/web/lib/engineer-shares/service';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const ROUTE_FILE = path.join(repoRoot, 'apps', 'web', 'app', 'api', '(main)', 'engineer-shares', 'route.ts');
const LIB_DIR = path.join(repoRoot, 'apps', 'web', 'lib', 'engineer-shares');
const SEARCH_SINGLE_PATH_TEST = path.join(here, 'search-sql-single-path.test.ts');

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** ファイルの export 名（`export const X` / `export function X` / `export { X }` / `export type X` を含む）。 */
function exportedNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (isExported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (isExported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))) {
      if (statement.name !== undefined) names.push(statement.name.text);
    } else if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.push(element.name.text);
      }
    }
  }
  return names;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** `contains:` / `mode: 'insensitive'` をプロパティ割り当てとして持つ箇所（AST。コメントは対象外）。 */
function freeWordPredicateSites(sourceFile: ts.SourceFile): string[] {
  const sites: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (name === 'contains') sites.push(`contains@${node.getStart(sourceFile)}`);
      if (
        name === 'mode' &&
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text === 'insensitive'
      ) {
        sites.push(`mode:insensitive@${node.getStart(sourceFile)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return sites;
}

describe('① 応答は `{ items, nextCursor }` の 2 キー（型）', () => {
  it('`EngineerShareListView` は `CursorPage<EngineerShareCandidateView>` と同一で、総件数系のキーを持たない', () => {
    expectTypeOf<EngineerShareListView>().toEqualTypeOf<CursorPage<EngineerShareCandidateView>>();
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('total');
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('remaining');
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('page');
    expectTypeOf<EngineerShareListView>().not.toHaveProperty('ledgerEmpty');
  });
});

describe('② query のキー集合（スナップショット）', () => {
  it("`['availableBy','cursor','limit','q','shared']` のまま（スキル・単価・勤務地・skillMode を足さない）", () => {
    expect(Object.keys(engineerShareListQuerySchema.shape).sort()).toMatchInlineSnapshot(`
      [
        "availableBy",
        "cursor",
        "limit",
        "q",
        "shared",
      ]
    `);
  });
});

describe('③ カーソルは `s:` / `u:` の 2 形だけ', () => {
  const UUID = '01930000-0000-7000-8000-0000000000a1';

  it.each([
    ['空文字', ''],
    ['UUID 単体', UUID],
    ['並びのキー `{bucket}:{date}:{sortRef}`', '0:2026-09-08:AAAAAAAAAAAAAAAAAAAAAA'],
    ['数値だけ', '1757000000000'],
  ])('%s を弾く', (_label, cursor) => {
    expect(engineerShareCursorSchema.safeParse(cursor).success).toBe(false);
  });

  it('2 形は通す', () => {
    expect(engineerShareCursorSchema.safeParse(`s:1757000000000:${UUID}`).success).toBe(true);
    expect(engineerShareCursorSchema.safeParse(`u:1757000000000:${UUID}`).success).toBe(true);
  });
});

describe('🔴 ④ 一括の共有 / 解除のエンドポイントが存在しない（`F-016 AC-1`）', () => {
  it('`engineerShareBodySchema` のキーは `shared` だけ（配列を受けるキーが無い）', () => {
    expect(Object.keys(engineerShareBodySchema.shape)).toEqual(['shared']);
    expect(engineerShareBodySchema.safeParse({ shared: [true, false] }).success).toBe(false);
    expect(engineerShareBodySchema.parse({ shared: true, engineerIds: ['a'], all: true })).toEqual({ shared: true });
  });

  it('`/api/engineer-shares/route.ts` の HTTP メソッドの export は `GET` だけ（AST）', () => {
    const names = exportedNames(parse(ROUTE_FILE));
    const methods = names.filter((name) => name === name.toUpperCase() && /^[A-Z]+$/.test(name));
    expect(methods).toEqual(['GET']);
    // 対照: `runtime` / `dynamic` は Next.js の設定であり、メソッドではない。
    expect(names).toContain('runtime');
  });
});

describe('⑤ フリーワードの照合が `apps/web/lib/engineer-shares/**` に無い（1 箇所化。#22 と対）', () => {
  it('`contains` / `mode: \'insensitive\'` のプロパティ割り当てが 0 件', () => {
    const files = listSourceFiles(LIB_DIR);
    expect(files.length).toBeGreaterThan(0);
    const sites = files.flatMap((file) => freeWordPredicateSites(parse(file)).map((site) => `${path.basename(file)}:${site}`));
    expect(sites).toEqual([]);
  });

  it('対照: #22（`search-sql-single-path.test.ts`）の走査対象に `apps` が含まれている', () => {
    const source = readFileSync(SEARCH_SINGLE_PATH_TEST, 'utf8');
    expect(source).toMatch(/SCANNED_ROOTS\s*=\s*\[[^\]]*'apps'/);
    expect(source).toContain("'packages/db/src/search/'");
  });
});

describe('⑥ T-12-17 ③: 「次の 50 件」の文言と `PAGE_SIZE_DEFAULT` の対照（手で同期している 2 箇所）', () => {
  it('`PAGE_SIZE_DEFAULT` は 50 で、`engineerShares.loadMore` の文言がその数を含む', () => {
    expect(PAGE_SIZE_DEFAULT).toBe(50);
    expect(t('engineerShares.loadMore')).toBe(`次の ${PAGE_SIZE_DEFAULT} 件`);
  });
});
