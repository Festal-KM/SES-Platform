// tests/static/shared-scope-single-path.test.ts
// 🔴 T-08-03（docs/05 §4.5 / §4.7 二重防御 #6 / `P-A-14`）:
//    **`app.shared_scope` を `'on'` にできる場所を 1 ファイルに固定する。**
//
// なぜ ESLint だけでは足りないか: `$executeRaw` の呼び出し禁止（`eslint.config.mjs`）は
// `packages/db/src/**` を丸ごと許可しており、**`packages/db` の中で新しい関数が GUC を立てるのは
// lint では止まらない**。「経路 4 の読み手はホストだけである」（`BR-56`）を支えているのは
// 「`'on'` を書いた場所が 1 つしかない」という構造そのものであり、それを見張れるのは静的検査だけである。
//
// 🔴 許可は `packages/db/src/scope-settings.ts` の 1 ファイルのみ
//    （`sharedCandidateScopeSettingsSql`。呼び出し元は `packages/db/src/shared-candidate.ts` の
//     `withSharedCandidateScope` だけであり、そのさらに外側は
//     `tests/static/auth-db-callers.test.ts` と `eslint.config.mjs` が固定する）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages', 'prompts', 'scripts'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 `app.shared_scope` を `'on'` にしてよい唯一のファイル。 */
const ALLOWED_ON_SITES = ['packages/db/src/scope-settings.ts'];

/**
 * 🔴 `'off'` で上書きする側は**多いほど良い**（`withTenant` を含む全経路が毎回上書きする）。
 *    ここは「減っていないこと」を見るための一覧である —— 1 本でも上書きをやめると、
 *    同じ物理接続に残った `'on'` が次のリクエストへ漏れる（二重防御 #6 が守っている性質）。
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

/**
 * 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約）。
 *    `packages/db/src/testing/isolation.ts` は**読み出し**（`current_setting`）だけを行い、
 *    `'on'` を書かないので下の判定には掛からない。
 */
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

/** `set_config('app.shared_scope', 'on', …)` / `SET app.shared_scope = 'on'` の両形を拾う。 */
const SET_ON = /app\.shared_scope['"]?\s*(?:,|=)\s*['"]on['"]/;
const SET_OFF = /app\.shared_scope['"]?\s*(?:,|=)\s*['"]off['"]/;

describe('🔴 app.shared_scope を on にできる場所は 1 ファイルだけである（docs/05 §4.5 / §4.7 #6）', () => {
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

  it('🔴 `sharedCandidateScopeSettingsSql` を呼ぶのは withSharedCandidateScope の 1 ファイルだけである', () => {
    const callers = sourceFiles
      .filter((file) =>
        /\bsharedCandidateScopeSettingsSql\b/.test(stripComments(readFileSync(file, 'utf8'))),
      )
      .map(toRepoRelative)
      .sort();
    expect(callers).toEqual([
      'packages/db/src/scope-settings.ts',
      'packages/db/src/shared-candidate.ts',
    ]);
  });

  it('🔴 `sharedCandidateScopeSettingsSql` は packages/db の外へ export されていない', () => {
    const indexSource = readFileSync(path.join(repoRoot, 'packages/db/src/index.ts'), 'utf8');
    expect(indexSource).not.toContain('sharedCandidateScopeSettingsSql');
  });
});
