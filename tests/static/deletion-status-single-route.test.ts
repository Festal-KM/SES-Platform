// tests/static/deletion-status-single-route.test.ts
// 🔴 docs/05 §17.2 #15（T-10-10）: **削除完了の確認を返すルートが `api/admin/tenants/[id]/deletion-status` の 1 本だけ**
//    （`F-062 AC-7`「これが運営者にとっての唯一の経路」/ docs/05 §6.9「API-A12 以外に削除完了の確認を返す API を作らない」/
//    docs/04 program-design 申し送り 15）。
//
// なぜ静的テストか: 「作らない」は書かれていないことの検査であり、型でもユニットテストでも表に出ない。ここでは
// 「読もうとするコードが存在しない」ことを AST 走査で固定する。**誰かが作った瞬間に落ちる。**
//
// 検査:
//   ① `DeletionStatusView` / `readDeletionStatus`（API-A12 の DTO と読み取り関数）を参照する Route Handler
//      （`apps/web/app/api/**/route.ts`）が **API-A12 の 1 本だけ**。`readDeletionStatus` の呼び出し元は `apps/web` 全体で
//      **API-A12 のルート + `A-010` の画面（`app/admin/tenants/[id]/contract/page.tsx`）の 2 本だけ**。
//   ② `TenantPurgeRun` の**行を読む**呼び出し（`tenantPurgeRun.find*`）が管理平面（`packages/db/src/platform/**` /
//      `apps/web/app/api/admin/**` / `apps/web/app/admin/**`）で `queries/deletion-status.ts` の 1 本だけ。他のファイル
//      （`A-005` 項目 7 の `monitoring.ts`）は `groupBy` / `count` / `aggregate`（件数）しか使えない。
//   ③ 🔴 その 1 本の `select` に `failureReason` が無い（`app_platform` に GRANT が無い列。docs/05 §5.5）。`select` を省いた
//      呼び出し（全列 = `failure_reason` を含む）も違反。
//   ④ 🔴 **他の応答型に削除完了の確認が紛れていない**: 管理平面の DTO 区画（`packages/db/src/platform/queries/*.ts` /
//      `packages/db/src/serializers/platform/*.ts` / `apps/web/lib/admin-*/view.ts`）と `S-042` のビュー（`apps/web/lib/retention/view.ts`。
//      `GET /api/retention` は未実装のため画面の読み取りモデルを見る）の **export された型のプロパティ名**に
//      `purgeRuns` / `deletionCounts` / `purgeCounts` / `counts` が無い（`deletion-status.ts` を除く）。
//      `A-005`（API-A8）の `PURGE_JOB_FAILED` の DTO（`PurgeJobFailure*` / `PurgeJobFailedPayload`）に完了の事実
//      （`completed*` / `counts`）が無い（`F-059 AC-2`「失敗と完了を混ぜない」）。
//   ⑤ 管理平面の URL に `deletion-status` を含むものが API-A12 の 1 本だけ（`sandbox-tenants/**` = `A-013` 等に生えていない）。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 🔴 唯一のルート（API-A12）と、同じ読み取り関数を使う唯一の画面（`A-010`）。 */
const DELETION_STATUS_ROUTE = 'apps/web/app/api/admin/tenants/[id]/deletion-status/route.ts';
const DELETION_STATUS_PAGE = 'apps/web/app/admin/tenants/[id]/contract/page.tsx';
const DELETION_STATUS_QUERY = 'packages/db/src/platform/queries/deletion-status.ts';

/** API-A12 の識別子（DTO 型・読み取り関数）。 */
const DELETION_STATUS_IDENTIFIERS: ReadonlySet<string> = new Set(['DeletionStatusView', 'readDeletionStatus']);

/** `tenant_purge_runs` の行を読む呼び出し（① と同じ集合。件数・集計は許す）。 */
const ROW_READ_METHODS: ReadonlySet<string> = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
]);

/** 🔴 `app_platform` が読める `tenant_purge_runs` の列（Prisma のフィールド名）。`failureReason` は無い。 */
const PURGE_RUN_SELECTABLE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'tenantId',
  'cause',
  'status',
  'startedAt',
  'completedAt',
  'counts',
]);

/** ④ 他の応答型に現れてはならないプロパティ名。 */
const DELETION_CONFIRMATION_KEYS: ReadonlySet<string> = new Set(['purgeRuns', 'deletionCounts', 'purgeCounts', 'counts']);

const ADMIN_PLANE_DIRS = ['packages/db/src/platform', 'apps/web/app/api/admin', 'apps/web/app/admin'] as const;
const ADMIN_DTO_DIRS = ['packages/db/src/platform/queries', 'packages/db/src/serializers/platform'] as const;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo']);

function listSourceFiles(dir: string, recursive = true): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive && !SKIPPED_DIRS.has(entry.name) ? listSourceFiles(full) : [];
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function parse(absolute: string, text = readFileSync(absolute, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(
    absolute,
    text,
    ts.ScriptTarget.Latest,
    true,
    absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** ファイル中の識別子の出現（import 指定子・型参照・呼び出し。コメントは AST に無いので対象外）。 */
function identifiersOf(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

type Violation = { readonly file: string; readonly line: number; readonly detail: string };

/** ② ③ `X.tenantPurgeRun.<method>(...)`。 */
function scanPurgeRunReads(file: string, source: ts.SourceFile): {
  readonly rowReads: Violation[];
  readonly selectViolations: Violation[];
  readonly aggregateCalls: number;
} {
  const rowReads: Violation[] = [];
  const selectViolations: Violation[] = [];
  let aggregateCalls = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'tenantPurgeRun'
    ) {
      const method = node.expression.name.text;
      if (ROW_READ_METHODS.has(method)) {
        rowReads.push({ file, line: lineOf(source, node), detail: `tenantPurgeRun.${method}()` });
        const argument = node.arguments[0];
        const select =
          argument !== undefined && ts.isObjectLiteralExpression(argument)
            ? argument.properties.find(
                (property): property is ts.PropertyAssignment =>
                  ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'select',
              )
            : undefined;
        if (select === undefined || !ts.isObjectLiteralExpression(select.initializer)) {
          selectViolations.push({ file, line: lineOf(source, node), detail: `tenantPurgeRun.${method}() — select の無い呼び出し（failure_reason を含む全列を読む）` });
        } else {
          for (const property of select.initializer.properties) {
            const name = ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) ? property.name.text : null;
            if (name === null || !PURGE_RUN_SELECTABLE_KEYS.has(name)) {
              selectViolations.push({ file, line: lineOf(source, property), detail: `select に読めない列 ${name ?? '(非識別子)'} がある` });
            }
          }
        }
      } else {
        aggregateCalls += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { rowReads, selectViolations, aggregateCalls };
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

type Property = { readonly type: string; readonly key: string; readonly line: number };

/** ④ export された type / interface の全プロパティ名（同一ファイル内で参照する非 export 型を含む）。 */
function collectExportedTypeProperties(source: ts.SourceFile): Property[] {
  const declarations = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
    }
  }
  const properties: Property[] = [];
  for (const statement of source.statements) {
    if (!(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) || !hasExportModifier(statement)) continue;
    const typeName = statement.name.text;
    const visited = new Set<string>([typeName]);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertySignature(node)) {
        const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
        if (name !== null) properties.push({ type: typeName, key: name, line: lineOf(source, node) });
      }
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !visited.has(node.typeName.text)) {
        const referenced = declarations.get(node.typeName.text);
        if (referenced !== undefined) {
          visited.add(node.typeName.text);
          visit(referenced);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
  return properties;
}

/** `app/api` 配下で `route.ts(x)` を持つディレクトリの URL（`admin-no-content-reach.test.ts` と同じ正規化）。 */
function collectRouteUrls(absolute: string, segments: readonly string[]): string[] {
  if (!existsSync(absolute)) return [];
  const entries = readdirSync(absolute, { withFileTypes: true });
  const urls: string[] = [];
  if (entries.some((entry) => entry.isFile() && /^route\.tsx?$/.test(entry.name))) {
    urls.push(`/${['api', ...segments].join('/')}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const segment = entry.name.startsWith('(') ? [] : entry.name.startsWith('[') ? ['{}'] : [entry.name];
    urls.push(...collectRouteUrls(path.join(absolute, entry.name), [...segments, ...segment]));
  }
  return urls;
}

const routeFiles = listSourceFiles(path.join(repoRoot, 'apps', 'web', 'app', 'api')).filter((file) => /[\\/]route\.tsx?$/.test(file));
const webFiles = listSourceFiles(path.join(repoRoot, 'apps', 'web'));
const adminPlaneFiles = ADMIN_PLANE_DIRS.flatMap((dir) => listSourceFiles(path.join(repoRoot, dir)));
const adminDtoFiles = [
  ...ADMIN_DTO_DIRS.flatMap((dir) => listSourceFiles(path.join(repoRoot, dir), false)),
  ...readdirSync(path.join(repoRoot, 'apps', 'web', 'lib'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('admin-'))
    .map((entry) => path.join(repoRoot, 'apps', 'web', 'lib', entry.name, 'view.ts'))
    .filter((file) => existsSync(file)),
  ...[path.join(repoRoot, 'apps', 'web', 'lib', 'retention', 'view.ts')].filter((file) => existsSync(file)),
];

function format(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} — ${v.detail}`).join('\n');
}

describe('🔴 削除完了の確認を返すルートは API-A12 の 1 本だけ（docs/05 §17.2 #15 / F-062 AC-7）', () => {
  it('対照: API-A12 のルート・A-010 の画面・専用クエリが実在し、走査が空振りしていない', () => {
    for (const file of [DELETION_STATUS_ROUTE, DELETION_STATUS_PAGE, DELETION_STATUS_QUERY]) {
      expect(existsSync(path.join(repoRoot, file)), `${file} が無い`).toBe(true);
    }
    expect(routeFiles.length).toBeGreaterThan(20);
    expect(adminPlaneFiles.length).toBeGreaterThan(15);
    expect(adminDtoFiles.map(toRepoRelative)).toContain('packages/db/src/platform/queries/monitoring.ts');
    expect(adminDtoFiles.map(toRepoRelative)).toContain('packages/db/src/serializers/platform/tenants.ts');
    expect(adminDtoFiles.map(toRepoRelative)).toContain('apps/web/lib/admin-monitoring/view.ts');
  });

  it('① DeletionStatusView / readDeletionStatus を参照する Route Handler は API-A12 の 1 本だけ', () => {
    const referencing = routeFiles
      .filter((file) => {
        const names = identifiersOf(parse(file));
        return [...DELETION_STATUS_IDENTIFIERS].some((name) => names.has(name));
      })
      .map(toRepoRelative);
    expect(referencing).toEqual([DELETION_STATUS_ROUTE]);
  });

  it('① readDeletionStatus の呼び出し元は apps/web 全体で API-A12 のルートと A-010 の画面の 2 本だけ', () => {
    const callers = webFiles
      .filter((file) => identifiersOf(parse(file)).has('readDeletionStatus'))
      .map(toRepoRelative)
      .sort();
    expect(callers).toEqual([DELETION_STATUS_PAGE, DELETION_STATUS_ROUTE].sort());
  });

  it('② TenantPurgeRun の行を読む呼び出し（tenantPurgeRun.find*）は管理平面で deletion-status.ts の 1 本だけ。他は件数・集計のみ', () => {
    const rowReadFiles = new Set<string>();
    let aggregateElsewhere = 0;
    for (const absolute of adminPlaneFiles) {
      const file = toRepoRelative(absolute);
      const scan = scanPurgeRunReads(file, parse(absolute));
      if (scan.rowReads.length > 0) rowReadFiles.add(file);
      if (file !== DELETION_STATUS_QUERY) aggregateElsewhere += scan.aggregateCalls;
    }
    expect([...rowReadFiles]).toEqual([DELETION_STATUS_QUERY]);
    // 対照: A-005 項目 7（monitoring.ts）は groupBy で失敗の件数だけを数えている（走査が tenantPurgeRun を見ている証拠）。
    expect(aggregateElsewhere).toBeGreaterThanOrEqual(1);
  });

  it('🔴 ③ deletion-status.ts の select に failureReason が無く、読める列（id / tenantId / cause / status / startedAt / completedAt / counts）に閉じている', () => {
    const scan = scanPurgeRunReads(DELETION_STATUS_QUERY, parse(path.join(repoRoot, DELETION_STATUS_QUERY)));
    expect(scan.rowReads.length).toBeGreaterThanOrEqual(1);
    expect(scan.selectViolations, format(scan.selectViolations)).toEqual([]);
    const text = readFileSync(path.join(repoRoot, DELETION_STATUS_QUERY), 'utf8');
    expect(text).toContain('counts: true');
    expect(text).not.toMatch(/failureReason\s*:\s*true/);
  });

  it('🔴 対照（合成ソース）: select 無し / failureReason を含む select は違反として検出される', () => {
    const at = DELETION_STATUS_QUERY;
    const run = (code: string) => scanPurgeRunReads(at, parse(at, code)).selectViolations.map((v) => v.detail);
    expect(run(`await db.tenantPurgeRun.findMany({ where: { tenantId } });`)).toEqual([
      'tenantPurgeRun.findMany() — select の無い呼び出し（failure_reason を含む全列を読む）',
    ]);
    expect(run(`await db.tenantPurgeRun.findMany({ select: { status: true, failureReason: true } });`)).toEqual([
      'select に読めない列 failureReason がある',
    ]);
    expect(run(`await db.tenantPurgeRun.findMany({ select: { status: true, counts: true } });`)).toEqual([]);
    // 件数・集計は行の読み取りではない。
    expect(scanPurgeRunReads(at, parse(at, `await db.tenantPurgeRun.groupBy({ by: ['tenantId'] });`)).rowReads).toEqual([]);
  });

  it('🔴 ④ 他の管理平面 DTO と S-042 のビューの export 型に purgeRuns / deletionCounts / purgeCounts / counts が無い（deletion-status.ts を除く）', () => {
    const violations: Violation[] = [];
    for (const absolute of adminDtoFiles) {
      const file = toRepoRelative(absolute);
      if (file === DELETION_STATUS_QUERY) continue;
      for (const property of collectExportedTypeProperties(parse(absolute))) {
        if (DELETION_CONFIRMATION_KEYS.has(property.key)) {
          violations.push({ file, line: property.line, detail: `${property.type}.${property.key}（削除完了の確認を API-A12 以外に写している）` });
        }
      }
    }
    expect(violations, format(violations)).toEqual([]);
  });

  it('🔴 ④ A-005（API-A8）の PURGE_JOB_FAILED の DTO に完了の事実（completed* / counts）が無い（F-059 AC-2）', () => {
    const files = adminDtoFiles.filter((absolute) =>
      ['packages/db/src/platform/queries/monitoring.ts', 'apps/web/lib/admin-monitoring/view.ts'].includes(toRepoRelative(absolute)),
    );
    expect(files).toHaveLength(2);
    const purgeTypes = files.flatMap((absolute) =>
      collectExportedTypeProperties(parse(absolute)).filter((property) => /^PurgeJobFail/.test(property.type)),
    );
    // 対照: 走査が空振りしていない（failedCount を持つ行の型がある）。
    expect(purgeTypes.some((property) => property.key === 'failedCount')).toBe(true);
    const leaking = purgeTypes.filter((property) => /^completed/i.test(property.key) || DELETION_CONFIRMATION_KEYS.has(property.key));
    expect(leaking.map((property) => `${property.type}.${property.key}`)).toEqual([]);
  });

  it('⑤ `deletion-status` を含む API の URL は /api/admin/tenants/{}/deletion-status の 1 本だけ（A-013 / S-042 側に生えていない）', () => {
    const urls = collectRouteUrls(path.join(repoRoot, 'apps', 'web', 'app', 'api'), []);
    expect(urls.filter((url) => url.includes('deletion-status'))).toEqual(['/api/admin/tenants/{}/deletion-status']);
    expect(urls.filter((url) => url.includes('deletion') || url.includes('purge'))).toEqual(['/api/admin/tenants/{}/deletion-status']);
  });
});
