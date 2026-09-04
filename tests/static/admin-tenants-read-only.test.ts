// tests/static/admin-tenants-read-only.test.ts
// `F-056 AC-3`（運営者はテナントの**業務データ**を作成・更新・削除できない。`BR-37`）。T-03-09。
// 🔴 T-03-10 で API-A4（テナントの開設）が `POST /api/admin/tenants` として加わったため、
//    「管理平面のルートに書き込みが 1 つも無い」ではなく「**書き込みが許された領域**
//    （`CLAUDE.md` §10.5 の 6 領域 + 開設）以外の書き込みが無い」を検査する形に改めた。
//
// 🔴 DB 権限（`app_platform` に業務テーブルの `INSERT`/`UPDATE`/`DELETE` が 1 つも無いこと、
//    `app_platform_write` の書込先が `tenants` / `invitations` / `tenant_sending_domains` /
//    `audit_logs` などに限られること）は `tests/isolation/roles.test.ts` /
//    `platform-tenants.test.ts` / `platform-provisioning.test.ts` が実証する。
//    ここでは**もう 1 段外側**、Route Handler が export する HTTP メソッドの形を固定する。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/**
 * 🔴 閲覧のみのルート（API-A2 / API-A3）。**`GET` 以外を 1 つも export しない。**
 */
const READ_ONLY_ROUTE_FILES = [
  'apps/web/app/api/admin/tenants/[id]/route.ts',
] as const;

/**
 * 🔴 書き込みを持つ管理平面のルートと、その根拠。
 *
 * **理由なしで足さない。** ここに 1 行足すことは「運営者がこの操作を行える」という判断であり、
 * `CLAUDE.md` §10.5（書き込みが許されるのは契約・クォータ・機能フラグ・お知らせ + 開設）の
 * 解釈を広げることに等しい。業務データ（エンジニア・案件・提案・チャット・契約）を
 * 対象にする行をここに書くことは**できない**（DB 権限が無いため実装しても動かない）。
 */
const WRITE_ROUTE_FILES: Readonly<Record<string, { readonly methods: readonly string[]; readonly reason: string }>> = {
  'apps/web/app/api/admin/tenants/route.ts': {
    methods: ['GET', 'POST'],
    reason:
      'API-A2（一覧の閲覧）と API-A4（テナントの開設。`F-001` / `A-014`）。開設は '
      + '`CLAUDE.md` §10.5 が Phase 0 の管理平面機能として置く「契約」への書き込みであり、'
      + '触れるのは `tenants` / `tenant_sending_domains` の INSERT だけである（docs/05 §5.2 / P-A-13）。',
  },
  'apps/web/app/api/admin/tenants/[id]/owner-invitation/route.ts': {
    methods: ['POST'],
    reason:
      'API-A5（初期 `OWNER` 招待）。`invitations` の INSERT のみで、RLS の WITH CHECK が '
      + '`role=OWNER` / 発行者 = 自分に固定する（docs/05 §5.2）。API-A4 と分離している（§10.7）。',
  },
};

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

/** HTTP メソッドとして export されているもの（`runtime` / `dynamic` 等の設定を除く）。 */
function exportedHttpMethods(absolutePath: string): string[] {
  const httpMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  return exportedNames(absolutePath)
    .filter((name) => httpMethods.has(name))
    .sort();
}

describe('A-003 の Route Handler は GET のみを export する（F-056 AC-3 / BR-37）', () => {
  it.each(READ_ONLY_ROUTE_FILES)('%s に POST / PUT / PATCH / DELETE が無い', (relativePath) => {
    const names = exportedNames(path.join(repoRoot, relativePath));
    expect(names).toContain('GET'); // 対照: 走査自体が空振りしていない
    for (const method of MUTATING_METHODS) {
      expect(names, `${relativePath} が ${method} を export している`).not.toContain(method);
    }
  });
});

describe('🔴 管理平面の書き込みルートは許可リストと一致する（CLAUDE.md §10.5 / docs/05 §5.2）', () => {
  it.each(Object.entries(WRITE_ROUTE_FILES))(
    '%s が export する HTTP メソッドが宣言どおりである',
    (relativePath, declaration) => {
      expect(exportedHttpMethods(path.join(repoRoot, relativePath))).toEqual(
        [...declaration.methods].sort(),
      );
    },
  );

  /**
   * 🔴 API-A4 / API-A5 は **`PLATFORM_OWNER` のみ**である（docs/05 §6.9 / `F-001` の `PP` = `−` /
   *    `BR-44`）。「ルート自体が 403」を成立させるのは `requirePlatformOwnerCtx`（403 に写像される
   *    `PlatformRoleNotAllowedError` を投げる唯一の入口）であり、`requirePlatformCtx`（閲覧用）
   *    では `PLATFORM_SUPPORT` が通ってしまう。**取り違えをここで固定する。**
   */
  it('🔴 書き込みルートは requirePlatformOwnerCtx を通る（requirePlatformCtx では足りない）', () => {
    for (const file of Object.keys(WRITE_ROUTE_FILES)) {
      const source = readFileSync(path.join(repoRoot, file), 'utf8');
      expect(source, `${file} が requirePlatformOwnerCtx を参照していない`).toContain(
        'requirePlatformOwnerCtx',
      );
    }
  });

  it('🔴 許可の根拠がすべて書かれている', () => {
    for (const [file, declaration] of Object.entries(WRITE_ROUTE_FILES)) {
      expect(declaration.reason.length, `${file} の許可理由が空です`).toBeGreaterThan(20);
    }
  });

  it('🔴 許可リストに無い管理平面のルートは状態を変えるメソッドを持たない（認証を除く）', () => {
    const adminApiDir = path.join(repoRoot, 'apps', 'web', 'app', 'api', 'admin');
    const routeFiles = listRouteFiles(adminApiDir).map((file) =>
      path.relative(repoRoot, file).split(path.sep).join('/'),
    );
    expect(routeFiles.length).toBeGreaterThan(0); // 対照

    for (const file of routeFiles) {
      if (file in WRITE_ROUTE_FILES) continue;
      // 🔴 認証（API-A1）は「運営者自身の資格情報」を扱う経路であり、テナントの
      //    契約・業務データへの書き込みではない（docs/05 §4.4.2 / §5.2 の別枠）。
      if (file.startsWith('apps/web/app/api/admin/auth/')) continue;
      const methods = exportedHttpMethods(path.join(repoRoot, file));
      for (const method of MUTATING_METHODS) {
        expect(methods, `${file} が許可リスト外で ${method} を export している`).not.toContain(
          method,
        );
      }
    }
  });
});

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return /^route\.(ts|tsx|mts|cts)$/.test(entry.name) ? [full] : [];
  });
}
