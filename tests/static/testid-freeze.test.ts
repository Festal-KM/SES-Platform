// tests/static/testid-freeze.test.ts
// 🔴 **`data-testid` の凍結**（`docs/05` §17.7.3 / `docs/04` `U-22` / `docs/sprints/SP-22` §3.2）。
//
// ============================================================================
// なぜ `testid-inventory.test.ts` の隣にもう 1 本置くのか
// ============================================================================
// `testid-inventory.test.ts` は「**実体 ⊇ `FROZEN_EXACT` / `FROZEN_PREFIXES`**」を検査する。
// これは削除・改名を捕まえるが、⚠️ **`FROZEN_EXACT` 自体を同じ変更で書き換えれば緑になる** ——
// 凍結リストと検査対象が**同じファイルに在る**ためである。`docs/05` §17.7.3 はこれを
// 「現状の穴」と名指しした。🔴 **凍結が編集できるなら凍結ではない。**
//
// そこで 2026-09-30 の実体を `support/testid-baseline.ts`（**別ファイル**）に固定し、ここで
//
//   ① 🔴 **現在の実体 ⊇ ベースライン**（改名・削除 0 件）
//      —— **これが本体の保護である。** `FROZEN_EXACT` をいくら書き換えても緑にならない。
//   ② 🔴 **`FROZEN_EXACT` ∪ `FROZEN_PREFIXES` ⊇ ベースライン**
//      —— 凍結リストが縮められていないこと（`docs/05` §17.7.3 の条文どおりの検査）。
//
// の 2 つを見る。**追加は可、改名と削除は不可**（`docs/04` `U-22`）。
//
// ============================================================================
// 🔴 なぜ体裁の話ではないのか
// ============================================================================
// `SP-22` §3.2 の ⚠️: 守っているのは **`CLAUDE.md` §7 の「許容しない」5 項目**
// （越境 0 件 / パートナー間の相互参照 0 件 / PII 0 件 / 匿名候補の身元露出 0 件 / 二重送信 0 件）を
// 検査している E2E と render テストである。**キーが動くと、情報境界の回帰が
// 「セレクタが見つからない」に紛れる。**
//
// 🔴 さらに `SP-22` は 19 部品を `packages/ui` へ置く。`testid-inventory.test.ts` の `SCAN_ROOTS` に
//    `packages/ui` を足したのは（✅ T-22-02）、**部品を移した瞬間に凍結の射程から抜ける**のを
//    防ぐためである。本ファイルも同じ 2 ルートを走査する（片方だけ見ると、移動を削除と誤判定する）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, repoRoot, toRepoRelative } from './support/ui-classes.js';
import { TESTID_BASELINE_EXACT, TESTID_BASELINE_PREFIXES } from './support/testid-baseline.js';
import { composeTestIds, extractTestIds } from './support/testid-extract.js';

/** 🔴 `testid-inventory.test.ts` の `SCAN_ROOTS` と同じ 2 ルート（片方だけ見ない）。 */
const SCAN_ROOTS = [path.join(repoRoot, 'apps', 'web'), path.join(repoRoot, 'packages', 'ui')];

const scanned = SCAN_ROOTS.flatMap((root) =>
  collectSourceFiles(root, ['.tsx']).map((absolute) => {
    const label = toRepoRelative(absolute);
    const source = readFileSync(absolute, 'utf8');
    return { label, source, extraction: extractTestIds(source, label) };
  }),
);
/**
 * 🔴 **`testIdPrefix` から組まれる testid を解いて足す**（`T-22-06`。`support/testid-extract.ts` の
 *    「`testIdPrefix` から組まれる testid の解決」）。`T-22-04` の一覧の部品は
 *    `${testIdPrefix}table` の形で testid を組むため、これを解かないと
 *    **`engineer-list-table` / `engineer-list-row-` が「消えた」と誤判定される**。
 * 🔴 **凍結リストを緩めたのではない。** 解けなかった場合に起きるのは「見つからない = 落ちる」で
 *    あり、この解決は**実際に DOM に出る値だけ**を足す（要素名で突き合わせる）。
 */
const composed = composeTestIds(scanned);
const presentExact = new Set([...scanned.flatMap((file) => file.extraction.exact), ...composed.exact]);
const presentPrefixes = new Set([...scanned.flatMap((file) => file.extraction.prefixes), ...composed.prefixes]);
const totalOccurrences = scanned.reduce((sum, file) => sum + file.extraction.occurrences, 0);

/**
 * 🔴 `FROZEN_EXACT` / `FROZEN_PREFIXES` を**ソースから読む**（テスト間で定数を export し合わない）。
 *    `testid-inventory.test.ts` は 1,700 行の凍結リストであり、`export` を増やすと
 *    「どちらが正の一覧か」が曖昧になる。ここが見たいのは**リストが縮められていないこと**なので、
 *    文字列として読み出せば足りる。
 */
function frozenListFromSource(name: string): string[] {
  const source = readFileSync(path.join(repoRoot, 'tests', 'static', 'testid-inventory.test.ts'), 'utf8');
  const head = `const ${name}: readonly string[] = [\n`;
  const start = source.indexOf(head);
  if (start < 0) throw new Error(`${name} の宣言が testid-inventory.test.ts に見つかりません`);
  const end = source.indexOf('\n];', start + head.length);
  const body = source.slice(start + head.length, end);
  return [...body.matchAll(/^ {2}'([^']+)',$/gm)].map((match) => match[1] as string);
}

const frozenExact = frozenListFromSource('FROZEN_EXACT');
const frozenPrefixes = frozenListFromSource('FROZEN_PREFIXES');

/**
 * 凍結が値を覆っているか。
 * 🔴 **完全一致で凍結されていなくても、いずれかの凍結接頭辞で始まるなら覆われている**
 *    （例: `admin-monitoring-send-hold-PROVIDER_QUOTA` は接頭辞
 *    `admin-monitoring-send-hold-` が凍結している。値自体は ENUM 由来で kebab-case ではないため
 *    `FROZEN_EXACT` の命名規約に載せられない）。
 */
function isCoveredByFrozen(value: string): boolean {
  return frozenExact.includes(value) || frozenPrefixes.some((prefix) => value.startsWith(prefix));
}

describe('🔴 data-testid の凍結（docs/05 §17.7.3 / docs/04 U-22）', () => {
  it('走査が空振りしていない（対照。抽出器が 0 件になれば「削除が無い」も自明に真になる）', () => {
    expect(scanned.length).toBeGreaterThanOrEqual(140);
    expect(totalOccurrences).toBeGreaterThanOrEqual(1200);
    expect(scanned.some((file) => file.label.startsWith('apps/web/'))).toBe(true);
    expect(scanned.some((file) => file.label.startsWith('packages/ui/'))).toBe(true);
  });

  it('ベースライン自体が重複を持たず昇順である（差分を読める形に保つ）', () => {
    expect(new Set(TESTID_BASELINE_EXACT).size).toBe(TESTID_BASELINE_EXACT.length);
    expect(new Set(TESTID_BASELINE_PREFIXES).size).toBe(TESTID_BASELINE_PREFIXES.length);
    expect([...TESTID_BASELINE_EXACT]).toEqual([...TESTID_BASELINE_EXACT].sort());
    expect([...TESTID_BASELINE_PREFIXES]).toEqual([...TESTID_BASELINE_PREFIXES].sort());
    // ベースラインが空ではない（生成に失敗したまま緑になる経路を塞ぐ）。
    expect(TESTID_BASELINE_EXACT.length).toBeGreaterThanOrEqual(1000);
    expect(TESTID_BASELINE_PREFIXES.length).toBeGreaterThanOrEqual(200);
  });

  it('🔴 ① 2026-09-30 の testid が 1 つも消えていない（改名・削除 0 件。完全一致）', () => {
    const missing = TESTID_BASELINE_EXACT.filter((value) => !presentExact.has(value));
    expect(
      missing,
      `2026-09-30 に在った data-testid が ${missing.length} 件消えています: ${missing.join(', ')}\n` +
        '🔴 追加は可、改名と削除は不可（docs/04 U-22）。整形で落としたのなら戻すこと。' +
        '意図して外すなら SP-22 §3.2 の 4 点（①どの testid か ②掴んでいる E2E / render のファイルと行 ' +
        '③改名しないと成立しない理由〔見た目の都合は理由にならない〕④追加 + 旧キー併記で移行できないか）を' +
        '完了記録に残すこと。記録が無ければタスクを完了にしない。',
    ).toEqual([]);
  });

  it('🔴 ① 2026-09-30 の動的 testid の接頭辞が 1 つも消えていない', () => {
    const missing = TESTID_BASELINE_PREFIXES.filter((value) => !presentPrefixes.has(value));
    expect(
      missing,
      `2026-09-30 に在った testid 接頭辞が ${missing.length} 件消えています: ${missing.join(', ')}\n` +
        '接頭辞が変わると、その一覧の行を掴んでいる E2E がすべて外れます。',
    ).toEqual([]);
  });

  it('🔴 ② `FROZEN_EXACT` / `FROZEN_PREFIXES` がベースラインを包含している（凍結リストを縮めていない）', () => {
    const uncovered = TESTID_BASELINE_EXACT.filter((value) => !isCoveredByFrozen(value));
    expect(
      uncovered,
      `ベースラインの値 ${uncovered.length} 件が凍結リストから外れています: ${uncovered.join(', ')}\n` +
        '🔴 `testid-inventory.test.ts` の `FROZEN_EXACT` / `FROZEN_PREFIXES` から行を消すのは、' +
        'この安全網を無効化する行為です（docs/05 §17.7.3 が名指しした「現状の穴」）。',
    ).toEqual([]);
    const uncoveredPrefixes = TESTID_BASELINE_PREFIXES.filter((value) => !frozenPrefixes.includes(value));
    expect(uncoveredPrefixes).toEqual([]);
  });

  it('🔴 凍結リストの読み出しが空振りしていない（ソースの形が変わったら落ちる）', () => {
    expect(frozenExact.length).toBeGreaterThanOrEqual(1000);
    expect(frozenPrefixes.length).toBeGreaterThanOrEqual(200);
    // 実在する値で、読み出しが本物であることを示す。
    expect(frozenExact).toContain('signin-email');
    expect(frozenPrefixes).toContain('engineer-list-row-');
  });

  it('🔴 サインイン経路の testid がベースラインに在る（E2E 71 ケースの前提。ここが欠けると全滅する）', () => {
    for (const value of [
      'signin-email',
      'signin-password',
      'signin-2fa-code',
      'signin-submit',
      'admin-signin-email',
      'admin-signin-password',
      'admin-signin-2fa-code',
      'admin-signin-submit',
    ]) {
      expect(TESTID_BASELINE_EXACT, `${value} がベースラインにありません`).toContain(value);
      expect(presentExact.has(value), `${value} が実装から消えています`).toBe(true);
    }
  });

  it('🔴 外枠の testid がベースラインに在る（T-22-05 が `packages/ui` へ移す対象。移動で抜けないことの根拠）', () => {
    // `SCAN_ROOTS` に `packages/ui` を足していなければ、部品を移した瞬間にここが落ちる。
    for (const value of [
      'app-shell',
      'app-sidebar',
      'app-header',
      'app-header-scope',
      'app-header-scope-organization',
      'app-header-scope-company',
      'app-bottom-tabs',
      'app-page-heading',
      'app-page-breadcrumb',
    ]) {
      expect(TESTID_BASELINE_EXACT, `${value} がベースラインにありません`).toContain(value);
    }
    for (const value of ['app-nav-', 'app-tab-', 'app-more-nav-', 'admin-nav-']) {
      expect(TESTID_BASELINE_PREFIXES, `${value} がベースラインにありません`).toContain(value);
    }
  });

  it('対照: ベースラインに無い架空の値は「現在の実体」にも無い（走査が何でも真にしていない）', () => {
    expect(presentExact.has('this-testid-does-not-exist')).toBe(false);
    expect(isCoveredByFrozen('this-testid-does-not-exist')).toBe(false);
    // 接頭辞の覆いが機能している（ENUM 由来の値が接頭辞で覆われる形）。
    expect(isCoveredByFrozen('admin-monitoring-send-hold-PROVIDER_QUOTA')).toBe(true);
  });

  it('🔴 `testIdPrefix` の合成が現に働いている（`T-22-06`。解けていなければ上の ① が落ちる側に倒れる）', () => {
    // 🔴 一覧の 3 画面は `DataTable` に `testIdPrefix` を渡す形へ移った（`T-22-06`）。
    //    合成が働いていることを**実在の値**で示す（0 件でも緑にならないようにする）。
    expect(composed.exact).toContain('engineer-list-table');
    expect(composed.exact).toContain('project-list-table');
    expect(composed.exact).toContain('proposal-list-table');
    expect(composed.prefixes).toContain('engineer-list-row-');
    expect(composed.prefixes).toContain('engineer-list-link-');
    // 🔴 合成は要素名で突き合わせる（総当たりではない）—— `Toolbar` の接尾辞が
    //    `DataTable` の接頭辞に付くことはない。
    expect(composed.exact).not.toContain('engineer-list-toolbar-table');
  });
});
