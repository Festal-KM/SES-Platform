// tests/static/ui-color-tokens.test.ts
// 🔴 `docs/05` §17.7.1 **(a)**: **アプリコードに primitive の色クラスが出現しない。**
//
// ============================================================================
// なぜこの検査が要るのか / なぜ `design-tokens.test.ts` と 2 ファイルなのか
// ============================================================================
// `docs/04` §7.9 の 🔴 が記録した着手前の状態は「色は TSX 直書き（`slate` 1,038 / `amber` 152 /
// `red` 83 箇所）」であり、**値の所在が無い**ため §7.4 の意味の割り当てを機械で確かめられない。
// トークンを入れただけでは同じ状態に戻る —— 次の誰かが `text-slate-500` を 1 つ書けば拡散が再開する。
//
// 🔴 **(a) の射程は「`packages/ui` と `apps/web/app`」の 2 つだが、`packages/ui` 側は
//    `T-22-01` が `tests/static/design-tokens.test.ts` で既に 0 件として固定している。**
//    `docs/05` §17.4 の「同じ検査を 2 箇所に書かない」に従い、本ファイルは
//    **`apps/web/app/**` 側のラチェットだけ**を持つ。**判定（何が違反か）の定義は
//    `tests/static/support/ui-classes.ts` の 1 箇所**であり、`design-tokens.test.ts` も
//    同じ検出器を import する（`T-22-02` でそちらを寄せた）。
//
//   | 射程 | どのファイルが見るか | 許可リスト |
//   |---|---|---|
//   | `packages/ui/src/**` | `design-tokens.test.ts`（`T-22-01`） | 無し（既に 0 件） |
//   | `apps/web/app/**` | **本ファイル** | 有り（段①〜⑤ で縮める。`SP-22` §4.1） |
//
// 禁止するもの（`docs/05` §17.7.1 (a)）:
//   ① `{text,bg,border,ring,…}-{slate,…,rose}-{50〜950}`
//   ② `*-white` / `*-black`
//   ③ 任意値（`text-[#…]` / `bg-[oklch(…)]` / `text-[var(--color-…)]`）
//   🔴 `transparent` / `current` / `inherit` は対象外（構造であって色の選択ではない）
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  ARBITRARY_COLOR,
  RAW_COLOR,
  RAW_EXTREME_COLOR,
  classTokensOf,
  collectSourceFiles,
  isRawColorClass,
  readSource,
  repoRoot,
  utilityOf,
} from './support/ui-classes.js';
import {
  describeRatchetInvariants,
  scanClassViolations,
  scanClassFixtures,
  violationLinesByFile,
} from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_A } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_A } from './support/ui-ratchet-baseline.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

const findings = scanClassViolations([APP_ROOT], (token) => (isRawColorClass(token) ? token : null));
const actual = violationLinesByFile(findings);

describeRatchetInvariants({
  label: '(a) 色の直書き',
  allowlist: UI_RATCHET_ALLOWLIST_A,
  baseline: UI_RATCHET_BASELINE_A,
  actual,
  scannedFileCount: 128,
});

describe('🔴 (a) apps/web/app に primitive の色クラスが無い（許可リストの外）', () => {
  it('許可リスト外のファイルに色の直書きが 1 件も無い', () => {
    const violations = findings
      .filter((finding) => !UI_RATCHET_ALLOWLIST_A.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      violations,
      '🔴 色は `@theme` の semantic トークン（`text-fg` / `bg-bg-subtle` / `border-border` …）で書く。' +
        'docs/04 §7.9 の 3 層と §7.4 の意味の割り当てが崩れる',
    ).toEqual([]);
  });

  // ============================================================================
  // 🔴 段⑤（`T-22-14`）で違反が 0 件になった。**ここが「空振り」に化けないようにする**
  // ============================================================================
  // 旧実装は対照として **「移行中のファイルに現に違反が在る」**（= 本番の走査が非空）を見て
  // いた。許可リストが空になった以上その条件は成立しないが、🔴 **代わりに何も見ないと、
  // 検出器が壊れて 0 件になったときも「違反 0 件」が自明に真**になる（`testid-freeze.test.ts`
  // の「抽出器が 0 件になれば削除が無いも自明に真になる」と同じ穴）。
  // そこで対照を **2 つに置き換えた**:
  //   ① **走査が現にファイルを読み、クラス名候補を取り出している**（件数の下限）。
  //   ② **検出器が合成ソース（`__fixtures__/ui-classes/`）では現に違反を拾う**
  //      （このファイル下部の「対照」ブロック。**0 件の根拠はそこに在る**）。
  it('🔴 違反が 0 件である（段⑤ で許可リストが空になり、本検査は無条件 green である）', () => {
    expect(findings).toEqual([]);
    expect(actual.size).toBe(0);
  });

  it('① 走査が現にファイルを読み、クラス名候補を取り出している（空振りの対照）', () => {
    const scanned = collectSourceFiles(APP_ROOT, ['.tsx']);
    expect(scanned.length).toBeGreaterThan(80);
    const tokens = scanned.flatMap((absolute) => classTokensOf(readSource(absolute), absolute));
    expect(tokens.length).toBeGreaterThan(1000);
    // semantic トークンが現に使われている（= 抽出が機能しており、ソースが空でもない）。
    expect(tokens.some(({ token }) => token === 'text-fg')).toBe(true);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (a) の検出器（`support/ui-classes.ts`）', () => {
  it('① primitive の階調を拾う（全ユーティリティ接頭辞 × 全パレット）', () => {
    for (const token of [
      'text-slate-500',
      'bg-amber-50',
      'border-red-300',
      'ring-indigo-700',
      'divide-slate-200',
      'placeholder-slate-400',
      'border-t-slate-200',
      'shadow-slate-900',
      'bg-emerald-600/50',
    ]) {
      expect(isRawColorClass(token), token).toBe(true);
    }
  });

  it('② `bg-white` / `text-black` を拾う（無彩色の極も「色の選択」である）', () => {
    expect(isRawColorClass('bg-white')).toBe(true);
    expect(isRawColorClass('text-black')).toBe(true);
    expect(RAW_EXTREME_COLOR.test('bg-white')).toBe(true);
  });

  it('③ 任意値を拾う（`#` / `rgb` / `oklch` / `color-mix` / `var(--color-…)`）', () => {
    for (const token of [
      'text-[#111827]',
      'bg-[rgb(0,0,0)]',
      'text-[oklch(0.2_0_0)]',
      'bg-[color-mix(in_oklch,red,blue)]',
      'text-[var(--color-fg)]',
    ]) {
      expect(isRawColorClass(token), token).toBe(true);
    }
  });

  it('🔴 `transparent` / `current` / `inherit` は拾わない（構造であって色の選択ではない）', () => {
    for (const token of ['bg-transparent', 'text-current', 'border-transparent', 'text-inherit', 'fill-current']) {
      expect(isRawColorClass(token), token).toBe(false);
    }
  });

  it('🔴 semantic トークンと、色でないユーティリティを拾わない（誤検知しない）', () => {
    for (const token of [
      'text-fg',
      'text-fg-muted',
      'bg-bg-subtle',
      'border-border-strong',
      'bg-brand',
      'text-brand-fg',
      'bg-warning-bg',
      'text-cell',
      'rounded-sm',
      'grid-cols-3',
      'w-4',
      'p-4',
      'max-w-3xl',
      'duration-150',
    ]) {
      expect(isRawColorClass(token), token).toBe(false);
    }
  });

  it('バリアント接頭辞を剥がしてから照合する（`hover:md:bg-slate-50`）', () => {
    expect(utilityOf('hover:md:bg-slate-50')).toBe('bg-slate-50');
    expect(isRawColorClass('hover:md:bg-slate-50')).toBe(true);
    // 任意値の中の `:` で切らない（`bg-[url(a:b)]`）。
    expect(utilityOf('bg-[url(a:b)]')).toBe('bg-[url(a:b)]');
  });

  it('正規表現そのものがアンカーされている（部分一致で拾わない）', () => {
    expect(RAW_COLOR.test('not-text-slate-500')).toBe(false);
    expect(RAW_COLOR.test('text-slate-500-extra')).toBe(false);
    expect(ARBITRARY_COLOR.test('text-[13px]')).toBe(false);
  });
});

describe('対照: fixtures の合成ソースをファイルから走査する（ファイル収集 → AST → 検出器）', () => {
  const fixtures = scanClassFixtures((token) => (isRawColorClass(token) ? token : null));

  it('🔴 違反を仕込んだファイルで検出される（検査が「何も見ていない」状態で緑になっていない）', () => {
    expect([...fixtures.violationTokens].sort()).toEqual([
      'bg-white',
      'border-red-300',
      'text-[#111827]',
      'text-[var(--color-fg)]',
      'text-slate-700',
    ]);
  });

  it('🔴 適合しているファイルでは 0 件である（誤検知しない。誤検知する検査はいずれ緩められる）', () => {
    expect(fixtures.cleanTokens).toEqual([]);
  });

  it('🔴 コメントの中に書いたクラス名を拾わない（規律を書き残した瞬間に落ちる検査にしない）', () => {
    // `violation.tsx` のコメントには同じ語が書いてある。拾っていたら件数が増える。
    expect(fixtures.violationTokens.length).toBe(5);
  });
});
