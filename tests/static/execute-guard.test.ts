// tests/static/execute-guard.test.ts
// docs/05 §17.2 #7:「🔴 実行系ルート一覧の全ファイルが `requireExecutable` を呼ぶ（AST 走査）」。
// T-03-04（docs/sprints/SP-03-auth-audit-admin0.md）。
//
// 🔴 なぜこのテストが要るか（docs/05 §6.2 / `docs/03` 申し送り 11-①）:
//    `requireExecutable` は `F-004` と同じ経路に置かなければならない。ロールごとの分岐に散らすと
//    `SUSPENDED` / `CLOSING` の抜け穴になる。「レビューで気をつける」では、ルートが増えるたびに
//    抜ける。**実行系ルートが増えるたびに、このテストが自動で対象に加える**構造にする。
//
// 🔴 対象は列挙ではなく**全部から引く**（docs/05 §17.2 #20 ③と同じ向き）:
//    `apps/web/app/**/route.ts` を走査し、**状態を変える HTTP メソッド（POST / PUT / PATCH /
//    DELETE）を export しているルートすべて**に `requireExecutable` を要求する。
//    例外は `EXEMPT_ROUTES` に**理由つきで**書く。新しいルートは既定で検査対象に入る。
//
// 🔴 「閲覧・エクスポートに `requireExecutable` を掛けろ」ではない。`CLOSING` では
//    「閲覧と返却（エクスポート）のみ実行できる」（`F-004 AC-8` / `F-064 AC-5`）ため、
//    GET だけのルートは対象外である。ダウンロード / エクスポートに要るのは `requireNotViewer`。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webAppDir = path.join(repoRoot, 'apps', 'web', 'app');
const fixturesDir = path.join(here, '__fixtures__', 'execute-guard');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo']);

/** 🔴 状態を変える HTTP メソッド。これを export するルートは実行系とみなす。 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** ガードの出所。ここから import された識別子だけを「ガードを通した」根拠にする。 */
const GUARDS_MODULE_SUFFIX = '/api/guards';

const EXECUTE_GUARD = 'requireExecutable';

/**
 * 🔴 `requireExecutable` を要求しないルートと、その理由。
 *
 * **理由なしで足さない。** ここに 1 行足すことは「テナントが停止中 / 解約手続き中でも
 * この操作は通す」という判断であり、`F-004 AC-7` / `AC-8` の例外を作ることに等しい。
 *
 * 🔴 いずれも「認証コンテキスト（`AuthenticatedTenantCtx`）が存在しない経路」である。
 *    `requireExecutable` は ctx のライフサイクル状態を見るガードなので、ctx を作れない
 *    経路には**掛けようがない**（掛けたいなら ctx を作れるようにする必要がある）。
 *    ⚠️ 将来ここに「ctx はあるが実行させたい」ルート（`POST /api/data-exports` など。
 *    `F-064 AC-5`「返却は `CLOSING` でも実行できる」）を足すときは、その旨を書く。
 */
const EXEMPT_ROUTES: Readonly<Record<string, string>> = {
  'apps/web/app/api/(main)/auth/signin/route.ts':
    '未認証経路（docs/05 §6.3 #1）。ctx を作る前の資格情報照合であり、テナントが確定していない。',
  'apps/web/app/api/(main)/auth/signout/route.ts':
    'セッション破棄（#4）。未認証でも 204 を返す（セッションの有無を漏らさない）。' +
    '解約手続き中でもサインアウトはできなければならない。',
  'apps/web/app/api/(main)/auth/password-reset/route.ts':
    '未認証経路（#5）。行由来コンテキスト（docs/05 §4.4.2）のみを使う。',
  'apps/web/app/api/(main)/auth/password-reset/confirm/route.ts':
    '未認証経路（#5b）。トークン照合で得た行が分離キーの出所。',
  'apps/web/app/api/(main)/auth/2fa/setup/route.ts':
    '2FA 未設定の OWNER / ADMIN が使う操作（#3）。定義上 ctx を作れない（docs/05 §6.2）。',
  'apps/web/app/api/(main)/auth/2fa/verify/route.ts':
    '第 2 要素の提示（#2）。同上、ctx が生成される前の経路である。',
  'apps/web/app/api/(main)/invitations/[token]/accept/route.ts':
    '未認証経路（#7）。所属は招待行から決まり、受諾時点では ctx が無い。',
  'apps/web/app/api/(main)/data-exports/route.ts':
    '🔴 返却データの生成（docs/05 §6.7 #77 / `F-064 AC-5`。T-10-09）。返却は `CLOSING`（実行系が止まる状態）でこそ ' +
    '実行できなければならない（`F-004 AC-8`「実行できるのは閲覧と返却（エクスポート）のみ」）。`requireExecutable` を掛けると ' +
    '解約手続き中のテナントがデータを取り戻せないまま `PURGED` に至る。逆向きの判定（`CLOSING` 以外は 422）は ' +
    '`packages/db` の `createDataExportRequest` が DB の行で行う。運営者は主平面のセッションを持たないので到達できない。',
  'apps/web/app/api/webhooks/guardduty/route.ts':
    '🔴 Webhook 受信（docs/05 §6.10 / §8.5。T-05-05）。送信元は GuardDuty の結果を運ぶ ' +
    'EventBridge 経路であり、テナント利用者の操作ではない（Cookie もセッションも無く ctx を ' +
    '作れない）。認可は HMAC 署名の検証が担う。受信は「検証 → WebhookDelivery に INSERT → ' +
    '200 → enqueue」だけを行い、テナントの業務データを 1 件も変更しない。' +
    '🔴 加えて、ウイルススキャンの結果はテナントの契約状態に依存して良いものではない —— ' +
    'SUSPENDED / CLOSING のテナントでも、感染したファイルは INFECTED として隔離されなければ ' +
    'ならない（requireExecutable を掛けると、停止中のテナントのファイルが SCANNING のまま ' +
    '残り、BR-26 の判定が永久に確定しない）。',
  'apps/web/app/api/webhooks/ses/route.ts':
    '🔴 Webhook 受信（docs/05 §6.10 / §8.5。T-04-03）。送信元は Amazon SNS であり ' +
    'テナント利用者の操作ではない（Cookie もセッションも無く ctx を作れない）。認可は SNS の ' +
    '署名検証とトピック照合が担う。加えて、受信は「検証 → WebhookDelivery に INSERT → 200 → ' +
    'enqueue」だけを行い、テナントの業務データを 1 件も変更しない（バウンス・苦情の記録は ' +
    'C0 SYSTEM_ONLY の email_events であり、テナントのライフサイクル状態に依存しない）。',
};

/**
 * 🔴 管理平面（`apps/web/app/api/admin/**`）は `requireExecutable` の対象ではない。
 *
 * `requireExecutable` は `AuthenticatedTenantCtx.lifecycleState`（= 特定テナントの
 * ライフサイクル）を見るガードである。管理平面の操作は**どのテナントの利用者の操作でもなく**、
 * `PlatformUser` として行われる（`BR-36` の別テーブル・別認証）ため、テナントの ctx が
 * 存在せず掛けようがない。**免除ではなく、別のガードの対象である**（T-03-10 で構造化した）:
 *
 *   - 認証（API-A1。`apps/web/app/api/admin/auth/**`）… ctx が生成される前の経路。
 *   - それ以外の管理平面の実行系（API-A4 / A5 …）… 🔴 **`@ses/db/platform` の
 *     `withPlatformWrite`（監査先行 + 専用 DB ロール + ドメイン照合）を通る関数**を呼ぶこと。
 *     下の describe がそれを走査する。
 */
const ADMIN_PLANE_PREFIX = 'apps/web/app/api/admin/';
const ADMIN_AUTH_PREFIX = 'apps/web/app/api/admin/auth/';

/** 管理平面の書き込み経路の出所（ここから import した識別子だけを根拠にする）。 */
const PLATFORM_MODULE = '@ses/db/platform';

/**
 * 🔴 `withPlatformWrite` を**経由する**専用クエリ関数（docs/05 §5.2「汎用エスケープハッチを
 *    作らない担保」）。`apps/**` は `withPlatformWrite` を直接呼ばない
 *    （`tests/static/auth-db-callers.test.ts` が期待値 `[]` で固定している）ため、
 *    ルートが呼ぶのは必ずこの層の関数である。
 *    その関数が本当に `withPlatformWrite` を通ることは
 *    `tests/static/platform-plane-boundary.test.ts` ④ が検査する。
 */
// ✅ T-11-02: `setTenantQuotaOverride`（API-A6。`withPlatformWrite(domain='QUOTA')` で `tenant_quota_overrides` に INSERT だけ）。
const PLATFORM_WRITE_FUNCTIONS = ['provisionTenant', 'issueTenantOwnerInvitation', 'setTenantQuotaOverride'];

/**
 * 🔴 T-10-06: **`withPlatformWrite` の 7 ドメインの外に書く唯一の管理平面ルート群**（API-A16。`F-053` / docs/05 §13.6）。
 *    書き込み先は `demo` プリセットの**合成データ**であり（テナントの契約・業務データのどちらでもない）、実体は `@ses/db/seed` の
 *    `runSeed`（投入）/ `runSeedReset`（✅ T-10-07。リセット）（特権接続）である。監査の先行は `readDemoSeedStatus(action=…)`
 *    （`withPlatformRead` = 監査の先行）を**実行の前**（`REQUESTED`）と**後**（`COMPLETED` + 帰結）に通すことで成立させる。
 *    環境ガードは `assertDemoSeedAvailable`（`packages/config` の `isSeedableAppEnv`）と `runSeed` / `runSeedReset` の先頭の 2 枚
 *    （`F-053 AC-6`）。`reset` は加えて確認入力の環境名（400）を 3 枚目に持つ。
 *    🔴 ここに `demo/**` 以外の行を足すことは「運営者が合成データ以外を特権接続で書く」ことと同義であり、`CLAUDE.md` §10.5 の解釈を変える。
 *    🔴 サービスは 1 ファイル（`_lib/service.ts`）に固定する —— `runSeed` / `runSeedReset` の呼び出し元は
 *    `tests/static/auth-db-callers.test.ts` がこの 1 ファイルで固定しており、ここでも同じ 1 ファイルを指す。
 */
const ADMIN_SEED_ROUTES: Readonly<
  Record<
    string,
    {
      readonly service: string;
      /** ルートが呼ぶサービス関数（呼び出し式）。 */
      readonly serviceCall: string;
      /** サービスが `readDemoSeedStatus` に渡す action（監査の先行の根拠）。 */
      readonly auditAction: string;
      /** サービスが `@ses/db/seed` から呼ぶ実体。 */
      readonly seedFunction: 'runSeed' | 'runSeedReset';
      readonly reason: string;
    }
  >
> = {
  'apps/web/app/api/admin/demo/seed/route.ts': {
    service: 'apps/web/app/api/admin/demo/_lib/service.ts',
    serviceCall: 'runDemoSeedForAdmin(',
    auditAction: "action: 'admin.demo.seed'",
    seedFunction: 'runSeed',
    reason:
      'API-A16（seed:demo の投入）。書き込み先は demo プリセットの合成データだけで、runSeed（@ses/db/seed。特権接続）が実体。'
      + ' 監査の先行は readDemoSeedStatus(action=admin.demo.seed) を投入の前後に通して成立させる（docs/05 §13.6「T-10-06 の実装の決着」）。',
  },
  'apps/web/app/api/admin/demo/reset/route.ts': {
    service: 'apps/web/app/api/admin/demo/_lib/service.ts',
    serviceCall: 'runDemoResetForAdmin(',
    auditAction: "action: 'admin.demo.reset'",
    seedFunction: 'runSeedReset',
    reason:
      'API-A16 reset（seed:demo のリセット = demo プリセットの 2 テナントの全業務データ削除。F-053 AC-2 / AC-6。T-10-07）。消す先は'
      + ' demo プリセットの合成データだけで（deleteTenantData(preset.tenantIds)。body に tenantId は無い）、runSeedReset（@ses/db/seed。特権接続）が実体。'
      + ' 監査の先行は readDemoSeedStatus(action=admin.demo.reset) を削除の前（REQUESTED）と後（COMPLETED）に通して成立させ、'
      + ' 確認入力（環境名 + テナント名）の照合を何も消す前に行う（docs/05 §13.6「T-10-07 の実装の決着」）。',
  },
};

/** `ADMIN_SEED_ROUTES` の全ルートが共有する 1 本のサービス。`@ses/db/seed` からの import はこの行の形に固定する。 */
const ADMIN_SEED_SERVICE_IMPORT = "import { DEMO_SEED_IDS, runSeed, runSeedReset, SeedIncompleteError } from '@ses/db/seed';";

type RouteAnalysis = {
  /** export されている HTTP メソッド名。 */
  readonly exportedMethods: ReadonlySet<string>;
  /**
   * 🔴 `lib/api/guards` の **`requireExecutable` 本体**に束縛されたローカル名。
   *
   * 判定は import の**元名**（`propertyName`）で行い、記録するのは**ローカル名**である。
   *   - `import { requireRole as requireExecutable }` … 元名が違うので**記録されない**
   *     （名前だけ `requireExecutable` に見せかけた偽装が素通りしない）
   *   - `import { requireExecutable as guard }` … 元名が一致するので `guard` を記録する
   *     （正当な alias を誤検知しない）
   */
  readonly executeGuardBindings: ReadonlySet<string>;
  /** ファイル中でコードとして参照されている識別子（コメントは含まない）。 */
  readonly referencedIdentifiers: ReadonlySet<string>;
  /**
   * 🔴 `@ses/db/platform` から import された**元名**の集合（T-03-10）。
   *    管理平面の実行系ルートが「監査先行の書き込み経路」を通っているかの根拠にする。
   */
  readonly platformImportedNames: ReadonlySet<string>;
};

function analyzeRoute(sourceText: string, fileName: string): RouteAnalysis {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const exportedMethods = new Set<string>();
  const executeGuardBindings = new Set<string>();
  const referencedIdentifiers = new Set<string>();
  const platformImportedNames = new Set<string>();

  function hasExportModifier(node: ts.Node): boolean {
    return (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
  }

  function visit(node: ts.Node): void {
    // export async function POST(…) {}
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      exportedMethods.add(node.name.text);
    }
    // export const POST = withApiRoute(…)
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exportedMethods.add(declaration.name.text);
      }
    }
    // import { requireExecutable } from '../../lib/api/guards'
    // import { requireExecutable as guard } from '../../lib/api/guards'
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith(GUARDS_MODULE_SUFFIX)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          // 🔴 元名（alias が無ければローカル名と同じ）で判定し、ローカル名を記録する。
          const importedName = (element.propertyName ?? element.name).text;
          if (importedName === EXECUTE_GUARD) executeGuardBindings.add(element.name.text);
        }
      }
    }
    // import { provisionTenant } from '@ses/db/platform'
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === PLATFORM_MODULE
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          platformImportedNames.add((element.propertyName ?? element.name).text);
        }
      }
    }

    if (ts.isIdentifier(node)) referencedIdentifiers.add(node.text);

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { exportedMethods, executeGuardBindings, referencedIdentifiers, platformImportedNames };
}

/** 実行系（状態を変えるメソッドを export している）か。 */
function isMutatingRoute(analysis: RouteAnalysis): boolean {
  return [...analysis.exportedMethods].some((method) => MUTATING_METHODS.has(method));
}

/**
 * 🔴 `lib/api/guards` の `requireExecutable` **本体**に束縛された名前を、
 *    コード上で参照しているか。
 *
 *    根拠にしないもの:
 *      - コメントでの言及（AST の識別子ではない）
 *      - 同名のローカル関数（guards モジュールからの束縛が無い）
 *      - `import { requireRole as requireExecutable }`（元名が違う＝別のガード）
 */
function callsExecuteGuard(analysis: RouteAnalysis): boolean {
  return [...analysis.executeGuardBindings].some((localName) =>
    analysis.referencedIdentifiers.has(localName),
  );
}

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listRouteFiles(full);
    }
    return /^route\.(ts|tsx|mts|cts)$/.test(entry.name) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function readFixture(name: string): RouteAnalysis {
  return analyzeRoute(readFileSync(path.join(fixturesDir, name), 'utf8'), name);
}

const routeFiles = listRouteFiles(webAppDir).map((file) => ({
  file: toRepoRelative(file),
  analysis: analyzeRoute(readFileSync(file, 'utf8'), file),
}));

const mutatingRoutes = routeFiles.filter((route) => isMutatingRoute(route.analysis));
// 🔴 管理平面は別のガード体系（下の describe）。主平面だけを `requireExecutable` の対象にする。
const mainPlaneMutatingRoutes = mutatingRoutes.filter(
  (route) => !route.file.startsWith(ADMIN_PLANE_PREFIX),
);
const adminPlaneMutatingRoutes = mutatingRoutes.filter((route) =>
  route.file.startsWith(ADMIN_PLANE_PREFIX),
);
const requiredRoutes = mainPlaneMutatingRoutes.filter((route) => !(route.file in EXEMPT_ROUTES));

describe('🔴 実行系ルートは例外なく requireExecutable を通る（docs/05 §17.2 #7 / §6.2）', () => {
  it('対照: apps/web/app 配下に Route Handler が存在する（テストが空振りしていない）', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it('対照: 状態を変えるメソッドを export しているルートが存在する', () => {
    expect(mutatingRoutes.length).toBeGreaterThan(0);
  });

  it('🔴 対照: 免除されていない実行系ルートが 1 本以上ある（規則が空振りしていない）', () => {
    expect(requiredRoutes.map((route) => route.file)).not.toEqual([]);
  });

  it('免除されていない実行系ルートのすべてが requireExecutable を通している', () => {
    const missing = requiredRoutes
      .filter((route) => !callsExecuteGuard(route.analysis))
      .map((route) => route.file);
    expect(missing).toEqual([]);
  });

  it('🔴 免除リストに死んだ項目が無い（ファイルが実在し、かつ実行系である）', () => {
    const routesByFile = new Map(routeFiles.map((route) => [route.file, route]));
    for (const file of Object.keys(EXEMPT_ROUTES)) {
      const route = routesByFile.get(file);
      expect(route, `免除リストの ${file} が存在しません（リネーム / 削除の取り残し）`).toBeDefined();
      if (route) expect(isMutatingRoute(route.analysis)).toBe(true);
    }
  });

  it('🔴 免除にはすべて理由が書かれている', () => {
    for (const [file, reason] of Object.entries(EXEMPT_ROUTES)) {
      expect(reason.length, `${file} の免除理由が空です`).toBeGreaterThan(20);
    }
  });

  it('🔴 免除リストに管理平面のルートが紛れていない（別のガード体系で検査する）', () => {
    for (const file of Object.keys(EXEMPT_ROUTES)) {
      expect(file.startsWith(ADMIN_PLANE_PREFIX)).toBe(false);
    }
  });
});

/**
 * 🔴 T-03-10: 管理平面の実行系ルート（API-A4 / A5 …）が「記録されない書き込み」にならないことを、
 *    ルートの形として固定する（`BR-41` / docs/05 §5.3）。
 *
 * 認証（API-A1）以外の**状態を変える管理平面ルートは、`@ses/db/platform` の専用クエリ関数を
 * 通らなければならない**。その関数は `withPlatformWrite`（監査を `fn` の前に同一トランザクションで
 * 書く）を経由することが `tests/static/platform-plane-boundary.test.ts` ④ で保証されている。
 * ルートが `@prisma/client` や `@ses/db` の別経路で書く実装を混ぜたら、ここで落ちる。
 */
describe('🔴 管理平面の実行系ルートは監査先行の書き込み経路を通る（CLAUDE.md §10.5 / BR-41）', () => {
  const targets = adminPlaneMutatingRoutes.filter(
    (route) => !route.file.startsWith(ADMIN_AUTH_PREFIX),
  );

  it('対照: 認証以外の管理平面の実行系ルートが 1 本以上ある（規則が空振りしていない）', () => {
    expect(targets.map((route) => route.file)).not.toEqual([]);
  });

  it('すべてが `@ses/db/platform` の書き込み関数を import して呼んでいる（合成データの投入ルートだけは ADMIN_SEED_ROUTES の規律で見る）', () => {
    const missing = targets
      .filter((route) => !(route.file in ADMIN_SEED_ROUTES))
      .filter((route) => {
        const imported = [...route.analysis.platformImportedNames];
        return !imported.some(
          (name) =>
            PLATFORM_WRITE_FUNCTIONS.includes(name) &&
            route.analysis.referencedIdentifiers.has(name),
        );
      })
      .map((route) => route.file);
    expect(missing).toEqual([]);
  });

  it('🔴 T-10-06 / T-10-07: 合成データの投入・リセットのルートは環境ガード + 監査の先行（readDemoSeedStatus）+ runSeed / runSeedReset の 3 点を持ち、withPlatformWrite の外で他の表に触れない', () => {
    // 🔴 対照: seed と reset の 2 本が両方登録されている（片方だけ消えた状態を通さない）。
    expect(Object.keys(ADMIN_SEED_ROUTES).sort()).toEqual([
      'apps/web/app/api/admin/demo/reset/route.ts',
      'apps/web/app/api/admin/demo/seed/route.ts',
    ]);
    for (const [file, declaration] of Object.entries(ADMIN_SEED_ROUTES)) {
      expect(declaration.reason.length).toBeGreaterThan(20);
      // 🔴 `demo/**` の外にこの規律で書き込むルートを置けない。
      expect(file.startsWith('apps/web/app/api/admin/demo/')).toBe(true);
      const route = readFileSync(path.join(repoRoot, file), 'utf8');
      const service = readFileSync(path.join(repoRoot, declaration.service), 'utf8');
      // 設計意図のコメントに関数名が出るため、判定は **import 文**（コードとして持ち込んだもの）だけで行う。
      const serviceImports = service.split('\n').filter((line) => /^import\b/.test(line.trim()));
      // ルート: 認証済み運営者 → 環境ガード → サービス。
      expect(route).toContain('requirePlatformCtx');
      expect(route).toContain('assertDemoSeedAvailable(');
      expect(route).toContain(declaration.serviceCall);
      // サービス: 監査の先行（withPlatformRead 経由の専用クエリ）と、実体は @ses/db/seed の runSeed / runSeedReset だけ。
      expect(serviceImports).toContain("import { readDemoSeedStatus } from '@ses/db/platform';");
      expect(serviceImports).toContain(ADMIN_SEED_SERVICE_IMPORT);
      expect(ADMIN_SEED_SERVICE_IMPORT).toContain(declaration.seedFunction);
      expect(service).toContain(declaration.auditAction);
      // 🔴 生 Prisma / 主平面の DB 経路を import しない。
      for (const line of serviceImports) {
        expect(line).not.toContain('@prisma/client');
        expect(line).not.toContain('withTenant');
      }
    }
    // ✅ T-10-07: reset のサービスは、確認入力の照合（環境名 + テナント名）を削除の前に持ち、body に tenantId を受けない。
    const service = readFileSync(path.join(repoRoot, 'apps/web/app/api/admin/demo/_lib/service.ts'), 'utf8');
    expect(service).toContain('matchesDemoResetConfirmation(');
    expect(service).toContain('DemoResetConfirmationMismatchError');
    expect(service).toContain("preset: 'demo'");
    // `reset` の body スキーマは 2 キー + strict。`tenantId` を受ける行が無い。
    expect(service).toMatch(/confirmEnv: z\.string\(\)/);
    expect(service).toMatch(/confirmTenantName: z\.string\(\)/);
    expect(service).toContain('.strict()');
    expect(service).not.toMatch(/tenantId:\s*z\./);
    // 🔴 順序: 照合（400）→ 監査の先行（REQUESTED）→ runSeedReset → 監査（COMPLETED）。ソース上の出現順で固定する。
    const resetBody = service.slice(service.indexOf('export async function runDemoResetForAdmin('));
    const positions = [
      resetBody.indexOf('matchesDemoResetConfirmation('),
      resetBody.indexOf("phase: 'REQUESTED'"),
      resetBody.indexOf('runSeedReset('),
      resetBody.indexOf("phase: 'COMPLETED'"),
    ];
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('🔴 管理平面の認証ルートは対象外である（ctx が生成される前の経路）', () => {
    const authRoutes = adminPlaneMutatingRoutes.filter((route) =>
      route.file.startsWith(ADMIN_AUTH_PREFIX),
    );
    expect(authRoutes.length).toBeGreaterThan(0); // 対照: 認証ルートは実在する
    for (const route of authRoutes) {
      expect(route.analysis.platformImportedNames.size).toBe(0);
    }
  });
});

describe('検出ロジックの対照（fixture）', () => {
  it('違反: POST があるのに requireExecutable が無い', () => {
    const analysis = readFixture('missing-guard.violation.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('🔴 違反: コメントで言及しているだけでは通らない', () => {
    const analysis = readFixture('comment-only.violation.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('🔴 違反: 同名のローカル関数を自前で定義した偽装は通らない', () => {
    const analysis = readFixture('decoy-identifier.violation.ts');
    expect(analysis.referencedIdentifiers.has(EXECUTE_GUARD)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('🔴 違反: 別のガードを requireExecutable という名前で import した偽装は通らない', () => {
    const analysis = readFixture('alias-spoof.violation.ts');
    // ファイル中に識別子としては現れる（名前だけの一致では判定できない）。
    expect(analysis.referencedIdentifiers.has(EXECUTE_GUARD)).toBe(true);
    // 🔴 元名が `requireRole` なので、requireExecutable への束縛は 1 つも無い。
    expect([...analysis.executeGuardBindings]).toEqual([]);
    expect(callsExecuteGuard(analysis)).toBe(false);
  });

  it('適合: 本体を alias して使う正当な形（requireExecutable as executableGuard）', () => {
    const analysis = readFixture('alias-legit.ok.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect([...analysis.executeGuardBindings]).toEqual(['executableGuard']);
    expect(callsExecuteGuard(analysis)).toBe(true);
  });

  it('適合: guards から import して宣言している', () => {
    const analysis = readFixture('with-guard.ok.ts');
    expect(isMutatingRoute(analysis)).toBe(true);
    expect(callsExecuteGuard(analysis)).toBe(true);
  });

  it('適合: GET だけのルートは対象外（CLOSING でも閲覧はできる。F-004 AC-8）', () => {
    const analysis = readFixture('read-only.ok.ts');
    expect(analysis.exportedMethods.has('GET')).toBe(true);
    expect(isMutatingRoute(analysis)).toBe(false);
  });
});
