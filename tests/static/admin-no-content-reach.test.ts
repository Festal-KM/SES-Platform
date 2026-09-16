// tests/static/admin-no-content-reach.test.ts
// 🔴 `F-058 AC-2` / `BR-40` / `CLAUDE.md` §10.5: **管理平面に、`targetId` から本文・氏名・経歴を引く経路が無い**
//    ことを構造で固定する（T-11-03。`docs/05` §5.7 `A-006`「ID から本文を引く API を作らない」）。
//
// なぜ静的テストか: 「作らない」は書かれていないことの検査であり、型でもユニットテストでも表に出ない。
// DB 権限（`app_platform` に非開示列の GRANT が無いこと）は `tests/isolation/platform-plane.test.ts` ⑥ が
// 実証するが、それは「読もうとしたら失敗する」段である。ここでは**もう 1 段外側**、「読もうとするコードが
// 管理平面に存在しない」ことを走査で固定する。**誰かが作った瞬間に落ちる**。
//
// 走査対象（管理平面の全層）:
//   - `apps/web/app/api/admin/**`（Route Handler）/ `apps/web/app/admin/**`（画面）
//   - `packages/db/src/platform/**`（専用クエリ）/ `packages/db/src/serializers/platform/**`（シリアライザ）
//
// 検査:
//   ① 内容を持つモデル（`engineer` / `skillSheet` / `message` / `proposal` / `user` ほか）の Prisma デリゲートに対し、
//      **行を読む呼び出し**（`find*`）が無い。件数・集計（`count` / `groupBy` / `aggregate`）だけを許す
//      （`A-002` / `A-003` の件数列がこれに当たる）。`include:` は使わない（関連の全列を引く）。
//   ② 非開示列（`docs/05` §5.5 の表）を `select` するキーが無い（`displayName: true` / `body: true` ほか）。
//   ③ `apps/web/app/api/admin/**` に、内容エンティティの URL（`/api/admin/engineers` ほか）と
//      **監査ログの詳細エンドポイント**（`/api/admin/audit-logs/{}`）が存在しない。
//   ④ 管理平面のファイルが主平面の DB 経路（`withTenant` ほか）・主平面のサービス（`apps/web/lib/engineers` ほか）を
//      import しない。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_DIRS = [
  'apps/web/app/api/admin',
  'apps/web/app/admin',
  'packages/db/src/platform',
  'packages/db/src/serializers/platform',
] as const;

/**
 * 🔴 内容（氏名・本文・経歴・商流）を持つモデル。行を読む呼び出しを管理平面に置かない。
 *    `user` を含める: `users.display_name` / `email` は `app_platform` に GRANT されている（`A-002` の最終ログインの
 *    母集団のため）が、**利用者の氏名を解決して出す経路**を管理平面に作らない（`docs/sprints/SP-11` §4-3）。
 */
const CONTENT_MODELS: ReadonlySet<string> = new Set([
  'user',
  'engineer',
  'engineerSnapshot',
  'engineerCareer',
  'engineerSkill',
  'skillSheet',
  'skillSheetExtraction',
  'message',
  'chatThread',
  'proposal',
  'proposalEvent',
  'proposalRequest',
  'reviewGate',
  'matchCandidate',
  'extensionReview',
  'contract',
  'contractDocument',
  'contractTemplate',
  'order',
  'assignment',
  'notification',
  'project',
  'projectRequirement',
]);

/** 行を読む呼び出し（禁止）。`count` / `groupBy` / `aggregate` は件数・集計であり許す。 */
const ROW_READ_METHODS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
]);

/** 🔴 `docs/05` §5.5「`app_platform` に GRANT しない列」の Prisma フィールド名（`select` のキーとして現れてはならない）。 */
const FORBIDDEN_SELECT_KEYS: ReadonlySet<string> = new Set([
  'displayName',
  'birthDate',
  'contactEmail',
  'contactPhone',
  'affiliationLabel',
  'city',
  'preferenceNote',
  'skills',
  'careers',
  // engineer_careers.role（業務内容）は列名が招待・所属の `role`（列挙値）と同じため ① のモデル単位で塞ぐ。
  'description',
  'technologies',
  'objectKey',
  'note',
  'payload',
  'body',
  'attachmentKey',
  'subject',
  'draftBody',
  'recipientEmail',
  'findings',
  'aiWarnings',
  'message',
  'declineReason',
  'credentialEncrypted',
  'connectHmacKeysEncrypted',
  'webhookPathSecretEncrypted',
  'unitPrice',
  'unitPriceMin',
  'unitPriceMax',
  'internalUnitPrice',
  'offeredUnitPrice',
  'amount',
  'counterpartyName',
  'recipientCompanyName',
  'endClientName',
  'paymentTerms',
  'signers',
  'secretEncrypted',
  'recoveryCodeHashes',
  'passwordHash',
  'rationale',
  'facts',
  'summary', // extension_reviews.summary。audit_logs.summary は ① の対象外モデルで、シリアライザがマスクする
  'title',
  'bodyParams',
  'failureDetail',
  'mergeResult',
  'mapping',
]);

/**
 * 🔴 例外: `audit_logs.summary` は `A-006` の材料であり、`select: { summary: true }` を**監査ログのクエリ 1 本**に限って許す。
 *    値は必ず `toPlatformAuditLog` → `maskAuditSummary` を通る（`packages/db/src/serializers/platform/audit-logs.ts`）。
 */
const SELECT_KEY_EXCEPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['packages/db/src/platform/queries/audit-logs.ts', new Set(['summary'])],
]);

/** ③ 管理平面に存在してはならない URL のセグメント（内容エンティティ）。 */
const FORBIDDEN_ADMIN_URL_SEGMENTS: readonly string[] = [
  'engineers',
  'engineer',
  'skill-sheets',
  'skill-sheet',
  'skillsheets',
  'careers',
  'snapshots',
  'messages',
  'message',
  'chat',
  'threads',
  'proposals',
  'proposal',
  'contracts',
  'contract-documents',
  'projects',
  'users',
  'members',
];

/** ④ 主平面の DB 経路（`@ses/db` の named import として管理平面に現れてはならない）。 */
const FORBIDDEN_DB_IMPORTS: ReadonlySet<string> = new Set([
  'withTenant',
  'withSystemScope',
  'withSharedCandidateScope',
  'runInTenantTransaction',
  'recordAuditLog',
  'recordAuthAuditLog',
]);

/** ④ 主平面のサービス層（`apps/web/lib/<module>/**`）のうち、内容に到達するモジュール。 */
const FORBIDDEN_LIB_MODULES: readonly string[] = [
  'engineers',
  'skill-sheets',
  'proposals',
  'proposal-requests',
  'candidates',
  'projects',
  'chat',
  'messages',
  'contracts',
  'members',
  'audit-logs', // 主平面 `S-041` のサービス（`users.display_name` を解決する）。`A-006` は `admin-audit-logs` を使う
];

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo']);

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

type Violation = { readonly file: string; readonly line: number; readonly detail: string };

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
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

/** ① `X.<model>.<find*>(...)` と `include:`。 */
function scanDelegateReads(file: string, source: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      if (ROW_READ_METHODS.has(method) && ts.isPropertyAccessExpression(receiver)) {
        const model = receiver.name.text;
        if (CONTENT_MODELS.has(model)) {
          violations.push({
            file,
            line: lineOf(source, node),
            detail: `${model}.${method}() — 内容を持つモデルの行を管理平面で読んでいる（件数・集計のみ許される）`,
          });
        }
      }
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'include') {
      violations.push({ file, line: lineOf(source, node), detail: 'include: — 関連の全列を引く' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/** ② `select: { <forbidden>: true }`。`select` 直下だけでなく入れ子の select も見る。 */
function scanSelectKeys(file: string, source: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const exceptions = SELECT_KEY_EXCEPTIONS.get(file) ?? new Set<string>();
  const visitSelect = (literal: ts.ObjectLiteralExpression): void => {
    for (const property of literal.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
      if (name === null) continue;
      if (FORBIDDEN_SELECT_KEYS.has(name) && !exceptions.has(name)) {
        violations.push({
          file,
          line: lineOf(source, property),
          detail: `select に非開示列 ${name} がある（docs/05 §5.5）`,
        });
      }
      // 入れ子（`select: { tenant: { select: {...} } }`）。
      if (ts.isObjectLiteralExpression(property.initializer)) {
        for (const inner of property.initializer.properties) {
          if (
            ts.isPropertyAssignment(inner) &&
            ts.isIdentifier(inner.name) &&
            inner.name.text === 'select' &&
            ts.isObjectLiteralExpression(inner.initializer)
          ) {
            visitSelect(inner.initializer);
          }
        }
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'select' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      visitSelect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/** ④ import。 */
function scanImports(file: string, source: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (specifier === '@ses/db' && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (FORBIDDEN_DB_IMPORTS.has(imported)) {
          violations.push({
            file,
            line: lineOf(source, element),
            detail: `@ses/db の ${imported} を管理平面から import している（主平面の DB 経路）`,
          });
        }
      }
    }
    if (specifier.startsWith('.')) {
      const resolved = toRepoRelative(path.resolve(path.dirname(path.join(repoRoot, file)), specifier));
      for (const moduleName of FORBIDDEN_LIB_MODULES) {
        if (resolved === `apps/web/lib/${moduleName}` || resolved.startsWith(`apps/web/lib/${moduleName}/`)) {
          violations.push({
            file,
            line: lineOf(source, statement),
            detail: `apps/web/lib/${moduleName} を管理平面から import している（主平面のサービス）`,
          });
        }
      }
      if (resolved.startsWith('apps/web/app/(main)/')) {
        violations.push({
          file,
          line: lineOf(source, statement),
          detail: `主平面の画面（apps/web/app/(main)/**）を管理平面から import している`,
        });
      }
    }
  }
  return violations;
}

const scannedFiles = SCAN_DIRS.flatMap((dir) => listSourceFiles(path.join(repoRoot, dir))).map((absolute) => ({
  file: toRepoRelative(absolute),
  source: parse(absolute),
}));

function format(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} — ${v.detail}`).join('\n');
}

describe('🔴 管理平面に内容へ到達する経路が無い（F-058 AC-2 / BR-40 / CLAUDE.md §10.5）', () => {
  it('対照: 走査が空振りしていない', () => {
    expect(scannedFiles.length).toBeGreaterThanOrEqual(15);
    expect(scannedFiles.some((f) => f.file === 'packages/db/src/platform/queries/audit-logs.ts')).toBe(true);
    expect(scannedFiles.some((f) => f.file === 'apps/web/app/api/admin/audit-logs/route.ts')).toBe(true);
  });

  it('① 内容を持つモデルの行を読む呼び出し（find*）と include: が 1 つも無い', () => {
    const violations = scannedFiles.flatMap((f) => scanDelegateReads(f.file, f.source));
    expect(violations, format(violations)).toEqual([]);
  });

  it('対照: 件数・集計（groupBy / count）は使われている（① が緩すぎないことの確認）', () => {
    const tenants = scannedFiles.find((f) => f.file === 'packages/db/src/platform/queries/tenants.ts');
    expect(tenants).toBeDefined();
    const text = tenants?.source.getFullText() ?? '';
    expect(text).toContain('db.engineer.groupBy');
    expect(text).toContain('db.proposal.count');
  });

  it('② 非開示列を select するキーが 1 つも無い（audit_logs.summary は監査ログのクエリ 1 本だけの例外）', () => {
    const violations = scannedFiles.flatMap((f) => scanSelectKeys(f.file, f.source));
    expect(violations, format(violations)).toEqual([]);
  });

  it('対照: 例外の 1 本では summary を select している（例外が空振りしていない）', () => {
    const query = scannedFiles.find((f) => f.file === 'packages/db/src/platform/queries/audit-logs.ts');
    expect(query?.source.getFullText()).toContain('summary: true');
    // 🔴 その値は必ずシリアライザ（マスク）を通る。
    expect(query?.source.getFullText()).toContain('toPlatformAuditLog(');
  });

  it('④ 主平面の DB 経路・サービス・画面を管理平面から import していない', () => {
    const violations = scannedFiles.flatMap((f) => scanImports(f.file, f.source));
    expect(violations, format(violations)).toEqual([]);
  });
});

/** `app/api/admin` 配下で `route.ts(x)` を持つディレクトリの URL（`forbidden-api-routes.test.ts` と同じ正規化）。 */
function collectRouteUrls(absolute: string, segments: readonly string[]): string[] {
  const entries = readdirSync(absolute, { withFileTypes: true });
  const urls: string[] = [];
  if (entries.some((entry) => entry.isFile() && /^route\.tsx?$/.test(entry.name))) {
    urls.push(`/${['api', 'admin', ...segments].join('/')}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const segment = entry.name.startsWith('(') ? [] : entry.name.startsWith('[') ? ['{}'] : [entry.name];
    urls.push(...collectRouteUrls(path.join(absolute, entry.name), [...segments, ...segment]));
  }
  return urls;
}

describe('③ 管理平面の URL に内容エンティティと監査ログの詳細エンドポイントが無い', () => {
  const urls = collectRouteUrls(path.join(repoRoot, 'apps', 'web', 'app', 'api', 'admin'), []);

  it('対照: API-A7 が存在し、走査が空振りしていない', () => {
    expect(urls).toContain('/api/admin/audit-logs');
    expect(urls).toContain('/api/admin/tenants/{}');
  });

  it('🔴 `/api/admin/audit-logs/{}`（targetId / 行 ID から 1 件を引く詳細）が存在しない', () => {
    expect(urls.filter((url) => url.startsWith('/api/admin/audit-logs/'))).toEqual([]);
  });

  it.each(FORBIDDEN_ADMIN_URL_SEGMENTS)('🔴 セグメント %s を持つ管理平面 API が存在しない', (segment) => {
    const offenders = urls.filter((url) => url.split('/').includes(segment));
    expect(offenders).toEqual([]);
  });
});
