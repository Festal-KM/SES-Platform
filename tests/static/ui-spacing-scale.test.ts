// tests/static/ui-spacing-scale.test.ts
// 🔴 `docs/05` §17.7.1 **(f)**: **spacing が `docs/04` §7.9 の 7 段以外を使っていない。**
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §7.9 の 🔴 の実測は「**spacing は 48 種類**が散在」である。段が無いと、隣り合う
// セクションの余白が `mt-10` と `mt-8` で違う、という状態が画面ごとに生まれ、**密度（§7.1）を
// 「守られているか」で語れなくなる。** §7.9 の 7 段（4 / 8 / 12 / 16 / 24 / 32 / 48px）は
// Tailwind 既定スケールの `1` `2` `3` `4` `6` `8` `12` と 1 対 1 であり、トークンを宣言せずに
// **検査だけで強制する**（`--spacing-*` を宣言すると同じ値が 2 つの名前を持つ。`docs/05` §2.3.2）。
//
// 🔴 **`packages/ui/src/**` 側は `T-22-01` の `design-tokens.test.ts` が 0 件として固定している**
//    （`docs/05` §17.4 の「同じ検査を 2 箇所に書かない」）。本ファイルは `apps/web/app/**` の
//    ラチェットだけを持ち、判定は `support/ui-classes.ts` の `offScaleSpacingValue` 1 箇所である。
//
// ============================================================================
// 🔴 恒久例外は 1 件だけである
// ============================================================================
// `docs/05` §17.7.1 (f) / `SP-22` §4.1 / `T-22-02` 受け入れ基準 3:
//   **`AppShell` の `pb-24` は「余白の段」ではなく `fixed` なボトムタブの高さ分の逃がしである。**
// これは刷新が終わっても残る（ボトムタブが `fixed` である限り、本文の下端はタブの高さ分だけ
// 逃がさなければ最後の行がタブの下に隠れる）。したがって**許可リスト（段が進めば空になる）ではなく
// 恒久例外**として置き、🔴 **増えないこと**（1 箇所 / `AppShell` だけ / 値は `pb-24` だけ）を検査する。
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  ALLOWED_SPACING,
  PERMANENT_SPACING_EXCEPTION,
  SPACING_UTILITY,
  classTokensOf,
  collectSourceFiles,
  isPermanentSpacingException,
  offScaleSpacingValue,
  readSource,
  repoRoot,
  toRepoRelative,
} from './support/ui-classes.js';
import {
  describeRatchetInvariants,
  scanClassFixtures,
  violationLinesByFile,
} from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_F } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_F } from './support/ui-ratchet-baseline.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

/**
 * 🔴 **恒久例外（リポジトリ全体で 1 件のみ）の定義は `support/ui-classes.ts` に在る。**
 *    ✅ `T-22-05` でそこへ移した —— `AppShell` が `packages/ui` に移り、**例外を数える側が
 *    2 つ（`apps/web` 側のこの検査と `packages/ui` 側の `design-tokens.test.ts`）になった**ため、
 *    定義が 2 箇所にあると片方だけが例外を増やせる（`docs/05` §17.4）。
 * 🔴 **判定（1 件だけ / ファイル名で縛る / 理由をコードに書く）は 1 つも変えていない。**
 */
const isPermanentException = isPermanentSpacingException;

/**
 * 🔴 恒久例外を数える範囲は **`apps/web/app` と `packages/ui/src` の両方**である。
 *    片方だけ見ると、`AppShell` の移動（`T-22-05`）が**例外の消滅**に見えてしまう
 *    （例外は部品の責務に付いており、置き場所に付いていない）。
 */
const EXCEPTION_ROOTS = [APP_ROOT, path.join(repoRoot, 'packages', 'ui', 'src')];

const scanned = collectSourceFiles(APP_ROOT, ['.tsx']);
type Finding = { readonly file: string; readonly line: number; readonly token: string };

const all: Finding[] = scanned.flatMap((absolute) => {
  const file = toRepoRelative(absolute);
  return classTokensOf(readSource(absolute), absolute)
    .filter(({ token }) => offScaleSpacingValue(token) !== null)
    .map(({ token, line }) => ({ file, line, token, absolute }))
    .filter((finding) => !isPermanentException(finding.absolute, finding.token))
    .map(({ file: f, line, token }) => ({ file: f, line, token }));
});
const actual = violationLinesByFile(all);

const permanent: Finding[] = EXCEPTION_ROOTS.flatMap((root) =>
  collectSourceFiles(root, ['.tsx']).flatMap((absolute) => {
    const file = toRepoRelative(absolute);
    return classTokensOf(readSource(absolute), absolute)
      .filter(({ token }) => isPermanentException(absolute, token))
      .map(({ token, line }) => ({ file, line, token }));
  }),
);

describeRatchetInvariants({
  label: '(f) spacing 7 段',
  allowlist: UI_RATCHET_ALLOWLIST_F,
  baseline: UI_RATCHET_BASELINE_F,
  actual,
  scannedFileCount: scanned.length,
});

describe('🔴 (f) apps/web/app の spacing が §7.9 の 7 段だけである（許可リストの外）', () => {
  it('7 段（1/2/3/4/6/8/12）と 0 / auto / px 以外の余白が 1 件も無い', () => {
    const violations = all
      .filter((finding) => !UI_RATCHET_ALLOWLIST_F.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      violations,
      '🔴 §7.9 の 7 段は `1` `2` `3` `4` `6` `8` `12`（4/8/12/16/24/32/48px）である。' +
        '`0.5` / `5` / `7` / `9` / `10` / `24` は段ではない',
    ).toEqual([]);
  });

  it('走査が空振りしていない（移行中のファイルに現に違反が在る）', () => {
    expect(all.length).toBeGreaterThan(0);
  });
});

describe('🔴 恒久例外（`AppShell` の `pb-24`）が 1 件を超えない', () => {
  it('例外は 1 箇所だけであり、`AppShell` のファイルにだけ在る', () => {
    // ✅ `T-22-05`: `AppShell` の描画が `packages/ui` へ移ったので、例外もそこへ付いていった
    //    （**件数は 1 のまま / 語は `pb-24` のまま / 判定はファイル名のまま**）。
    //    🔴 `apps/web` 側に `pb-24` が残っていれば 2 件になって落ちる。
    expect(permanent.map((finding) => `${finding.file} ${finding.token}`)).toEqual([
      `packages/ui/src/components/app-shell.tsx ${PERMANENT_SPACING_EXCEPTION.utility}`,
    ]);
  });

  it('🔴 例外の理由がコード側に書かれている（「なぜ段でないか」が読める）', () => {
    expect(PERMANENT_SPACING_EXCEPTION.reason).toContain('fixed');
    expect(PERMANENT_SPACING_EXCEPTION.reason).toContain('余白の段ではない');
  });

  it('🔴 例外は許可リストに二重に載っていない（ラチェットで消える対象ではない）', () => {
    // ✅ `T-22-05` で `_shell/app-shell.tsx` は無くなり、許可リストの段① も空になった。
    //    🔴 それでも **`pb-24` は違反として数えられていない**ことをここで固定する
    //    （数え始めると、許可リストに載っていない `packages/ui` 側で落ちる）。
    const remaining = all.filter((finding) => finding.file.endsWith('app-shell.tsx'));
    expect(remaining.every((finding) => finding.token !== PERMANENT_SPACING_EXCEPTION.utility)).toBe(true);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (f) の検出器', () => {
  it('段の外の値を拾う（`0.5` / `5` / `7` / `9` / `10` / `16` / `24`）', () => {
    for (const token of ['py-0.5', 'px-1.5', 'pl-5', 'pl-7', 'mt-10', 'py-16', 'pb-24', 'gap-0.5', 'space-y-5']) {
      expect(offScaleSpacingValue(token), token).not.toBeNull();
    }
  });

  it('7 段と `0` / `auto` / `px` は拾わない', () => {
    for (const token of [
      'p-1', 'px-2', 'py-3', 'gap-4', 'mt-6', 'mb-8', 'space-y-12', 'p-0', 'mx-auto', 'px-px',
    ]) {
      expect(offScaleSpacingValue(token), token).toBeNull();
    }
    for (const value of ['0', '1', '2', '3', '4', '6', '8', '12', 'auto', 'px']) {
      expect(ALLOWED_SPACING.has(value), value).toBe(true);
    }
  });

  it('任意値・負の値も段の外として拾う', () => {
    expect(offScaleSpacingValue('mt-[13px]')).toBe('[13px]');
    expect(offScaleSpacingValue('-mt-4')).toBeNull(); // `-mt-4` は接頭辞が `-mt` なので照合しない
    expect(offScaleSpacingValue('mt--4')).toBe('-4');
  });

  it('🔴 spacing でないユーティリティを拾わない（`p` で始まる別ユーティリティ / 幅 / 位置）', () => {
    for (const token of ['placeholder-slate-400', 'pointer-events-none', 'w-5', 'h-10', 'top-5', 'grid-cols-5', 'border-2']) {
      expect(offScaleSpacingValue(token), token).toBeNull();
    }
    expect(SPACING_UTILITY.test('placeholder-slate-400')).toBe(false);
  });

  it('バリアント接頭辞を剥がしてから照合する', () => {
    expect(offScaleSpacingValue('lg:pl-5')).toBe('5');
    expect(offScaleSpacingValue('hover:px-4')).toBeNull();
  });
});

describe('対照: fixtures の合成ソースをファイルから走査する（ファイル収集 → AST → 検出器）', () => {
  const fixtures = scanClassFixtures(offScaleSpacingValue);

  it('🔴 違反を仕込んだファイルで検出される（検査が「何も見ていない」状態で緑になっていない）', () => {
    expect([...fixtures.violationTokens].sort()).toEqual(['mt-10', 'pl-5', 'py-0.5']);
  });

  it('🔴 適合しているファイルでは 0 件である（誤検知しない。誤検知する検査はいずれ緩められる）', () => {
    expect(fixtures.cleanTokens).toEqual([]);
  });

  it('🔴 コメントの中に書いたクラス名を拾わない（規律を書き残した瞬間に落ちる検査にしない）', () => {
    // `violation.tsx` のコメントには同じ語が書いてある。拾っていたら件数が増える。
    expect(fixtures.violationTokens.length).toBe(3);
  });
});
