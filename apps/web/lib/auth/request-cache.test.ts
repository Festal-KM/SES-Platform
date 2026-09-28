// apps/web/lib/auth/request-cache.test.ts
// 🔴 **認証コンテキストの畳み込みが「リクエスト内」に閉じていること**を固定する
//    （T-12-20 の code-reviewer 指摘 #5）。
//
// ============================================================================
// 何が起きたら事故なのか
// ============================================================================
// 共通外枠（`app/(main)/layout.tsx` / `app/admin/**` の `AdminConsoleFrame`）とページは
// 同じリクエストで `resolveTenantCtxOutcome` / `resolvePlatformCtxOutcome` を**2 回**呼ぶ。
// そこで React の `cache()` で 1 回に畳んだ。
//
// 🔴 **もしこれをモジュールスコープの変数（`let cached` / `new Map()`）で実装すると、
//    畳み込みはリクエストを越えて効く。** その瞬間、次のリクエストの利用者に**前のリクエストの
//    ctx**（= 別テナント・別ロールの分離キー）が渡る。`CLAUDE.md` §7 の「テナント越境の
//    情報漏洩 0 件」を、キャッシュという最も気づきにくい形で破る。
//
// ============================================================================
// どう固定するか（2 段）
// ============================================================================
// ① **実行時**: 呼び出しごとにセッションと DB から作り直されること。
//    セッションの主張を入れ替えて 2 回呼ぶと、2 回目は**新しい主張の ctx** が返り、
//    `buildTenantCtx` / `buildPlatformCtxResolution` が 2 回走る。
//    🔴 ここ（Vitest）には React のリクエストスコープが存在せず、`react` のクライアント版
//    `cache()` は**素通し**である。したがってこのテストが観測するのは
//    「**グローバルな畳み込みが 1 つも無い**」ことそのものであり、モジュールスコープの
//    キャッシュを足した瞬間に落ちる。
// ② **構造**: 畳み込みが `react` の `cache()` だけであること（= 有効範囲がリクエストである
//    ことが仕組みで保証される）。加えて両モジュールが**モジュールスコープの可変束縛と
//    Map/WeakMap を 1 つも持たない**こと。①は「今は無い」を、②は「作れない形になっている」を見る。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformCtx, AuthenticatedTenantCtx } from '@ses/db';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- 主平面のモック ---------------------------------------------------------
const auth = vi.fn<() => Promise<unknown>>();
const buildTenantCtx = vi.fn<(...args: unknown[]) => Promise<AuthenticatedTenantCtx | null>>();
// --- 管理平面のモック -------------------------------------------------------
const platformAuth = vi.fn<() => Promise<unknown>>();
const buildPlatformCtxResolution = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest' }),
}));

// 🔴 `next-auth` は Vitest の解決条件では読み込めない（`next/server` の拡張子なし import）。
//    本テストは `signIn` 系を通らないので、型として要る 2 つのエラークラスだけを差し替える。
vi.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {},
  CredentialsSignin: class CredentialsSignin extends Error {},
}));

vi.mock('../db/bootstrap', () => ({ ensureDbConfigured: () => {} }));

vi.mock('./main', () => ({
  auth: () => auth(),
  signIn: async () => '',
  signOut: async () => {},
  unstable_update: async () => {},
}));

vi.mock('./platform', () => ({
  platformAuth: () => platformAuth(),
  platformSignIn: async () => '',
  platformSignOut: async () => {},
  platformUpdate: async () => {},
}));

vi.mock('./tenant-context', () => ({
  buildTenantCtx: (...args: unknown[]) => buildTenantCtx(...args),
}));

vi.mock('./platform-context', () => ({
  buildPlatformCtx: async () => null,
  buildPlatformCtxResolution: (...args: unknown[]) => buildPlatformCtxResolution(...args),
}));

const { resolveTenantCtxOutcome } = await import('./session');
const { resolvePlatformCtxOutcome } = await import('./platform-session');

const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';

/** ctx はブランド型で自前に作れないため、検証に使う分離キーだけを持つ値を通す。 */
function tenantCtxLike(tenantId: string): AuthenticatedTenantCtx {
  return { tenantId, partnerCompanyId: null } as unknown as AuthenticatedTenantCtx;
}

function platformCtxLike(platformUserId: string): AuthenticatedPlatformCtx {
  return { platformUserId, platformRole: 'PLATFORM_OWNER' } as unknown as AuthenticatedPlatformCtx;
}

beforeEach(() => {
  auth.mockReset();
  buildTenantCtx.mockReset();
  platformAuth.mockReset();
  buildPlatformCtxResolution.mockReset();
});

describe('🔴 ① resolveTenantCtxOutcome の畳み込みはリクエストを越えない', () => {
  it('セッションの主張が入れ替わると、2 回目は新しいテナントの ctx を返す（前の ctx が残らない）', async () => {
    auth.mockResolvedValueOnce({ claims: { tenantId: TENANT_A, partnerCompanyId: null, userId: 'u1' } });
    buildTenantCtx.mockResolvedValueOnce(tenantCtxLike(TENANT_A));
    const first = await resolveTenantCtxOutcome();

    auth.mockResolvedValueOnce({ claims: { tenantId: TENANT_B, partnerCompanyId: null, userId: 'u2' } });
    buildTenantCtx.mockResolvedValueOnce(tenantCtxLike(TENANT_B));
    const second = await resolveTenantCtxOutcome();

    expect(first.status).toBe('AUTHENTICATED');
    expect(second.status).toBe('AUTHENTICATED');
    expect(first.status === 'AUTHENTICATED' ? first.ctx.tenantId : null).toBe(TENANT_A);
    // 🔴 ここが `TENANT_A` になったら、テナント越境そのものである。
    expect(second.status === 'AUTHENTICATED' ? second.ctx.tenantId : null).toBe(TENANT_B);
    expect(buildTenantCtx).toHaveBeenCalledTimes(2);
  });

  it('🔴 認証済み → 未認証に変わったら 2 回目は未認証を返す（サインアウト後に前の ctx が生き残らない）', async () => {
    auth.mockResolvedValueOnce({ claims: { tenantId: TENANT_A, partnerCompanyId: null, userId: 'u1' } });
    buildTenantCtx.mockResolvedValueOnce(tenantCtxLike(TENANT_A));
    expect((await resolveTenantCtxOutcome()).status).toBe('AUTHENTICATED');

    auth.mockResolvedValueOnce(null);
    expect((await resolveTenantCtxOutcome()).status).toBe('UNAUTHENTICATED');
  });

  it('🔴 同じ主張で 2 回呼んでも DB からの確定が 2 回走る（畳み込みがグローバルでない証拠）', async () => {
    const claims = { claims: { tenantId: TENANT_A, partnerCompanyId: null, userId: 'u1' } };
    auth.mockResolvedValue(claims);
    buildTenantCtx.mockResolvedValue(tenantCtxLike(TENANT_A));

    await resolveTenantCtxOutcome();
    await resolveTenantCtxOutcome();

    // React のリクエストスコープが無い環境（= 「別のリクエスト」に相当）では畳まれない。
    expect(buildTenantCtx).toHaveBeenCalledTimes(2);
  });
});

describe('🔴 ① resolvePlatformCtxOutcome の畳み込みはリクエストを越えない', () => {
  it('主体が入れ替わると、2 回目は新しい運営者の ctx と表示名を返す', async () => {
    platformAuth.mockResolvedValueOnce({ platformClaims: { platformUserId: 'p1' } });
    buildPlatformCtxResolution.mockResolvedValueOnce({
      ctx: platformCtxLike('p1'),
      displayName: '運営者 1（合成）',
    });
    const first = await resolvePlatformCtxOutcome();

    platformAuth.mockResolvedValueOnce({ platformClaims: { platformUserId: 'p2' } });
    buildPlatformCtxResolution.mockResolvedValueOnce({
      ctx: platformCtxLike('p2'),
      displayName: '運営者 2（合成）',
    });
    const second = await resolvePlatformCtxOutcome();

    expect(first.status === 'AUTHENTICATED' ? first.displayName : null).toBe('運営者 1（合成）');
    expect(second.status === 'AUTHENTICATED' ? second.displayName : null).toBe('運営者 2（合成）');
    expect(second.status === 'AUTHENTICATED' ? second.ctx.platformUserId : null).toBe('p2');
    expect(buildPlatformCtxResolution).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// ② 構造
// ---------------------------------------------------------------------------

const CACHED_MODULES: readonly { readonly file: string; readonly exportName: string }[] = [
  { file: 'session.ts', exportName: 'resolveTenantCtxOutcome' },
  { file: 'platform-session.ts', exportName: 'resolvePlatformCtxOutcome' },
];

function parse(file: string): ts.SourceFile {
  const absolute = path.join(here, file);
  return ts.createSourceFile(
    absolute,
    readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** `import { cache } from 'react'` が在るか。 */
function importsReactCache(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'react' &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === 'cache'),
  );
}

/** `export const <name> = cache(...)` の形か。 */
function isWrappedInCache(source: ts.SourceFile, exportName: string): boolean {
  return source.statements.some((statement) => {
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === exportName &&
        declaration.initializer !== undefined &&
        ts.isCallExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === 'cache',
    );
  });
}

/** モジュールスコープの可変束縛（`let` / `var`）。 */
function moduleScopeMutableBindings(source: ts.SourceFile): string[] {
  return source.statements
    .filter(ts.isVariableStatement)
    .filter((statement) => (statement.declarationList.flags & ts.NodeFlags.Const) === 0)
    .flatMap((statement) =>
      statement.declarationList.declarations.map((declaration) => declaration.name.getText(source)),
    );
}

/** `new Map()` / `new WeakMap()` の出現（自前キャッシュの器）。 */
function mapConstructions(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /^(Weak)?Map$/.test(node.expression.text)) {
      found.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('🔴 ② 畳み込みは react の cache() だけ（有効範囲がリクエストであることを仕組みで保証する）', () => {
  it.each(CACHED_MODULES)('$file の $exportName は cache() で包まれている', ({ file, exportName }) => {
    const source = parse(file);
    expect(importsReactCache(source), `${file} が react の cache を import していない`).toBe(true);
    expect(isWrappedInCache(source, exportName), `${exportName} が cache() で包まれていない`).toBe(true);
  });

  it.each(CACHED_MODULES)('🔴 $file はモジュールスコープの可変束縛を持たない（自前キャッシュを置けない）', ({ file }) => {
    expect(moduleScopeMutableBindings(parse(file))).toEqual([]);
  });

  it.each(CACHED_MODULES)('🔴 $file は Map / WeakMap を作らない（リクエストを越える器を持たない）', ({ file }) => {
    expect(mapConstructions(parse(file))).toEqual([]);
  });
});
