// tests/static/admin-no-gate-retry.test.ts
// 🔴 `docs/05` §9.10 / [Issue #16](https://github.com/Festal-KM/SES-Platform/issues/16) / `CLAUDE.md` §10.5:
//    **失敗した `gate.run` の再実行の入口はテナント利用者の #39 だけ**であり、運営者は `A-005` 項目 12 で滞留を検知して
//    再依頼を促すだけである。**BullMQ の retry に相当する運営者操作を作らない。** T-11-05。
//
// なぜ静的テストか: 「作らない」は書かれていないことの検査であり、型でもユニットテストでも表に出ない。
// DB 権限（`app_platform*` に `proposals` / `review_gates` の書き込みが無いこと）は `tests/isolation/roles.test.ts` ② / ③ と
// `tests/isolation/admin-gate-stalls.test.ts` ⑧ が実証するが、それは「書こうとしたら失敗する」段である。ここでは
// **もう 1 段外側**、「書こうとするコード・積もうとするコードが管理平面に存在しない」ことを走査で固定する。
// **誰かが作った瞬間に落ちる。**
//
// 走査対象（管理平面の全層）: `apps/web/app/api/admin/**` / `apps/web/app/admin/**` /
// `packages/db/src/platform/**` / `packages/db/src/serializers/platform/**`（`admin-no-content-reach.test.ts` と同じ）。
//
// 検査:
//   ① 管理平面が `gate.run` のキューに到達しない —— `bullmq` / `ioredis` の直接 import が無く、`@ses/connectors` から
//      キュー・ワーカー・enqueuer の生成器と `gate.run` の識別子（`GATE_RUN_JOB` / `gateRunJobId` / `shouldRemoveGateRunJob`）を
//      import せず、`apps/web/lib/jobs/**` のうち `account-mail`（初期 `OWNER` 招待メール。API-A5）以外を import しない
//   ② BullMQ のジョブ操作（`retry` / `retryJobs` / `promote` / `moveTo*` / `obliterate` / `drain` / `clean`）と
//      ゲート専用ポートの操作（`removeFailedJob`）の呼び出しが無い。文字列 `'gate.run'` も現れない
//   ③ `proposals` / `review_gates` / `project_publish_requests` / `proposal_events` の Prisma デリゲートに対する書き込み
//      （`create*` / `update*` / `upsert` / `delete*`）と、生 SQL（`$executeRaw*` / `$queryRaw*`）・`$transaction` が無い
//   ④ `withPlatformWrite` のドメイン表（`PLATFORM_WRITE_DOMAIN_MODELS`。`packages/db/src/platform.ts`）にゲート・提案のモデルが
//      無く、`PLATFORM_ACTIONS` にゲート・再実行・ジョブ操作を名乗る action が無い（型で閉じている構造を走査で写す）
//   ⑤ 管理平面の URL に `gate` / `retry` / `rerun` / `jobs` / `queues` のセグメントが無く、
//      **書き込みメソッド（POST / PUT / PATCH / DELETE）を持つ管理平面 API は固定の一覧と一致する**
//      （認証 4 本 + テナント開設 + 初期 `OWNER` 招待。増やすのは `CLAUDE.md` §10.5 の列挙に対応する意識的な変更）
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

/** ① キュー基盤の SDK。`packages/connectors/src/bullmq.ts` だけが import してよい。 */
const FORBIDDEN_MODULES: ReadonlySet<string> = new Set(['bullmq', 'ioredis']);

/**
 * ① `@ses/connectors` の named import のうち、キューへ到達する（生成器 / ポート / enqueuer / ワーカー / スケジュール）か
 *    `gate.run` の `jobId` を組み立てられるもの。**読み取り専用の照会（`list…` / `read…`。T-11-04 が failed セットを読むために足す）は
 *    ここに当たらない** —— 当たるのは `Queue` / `Job` の操作に到達できる形だけである。
 */
const FORBIDDEN_CONNECTOR_IMPORT =
  /^createBullMq|^GATE_RUN_JOB$|^gateRunJobId$|^shouldRemoveGateRunJob$|GateRun(Job)?Queue|GateRunWorker|SendProposal(Job)?Queue|JobEnqueuer|^BullMqWorker$|^BullMqSchedule$|^BullMqConnection$/;

/** ① `apps/web/lib/jobs/**` のうち管理平面が import してよいモジュール（初期 `OWNER` 招待メールの `account.mail` だけ）。 */
const ALLOWED_JOB_MODULES: ReadonlySet<string> = new Set(['apps/web/lib/jobs/account-mail']);

/** ② BullMQ の `Job` / `Queue` のジョブ操作と、ゲート専用ポート（`GateRunJobQueue`）の操作。 */
const FORBIDDEN_CALL_METHODS: ReadonlySet<string> = new Set([
  'removeFailedJob',
  'retry',
  'retryJobs',
  'promote',
  'moveToFailed',
  'moveToCompleted',
  'moveToWait',
  'moveToDelayed',
  'obliterate',
  'drain',
  'clean',
]);

/** ② `gate.run`（キュー名 = `GATE_RUN_JOB`）を文字列で名指ししない。 */
const FORBIDDEN_STRING_LITERALS: ReadonlySet<string> = new Set(['gate.run']);

/** ③ ゲート・提案のモデル（Prisma デリゲート名）。書き込みメソッドの呼び出しを管理平面に置かない。 */
const GATE_MODELS: ReadonlySet<string> = new Set(['proposal', 'reviewGate', 'projectPublishRequest', 'proposalEvent']);

const WRITE_METHODS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** ③ 生 SQL・明示トランザクション。管理平面の DB 経路は `withPlatformRead` / `withPlatformWrite`（`packages/db/src/platform.ts`）だけ。 */
const FORBIDDEN_RAW_METHODS: ReadonlySet<string> = new Set([
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRaw',
  '$queryRawUnsafe',
  '$transaction',
]);

/** ⑤ 管理平面の URL に現れてはならないセグメント。 */
const FORBIDDEN_ADMIN_URL_SEGMENTS: readonly string[] = ['gate', 'gates', 'retry', 'rerun', 'job', 'jobs', 'queue', 'queues', 'bullmq'];

/**
 * ⑤ 🔴 書き込みメソッドを持つ管理平面 API の固定一覧（URL → メソッド）。
 *    認証（`F-055`）とテナント開設・初期 `OWNER` 招待（API-A4 / API-A5。`CLAUDE.md` §10.5 の「INSERT のみ」）だけである。
 *    ここに無い書き込み API を足すのは、`CLAUDE.md` §10.5 の列挙（契約・クォータ・機能フラグ・お知らせ・停止再開・代理閲覧）に
 *    対応する意識的な変更であり、この表を同時に更新する。**`gate` / `retry` に相当する行は将来も足さない。**
 */
const ALLOWED_MUTATING_ADMIN_ROUTES: ReadonlyMap<string, readonly string[]> = new Map([
  ['/api/admin/auth/signin', ['POST']],
  ['/api/admin/auth/signout', ['POST']],
  ['/api/admin/auth/2fa/setup', ['POST']],
  ['/api/admin/auth/2fa/verify', ['POST']],
  ['/api/admin/tenants', ['POST']],
  ['/api/admin/tenants/{}/owner-invitation', ['POST']],
]);

const MUTATING_HTTP_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

/** ① import。 */
function scanImports(file: string, source: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (FORBIDDEN_MODULES.has(specifier)) {
      violations.push({ file, line: lineOf(source, statement), detail: `${specifier} を管理平面から直接 import している` });
    }
    const clause = statement.importClause;
    if (specifier === '@ses/connectors' && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (FORBIDDEN_CONNECTOR_IMPORT.test(imported)) {
          violations.push({
            file,
            line: lineOf(source, element),
            detail: `@ses/connectors の ${imported} を管理平面から import している（キュー / gate.run への到達）`,
          });
        }
      }
    }
    if (specifier.startsWith('.')) {
      const resolved = toRepoRelative(path.resolve(path.dirname(path.join(repoRoot, file)), specifier)).replace(
        /\.(js|ts|tsx)$/,
        '',
      );
      if (resolved.startsWith('apps/web/lib/jobs/') && !ALLOWED_JOB_MODULES.has(resolved)) {
        violations.push({
          file,
          line: lineOf(source, statement),
          detail: `${resolved} を管理平面から import している（ジョブの enqueue 経路。許されるのは account-mail だけ）`,
        });
      }
    }
  }
  return violations;
}

/** ② ③ 呼び出しと文字列。 */
function scanCalls(file: string, source: ts.SourceFile): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      if (FORBIDDEN_CALL_METHODS.has(method)) {
        violations.push({ file, line: lineOf(source, node), detail: `.${method}() — ジョブの再実行・削除・操作に相当する呼び出し` });
      }
      if (FORBIDDEN_RAW_METHODS.has(method)) {
        violations.push({ file, line: lineOf(source, node), detail: `${method}() — 管理平面に生 SQL / 明示トランザクションを置かない` });
      }
      if (WRITE_METHODS.has(method) && ts.isPropertyAccessExpression(receiver) && GATE_MODELS.has(receiver.name.text)) {
        violations.push({
          file,
          line: lineOf(source, node),
          detail: `${receiver.name.text}.${method}() — ゲート・提案のモデルへの書き込み（運営者コンソールは read-only）`,
        });
      }
    }
    // 生 SQL はタグ付きテンプレート（`db.$executeRaw\`...\``）の形でも書ける。
    if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag)) {
      const method = node.tag.name.text;
      if (FORBIDDEN_RAW_METHODS.has(method)) {
        violations.push({ file, line: lineOf(source, node), detail: `${method}() — 管理平面に生 SQL / 明示トランザクションを置かない` });
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && FORBIDDEN_STRING_LITERALS.has(node.text)) {
      violations.push({ file, line: lineOf(source, node), detail: `文字列 '${node.text}' — キュー名を管理平面で名指ししている` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

const scannedFiles = SCAN_DIRS.flatMap((dir) => listSourceFiles(path.join(repoRoot, dir))).map((absolute) => ({
  file: toRepoRelative(absolute),
  source: parse(absolute),
}));

function format(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} — ${v.detail}`).join('\n');
}

describe('🔴 管理平面に gate.run の再実行に相当する操作が無い（docs/05 §9.10 / Issue #16 / CLAUDE.md §10.5）', () => {
  it('対照: 走査が空振りしていない', () => {
    expect(scannedFiles.length).toBeGreaterThanOrEqual(15);
    expect(scannedFiles.some((f) => f.file === 'packages/db/src/platform/queries/gate-stalls.ts')).toBe(true);
    expect(scannedFiles.some((f) => f.file === 'apps/web/app/api/admin/tenants/[id]/owner-invitation/route.ts')).toBe(true);
  });

  it('① bullmq / ioredis / @ses/connectors のキュー生成器 / lib/jobs（account-mail 以外）を import していない', () => {
    const violations = scannedFiles.flatMap((f) => scanImports(f.file, f.source));
    expect(violations, format(violations)).toEqual([]);
  });

  it('🔴 対照: ① の @ses/connectors の判定は「操作に到達できる形」だけを弾き、読み取り専用の照会は通す', () => {
    const scan = (code: string) =>
      scanImports('apps/web/app/api/admin/x/route.ts', ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)).map(
        (v) => v.detail,
      );
    for (const forbidden of [
      'createBullMqGateRunQueue',
      'createBullMqJobEnqueuer',
      'createBullMqGateRunWorker',
      'GATE_RUN_JOB',
      'gateRunJobId',
      'shouldRemoveGateRunJob',
      'GateRunJobQueue',
      'BullMqGateRunQueue',
      'BullMqConnection',
    ]) {
      expect(scan(`import { ${forbidden} } from '@ses/connectors';`), forbidden).toHaveLength(1);
    }
    // T-11-04 が足す予定の読み取り専用の照会（名前に `GateRun` を含んでも `Queue` / `Worker` / 生成器でなければ通る）。
    expect(scan(`import { listBullMqFailedGateRunJobs, type GateRunJob } from '@ses/connectors';`)).toEqual([]);
    expect(scan(`import { Queue } from 'bullmq';`)).toEqual(['bullmq を管理平面から直接 import している']);
  });

  it('対照: ① は account-mail の import を許している（初期 OWNER 招待は API-A5 の正規の経路）', () => {
    const route = scannedFiles.find((f) => f.file === 'apps/web/app/api/admin/tenants/[id]/owner-invitation/route.ts');
    expect(route?.source.getFullText()).toContain('lib/jobs/account-mail');
    expect(scanImports(route!.file, route!.source)).toEqual([]);
  });

  it('② ③ ジョブ操作・gate.run の名指し・ゲート/提案モデルへの書き込み・生 SQL が 1 つも無い', () => {
    const violations = scannedFiles.flatMap((f) => scanCalls(f.file, f.source));
    expect(violations, format(violations)).toEqual([]);
  });

  it('🔴 対照: ② ③ は書けば落ちる（走査が緩すぎないことの確認）', () => {
    const scan = (code: string) =>
      scanCalls('x.ts', ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)).map((v) => v.detail);
    expect(scan(`await job.retry();`)).toEqual(['.retry() — ジョブの再実行・削除・操作に相当する呼び出し']);
    expect(scan(`await queue.removeFailedJob(key);`)).toEqual(['.removeFailedJob() — ジョブの再実行・削除・操作に相当する呼び出し']);
    expect(scan(`const q = new Queue('gate.run');`)).toEqual(["文字列 'gate.run' — キュー名を管理平面で名指ししている"]);
    expect(scan(`await db.proposal.updateMany({ where: { id }, data: { state: 'DRAFT' } });`)).toEqual([
      'proposal.updateMany() — ゲート・提案のモデルへの書き込み（運営者コンソールは read-only）',
    ]);
    expect(scan(`await db.reviewGate.delete({ where: { id } });`)).toEqual([
      'reviewGate.delete() — ゲート・提案のモデルへの書き込み（運営者コンソールは read-only）',
    ]);
    expect(scan('await db.$executeRaw`UPDATE review_gates SET execution = $1`;')).toEqual([
      '$executeRaw() — 管理平面に生 SQL / 明示トランザクションを置かない',
    ]);
    // 読み取り（`findMany` / `count`）と、ゲート以外のモデルへの許された書き込み（開設）は捕まえない。
    expect(scan(`await db.reviewGate.findMany({ select: { id: true } }); await db.proposal.count();`)).toEqual([]);
    expect(scan(`await db.tenant.create({ data })`)).toEqual([]);
  });
});

/** ④ `packages/db/src/platform.ts` の `PLATFORM_WRITE_DOMAIN_MODELS` / `PLATFORM_ACTIONS` を走査する。 */
function readPlatformDeclarations(): { readonly writeModels: string[]; readonly actions: string[] } {
  const source = parse(path.join(repoRoot, 'packages', 'db', 'src', 'platform.ts'));
  const writeModels: string[] = [];
  const actions: string[] = [];
  const collectStrings = (node: ts.Node, into: string[]): void => {
    if (ts.isStringLiteral(node)) into.push(node.text);
    ts.forEachChild(node, (child) => collectStrings(child, into));
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      if (declaration.name.text === 'PLATFORM_WRITE_DOMAIN_MODELS') collectStrings(declaration.initializer, writeModels);
      if (declaration.name.text === 'PLATFORM_ACTIONS') collectStrings(declaration.initializer, actions);
    }
  }
  return { writeModels, actions };
}

describe('④ withPlatformWrite のドメインと action にゲート・提案・ジョブ操作が無い（packages/db/src/platform.ts）', () => {
  const declared = readPlatformDeclarations();

  it('対照: 宣言が読めている', () => {
    expect(declared.writeModels).toContain('tenant');
    expect(declared.actions).toContain('admin.monitoring.view');
  });

  it('🔴 PLATFORM_WRITE_DOMAIN_MODELS に proposal / reviewGate / projectPublishRequest / proposalEvent が無い', () => {
    expect(declared.writeModels.filter((model) => GATE_MODELS.has(model))).toEqual([]);
  });

  it('🔴 PLATFORM_ACTIONS に gate / retry / rerun / job / queue を名乗る action が無い', () => {
    expect(declared.actions.filter((action) => /gate|retry|rerun|job|queue/i.test(action))).toEqual([]);
  });
});

/** ⑤ `app/api/admin` 配下の Route Handler（URL → export されている HTTP メソッド）。 */
function collectRoutes(absolute: string, segments: readonly string[]): Array<{ url: string; methods: string[] }> {
  const entries = readdirSync(absolute, { withFileTypes: true });
  const routes: Array<{ url: string; methods: string[] }> = [];
  const routeFile = entries.find((entry) => entry.isFile() && /^route\.tsx?$/.test(entry.name));
  if (routeFile !== undefined) {
    const source = parse(path.join(absolute, routeFile.name));
    const methods: string[] = [];
    for (const statement of source.statements) {
      const exported = ts.canHaveModifiers(statement)
        ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        : false;
      if (!exported) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) methods.push(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) methods.push(declaration.name.text);
        }
      }
    }
    routes.push({ url: `/${['api', 'admin', ...segments].join('/')}`, methods: methods.filter((m) => /^[A-Z]+$/.test(m)) });
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const segment = entry.name.startsWith('(') ? [] : entry.name.startsWith('[') ? ['{}'] : [entry.name];
    routes.push(...collectRoutes(path.join(absolute, entry.name), [...segments, ...segment]));
  }
  return routes;
}

describe('⑤ 管理平面の URL とメソッド', () => {
  const routes = collectRoutes(path.join(repoRoot, 'apps', 'web', 'app', 'api', 'admin'), []);

  it('対照: 走査が空振りしていない（API-A5 の POST が読めている）', () => {
    const invitation = routes.find((route) => route.url === '/api/admin/tenants/{}/owner-invitation');
    expect(invitation?.methods).toContain('POST');
  });

  it.each(FORBIDDEN_ADMIN_URL_SEGMENTS)('🔴 セグメント %s を持つ管理平面 API が存在しない', (segment) => {
    expect(routes.filter((route) => route.url.split('/').includes(segment)).map((route) => route.url)).toEqual([]);
  });

  it('🔴 書き込みメソッドを持つ管理平面 API は固定の一覧と一致する（増やすのは意識的な変更）', () => {
    const actual = new Map(
      routes
        .map((route) => [route.url, route.methods.filter((m) => MUTATING_HTTP_METHODS.has(m)).sort()] as const)
        .filter(([, methods]) => methods.length > 0),
    );
    expect(Object.fromEntries(actual)).toEqual(
      Object.fromEntries([...ALLOWED_MUTATING_ADMIN_ROUTES].map(([url, methods]) => [url, [...methods].sort()])),
    );
  });
});
