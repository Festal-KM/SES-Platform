// tests/static/admin-tenants-read-only.test.ts
// `F-056 AC-3`（運営者はテナントの業務データを作成・更新・削除できない。`BR-37`）。T-03-09。
//
// 🔴 DB 権限（`app_platform` に業務テーブルの `INSERT`/`UPDATE`/`DELETE` が 1 つも無いこと）は
//    `tests/isolation/platform-tenants.test.ts` / `platform-plane.test.ts` が実証する。
//    ここでは**もう 1 段外側**、API-A2 / API-A3 の Route Handler 自体に書き込みハンドラが
//    存在しないことを固定する（`POST` / `PUT` / `PATCH` / `DELETE` を export しない）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const ROUTE_FILES = [
  'apps/web/app/api/admin/tenants/route.ts',
  'apps/web/app/api/admin/tenants/[id]/route.ts',
] as const;

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** ソースファイルのトップレベル export された関数・const の識別子一覧。 */
function exportedNames(absolutePath: string): string[] {
  const source = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  sourceFile.forEachChild((node) => {
    const hasExportModifier =
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExportModifier) return;
    if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
      }
    }
  });
  return names;
}

describe('A-002 / A-003 の Route Handler は GET のみを export する（F-056 AC-3 / BR-37）', () => {
  it.each(ROUTE_FILES)('%s に POST / PUT / PATCH / DELETE が無い', (relativePath) => {
    const names = exportedNames(path.join(repoRoot, relativePath));
    expect(names).toContain('GET'); // 対照: 走査自体が空振りしていない
    for (const method of MUTATING_METHODS) {
      expect(names, `${relativePath} が ${method} を export している`).not.toContain(method);
    }
  });
});
