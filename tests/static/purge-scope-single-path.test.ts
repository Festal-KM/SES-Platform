// tests/static/purge-scope-single-path.test.ts
// 🔴 T-10-09（docs/05 §9.7 / migration 20260927000000 ④ / `F-064 AC-2`）:
//    **`app.purge_scope` を `'on'` にできる場所を 1 ファイルに固定する。**
//    `shared-scope-single-path.test.ts`（`app.shared_scope`）と同型。
//
// なぜ ESLint だけでは足りないか: `$executeRaw` の呼び出し禁止（`eslint.config.mjs`）は
// `packages/db/src/**` を丸ごと許可しており、**`packages/db` の中で新しい関数が GUC を立てるのは
// lint では止まらない**。削除スコープは C3 OWNER_SCOPED の取引先所有行を**テナント境界だけ**で開く
// （= パートナースコープの第二境界を越える）唯一の GUC であり、「`'on'` を書いた場所が 1 つしかない」
// という構造そのものが `CLAUDE.md` §3.1 の越境経路を増やさないことを支えている。
//
// 🔴 許可は `packages/db/src/scope-settings.ts` の 1 ファイルのみ
//    （`purgeScopeSettingsSql`。呼び出し元は `packages/db/src/tenant-purge.ts` の `withPurgeScope` だけであり、
//     そのさらに外側〔`apps/**` からの 4 関数の呼び出し元〕は `tests/static/auth-db-callers.test.ts` が固定する）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages', 'prompts', 'scripts'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 `app.purge_scope` を `'on'` にしてよい唯一のファイル。 */
const ALLOWED_ON_SITES = ['packages/db/src/scope-settings.ts'];

/**
 * 🔴 `'off'` で上書きする側は**多いほど良い**（`withTenant` / 共有スコープ / system / 行由来 / platform / scheduler の
 *    全経路が毎回上書きする）。ここは「減っていないこと」を見るための一覧である —— 1 本でも上書きをやめると、
 *    同じ物理接続に残った `'on'` が次のリクエストへ漏れ、通常の HTTP 経路が取引先所有行を読める。
 */
const EXPECTED_OFF_SITES = [
  'packages/db/src/scheduler-fanout.ts',
  'packages/db/src/scope-settings.ts',
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約）。 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** コメントを落としたソース（設計意図を書いた行で落ちないようにする）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

const sourceFiles = SCAN_ROOTS.flatMap((root) => listSourceFiles(path.join(repoRoot, root))).filter(
  (file) => !isTestFile(file),
);

/** `set_config('app.purge_scope', 'on', …)` / `SET app.purge_scope = 'on'` の両形を拾う。 */
const SET_ON = /app\.purge_scope['"]?\s*(?:,|=)\s*['"]on['"]/;
const SET_OFF = /app\.purge_scope['"]?\s*(?:,|=)\s*['"]off['"]/;

describe('🔴 app.purge_scope を on にできる場所は 1 ファイルだけである（docs/05 §9.7 / migration 20260927000000 ④）', () => {
  it('対照: 走査対象のソースが存在する（テスト自体が空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("🔴 `'on'` を書いているのは packages/db/src/scope-settings.ts だけである", () => {
    const offenders = sourceFiles
      .filter((file) => SET_ON.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .sort();
    expect(offenders).toEqual(ALLOWED_ON_SITES);
  });

  it("🔴 `'off'` で上書きする経路が減っていない（残った 'on' が次の文脈へ漏れない）", () => {
    const offSites = sourceFiles
      .filter((file) => SET_OFF.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .sort();
    expect(offSites).toEqual(EXPECTED_OFF_SITES);
  });

  it("🔴 scope-settings.ts の全経路（共有スコープを含む）が `'off'` で上書きしている（'on' は 1 箇所、'off' はそれ以外の全関数）", () => {
    // 🔴 `sharedCandidateScopeSettingsSql`（共有スコープ = 'on'）も `purge_scope` は `'off'` で上書きする。
    //    片方の GUC を立てる経路がもう片方を放置すると、同じ物理接続に残った `'on'` がその文脈で生きる。
    const source = stripComments(readFileSync(path.join(repoRoot, 'packages/db/src/scope-settings.ts'), 'utf8'));
    // 🔴 文脈を立てる関数 = 名前が `…ScopeSettingsSql` / `…ScopeSql` のもの（`clear/restorePlatformTargetTenantSql` は
    //    `app.target_tenant_id` 1 つの消去 / 復元だけで、文脈を立てないので対象外）。
    const scopeFunctions = [...source.matchAll(/export function (\w+Scope(?:Settings)?Sql)\(/g)].map((m) => m[1]);
    expect(scopeFunctions).toEqual(
      expect.arrayContaining(['tenantScopeSettingsSql', 'sharedCandidateScopeSettingsSql', 'purgeScopeSettingsSql']),
    );
    const onCount = source.split('\n').filter((line) => SET_ON.test(line)).length;
    const offCount = source.split('\n').filter((line) => SET_OFF.test(line)).length;
    expect(onCount).toBe(1);
    expect(onCount + offCount).toBe(scopeFunctions.length);
  });

  it('🔴 `purgeScopeSettingsSql` を呼ぶのは tenant-purge.ts の 1 ファイルだけである', () => {
    const callers = sourceFiles
      .filter((file) => /\bpurgeScopeSettingsSql\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .sort();
    expect(callers).toEqual(['packages/db/src/scope-settings.ts', 'packages/db/src/tenant-purge.ts']);
  });

  it('🔴 `purgeScopeSettingsSql` / `withPurgeScope` は packages/db の外へ export されていない', () => {
    const indexSource = readFileSync(path.join(repoRoot, 'packages/db/src/index.ts'), 'utf8');
    expect(indexSource).not.toContain('purgeScopeSettingsSql');
    // 🔴 コメントでの言及（`withPurgeScope` は export しない、と書いた行）は許す。コードとしての export だけを見る。
    expect(stripComments(indexSource)).not.toContain('withPurgeScope');
    const platformIndexSource = readFileSync(path.join(repoRoot, 'packages/db/src/platform/index.ts'), 'utf8');
    expect(stripComments(platformIndexSource)).not.toContain('purgeScopeSettingsSql');
    expect(stripComments(platformIndexSource)).not.toContain('withPurgeScope');
  });
});
