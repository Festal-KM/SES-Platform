// eslint.config.mjs — 依存方向のハードルールを強制する唯一の場所（CLAUDE.md §2.1 / §3.2 / docs/05 §2.2）。
//
// 🔴 禁止リストは必ず PACKAGE_ZONES / CATCH_ALL_ZONE のデータに追記すること。
//    同じファイル集合に対して 'no-restricted-imports' / 'no-restricted-syntax' の
//    設定ブロックを新たに作らない。flat config はルール単位で「後勝ち・丸ごと置換」
//    であり、後から追加したブロックが既存の禁止を静かに消し去る
//    （例: apps/** に生 PrismaClient 禁止を足す場合（T-01-06）は、専用の
//    'no-restricted-imports' ブロックを新設せず、CATCH_ALL_ZONE の禁止リストを拡張する）。
//
// 🔴 静的 import の禁止は no-restricted-imports の patterns（group）で行い、
//    実際に import 可能かどうかの解決（resolver）には依存しない文字列照合にする。
//    resolver 依存の import/no-restricted-paths は使わない
//    （@ses/* はビルド前は解決に失敗し無視 = "常に no-op" になる罠があるため）。
//
// 🔴 動的 import（`import('@ses/db')` 等）・無置換のテンプレートリテラル動的 import
//    （`` import(`@ses/db`) ``）・require()（`require('@ses/db')`）はコアの
//    no-restricted-imports が検出しないため、同じ禁止リスト（buildRestrictedNames）
//    から no-restricted-syntax のセレクタも生成し、ImportExpression と
//    CallExpression[callee.name='require'] を個別に塞ぐ（buildDynamicImportSelectors()）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const BACKSLASH = String.fromCharCode(92);

const NODE_IO_MODULE_NAMES = [
  'fs',
  'net',
  'http',
  'https',
  'http2',
  'child_process',
  'dgram',
  'dns',
  'tls',
  'cluster',
  'worker_threads',
  'crypto',
  'timers',
  'stream',
];

const ANTHROPIC_SDK = '@anthropic-ai/sdk';
const ANTHROPIC_SDK_MESSAGE =
  '@anthropic-ai/sdk の import は packages/ai/src/client.ts のみ許可されます（CLAUDE.md §3.2）。';

// T-01-06（CLAUDE.md §3.1 / docs/05 §1.4 / §4.3）: withTenant / withHostTenant を経ない
// DB アクセス経路を lint で塞ぐ。3 本の禁止:
//   ①生 @prisma/client の import（packages/db 内部のみ許可）
//   ②@ses/db から PrismaClient を named import すること（@ses/db は現状これを export しないが、
//     将来のエクスポート追加による迂回を防ぐ防御的ルール。常時適用）
//   ③@ses/db/testing サブパスの import（tests/isolation/** のみ許可。分離機構そのものを
//     検証する専用の入口であり、汎用のエスケープハッチにしないため）
const PRISMA_CLIENT_MODULE = '@prisma/client';
const PRISMA_CLIENT_MESSAGE =
  '@prisma/client の直接 import は packages/db 内部でのみ許可されます（生 PrismaClient の迂回経路。' +
  'CLAUDE.md §3.1 / docs/05 §4.3）。@ses/db の withTenant / withHostTenant を使ってください。';
const SES_DB_MODULE = '@ses/db';
const SES_DB_PRISMA_CLIENT_MESSAGE =
  '@ses/db から PrismaClient を import することはできません（CLAUDE.md §3.1 / docs/05 §4.3）。' +
  'withTenant / withHostTenant 経由でアクセスしてください。';
const SES_DB_TESTING_SUBPATH = '@ses/db/testing';
const SES_DB_TESTING_MESSAGE =
  '@ses/db/testing は tests/isolation/** からのみ import できます（分離機構そのものを検証する専用の' +
  '入口のため。docs/05 §4.7 / packages/db/src/testing/isolation.ts 冒頭コメント）。';

// T-03-08（docs/03 `program-design` 申し送り 2 / docs/05 §5.2 / CLAUDE.md §10.5）:
// 🔴 主平面のコードから `withPlatform*`（テナント分離を越える唯一の経路）を import できないことを
//    lint で担保する。`@ses/db` の index は platform.ts を 1 つも re-export しないため、
//    到達経路は `@ses/db/platform` サブパスだけであり、それを次の 2 区画に限定する:
//      - apps/web/app/admin/**       … 管理平面の画面（A-001〜A-014）
//      - apps/web/app/api/admin/**   … 管理平面の API（API-A1〜A17。docs/05 §6.9）
//      - tests/isolation/**          … 分離機構そのものを検証する専用の区画（@ses/db/testing と同じ扱い）
const SES_DB_PLATFORM_SUBPATH = '@ses/db/platform';
const SES_DB_PLATFORM_MESSAGE =
  '@ses/db/platform（withPlatformRead / withPlatformWrite）は管理平面（apps/web/app/admin/** と ' +
  'apps/web/app/api/admin/**）と tests/isolation/** からのみ import できます。' +
  '主平面のコードがテナント分離を越える経路を持たないための制限です（CLAUDE.md §10.5 / ' +
  'docs/05 §5.2 / docs/03 program-design 申し送り 2）。';

// T-01-06: $queryRaw / $queryRawUnsafe / $executeRaw / $executeRawUnsafe の呼び出し禁止
// （no-restricted-syntax。import 制限だけでは「変数越しの呼び出し」を塞げないため）。
// packages/db/src/** と tests/isolation/** だけを許可する（実装ガイドの指定）。
const RAW_SQL_CALL_NAMES = ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'];
const RAW_SQL_CALL_MESSAGE =
  '$queryRaw / $queryRawUnsafe / $executeRaw / $executeRawUnsafe の呼び出しは packages/db/src/** と ' +
  'tests/isolation/** 以外では禁止です（CLAUDE.md §3.1 / docs/05 §4.3）。withTenant / withHostTenant を' +
  '使ってください。';

// T-04-01（docs/05 §13.1 / §2.2 の表 / `docs/03` §4.18.2）: 🔴 モック実装のモジュールを
// `packages/connectors/src/index.ts` 以外から import することを禁止する。
//   なぜ: モックを直接 import できると、業務コードの中に「この環境ならモック」という
//   リクエストごとの分岐を書けてしまう。差し替えの判断が起動時 1 箇所
//   （`resolveConnectorSelection` → `createConnectors`）に閉じている、という前提が静かに壊れる。
//   `@ses/connectors` の index は Mock* クラスを re-export しないため、外からの到達経路は
//   パッケージのサブパス（`@ses/connectors/mock` / `dist/mock/**`）と相対パスだけである。
const CONNECTOR_MOCK_MESSAGE =
  'モック実装（packages/connectors/src/mock/**）は packages/connectors/src/index.ts からのみ ' +
  'import できます（docs/05 §13.1 / CLAUDE.md §11.1）。呼び出し側は createConnectors が返した ' +
  'コネクタを使い、実装種別で分岐しないでください。';
const CONNECTOR_MOCK_SUBPATH = '@ses/connectors/mock';
// パッケージ名・パス経由での到達（全ゾーンで常時禁止）。
const CONNECTOR_MOCK_EXTERNAL_PATTERNS = [
  '@ses/connectors/mock',
  '@ses/connectors/mock/**',
  '@ses/connectors/src/mock/**',
  '@ses/connectors/dist/mock/**',
  '**/packages/connectors/src/mock/**',
  '**/packages/connectors/dist/mock/**',
];
// packages/connectors 内部の相対 import（index.ts / mock 自身 / ユニットテスト以外で禁止）。
// 🔴 深い階層からの脱出（`src/email/ses.ts` の `'../mock/email.js'`、
//    `src/esign/docusign/oauth.ts` の `'../../mock/email.js'` 等）を必ず含める。
//    1 階層だけ塞ぐと、T-04-03 以降に増えるサブディレクトリからは素通りになる
//    （T-04-01 レビュー指摘 4）。`**` 形と明示の深さ形の**両方**を置き、
//    minimatch の `.` / `..` セグメントの扱いに依存しないようにする
//    （`tests/static/no-restricted-imports.test.ts` が 1 / 2 / 3 階層で実際に検出を確認する）。
const CONNECTOR_MOCK_RELATIVE_PATTERNS = [
  '**/mock',
  '**/mock/*',
  '**/mock/**',
  './mock',
  './mock/*',
  './mock/**',
  './src/mock/**',
  '../mock',
  '../mock/*',
  '../mock/**',
  '../../mock',
  '../../mock/*',
  '../../mock/**',
  '../../../mock',
  '../../../mock/*',
  '../../../mock/**',
  '../../src/mock/**',
];

const APPS_PACKAGES = ['@ses/web', '@ses/worker'];
const APPS_PATH_PATTERNS = ['**/apps/web/**', '**/apps/worker/**'];
const APPS_MESSAGE =
  'packages/* から apps/* を import できません（CLAUDE.md §2.1）。相対パス経由の import も禁止です。';

// 動的 import の正規表現を組み立てるための @ses/* 全パッケージ名（packages/domain の
// forbidAllSes 用。'@ses/**' は minimatch の group では表現できても正規表現には
// 素直に落とせないため、実在パッケージ名を列挙する）。新しい packages/* を追加したら
// ここにも追記すること。
const ALL_SES_PACKAGE_NAMES = [
  '@ses/domain',
  '@ses/db',
  '@ses/ai',
  '@ses/connectors',
  '@ses/config',
  '@ses/ui',
  '@ses/i18n',
  '@ses/web',
  '@ses/worker',
];

/**
 * node: 接頭辞つき/なしの両形（完全一致の名前）。buildPatterns() と
 * buildDynamicImportSelectors() の両方がここから生成し、node I/O の禁止リストを
 * 単一ソースに保つ（静的 import の subpath 検出も動的 import 検出も、この配列が唯一の入力）。
 */
function nodeIoNames() {
  return NODE_IO_MODULE_NAMES.flatMap((name) => [name, `node:${name}`]);
}

/** 完全一致 + サブパスの両方を group に含める（`@ses/db` も `@ses/db/platform` も禁止対象にする）。 */
function withSubpaths(names) {
  return names.flatMap((name) => [name, `${name}/**`]);
}

function escapeSlashes(value) {
  return value.split('/').join(`${BACKSLASH}/`);
}

/** 正規表現の特殊文字（`$` を含む）をエスケープする。プロパティ名の完全一致照合に使う。 */
function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, `${BACKSLASH}$&`);
}

/** 静的 import 用の禁止パターン（no-restricted-imports の patterns）を組み立てる。 */
function buildPatterns({
  forbiddenSesPackages = [],
  forbidAllSes = false,
  forbidApps = false,
  allowSdk = false,
  allowPrismaClient = false,
  allowDbTestingSubpath = false,
  allowDbPlatformSubpath = false,
  allowConnectorMocks = false,
  forbidRelativeConnectorMocks = false,
  forbidNodeIo = false,
  zoneLabel = '',
}) {
  const patterns = [];
  if (forbidAllSes) {
    patterns.push({
      group: ['@ses/**'],
      message: '他の @ses/* パッケージに依存できません（CLAUDE.md §2.1）。',
    });
  } else if (forbiddenSesPackages.length > 0) {
    patterns.push({
      group: withSubpaths(forbiddenSesPackages),
      message: `${forbiddenSesPackages.join(' / ')} に依存できません（CLAUDE.md §2.1）。`,
    });
  }
  if (forbidApps) {
    patterns.push({
      group: [...withSubpaths(APPS_PACKAGES), ...APPS_PATH_PATTERNS],
      message: APPS_MESSAGE,
    });
  }
  if (forbidNodeIo) {
    // withSubpaths() で完全一致 + サブパス（node:fs/promises 等）の両方を group に含める。
    // nodeIoNames() が唯一の入力なので、buildDynamicImportSelectors() 側の禁止リストと必ず一致する。
    patterns.push({
      group: withSubpaths(nodeIoNames()),
      message: `${zoneLabel} は Node の I/O に依存できません（CLAUDE.md §2.1）。`,
    });
  }
  if (!allowSdk) {
    patterns.push({ group: withSubpaths([ANTHROPIC_SDK]), message: ANTHROPIC_SDK_MESSAGE });
  }
  if (!allowPrismaClient) {
    patterns.push({ group: withSubpaths([PRISMA_CLIENT_MODULE]), message: PRISMA_CLIENT_MESSAGE });
  }
  if (!allowDbTestingSubpath) {
    patterns.push({
      group: withSubpaths([SES_DB_TESTING_SUBPATH]),
      message: SES_DB_TESTING_MESSAGE,
    });
  }
  if (!allowDbPlatformSubpath) {
    patterns.push({
      group: withSubpaths([SES_DB_PLATFORM_SUBPATH]),
      message: SES_DB_PLATFORM_MESSAGE,
    });
  }
  // 🔴 T-04-01: モック実装への到達経路を index.ts に限定する（docs/05 §13.1）。
  if (!allowConnectorMocks) {
    patterns.push({ group: CONNECTOR_MOCK_EXTERNAL_PATTERNS, message: CONNECTOR_MOCK_MESSAGE });
  }
  if (forbidRelativeConnectorMocks) {
    patterns.push({ group: CONNECTOR_MOCK_RELATIVE_PATTERNS, message: CONNECTOR_MOCK_MESSAGE });
  }
  // 🔴 常時適用（防御的）: @ses/db から PrismaClient を named import することを禁止する。
  //    @ses/db は現状これを export しないが、将来のエクスポート追加による迂回を防ぐ。
  //    ゾーンが既に @ses/db 全体を禁止している場合（forbidAllSes、または
  //    forbiddenSesPackages に @ses/db を含む）は、同じ import に対して重複したエラーを
  //    出さないよう省く（意味は既存の禁止に含まれている）。
  const sesDbAlreadyForbidden = forbidAllSes || forbiddenSesPackages.includes(SES_DB_MODULE);
  if (!sesDbAlreadyForbidden) {
    patterns.push({
      group: [SES_DB_MODULE],
      importNames: ['PrismaClient'],
      message: SES_DB_PRISMA_CLIENT_MESSAGE,
    });
  }
  return patterns;
}

/**
 * buildPatterns() と同じオプションから、禁止したいモジュール名（完全一致）の配列を組み立てる。
 * 静的 import の subpath 化（withSubpaths）は呼び出し側で行うため、ここでは名前だけを返す。
 * この配列が buildDynamicImportSelectors() の唯一の入力であり、node I/O も含めて
 * buildPatterns() と同じ NODE_IO_MODULE_NAMES / ALL_SES_PACKAGE_NAMES から生成される。
 */
function buildRestrictedNames({
  forbiddenSesPackages = [],
  forbidAllSes = false,
  forbidApps = false,
  allowSdk = false,
  allowPrismaClient = false,
  allowDbTestingSubpath = false,
  allowDbPlatformSubpath = false,
  allowConnectorMocks = false,
  forbidNodeIo = false,
}) {
  const names = [];
  if (forbidAllSes) {
    names.push(...ALL_SES_PACKAGE_NAMES);
  } else {
    names.push(...forbiddenSesPackages);
  }
  if (forbidApps) names.push(...APPS_PACKAGES);
  if (forbidNodeIo) names.push(...nodeIoNames());
  if (!allowSdk) names.push(ANTHROPIC_SDK);
  if (!allowPrismaClient) names.push(PRISMA_CLIENT_MODULE);
  if (!allowDbTestingSubpath) names.push(SES_DB_TESTING_SUBPATH);
  // 🔴 動的 import / require でも `@ses/db/platform` に到達できないようにする
  //    （静的 import だけ塞いでも `await import('@ses/db/platform')` で素通りするため）。
  if (!allowDbPlatformSubpath) names.push(SES_DB_PLATFORM_SUBPATH);
  // 🔴 動的 import / require でもモック実装に到達できないようにする。
  //    `buildDynamicImportSelectors` の正規表現が `^(name)(/.*)?$` を作るため、
  //    `@ses/connectors/mock` の 1 件でサブパスまで覆う。
  if (!allowConnectorMocks) names.push(CONNECTOR_MOCK_SUBPATH);
  return names;
}

/**
 * 動的 import（`import()` / 無置換テンプレートリテラルの `import(\`...\`)`）・require() 用の
 * 禁止セレクタ（no-restricted-syntax）を、buildRestrictedNames() の同じ禁止リストから組み立てる。
 *
 * 追跡できない残余（意図的に対象外。誤検知を避けるため正規表現化しない）:
 * - 相対パスでの apps/* 脱出（`import('../../../apps/web/...')`）
 * - `createRequire()` で得たローカル変数経由の require 呼び出し（`callee.name` が `require` でなくなる）
 * - 変数・式に束縛してからの動的 import / require（`const m = '@ses/db'; import(m)` 等）
 */
function buildDynamicImportSelectors(options) {
  const names = buildRestrictedNames(options);
  if (names.length === 0) return [];

  const alternation = names.map(escapeSlashes).join('|');
  const valuePattern = `/^(${alternation})(${BACKSLASH}/.*)?$/`;
  return [
    {
      selector: `ImportExpression[source.type='Literal'][source.value=${valuePattern}]`,
      message: '動的 import (import()) にも同じ依存方向の制限が適用されます（CLAUDE.md §2.1 / §3.2）。',
    },
    {
      // 無置換のテンプレートリテラル（`` import(`@ses/db`) ``）。quasis が 1 個かつ
      // expressions が 0 個（= 実質的に文字列リテラルと同じ）のものだけを対象にする。
      selector: `ImportExpression[source.type='TemplateLiteral'][source.quasis.length=1][source.expressions.length=0][source.quasis.0.value.cooked=${valuePattern}]`,
      message:
        '無置換のテンプレートリテラルによる動的 import にも同じ依存方向の制限が適用されます（CLAUDE.md §2.1 / §3.2）。',
    },
    {
      selector: `CallExpression[callee.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value=${valuePattern}]`,
      message: 'require() にも同じ依存方向の制限が適用されます（CLAUDE.md §2.1 / §3.2）。',
    },
  ];
}

// 🔴 buildRestrictedNames() に @ses/db（PrismaClient の named import 防御）を含めない理由:
//    動的 import (`import('@ses/db')`) はモジュール全体を取得するだけで、取り出す束縛名
//    （`PrismaClient` かどうか）は import 式そのものからは分からない。名前レベルの制限は
//    静的 import（no-restricted-imports の importNames）でのみ意味を持つ。
//    @ses/db 自体の動的 import は他の目的（withTenant 等）で正当に行われうるため、
//    ここで @ses/db を丸ごと禁止リストに加えることはしない（意図的な残余）。

/**
 * T-01-06: `$queryRaw` / `$queryRawUnsafe` / `$executeRaw` / `$executeRawUnsafe` の呼び出しを
 * 禁止する no-restricted-syntax セレクタ（CLAUDE.md §3.1 / docs/05 §4.3）。
 *
 * 呼び出しの構文は 4 通りある（実装ガイドの「呼び出し」が指すのはどれも）:
 *   - 関数呼び出し形: `tx.$queryRaw(Prisma.sql`…`)`（`CallExpression`）
 *   - タグ付きテンプレート形: `` client.$queryRaw`SELECT …` ``（`TaggedTemplateExpression`。
 *     Prisma のドキュメントで推奨される書き方であり、実際に tests/isolation/roles.test.ts が使う）
 *   - 🔴 上記 2 つの **computed member access 形**（`tx['$queryRaw'](…)` /
 *     `` tx['$executeRaw']`…` ``）。T-01-06 のレビュー申し送り。ドット記法だけを塞ぐと、
 *     文字列添字で素通りする経路が残る（`callee.property` が `Identifier` ではなく `Literal` になる）。
 * 片方だけを塞ぐと、もう片方が素通しの経路になるため 4 つとも検出する。
 *
 * 🔴 追跡できない残余（意図的に対象外。誤検知を避けるため）: 変数に束縛した名前での
 *    computed access（`const k = '$queryRaw'; tx[k](…)`）と、分割代入した関数の呼び出し。
 *    これらは静的には名前が確定しない。生 SQL の実行経路そのものは
 *    「`withTenant` / `withHostTenant` が渡す型に `$queryRaw` 等が無い」（docs/05 §4.3 規約 3）
 *    ことで塞がっており、この lint は補助である。
 *
 * `allowRawSqlCalls` が true のゾーン（packages/db 内部・tests/isolation/**）では空配列を返す。
 */
function buildRawSqlCallSelectors(allowRawSqlCalls) {
  if (allowRawSqlCalls) return [];
  const alternation = RAW_SQL_CALL_NAMES.map(escapeRegexLiteral).join('|');
  const namePattern = `/^(${alternation})$/`;
  return [
    {
      selector: `CallExpression[callee.type='MemberExpression'][callee.property.type='Identifier'][callee.property.name=${namePattern}]`,
      message: RAW_SQL_CALL_MESSAGE,
    },
    {
      selector: `TaggedTemplateExpression[tag.type='MemberExpression'][tag.property.type='Identifier'][tag.property.name=${namePattern}]`,
      message: RAW_SQL_CALL_MESSAGE,
    },
    {
      selector: `CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.type='Literal'][callee.property.value=${namePattern}]`,
      message: RAW_SQL_CALL_MESSAGE,
    },
    {
      selector: `TaggedTemplateExpression[tag.type='MemberExpression'][tag.computed=true][tag.property.type='Literal'][tag.property.value=${namePattern}]`,
      message: RAW_SQL_CALL_MESSAGE,
    },
  ];
}

// 🔴 T-04-01: モック実装を import してよいファイル集合（docs/05 §13.1）。
//    index.ts（唯一の instantiate 経路）/ モック実装自身 / モックのユニットテスト。
const CONNECTOR_MOCK_IMPORTER_FILES = [
  'packages/connectors/src/index.ts',
  'packages/connectors/src/mock/**/*.{ts,tsx,mts,cts}',
  'packages/connectors/**/*.test.{ts,tsx,mts,cts}',
];

// --- ゾーン定義（CLAUDE.md §2.1 ①②③、§3.2 ④）---
// forbidApps: すべての packages/* ゾーンで一律 true にする（ルール①）。
const PACKAGE_ZONES = [
  {
    label: 'packages/domain',
    files: ['packages/domain/**/*.{ts,tsx,mts,cts}'],
    forbidAllSes: true,
    forbidNodeIo: true,
  },
  {
    label: 'packages/db',
    files: ['packages/db/**/*.{ts,tsx,mts,cts}'],
    forbiddenSesPackages: ['@ses/ai', '@ses/connectors'],
    // 🔴 生 PrismaClient / $queryRaw 等の唯一の正当な置き場所（CLAUDE.md §3.1 / docs/05 §4.3）。
    allowPrismaClient: true,
    allowRawSqlCalls: true,
  },
  {
    label: 'packages/ai（packages/ai/src/client.ts を除く）',
    files: ['packages/ai/**/*.{ts,tsx,mts,cts}'],
    ignores: ['packages/ai/src/client.ts'],
    forbiddenSesPackages: ['@ses/db', '@ses/connectors'],
  },
  {
    label: 'packages/ai/src/client.ts（唯一の SDK 例外経路。CLAUDE.md §3.2 ④）',
    files: ['packages/ai/src/client.ts'],
    forbiddenSesPackages: ['@ses/db', '@ses/connectors'],
    allowSdk: true,
  },
  {
    // 🔴 T-04-01: モック実装は index.ts からのみ import できる（docs/05 §13.1）。
    //    このゾーンには相対 import（`./mock/...`）の禁止も掛ける。
    label: 'packages/connectors（モック実装は index.ts からのみ import 可）',
    files: ['packages/connectors/**/*.{ts,tsx,mts,cts}'],
    ignores: CONNECTOR_MOCK_IMPORTER_FILES,
    forbiddenSesPackages: ['@ses/db', '@ses/ai'],
    forbidRelativeConnectorMocks: true,
  },
  {
    // モックの唯一の import 元（index.ts）と、モック実装自身、およびそのユニットテスト。
    // 🔴 ユニットテストを許可するのは、モックの振る舞い（callCount / 宛先マスキング /
    //    ドメイン未検証の throw）を検証するのがこのファイル群だからである。テストは出荷されず、
    //    「業務コードが実装種別で分岐しない」という本来の目的を損なわない。
    label: 'packages/connectors/src/index.ts と mock 実装自身（モックの唯一の import 元）',
    files: CONNECTOR_MOCK_IMPORTER_FILES,
    forbiddenSesPackages: ['@ses/db', '@ses/ai'],
    allowConnectorMocks: true,
  },
  {
    label: 'packages/config',
    files: ['packages/config/**/*.{ts,tsx,mts,cts}'],
  },
  {
    label: 'packages/ui',
    files: ['packages/ui/**/*.{ts,tsx,mts,cts}'],
  },
  {
    label: 'packages/i18n',
    files: ['packages/i18n/**/*.{ts,tsx,mts,cts}'],
  },
];

const PACKAGE_DIR_IGNORES_FOR_CATCH_ALL = PACKAGE_ZONES
  // packages/ai は 2 ゾーンに分かれているが、ディレクトリ全体としては 1 回だけ ignore する
  .map((zone) => zone.files[0].split('/').slice(0, 2).join('/') + '/**')
  .filter((value, index, self) => self.indexOf(value) === index);

function zoneConfigBlock(zone) {
  const options = {
    forbiddenSesPackages: zone.forbiddenSesPackages ?? [],
    forbidAllSes: zone.forbidAllSes ?? false,
    forbidApps: true,
    allowSdk: zone.allowSdk ?? false,
    allowPrismaClient: zone.allowPrismaClient ?? false,
    allowDbTestingSubpath: zone.allowDbTestingSubpath ?? false,
    allowDbPlatformSubpath: zone.allowDbPlatformSubpath ?? false,
    allowConnectorMocks: zone.allowConnectorMocks ?? false,
    forbidRelativeConnectorMocks: zone.forbidRelativeConnectorMocks ?? false,
    forbidNodeIo: zone.forbidNodeIo ?? false,
    zoneLabel: zone.label,
  };
  const block = {
    files: zone.files,
    rules: {
      // patterns（group）のみを使う。paths は完全一致しかできず、node:fs/promises のような
      // subpath を素通りさせるため使わない（buildPatterns() が withSubpaths() で吸収する）。
      'no-restricted-imports': ['error', { patterns: buildPatterns(options) }],
      'no-restricted-syntax': [
        'error',
        ...buildDynamicImportSelectors(options),
        ...buildRawSqlCallSelectors(zone.allowRawSqlCalls ?? false),
      ],
    },
  };
  if (zone.ignores) block.ignores = zone.ignores;
  return block;
}

// --- 既定ゾーン: 上記以外すべて（apps/*, scripts/*, tests/*, ルート設定ファイル等）---
// packages/domain 〜 packages/i18n の 7 ディレクトリのみが上の PACKAGE_ZONES で
// 個別にカバーされるため、それ以外のファイルは一律ここで SDK 直接 import を禁止する
// （CLAUDE.md §3.2 ④。packages/ai/src/client.ts だけが唯一の例外）。
// 🔴 tests/isolation/** は生 PrismaClient アクセスが正当な唯一の非 packages/db 区画のため
// （T-01-06。@ses/db/testing の唯一の import 元 + $queryRaw 等の直接呼び出しを要する）、
// ここでは ignore し、専用の TESTS_ISOLATION_ZONE に完全な代替ルールセットを持たせる
// （flat config は同一ルール名を「後勝ち・丸ごと置換」するため、ファイル集合を重ねずに分離する。
//  同一ファイル集合に対して 'no-restricted-imports' / 'no-restricted-syntax' の設定ブロックを
//  複数作らない。冒頭コメント参照）。
// 🔴 T-03-08: 管理平面の 2 区画（`@ses/db/platform` の唯一の import 許可先）。
//    CATCH_ALL_ZONE から ignore し、ADMIN_PLANE_ZONE に完全な代替ルールセットを持たせる
//    （flat config の「後勝ち・丸ごと置換」を避けるため、ファイル集合を重ねない。冒頭コメント）。
const ADMIN_PLANE_FILES = [
  'apps/web/app/admin/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
  'apps/web/app/api/admin/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
];

const CATCH_ALL_IGNORES = [
  ...PACKAGE_DIR_IGNORES_FOR_CATCH_ALL,
  'tests/isolation/**',
  ...ADMIN_PLANE_FILES,
];
const CATCH_ALL_OPTIONS = { allowSdk: false };
const CATCH_ALL_ZONE = {
  files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
  ignores: CATCH_ALL_IGNORES,
  rules: {
    'no-restricted-imports': ['error', { patterns: buildPatterns(CATCH_ALL_OPTIONS) }],
    'no-restricted-syntax': [
      'error',
      ...buildDynamicImportSelectors(CATCH_ALL_OPTIONS),
      ...buildRawSqlCallSelectors(false),
    ],
  },
};

// tests/isolation/** 専用ゾーン（T-01-06 申し送り 3）。CATCH_ALL_ZONE と同じ強度
// （SDK 単一経路・生 @prisma/client 禁止）を維持しつつ、@ses/db/testing の import と
// $queryRaw 等の直接呼び出しだけを許可する。
const TESTS_ISOLATION_OPTIONS = {
  allowSdk: false,
  allowDbTestingSubpath: true,
  // 🔴 T-03-08: 管理平面の分離バイパス（withPlatformRead / withPlatformWrite）が
  //    「監査を先に書く」「対象テナントに閉じる」「read-only である」ことを実証するのは
  //    この区画である（@ses/db/testing を許可するのと同じ理由。汎用の抜け道にはしない）。
  allowDbPlatformSubpath: true,
};
const TESTS_ISOLATION_ZONE = {
  files: ['tests/isolation/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
  rules: {
    'no-restricted-imports': ['error', { patterns: buildPatterns(TESTS_ISOLATION_OPTIONS) }],
    'no-restricted-syntax': [
      'error',
      ...buildDynamicImportSelectors(TESTS_ISOLATION_OPTIONS),
      ...buildRawSqlCallSelectors(true),
    ],
  },
};

// 🔴 T-03-08: 管理平面ゾーン。CATCH_ALL_ZONE と同じ強度（SDK 単一経路・生 @prisma/client 禁止・
//    生 SQL 禁止）を維持しつつ、`@ses/db/platform` の import だけを許可する。
const ADMIN_PLANE_OPTIONS = { allowSdk: false, allowDbPlatformSubpath: true };
const ADMIN_PLANE_ZONE = {
  files: ADMIN_PLANE_FILES,
  rules: {
    'no-restricted-imports': ['error', { patterns: buildPatterns(ADMIN_PLANE_OPTIONS) }],
    'no-restricted-syntax': [
      'error',
      ...buildDynamicImportSelectors(ADMIN_PLANE_OPTIONS),
      ...buildRawSqlCallSelectors(false),
    ],
  },
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.next/**', '**/.turbo/**', 'tests/static/__fixtures__/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },

  // scripts/** は Node ランタイムで実行される運用スクリプト置き場（CLAUDE.md §2.1）。
  // 依存方向・SDK 単一経路のルールは対象にする（下記ゾーンで一律適用）が、
  // Node のグローバル（process / console 等）を lint 対象にするために宣言する。
  {
    files: ['scripts/**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        globalThis: 'readonly',
      },
    },
  },

  ...PACKAGE_ZONES.map(zoneConfigBlock),

  TESTS_ISOLATION_ZONE,
  ADMIN_PLANE_ZONE,
  CATCH_ALL_ZONE,
);

// PACKAGE_ZONES / ALL_SES_PACKAGE_NAMES / APPS_PATH_PATTERNS を静的テスト
// （tests/static/package-zone-coverage.test.ts）から検証できるように名前付き export する。
// ESLint 本体は default export のみを見るため、この export はランタイムの lint 挙動に影響しない。
export { PACKAGE_ZONES, ALL_SES_PACKAGE_NAMES, APPS_PACKAGES, APPS_PATH_PATTERNS, ADMIN_PLANE_FILES };
