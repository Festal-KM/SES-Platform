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

/** 静的 import 用の禁止パターン（no-restricted-imports の patterns）を組み立てる。 */
function buildPatterns({
  forbiddenSesPackages = [],
  forbidAllSes = false,
  forbidApps = false,
  allowSdk = false,
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
    label: 'packages/connectors',
    files: ['packages/connectors/**/*.{ts,tsx,mts,cts}'],
    forbiddenSesPackages: ['@ses/db', '@ses/ai'],
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
    forbidNodeIo: zone.forbidNodeIo ?? false,
    zoneLabel: zone.label,
  };
  const block = {
    files: zone.files,
    rules: {
      // patterns（group）のみを使う。paths は完全一致しかできず、node:fs/promises のような
      // subpath を素通りさせるため使わない（buildPatterns() が withSubpaths() で吸収する）。
      'no-restricted-imports': ['error', { patterns: buildPatterns(options) }],
      'no-restricted-syntax': ['error', ...buildDynamicImportSelectors(options)],
    },
  };
  if (zone.ignores) block.ignores = zone.ignores;
  return block;
}

// --- 既定ゾーン: 上記以外すべて（apps/*, scripts/*, tests/*, ルート設定ファイル等）---
// packages/domain 〜 packages/i18n の 7 ディレクトリのみが上の PACKAGE_ZONES で
// 個別にカバーされるため、それ以外のファイルは一律ここで SDK 直接 import を禁止する
// （CLAUDE.md §3.2 ④。packages/ai/src/client.ts だけが唯一の例外）。
const CATCH_ALL_ZONE = {
  files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
  ignores: PACKAGE_DIR_IGNORES_FOR_CATCH_ALL,
  rules: {
    'no-restricted-imports': ['error', { patterns: buildPatterns({ allowSdk: false }) }],
    'no-restricted-syntax': ['error', ...buildDynamicImportSelectors({ allowSdk: false })],
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

  CATCH_ALL_ZONE,
);

// PACKAGE_ZONES / ALL_SES_PACKAGE_NAMES を静的テスト（tests/static/package-zone-coverage.test.ts）
// から検証できるように名前付き export する。ESLint 本体は default export のみを見るため、
// この export はランタイムの lint 挙動に影響しない。
export { PACKAGE_ZONES, ALL_SES_PACKAGE_NAMES, APPS_PACKAGES };
