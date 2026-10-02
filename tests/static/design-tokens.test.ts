// tests/static/design-tokens.test.ts
// 🔴 **デザイントークン（`docs/04` §7.9）が 1 箇所にあり、`packages/ui` がそこだけを見ている**
//    ことを機械で固定する（SP-22 T-22-01）。
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §7.9 の 🔴 が記録している着手前の状態はこうだった: **`@theme` の宣言は `--font-sans`
// の 1 行だけで、色は TSX 直書き（`slate` 1,038 / `amber` 152 / `red` 83 箇所）、spacing は
// 48 種類が散在**。**値の所在が無いので、§7.4 の意味の割り当ても §7.1 の密度も「実装で守られて
// いるか」を機械で確かめられない。** トークンを入れただけでは同じ状態に戻る —— 次の誰かが
// `text-slate-500` を 1 つ書けば、そこから拡散が再開する。**戻れないようにするのがこの検査である。**
//
// 🔴 **射程は `apps/web/app/tailwind.css` と `packages/ui/src` だけである。**
//    画面（`apps/web/app/**`）には色の直書きが約 1,273 箇所あり、一度に対象へ入れると全部赤くなる
//    （どの変更が壊したか分からなくなる。`docs/04` `Q-04-5` の段階適用）。**Phase 4 以降、刷新した
//    画面から順に対象へ加える**設計は `docs/05` 側で別途決めている。ここを「画面も見る検査」に
//    広げるのは、その設計に従って行うこと（**先に広げて赤いまま放置する**のが最悪である）。
//
// ⚠️ **この検査が守れないこと**: 生成 CSS にトークンが載っているかどうか（ビルド成果物は
//    リポジトリに無い）。`@theme static` を固定することで「宣言したのに出力に無い」経路は塞いで
//    いるが、実測は `pnpm --filter @ses/web run build` の出力 CSS を見るしかない
//    （`apps/web/app/tailwind.css` 冒頭の `@source` と同じ性質の限界）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOKEN_COLOR_SCALE, TOKEN_TEXT_SCALE, cn } from '../../packages/ui/src/lib/cn.js';
import {
  SELECTED_CLASSES,
  SELECTED_ROW_CLASSES,
  TRANSITION_CLASSES,
} from '../../packages/ui/src/lib/state-classes.js';
import { contrastRatio, relativeLuminance } from './support/oklch.js';
import {
  ALLOWED_RADIUS,
  ALLOWED_SPACING,
  PERMANENT_SPACING_EXCEPTION,
  RADIUS_UTILITY,
  classTokensOf,
  collectSourceFiles,
  isPermanentSpacingException,
  isRawColorClass,
  offScaleSpacingValue,
  offScaleTextSizeValue,
  readSource,
  toRepoRelative,
  utilityOf,
} from './support/ui-classes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const cssPath = path.join(repoRoot, 'apps', 'web', 'app', 'tailwind.css');
const css = readFileSync(cssPath, 'utf8');

/**
 * 🔴 CSS のコメントを落としてから検査する（`tailwind-breakpoints.test.ts` と同じ理由）。
 *    落とさないと、**「`--breakpoint-*` を宣言しない」と注意書きしたコメント自体が違反として
 *    検出される**。規律を書き残せない検査は、書き残しをやめる方向に人を動かす。
 */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const cssCode = stripCssComments(css);

/** `--token: value;` の宣言を集める（コメントを除いた本文から）。 */
function declarations(text: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    map.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return map;
}

const declared = declarations(cssCode);

// ============================================================================
// `docs/04` §7.9 の表（**この配列が §7.9 の写しである。値を変えるときは §7.9 の改訂が先**）
// ============================================================================

/**
 * ② semantic の色。値は「§7.9 が指定した primitive（Tailwind 既定パレットの階調）」。
 * 🔴 **実装は `var(--color-<階調>)` で参照する**（独自の hex を起こさない。`U-21`）。
 */
const SEMANTIC_COLORS: ReadonlyArray<readonly [token: string, primitive: string]> = [
  ['--color-fg', 'slate-900'],
  ['--color-fg-muted', 'slate-500'],
  ['--color-fg-placeholder', 'slate-400'],
  ['--color-bg', 'white'],
  ['--color-bg-subtle', 'slate-50'],
  ['--color-bg-inset', 'slate-100'],
  ['--color-border', 'slate-200'],
  ['--color-border-strong', 'slate-300'],
  ['--color-brand', 'indigo-700'],
  ['--color-brand-hover', 'indigo-800'],
  ['--color-brand-active', 'indigo-900'],
  ['--color-brand-bg', 'indigo-50'],
  ['--color-brand-fg', 'white'],
  ['--color-danger', 'red-700'],
  ['--color-danger-bg', 'red-50'],
  ['--color-danger-border', 'red-300'],
  ['--color-warning', 'amber-800'],
  ['--color-warning-bg', 'amber-50'],
  ['--color-warning-border', 'amber-300'],
  ['--color-success', 'emerald-700'],
  ['--color-success-bg', 'emerald-50'],
  ['--color-success-border', 'emerald-300'],
  ['--color-info', 'sky-700'],
  ['--color-info-bg', 'sky-50'],
  ['--color-info-border', 'sky-300'],
  ['--color-neutral-bg', 'slate-100'],
  ['--color-neutral-border', 'slate-300'],
  // ✅ 2026-10-02（人間のブリーフ）: カード・パネル・overlay の地。
  //    🔴 `--color-bg`（ページの地）と**値は同じで役割が違う**（`tailwind.css` の 🔴）。
  ['--color-surface', 'white'],
];

/**
 * ③ **component 層の色**（✅ 2026-10-02。`docs/04` §7.9 改訂 23 の濃色サイドバー +
 * 一覧の 2 色）。`[トークン, 値（`var(...)` の全文）]`。
 *
 * 🔴 **T-22-01 の「component 層を `@theme` に置かない」からの変更点はここだけである。**
 *    置けるのは **「部品 1 つのための色」**であり、`--focus-ring` / `--badge-*`（= 8 状態の
 *    組み合わせ）は引き続き `packages/ui` のクラス定数に残す（下の禁止パターンが固定する）。
 *    なぜ色だけ許すのか: **色は値であって振る舞いではない。** 「どの階調を使うか」は 1 箇所に
 *    集めたいが、「hover のとき背景を 1 段暗くする」は部品の実装であり、`@theme` に置くと
 *    画面からも組み直せてしまう（T-22-01 の判断の射程はそこだった）。
 *
 * 🔴 **`--color-sidebar-*` は primitive を直接参照する唯一の例外である**（§7.9 の 🔴）——
 *    semantic 層は「白地の面の上の意味」として定義されており、濃色の面に載せると逆転する。
 * 🔴 **一覧の 2 色は semantic を参照する**（値は従来と同一の `--color-bg-subtle`）。
 */
const COMPONENT_COLORS: ReadonlyArray<readonly [token: string, value: string]> = [
  ['--color-sidebar-bg', 'var(--color-slate-900)'],
  ['--color-sidebar-fg', 'var(--color-slate-100)'],
  ['--color-sidebar-fg-muted', 'var(--color-slate-400)'],
  ['--color-sidebar-border', 'var(--color-slate-700)'],
  ['--color-sidebar-hover-bg', 'var(--color-slate-800)'],
  ['--color-sidebar-selected-bg', 'var(--color-indigo-900)'],
  ['--color-sidebar-selected-fg', 'var(--color-white)'],
  // 🔴 現在地は藍のまま（§7.4 の割り当てを濃色でも変えない）。⚠️ **階調だけ `indigo-400`** である
  //    —— §7.9 の表は `--color-brand`（`indigo-700`）だが**実測 2.21:1 で `U-25` の 3:1 を満たさない**
  //    （下の濃色のコントラスト検査が実測で固定する。`tailwind.css` に実測値と経緯がある）。
  ['--color-sidebar-selected-bar', 'var(--color-indigo-400)'],
  ['--color-row-hover-bg', 'var(--color-bg-subtle)'],
  ['--color-table-header-bg', 'var(--color-bg-subtle)'],
];

/**
 * spacing の 7 段（✅ `docs/04` §7.9 改訂 23 / `U-26` で `@theme` に昇格した）。`[トークン, px]`。
 *
 * 🔴 **名前は `--spacing-*` である**（§7.9 の表記は `--space-*` だが、Tailwind v4 の spacing の
 *    名前空間は `--spacing-*` であり、`--space-4` を宣言しても `p-4` は 1 行も生成されない）。
 * 🔴 **段の値は 1 つも変えていない**（4 / 8 / 12 / 16 / 24 / 32 / 48px）。
 */
const SPACING_TOKENS: ReadonlyArray<readonly [token: string, px: number]> = [
  ['--spacing-1', 4],
  ['--spacing-2', 8],
  ['--spacing-3', 12],
  ['--spacing-4', 16],
  ['--spacing-6', 24],
  ['--spacing-8', 32],
  ['--spacing-12', 48],
];

/**
 * shadow の 2 トークン（✅ 改訂 23）。`[トークン, Tailwind 既定の対応トークン]`。
 *
 * 🔴 **値を本ファイルに写さない**（色の階調と同じ作法。`docs/05` §17.7.1 (e)）——
 *    `node_modules/tailwindcss/theme.css` から読んだ値と**完全一致**であることを検査する。
 *    一致していれば、改訂 23 の「名前を与えるだけで見た目を変えない」が守られている。
 */
const SHADOW_TOKENS: ReadonlyArray<readonly [token: string, tailwindToken: string]> = [
  ['--shadow-control', '--shadow-xs'],
  ['--shadow-overlay', '--shadow-md'],
];

/** 文字サイズ 6 トークン（§7.3 の 6 種に 1 対 1）。`[トークン, px, 行間]`。 */
const TEXT_TOKENS: ReadonlyArray<readonly [token: string, px: number, lineHeight: string]> = [
  ['--text-title', 20, '1.4'],
  ['--text-lg', 16, '1.4'],
  ['--text-body', 14, '1.6'],
  ['--text-cell', 13, '1.5'],
  ['--text-xs', 12, '1.5'],
  ['--text-micro', 11, '1.4'],
  // ✅ 2026-10-02（§7.3 / §7.9 改訂 23）: 7 つ目。🔴 **`KpiCard` の件数 1 箇所のみ**であり、
  //    参照元のファイルは下の「参照元の固定」が 1 つに縛る（段を 7 種に増やしたのではない）。
  ['--text-metric', 24, '1.2'],
];

/** 🔴 `--text-metric` を書いてよい唯一のファイル（§7.3 改訂 23 の 🔴 / 申し送り 22 ⑨(h)）。 */
const METRIC_TEXT_OWNER = 'packages/ui/src/components/kpi-card.tsx';

/**
 * 🔴 `--color-sidebar-*` を書いてよい唯一のファイル（§7.9 改訂 23 の 🔴 / 申し送り 22 ⑨(j)）。
 *    **濃色の面が他の画面に広がらないこと**がこの 1 行の意味である。
 */
const SIDEBAR_COLOR_OWNER = 'packages/ui/src/components/sidebar.tsx';

/**
 * radius 2 段（§7.9）。🔴 **名前は Tailwind 既定のキーのまま**（`docs/05` §2.3.2:
 * 同じ値に 2 つの名前を作らない）。値は既定と同一だが、**2 段がどれかを 1 箇所で読めるように
 * 明示的に宣言する**。
 */
const RADIUS_TOKENS: ReadonlyArray<readonly [token: string, px: number]> = [
  ['--radius-sm', 4],
  ['--radius-md', 6],
];

/**
 * 🔴 **`@theme` に宣言してはならないもの**（`docs/05` §2.3.2 / ✅ 2026-10-02 の改訂 23 で
 *    spacing と shadow が**許可**に移り、代わりに**より狭い禁止**が入った）。
 *
 * - 🔴 **`--space-*`** … **名前空間の誤りそのもの**である。Tailwind v4 の spacing は
 *   `--spacing-*` であり、`--space-4` を宣言しても `p-4` / `gap-6` は 1 行も生成されない
 *   ＝ **「宣言してあるのに効かない名前」**が生まれる（`docs/04` §7.9 の表記はこちらなので、
 *   設計書から素直に写すと必ず踏む。**その踏み方をここで止める**）。
 * - 🔴 **`--spacing`（基底の倍率）の打ち消し** … 消すと `h-10` / `w-56` / `size-4` / `pb-24` /
 *   `min-w-48` など**寸法ユーティリティ全体が無言で死ぬ**（`tailwind.css` の 🔴）。
 *   宣言そのものを禁じる（既定の 0.25rem を継ぐ）。
 * - 🔴 **寸法・border 幅・focus リング** … 対応する名前空間が Tailwind v4 に無い。
 *   置き場所は `packages/ui` のクラス定数（`lib/control-classes.ts` / `icons.ts` /
 *   `lib/state-classes.ts`）である。
 * - 🔴 **8 状態の組み合わせ**（`--row-hover-bg` ではなく `--focus-ring` / `--badge-*` の類） …
 *   `@theme` に置くと**画面からも組み直せてしまい**「部品ごと」の縛りが消える。
 * - transition … 既定の `duration-150` / `ease-out` で足りる（トークンを起こさない）。
 * - `--text-sm` / `--text-base` / `--text-2xl` … **宣言すると使ってよい名前に見える**（§17.7 (g)③）。
 */
const FORBIDDEN_TOKEN_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['`--space-*`（名前空間が違う。`--spacing-*` を使う）', /^--space-/],
  ['spacing の倍率の打ち消し（基底を消すと寸法ユーティリティが全部死ぬ）', /^--spacing$/],
  ['transition（既定の duration-150 / ease-out を使う）', /^--default-transition-/],
  ['文字サイズの 7 トークン以外', /^--text-(?:sm|base|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/],
  // 🔴 名前空間が存在しない寸法（宣言すると「効かない名前」になる）。
  ['アイコン寸法（`packages/ui/src/icons.ts` の `ICON_SIZE_CLASSES`）', /^--icon-/],
  ['操作要素の高さ（`lib/control-classes.ts` の `CONTROL_HEIGHT_CLASSES`）', /^--(?:control-h|input-h|row-h|height|size|width)(?:-|$)/],
  ['border 幅（`border` / `border-l-2` の 2 つだけ）', /^--border-w/],
  // 🔴 8 状態の組み合わせ（component 層のうち「振る舞い」側）。
  ['focus リング（`lib/state-classes.ts` の `FOCUS_RING_CLASSES`）', /^--focus-ring/],
  ['バッジの組み合わせ（`components/badge.tsx` の `cva`）', /^--badge-/],
];

function remToPx(value: string): number | null {
  const rem = /^([0-9.]+)rem$/.exec(value);
  if (rem !== null) return Number(rem[1]) * 16;
  const px = /^([0-9.]+)px$/.exec(value);
  if (px !== null) return Number(px[1]);
  return null;
}

describe('🔴 §7.9 のトークンが `@theme` に全部ある（欠けたら落ちる）', () => {
  it('走査が空振りしていない（対照）', () => {
    expect(cssCode.length).toBeGreaterThan(200);
    expect(declared.size).toBeGreaterThan(30);
  });

  it('🔴 `@theme static` である（宣言したトークンが出力 CSS から落ちない）', () => {
    // 既定の `@theme` は「どのユーティリティからも参照されていないトークン」を出力から落とす
    // （実測）。`var(--color-brand)` を CSS や任意値から直接参照した瞬間に**宣言してあるのに
    // 空に解決する**ため、`static` を外さない。
    expect(
      /@theme\s+static\s*\{/.test(cssCode),
      '`@theme static` が見つかりません。`static` を外すと、参照されていないトークンが' +
        '生成 CSS から落ち、`var(--color-…)` の直接参照が無言で空になります' +
        '（テストは緑のまま見た目だけ壊れる）。',
    ).toBe(true);
  });

  it('semantic の色 27 トークンが在り、値が §7.9 の階調（primitive）を参照している', () => {
    const missing = SEMANTIC_COLORS.filter(([token]) => !declared.has(token)).map(([t]) => t);
    expect(
      missing,
      `§7.9 の semantic トークンが欠けています: ${missing.join(', ')}\n` +
        '🔴 色は 3 層（primitive → semantic → component）で、画面が参照するのは semantic だけです。',
    ).toEqual([]);
    const wrong = SEMANTIC_COLORS.filter(
      ([token, primitive]) => declared.get(token) !== `var(--color-${primitive})`,
    ).map(([token, primitive]) => `${token}: ${declared.get(token) ?? '(無し)'} ≠ var(--color-${primitive})`);
    expect(
      wrong,
      '🔴 semantic トークンは **Tailwind 既定パレットの階調を参照**してください' +
        '（独自の hex を起こさない。`docs/04` `U-21`）。階調は明度が検証済みで、' +
        'コントラスト比の担保が予測できます。',
    ).toEqual([]);
  });

  it('🔴 `@theme` の `--color-*` は semantic 28 + component 10 の「列挙したものだけ」である', () => {
    const declaredColors = [...declared.keys()].filter((token) => /^--color-[a-z0-9-]+$/.test(token));
    expect(
      [...declaredColors].sort(),
      '🔴 `@theme` に置けるのは **semantic（§7.4 の意味と 1 対 1）** と、' +
        '**component 層のうち「部品 1 つのための色」**（`--color-sidebar-*` / `--color-row-hover-bg` / ' +
        '`--color-table-header-bg`）だけです。**8 状態の組み合わせ（focus リング / バッジ）は ' +
        '`packages/ui` のクラス定数に置いてください** —— `@theme` に置くと画面からも組み直せてしまい' +
        '「部品ごと」という縛りが消えます（`docs/05` §2.3.2 の判断の射程はそこでした）。' +
        '🔴 **画面ごとの component トークンを作らないこと**（部品ごとに作る。§7.9）。',
    ).toEqual(
      [...SEMANTIC_COLORS.map(([token]) => token), ...COMPONENT_COLORS.map(([token]) => token)].sort(),
    );
  });

  it('🔴 component 層の色が「部品 1 つのため」であり、値が §7.9 改訂 23 のとおりである', () => {
    const wrong = COMPONENT_COLORS.filter(([token, value]) => declared.get(token) !== value).map(
      ([token, value]) => `${token}: ${declared.get(token) ?? '(無し)'} ≠ ${value}`,
    );
    expect(
      wrong,
      '🔴 濃色サイドバーの 8 色は **primitive を直接参照する唯一の例外**です（semantic は「白地の面の' +
        '上の意味」として定義されており、濃色の面に載せると意味と見た目が逆転します。§7.9 の 🔴）。' +
        '一覧の 2 色は **semantic（`--color-bg-subtle`）を参照**し、値を変えていません。' +
        '🔴 **階調を実装側（TSX）で直書きしないこと**（`U-25`）。',
    ).toEqual([]);
  });

  it('🔴 spacing の 7 段が宣言されており、静的検査の許容段と一致する（改訂 23 の (m)）', () => {
    const wrong = SPACING_TOKENS.filter(([token, px]) => remToPx(declared.get(token) ?? '') !== px).map(
      ([token, px]) => `${token}: ${declared.get(token) ?? '(無し)'} ≠ ${px}px`,
    );
    expect(
      wrong,
      '🔴 §7.9 の 7 段（4 / 8 / 12 / 16 / 24 / 32 / 48px）を `--spacing-1` … `--spacing-12` として' +
        '宣言してください（改訂 23 / `U-26`: **「規約で禁止」より「名前が存在しない」ほうが強い**）。' +
        '🔴 **名前は `--space-*` ではありません**（Tailwind v4 の spacing の名前空間は `--spacing-*`）。',
    ).toEqual([]);
    // 🔴 **規約とトークンが 2 本の真実にならないこと**（改訂 23 の (m)）——
    //    宣言した段と、検査が許す段（`support/ui-classes.ts` の `ALLOWED_SPACING`）が一致する。
    const declaredSteps = SPACING_TOKENS.map(([token]) => token.replace('--spacing-', '')).sort();
    const allowedSteps = [...ALLOWED_SPACING].filter((value) => /^\d+$/.test(value) && value !== '0').sort();
    expect(
      declaredSteps,
      '🔴 `@theme` の 7 段と `ALLOWED_SPACING`（静的検査が許す段）が食い違っています。' +
        '**どちらかだけを直すと「宣言には無いが検査は通る値」または「宣言にあるのに書けない値」が' +
        '生まれます**（改訂 23 の (m) がこの一致を要求しています）。',
    ).toEqual(allowedSteps);
    // 🔴 宣言は 7 段「だけ」である（`--spacing-5` を足せない）。
    const declaredSpacing = [...declared.keys()].filter((token) => /^--spacing-/.test(token));
    expect([...declaredSpacing].sort()).toEqual([...SPACING_TOKENS.map(([token]) => token)].sort());
  });

  it('🔴 shadow は 2 トークンだけで、値が Tailwind 既定と完全一致する（見た目を変えずに名前を与えた）', () => {
    // 🔴 対照: 突き合わせ先が現に読めている（`undefined` 同士の一致で緑にならない）。
    expect(tailwindTheme.get('--shadow-xs')).toBeDefined();
    expect(tailwindTheme.get('--shadow-md')).toBeDefined();
    const wrong = SHADOW_TOKENS.filter(
      ([token, tailwindToken]) => declared.get(token) !== tailwindTheme.get(tailwindToken),
    ).map(
      ([token, tailwindToken]) =>
        `${token}: ${declared.get(token) ?? '(無し)'} ≠ ${tailwindTheme.get(tailwindToken) ?? '(無し)'}`,
    );
    expect(
      wrong,
      '🔴 改訂 23 は **影の名前を 2 つに固定した**だけで、例外も見た目も増やしていません。' +
        '`--shadow-control` は Tailwind の `--shadow-xs`（入力欄の輪郭）、`--shadow-overlay` は ' +
        '`--shadow-md`（overlay の浮き）と**同一の値**でなければなりません。' +
        '⚠️ `var(--shadow-xs)` で参照しないのは、`shadow-*` ユーティリティが値を解析して ' +
        '`--tw-shadow-color` を差し込むためです（`var()` 1 個では解析できず出力の形が変わります）。',
    ).toEqual([]);
    const declaredShadows = [...declared.keys()].filter((token) => /^--shadow-/.test(token));
    expect(
      [...declaredShadows].sort(),
      '🔴 影の名前はこの 2 つだけです。新しい影を作るには `docs/04` §7.9 への追記（= 人間の判断）が要ります。',
    ).toEqual([...SHADOW_TOKENS.map(([token]) => token)].sort());
  });

  it('🔴 `@theme` に置いてはならないトークン（spacing / transition / shadow / 文字サイズの別名）が無い', () => {
    const offenders = FORBIDDEN_TOKEN_PATTERNS.flatMap(([label, pattern]) =>
      [...declared.keys()].filter((token) => pattern.test(token)).map((token) => `${token}（${label}）`),
    );
    expect(
      offenders,
      '🔴 `docs/05` §2.3.2 が「宣言しない」と定めたトークンが `@theme` に在ります。' +
        '**同じ値が 2 つの名前を持つ状態**（spacing）や、**画面から書けてしまう component 層**を' +
        '作らないでください。',
    ).toEqual([]);
  });

  it('文字サイズが 7 トークンで、実寸と行間が §7.3 の表と一致する', () => {
    const wrong = TEXT_TOKENS.flatMap(([token, px, lineHeight]) => {
      const issues: string[] = [];
      if (remToPx(declared.get(token) ?? '') !== px) {
        issues.push(`${token}: ${declared.get(token) ?? '(無し)'} ≠ ${px}px`);
      }
      if (declared.get(`${token}--line-height`) !== lineHeight) {
        issues.push(
          `${token}--line-height: ${declared.get(`${token}--line-height`) ?? '(無し)'} ≠ ${lineHeight}`,
        );
      }
      return issues;
    });
    expect(
      wrong,
      '🔴 文字サイズは 6 トークン（20 / 16 / 14 / 13 / 11px + 12px）で、**行間はサイズと対で**' +
        '持ちます（`docs/04` §7.3 / §7.9）。weight を別トークンにしないのは、サイズと weight を' +
        '自由に組み合わせられるようにすると段の定義が画面ごとに崩れるためです。',
    ).toEqual([]);
  });

  it('radius が 2 段（4px / 6px）で、それ以外の radius トークンを宣言していない', () => {
    const wrong = RADIUS_TOKENS.filter(([token, px]) => remToPx(declared.get(token) ?? '') !== px).map(
      ([token, px]) => `${token}: ${declared.get(token) ?? '(無し)'} ≠ ${px}px`,
    );
    expect(
      wrong,
      '🔴 radius は 4px（入力欄 / ボタン / バッジ / セル）と 6px（パネル / Dialog / Drawer / ' +
        'Card）の **2 段だけ**です（`docs/04` §7.9）。',
    ).toEqual([]);
    const declaredRadius = [...declared.keys()].filter((token) => /^--radius-/.test(token));
    expect(
      [...declaredRadius].sort(),
      '🔴 `--radius-control` のような別名を作らないでください（`docs/05` §2.3.2: 同じ値が' +
        '2 つの名前を持つ状態を作らない）。12px 以上の段も足さないでください。',
    ).toEqual([...RADIUS_TOKENS.map(([token]) => token)].sort());
  });

  it('🔴 遷移は 150ms / `ease-out` を `packages/ui` の 1 定数が持つ（トークンを起こさない）', () => {
    expect(
      TRANSITION_CLASSES.split(' ').sort(),
      '🔴 `docs/04` §7.9 の transition は **150ms / `ease-out`**、対象は background-color / ' +
        'border-color / color / opacity **のみ**です。`transition-all` / `transition-transform` / ' +
        '`transition-shadow` を使わないでください（hover で動くと 50 行の一覧が波打ちます）。',
    ).toEqual(['duration-150', 'ease-out', 'transition-colors']);
  });

  it('🔴 `--breakpoint-*` の宣言が 0 件である（`CLAUDE.md` §13.3）', () => {
    // ⚠️ `tests/static/tailwind-breakpoints.test.ts` が全 CSS を対象に同じ検査をしている。
    //    ここでも見るのは、**トークンを足す作業のついでに `@theme` へ書かれる**のがこの 1 ファイル
    //    だからである（トークンの検査に来た人がこの行を読む）。
    const offenders = [...declared.keys()].filter((token) => token.startsWith('--breakpoint-'));
    expect(
      offenders,
      'ブレークポイントを独自定義しないでください（`CLAUDE.md` §13.3）。' +
        'Tier（`docs/04`）は Tailwind 既定の幅を共通語にしています。',
    ).toEqual([]);
  });

  it('🔴 `@source` で `packages/ui/src` を指している（消すと見た目だけ無言で壊れる）', () => {
    const sources = [...cssCode.matchAll(/@source\s+(['"])(.*?)\1/g)].map((m) => m[2] ?? '');
    const resolved = sources.map((source) =>
      path.resolve(path.dirname(cssPath), source).split(path.sep).join('/'),
    );
    expect(
      resolved,
      '`@ses/ui` のソースが Tailwind のコンテンツ検出に入っていません。' +
        '**`@ses/ui` を使う画面のスタイルが本番ビルドから無言で消えます**（テストは落ちません）。',
    ).toContain(path.join(repoRoot, 'packages', 'ui', 'src').split(path.sep).join('/'));
  });

  it('🔴 `dark:` バリアントが CSS に 0 件である（ダークテーマ非対応。`Q-04-3` 既定 ①）', () => {
    expect(/\bdark\\?:/.test(cssCode)).toBe(false);
    expect(/prefers-color-scheme/.test(cssCode)).toBe(false);
    expect(/color-scheme:\s*light/.test(cssCode)).toBe(true);
  });
});

// ============================================================================
// `packages/ui` がトークンだけを見ていること
// ============================================================================

const UI_SRC = path.join(repoRoot, 'packages', 'ui', 'src');

/**
 * 🔴 **走査と「何が違反か」の定義は `support/ui-classes.ts` にある**（✅ T-22-02）。
 *
 * `docs/05` §17.7.1 の (a)(f)(g) は、本ファイル（`packages/ui` 側）と
 * `ui-color-tokens` / `ui-spacing-scale` / `ui-type-scale`（`apps/web/app` 側のラチェット）の
 * **両方が同じ判定を使う**。判定を 2 箇所に写すと、片方だけが直る
 * （例えば「`bg-white` も色の選択である」という改善が片方にしか入らない）。
 * 従って **何を見るか（射程）は各テストが、何が違反かは support が 1 箇所で持つ**
 * （`docs/05` §17.4 の「同じ検証を 2 箇所に書かない」）。
 *
 * ⚠️ 射程の違いを取り違えないこと:
 *    | 射程 | 見るファイル | 許可リスト |
 *    |---|---|---|
 *    | `packages/ui/src/**`（`.ts` + `.tsx`） | **本ファイル** | 無し（既に 0 件） |
 *    | `apps/web/app/**`（`.tsx`） | `ui-color-tokens` / `ui-spacing-scale` / `ui-type-scale` | 有り（段①〜⑤で縮む） |
 */
const uiFiles = collectSourceFiles(UI_SRC, ['.ts', '.tsx']).map((absolute) => ({
  absolute,
  label: toRepoRelative(absolute),
  tokens: classTokensOf(readSource(absolute), absolute).map(({ token }) => token),
}));

/**
 * 🔴 `packages/ui` で影が出てよいのは **2 箇所 2 語だけ**である。**ファイル単位 × 語単位**で
 *    固定し、「どちらか片方だけ」も許さない（`docs/04` §7.9 の shadow の規約）。
 *
 * | 許す場所 | 語 | 根拠 |
 * |---|---|---|
 * | `lib/control-classes.ts` | `shadow-xs` | **入力欄の輪郭**。`docs/04` §7.9（改訂 19。2026-09-30）が **明示的な例外**として追記し、`docs/05` §2.3.2 が「既存 `Input` / `Select` / `Textarea` の `shadow-xs` は据え置く」と名指しした。🔴 **例外はこの 1 語 1 箇所に限る** |
 * | `lib/overlay-classes.ts` | `shadow-md` | **overlay そのもの**。§7.9 は「shadow は **overlay（`Dialog` / `Drawer` / `DropdownMenu` / `Tooltip` / `Toast`）**と入力欄の輪郭にのみ使う」と定めており、overlay は禁止の対象ではなく**唯一の本来の用途**である |
 *
 * ⚠️ **✅ T-22-03 で overlay の行を足した。** 🔴 **「落ちたから広げた」のではない** ——
 *    §7.9 が overlay の影を**認めている**からである（この検査の前身は
 *    「`shadow-xs` の 1 箇所だけ」と書いてあり、その行に
 *    「Phase 3b で overlay 部品が入るとき、根拠は『§7.9 が overlay の影を認めているから』で
 *    あり『落ちたから広げる』ではない」という予告が置かれていた。本改訂はその予告の実行である）。
 *    🔴 **広げたのは overlay 部品の component 層 1 ファイルだけ**で、
 *    **語も `shadow-md` の 1 語に固定した**（`shadow-lg` / `shadow-2xl` は落ちる）。
 *    🔴 **overlay 部品それぞれ（`components/{dialog,drawer,dropdown-menu,tooltip,toast}.tsx`）に
 *    影の語を書くことは許していない** —— 5 箇所に散ると「新しい要素に影を足した」のか
 *    「overlay だから正しい」のかを機械で見分けられなくなる（§7.9 の 🔴「新しい要素に
 *    『輪郭だから』と言って影を足せない」と同じ構え）。
 *
 * ⚠️ T-22-01 の時点では §7.9 と `docs/05` §2.3.2 で**入力欄の輪郭の読みが分かれていた**が、
 *    `docs/04` 改訂 19 が §7.9 側に例外を明記して解消済みである（完了報告で提起した件）。
 */
const SHADOW_ALLOWANCES: ReadonlyArray<readonly [file: string, utility: string]> = [
  // ✅ 2026-10-02（改訂 23）: 語が Tailwind 既定の名前からトークン名に替わった。
  //    🔴 **ファイルも件数も変えていない**（2 箇所 2 語）。値も同一である（上のミラー検査）。
  ['packages/ui/src/lib/control-classes.ts', 'shadow-control'],
  ['packages/ui/src/lib/overlay-classes.ts', 'shadow-overlay'],
];

/**
 * 🔴 **円形（`rounded-full`）が許される 2 箇所**（`docs/04` §7.9 の radius の 🔴
 * 「**円形はアバターとカウンタのみ**」）。✅ 2026-10-02 に部品が入ったので列挙で固定した。
 *
 * | 許す場所 | 何が円か |
 * |---|---|
 * | `components/avatar.tsx` | **アバター**そのもの（`Avatar`） |
 * | `components/rail-card.tsx` | **カウンタ**（`RankedList` の順位の数字） |
 *
 * 🔴 **ここに足すには §7.9 の改訂（人間の判断）が要る。** カード・ボタン・バッジ・タグを
 *    丸くしない（§7.9: 密度の高い一覧で角丸が大きいと行の境界が曖昧になる。`Badge` は
 *    `T-22-01` で円形をやめている）。
 */
const CIRCLE_ALLOWANCES: ReadonlyArray<readonly [file: string, utility: string]> = [
  ['packages/ui/src/components/avatar.tsx', 'rounded-full'],
  ['packages/ui/src/components/rail-card.tsx', 'rounded-full'],
];

function isAllowedCircle(file: string, utility: string): boolean {
  return CIRCLE_ALLOWANCES.some(([allowedFile, allowedUtility]) => allowedFile === file && allowedUtility === utility);
}

function isAllowedShadow(file: string, utility: string): boolean {
  return SHADOW_ALLOWANCES.some(([allowedFile, allowedUtility]) => allowedFile === file && allowedUtility === utility);
}

describe('🔴 `packages/ui` は semantic / component トークンだけを見る（トークン化の完了を固定する）', () => {
  it('走査が空振りしていない（対照）', () => {
    expect(uiFiles.length).toBeGreaterThanOrEqual(15);
    const all = uiFiles.flatMap((file) => file.tokens);
    // トークン化されたクラスが現に使われている（＝ 抽出が機能している）。
    expect(all).toContain('text-fg-muted');
    expect(all.some((token) => token.endsWith('text-body'))).toBe(true);
  });

  it('🔴 生の色ユーティリティ（`text-slate-700` 等）が 1 件も無い', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => isRawColorClass(token))
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 ① primitive 層（Tailwind 既定パレットの階調）をアプリコードから直接使わないでください' +
        '（`docs/04` §7.9。これが着手前の 1,038 箇所の原因です）。参照するのは semantic 層' +
        '（`text-fg` / `bg-bg-subtle` / `border-border-strong` …）だけです。' +
        '意味に名前が無い色が要るなら、まず §7.4 のどの系統かを決めてください（人間の判断）。',
    ).toEqual([]);
  });

  it('🔴 `dark:` バリアントが 1 件も無い（ダークテーマ非対応）', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens.filter((token) => /(^|:)dark:/.test(token)).map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      'ダークテーマは非対応で確定しています（`docs/04` `Q-04-3` 既定 ①）。効かない語を増やさないでください。',
    ).toEqual([]);
  });

  it('余白は §7.9 の 7 段だけを使う', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => offScaleSpacingValue(token) !== null)
        // 🔴 恒久例外（リポジトリ全体で 1 件）。定義は `support/ui-classes.ts` に在り、
        //    `apps/web` 側（`ui-spacing-scale.test.ts`）と**同じ 1 件**を指す。
        //    ✅ `T-22-05` で `AppShell` が `packages/ui` に移ったので、ここでも除外が要る
        //    （例外は部品の責務に付いており、置き場所に付いていない）。
        .filter((token) => !isPermanentSpacingException(file.absolute, token))
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 余白は 4 / 8 / 12 / 16 / 24 / 32 / 48px の 7 段です（`docs/04` §7.9）。' +
        '`p-5` / `gap-7` / `mt-9` / `gap-1.5` を書かないでください（Tailwind の既定スケールには' +
        '存在しますが、本プロダクトでは使いません。現状 48 種類からの収束です）。',
    ).toEqual([]);
  });

  it('🔴 恒久例外（`AppShell` の `pb-24`）が現に使われており、他へ広がっていない', () => {
    // 🔴 「許可だけが残っている」状態（例外が未使用のまま居座る）を防ぐ ——
    //    `SHADOW_ALLOWANCES` の対照と同じ構えである。件数の上限は
    //    `ui-spacing-scale.test.ts` の「例外は 1 箇所だけ」が両ルートを走査して固定する。
    const used = uiFiles.filter((file) =>
      file.tokens.some((token) => isPermanentSpacingException(file.absolute, token)),
    );
    expect(used.map((file) => file.label)).toEqual(['packages/ui/src/components/app-shell.tsx']);
    expect(PERMANENT_SPACING_EXCEPTION.utility).toBe('pb-24');
  });

  it('文字サイズは §7.9 の 6 トークンだけを使う', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => offScaleTextSizeValue(token) !== null)
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 文字サイズは `text-title` / `text-lg` / `text-body` / `text-cell` / `text-xs` / ' +
        '`text-micro` の 6 つだけです（`docs/04` §7.3 / §7.9）。`text-sm` / `text-base` / ' +
        '`text-2xl` / `text-[15px]` を書かないでください（**役割名で参照する**）。',
    ).toEqual([]);
  });

  it('radius は §7.9 の 2 段だけを使う（円形はアバターとカウンタのみ）', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .map((token) => ({ token, match: RADIUS_UTILITY.exec(utilityOf(token)) }))
        .filter(({ match }) => match !== null && !ALLOWED_RADIUS.has(match[1] ?? ''))
        // ✅ 2026-10-02: 🔴 **`rounded-full` は §7.9 が「アバターとカウンタのみ」として認めている。**
        //    認めた以上、**どこで使ってよいかをファイル単位で固定する**（`SHADOW_ALLOWANCES` と
        //    同じ構え）—— 語を一律に許すと、次の誰かがカードやボタンを丸くできる。
        .filter(({ token }) => !isAllowedCircle(file.label, utilityOf(token)))
        .map(({ token }) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 radius は `rounded-control`（4px = 入力欄 / ボタン / バッジ / セル）と ' +
        '`rounded-panel`（6px = パネル / Dialog / Drawer / Card）の 2 段だけです（`docs/04` §7.9）。' +
        '12px 以上の大きな角丸を使わないでください（密度の高い一覧で行の境界が曖昧になります）。' +
        '`rounded-full` はアバターとカウンタのみです。',
    ).toEqual([]);
    // 🔴 許可が「実在するから許している」ことの対照（未使用の許可が残るのを防ぐ。影と同じ構え）。
    for (const [file, utility] of CIRCLE_ALLOWANCES) {
      const allowed = uiFiles.find((entry) => entry.label === file);
      expect(
        allowed?.tokens.some((token) => utilityOf(token) === utility),
        `${file} に ${utility} が無い（許可だけが残っている）`,
      ).toBe(true);
    }
  });

  it('🔴 影は「入力欄の輪郭」と「overlay」の 2 箇所だけで、他のプリミティブは 1 件も持たない', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => /^shadow(-|$)/.test(utilityOf(token)))
        .filter((token) => !isAllowedShadow(file.label, utilityOf(token)))
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 影は overlay（Dialog / Drawer / DropdownMenu / Tooltip / Toast）の中と、入力欄の輪郭だけです' +
        '（`docs/04` §7.9）。**階層は border と background の差で表す** —— カードを浮かせる影は' +
        '「どれが操作可能か」の手がかりを薄めます。許されるのは ' +
        `${SHADOW_ALLOWANCES.map(([file, utility]) => `${file} の ${utility}`).join(' / ')} だけです。`,
    ).toEqual([]);
    // 🔴 許可が「実在するから許している」ことを対照で示す（未使用の許可が残るのを防ぐ）。
    for (const [file, utility] of SHADOW_ALLOWANCES) {
      const allowed = uiFiles.find((entry) => entry.label === file);
      expect(
        allowed?.tokens.some((token) => utilityOf(token) === utility),
        `${file} に ${utility} が無い（許可だけが残っている）`,
      ).toBe(true);
    }
  });

  it('🔴 `packages/ui` に出現する `shadow-` は許可された 2 箇所 2 語だけ（§7.9 / §17.7 (h)）', () => {
    // ✅ T-22-03: overlay 部品（Dialog / Drawer / DropdownMenu / Tooltip / Toast）が入ったので、
    //    `lib/overlay-classes.ts` の `shadow-md` を許可に足した。🔴 **根拠は「§7.9 が overlay の
    //    影を認めているから」であり、「落ちたから広げる」ではない**（この行の前身にその予告があった）。
    //    🔴 **広げたのは overlay の component 層 1 ファイル / 1 語だけ**で、
    //    overlay 部品それぞれ（`components/*.tsx`）に影を書くことは許していない。
    const found = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => /^shadow(-|$)/.test(utilityOf(token)))
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      found,
      '🔴 §7.9: 影の語は「入力欄の輪郭（shadow-xs）」と「overlay（shadow-md）」の 2 箇所 2 語に限る。' +
        '新しい要素に影を足していないか確認してください。',
    ).toEqual(SHADOW_ALLOWANCES.map(([file, utility]) => `${file}: ${utility}`));
  });

  it('🔴 `text-metric`（24px）を書いているのは `KpiCard` の 1 ファイルだけである（改訂 23 の (h)）', () => {
    const owners = uiFiles
      .filter((file) => file.tokens.some((token) => utilityOf(token) === 'text-metric'))
      .map((file) => file.label);
    expect(
      owners,
      '🔴 `--text-metric` は **`KpiCard` の件数 1 箇所のみ**です（§7.3 / §7.9 改訂 23）。' +
        '§7.3 の「20px より大きいサイズを作らない」の根拠は**日本語の見出しの過大化**であり、' +
        '算用数字 1〜4 桁にだけ例外を認めたものです。**見出し・本文・セル・バッジに使わないでください。**' +
        '使う場所を増やすには `docs/04` §7.3 / §7.9 への追記（= 人間の判断）が要ります。',
    ).toEqual([METRIC_TEXT_OWNER]);
  });

  it('🔴 濃色（`--color-sidebar-*`）を参照しているのは `Sidebar` の 1 ファイルだけである（改訂 23 の (j)）', () => {
    const owners = uiFiles
      .filter((file) => file.tokens.some((token) => /^[a-z-]+-sidebar-[a-z-]+$/.test(utilityOf(token))))
      .map((file) => file.label);
    expect(
      owners,
      '🔴 濃色の面はサイドバー 1 部品だけです（§3.3: **色を平面の差にしない** / §7.9 の 🔴: ' +
        '濃色の面を増やすには設計の改訂を要する）。管理平面のナビ・本体・モーダル・ヘッダに' +
        '`bg-sidebar-bg` を使わないでください。',
    ).toEqual([SIDEBAR_COLOR_OWNER]);
  });

  it('🔴 `Sidebar` が白地用の semantic（`text-fg` / `bg-bg` / `bg-bg-subtle`）を濃色の面に載せていない（(j) の後半）', () => {
    const sidebar = uiFiles.find((file) => file.label === SIDEBAR_COLOR_OWNER);
    expect(sidebar, `${SIDEBAR_COLOR_OWNER} が走査できていない`).toBeDefined();
    // 🔴 「その他」（`variant='more'`）は**白地のパネル**なので、同じファイルに白地用の語が在るのは正しい。
    //    ⚠️ したがってここで見るのは「濃色側の語と白地側の語が同じ**定数**に混ざっていないこと」ではなく、
    //    **濃色の面を描く語の隣に、効かない白地の語が残っていないこと**である。
    //    判定は現実的な形（`bg-bg` / `bg-bg-subtle` / `text-fg` の無修飾の出現が、
    //    `more` 用の 3 定数の中だけに在ること）で行う —— 文字列の位置ではなく**件数**で固定する。
    const whiteSurfaceTokens = (sidebar?.tokens ?? []).filter((token) =>
      ['bg-bg', 'bg-bg-subtle', 'bg-bg-inset', 'text-fg', 'text-fg-muted'].includes(utilityOf(token)),
    );
    expect(
      whiteSurfaceTokens.sort(),
      '🔴 白地用の semantic が濃色の面に載っていないかを確認してください（`--color-fg` は ' +
        '`slate-900` であり、`--color-sidebar-bg`（`slate-900`）の上では**完全に沈みます**）。' +
        'ここに在ってよいのは「その他」（`variant="more"` = 白地のパネル）用の語だけです。',
    ).toEqual([
      // `SIDEBAR_LINK_CLASSES.more`（白地のパネルの 1 項目）
      'active:bg-bg-inset',
      'hover:bg-bg-subtle',
      'text-fg',
      // `SIDEBAR_GROUP_LABEL_CLASSES.more` / `SIDEBAR_UNAVAILABLE_CLASSES.more` / `NOTE_CLASSES.more`
      'text-fg-muted',
      'text-fg-muted',
      'text-fg-muted',
    ]);
  });

  it('全周 2px 以上の border が無い（強調は左端 2px だけ）', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .map((token) => ({ token, match: /^border(-[xy])?-(\d+)$/.exec(utilityOf(token)) }))
        .filter(({ match }) => match !== null && Number(match[2]) >= 2)
        .map(({ token }) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 border は 1px で、強調が要る箇所のみ**左端 2px**です（`docs/04` §7.9）。' +
        '2px の全周 border は塗りに見えます。',
    ).toEqual([]);
  });
});

// ============================================================================
// トークンと `tailwind-merge` / 8 状態の整合
// ============================================================================

describe('🔴 ミラー: `docs/04` §7.9 の表 / `@theme` の宣言 / `cn()` の登録名が一致する', () => {
  // `docs/05` §17.7.1 (h)。`tests/static/anonymize-rounding-mirror.test.ts` と同じ形である。
  // 🔴 ③（`cn()` の登録）が欠けると **`cn()` がトークンを黙って落とす**（`docs/05` §2.3.3 規律 2）。
  it('色: `@theme` の `--color-*` と `TOKEN_COLOR_SCALE` が同じ集合である', () => {
    const declaredColors = [...declared.keys()]
      .filter((token) => /^--color-[a-z0-9-]+$/.test(token))
      .map((token) => token.replace('--color-', ''));
    expect(
      [...declaredColors].sort(),
      '🔴 `@theme` に色トークンを足したら `packages/ui/src/lib/cn.ts` の `TOKEN_COLOR_SCALE` にも' +
        '足してください（`docs/05` §2.3.3-2 / §17.7.1 (h)）。',
    ).toEqual([...TOKEN_COLOR_SCALE].sort());
  });

  it('文字サイズ: `@theme` の `--text-*` と `TOKEN_TEXT_SCALE` が同じ集合である', () => {
    const declaredText = [...declared.keys()]
      .filter((token) => /^--text-[a-z0-9-]+$/.test(token) && !token.endsWith('--line-height'))
      .map((token) => token.replace('--text-', ''));
    expect(
      [...declaredText].sort(),
      '🔴 登録しないと `tailwind-merge` が**文字サイズを文字色と同じグループに分類し、' +
        '`cn()` が片方を黙って捨てます**（実測。見た目だけが壊れテストは緑）。',
    ).toEqual([...TOKEN_TEXT_SCALE].sort());
  });

  it('文字サイズと文字色を同時に渡しても、どちらも消えない（登録の挙動そのものを見る）', () => {
    for (const size of TOKEN_TEXT_SCALE) {
      const merged = cn(`text-${size}`, 'text-fg');
      expect(merged, `text-${size} が文字色として扱われています`).toContain(`text-${size}`);
      expect(merged).toContain('text-fg');
    }
    // 同じ群（文字サイズ同士 / radius 同士 / 背景色同士）は後勝ちで 1 つに畳まれる。
    expect(cn('text-cell', 'text-body')).toBe('text-body');
    expect(cn('rounded-sm', 'rounded-md')).toBe('rounded-md');
    expect(cn('bg-bg-subtle', 'bg-brand')).toBe('bg-brand');
    // 🔴 バリアント付きは別の群として残る（`text-lg md:text-body` = iOS のズーム対策が消えない）。
    expect(cn('text-lg md:text-body')).toBe('text-lg md:text-body');
    // ✅ 2026-10-02: **アイコンの 2 段**（`ICON_SIZE_CLASSES`）が後勝ちで畳まれること。
    //    🔴 `Icon` は基底（`size-4 shrink-0`）に `size` を重ねるので、畳まれないと
    //    **16px と 20px の 2 つのクラスが同時に載り、どちらが効くかが生成 CSS の順序に委ねられる**。
    expect(cn('size-4', 'size-5')).toBe('size-5');
    expect(cn('size-4 shrink-0', 'size-5')).toBe('shrink-0 size-5');
    // ✅ 濃色の面の語が白地の語を上書きできること（`SIDEBAR_TOGGLE_CLASSES` が依存している）。
    expect(cn('text-fg', 'text-sidebar-fg')).toBe('text-sidebar-fg');
    expect(cn('hover:bg-bg-subtle', 'hover:bg-sidebar-hover-bg')).toBe('hover:bg-sidebar-hover-bg');
  });
});

describe('🔴 §7.10 の selected は 1 箇所で定義されている', () => {
  it('`SELECTED_ROW_CLASSES` は `SELECTED_CLASSES` に `data-[state=selected]:` を付けたものである', () => {
    // 🔴 実装側で導出してはならない（Tailwind はソースの**文字列**を走査するため、組み立てた
    //    クラス名は CSS が生成されない）。**literal で書いたうえで、一致をここで検査する。**
    const expected = SELECTED_CLASSES.split(' ')
      .map((utility) => `data-[state=selected]:${utility}`)
      .join(' ');
    expect(
      SELECTED_ROW_CLASSES,
      '行選択の見た目が §7.10 の selected（背景 `--color-row-selected-bg` + 文字 `--color-brand` + ' +
        '左端 2px）から外れています。hover と selected を同じ見た目にしないでください' +
        '（選択は maintained、hover は transient）。',
    ).toBe(expected);
  });
});

// ============================================================================
// コントラスト比（`docs/05` §17.7.1 (e) / `docs/04` §7.9 の 🔴）
// ============================================================================

/**
 * `@theme` の semantic トークンを **Tailwind 既定パレットまで解決**して CSS の色文字列にする。
 *
 * 🔴 **パレットの値をテストに写さない**（`docs/05` §17.7.1 (e)）—— 写すと Tailwind の更新で
 *    静かに嘘になる。`node_modules/tailwindcss/theme.css` を読んで解決する。
 */
const paletteCss = readFileSync(
  path.join(repoRoot, 'apps', 'web', 'node_modules', 'tailwindcss', 'theme.css'),
  'utf8',
);
const palette = new Map<string, string>(
  [...paletteCss.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
    match[1] ?? '',
    (match[2] ?? '').trim(),
  ]),
);

/**
 * Tailwind 既定テーマの**全トークン**（色に限らない）。✅ 2026-10-02 に shadow のミラーで要った。
 * 🔴 **値をテストに写さない**という (e) の作法をそのまま shadow にも当てる —— 写すと
 *    Tailwind の更新で静かに嘘になる。
 */
const tailwindTheme = new Map<string, string>(
  [...paletteCss.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
    match[1] ?? '',
    (match[2] ?? '').trim(),
  ]),
);

function resolveColor(token: string): string | null {
  let value: string | undefined = declared.get(token) ?? palette.get(token);
  for (let depth = 0; depth < 5; depth += 1) {
    if (value === undefined) return null;
    const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value.trim());
    if (reference === null) return value.trim();
    const next = reference[1] ?? '';
    value = declared.get(next) ?? palette.get(next);
  }
  return null;
}

/**
 * 🔴 **検査する組は「§7.9 / §7.10 が実際に割り当てている前景 × 背景」である。**
 *
 * - 無彩色の本文（`--color-fg`）は**どの面にも載る**（どれも 15:1 以上で余裕がある）。
 * - 補助（`--color-fg-muted`）が載る面は **`--color-bg` と `--color-bg-subtle` の 2 つ**である
 *   （§7.3 の「補助テキスト」= 列ヘッダ / 注記 / 単位。いずれも本文と同じ面に置かれる）。
 *   ⚠️ **`--color-bg-inset` は §7.10 の disabled の面**であり、そこに載る文字は
 *   `--color-fg-placeholder`（下の唯一の除外）である。**muted を inset や系統の面に載せる組は
 *   設計が作らない**（実測 4.26〜4.47:1 で 4.5 を割る）。🔴 **作りたくなったら、この検査を
 *   緩めるのではなく §7.9 の階調（`--color-fg-muted`）の改訂を提起すること**（人間の判断。
 *   `CLAUDE.md` §8.6）。
 * - 系統色（brand / danger / warning / success / info）は**自分の面**と**無彩色の面**に載る
 *   （`Alert` / `Badge` / `EnvironmentBanner` が現にその組で描く）。
 * - `--color-brand-fg` は **primary ボタンの面**（`--color-brand` / `--color-brand-hover`）に載る。
 *
 * 🔴 **除外は「`--color-fg-placeholder` を前景に持つ組」の 1 条件だけ**（§7.10。disabled と
 *    placeholder は**意図して約 2:1 に落としている** —— 4.5:1 まで上げると有効な要素と区別が
 *    つかず、8 状態の弁別そのものが壊れる。WCAG 1.4.3 も無効な UI 部品を対象外とする）。
 *    **画面ごとの除外リストを作らない。**
 */
const NEUTRAL_SURFACES = [
  '--color-bg',
  // ✅ 2026-10-02: カード・パネルの地（値は `--color-bg` と同じ白だが、**役割として検査する**）。
  '--color-surface',
  '--color-bg-subtle',
  '--color-bg-inset',
  '--color-neutral-bg',
];
const SYSTEM_TONES = ['brand', 'danger', 'warning', 'success', 'info'];

const CONTRAST_PAIRS: ReadonlyArray<readonly [foreground: string, background: string]> = [
  ...NEUTRAL_SURFACES.map((surface) => ['--color-fg', surface] as const),
  ...SYSTEM_TONES.map((tone) => ['--color-fg', `--color-${tone}-bg`] as const),
  ['--color-fg-muted', '--color-bg'] as const,
  ['--color-fg-muted', '--color-bg-subtle'] as const,
  ...SYSTEM_TONES.flatMap((tone) => [
    [`--color-${tone}`, `--color-${tone}-bg`] as const,
    ...NEUTRAL_SURFACES.map((surface) => [`--color-${tone}`, surface] as const),
  ]),
  ['--color-brand-fg', '--color-brand'] as const,
  ['--color-brand-fg', '--color-brand-hover'] as const,
];

describe('🔴 semantic の文字色 × 背景色が 4.5:1 以上（docs/05 §17.7.1 (e)）', () => {
  it('変換が正しい（既知の 3 値での対照）', () => {
    // 🔴 変換を自前で書いた以上、**既知の値で検算する**（係数の写し間違いは静かに通る）。
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // oklch の白（L=1 / C=0）は hex の白と同じ輝度に解ける。
    expect(relativeLuminance('oklch(100% 0 0)') ?? 0).toBeCloseTo(1, 3);
    // 解けない値は `null`（黙って 0 として扱わない）。
    expect(relativeLuminance('rebeccapurple')).toBeNull();
  });

  it('`@theme` の値が Tailwind 既定パレットまで解決できる（写していないことの対照）', () => {
    expect(palette.size).toBeGreaterThan(100);
    expect(resolveColor('--color-warning')).toBe(palette.get('--color-amber-800'));
    expect(resolveColor('--color-bg')).toBe(palette.get('--color-white'));
  });

  it('割り当てられている前景 × 背景の組がすべて 4.5:1 以上である', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(30);
    const failures = CONTRAST_PAIRS.flatMap(([foreground, background]) => {
      const ratio = contrastRatio(resolveColor(foreground) ?? '', resolveColor(background) ?? '');
      if (ratio === null) return [`${foreground} on ${background}: 色を解決できません`];
      return ratio >= 4.5 ? [] : [`${foreground} on ${background}: ${ratio.toFixed(2)}:1`];
    });
    expect(
      failures,
      '🔴 semantic の組み合わせが 4.5:1 を割っています（`docs/04` §7.9）。**注意色は最も多く出る色' +
        'であり、ここが読めないと運用が止まります。** 🔴 **この検査を緩めるのではなく、§7.9 の' +
        '階調を見直してください**（階調の変更は `docs/04` の改訂 = 人間の判断）。',
    ).toEqual([]);
  });

  // ==========================================================================
  // ✅ 濃色サイドバー（`docs/04` §7.9 改訂 23 / `U-25` / 申し送り 22 ⑨(k)）
  // ==========================================================================
  // 🔴 `U-25` の要求は **ラベル 4.5:1 以上 / 区切り線・アイコンのみの要素 3:1 以上**である。
  // 🔴 **(e) の除外条件（`--color-fg-placeholder` を前景に持つ組）は 1 つも広げていない。**
  it('🔴 濃色サイドバーの「読む要素」が 4.5:1 以上である（ラベル / 現在地の文字）', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['--color-sidebar-fg', '--color-sidebar-bg'],
      ['--color-sidebar-fg', '--color-sidebar-hover-bg'],
      ['--color-sidebar-selected-fg', '--color-sidebar-selected-bg'],
    ];
    const failures = pairs.flatMap(([foreground, background]) => {
      const ratio = contrastRatio(resolveColor(foreground) ?? '', resolveColor(background) ?? '');
      if (ratio === null) return [`${foreground} on ${background}: 色を解決できません`];
      return ratio >= 4.5 ? [] : [`${foreground} on ${background}: ${ratio.toFixed(2)}:1`];
    });
    expect(
      failures,
      '🔴 `U-25`: **項目ラベルは 4.5:1 以上**です。🔴 この検査を緩めるのではなく、`docs/04` §7.9 の' +
        '階調（`--sidebar-fg` / `--sidebar-bg`）を見直してください（階調の変更は人間の判断）。' +
        '🔴 **hover の面の上でも読めること**を併せて見ます（hover で文字色を変えないため。§7.10）。',
    ).toEqual([]);
  });

  it('🔴 濃色サイドバーの「走査しない要素」が 3:1 以上である（群名 / 注記 / 期限の点）', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['--color-sidebar-fg-muted', '--color-sidebar-bg'],
      // 🔴 期限の点（`SIDEBAR_DOT_CLASSES`）。`--color-warning`（`amber-800`）は濃色の上で 3:1 を
      //    割るため、注意系統の**面の階調**（`--color-warning-bg`）を使っている。その妥当性を固定する。
      ['--color-warning-bg', '--color-sidebar-bg'],
      // 現在地の左端 2px のバー（ブランド藍。§7.4 の割り当てを変えないことの裏付け）。
      ['--color-sidebar-selected-bar', '--color-sidebar-bg'],
    ];
    const failures = pairs.flatMap(([foreground, background]) => {
      const ratio = contrastRatio(resolveColor(foreground) ?? '', resolveColor(background) ?? '');
      if (ratio === null) return [`${foreground} on ${background}: 色を解決できません`];
      return ratio >= 3 ? [] : [`${foreground} on ${background}: ${ratio.toFixed(2)}:1`];
    });
    expect(
      failures,
      '🔴 `U-25`: **区切り線・アイコンのみの要素は 3:1 以上**です。' +
        '🔴 3:1 を満たせない色は「それ単独で情報を伝える要素」に使わないでください' +
        '（`--color-sidebar-border` が実際にその扱いです。`tailwind.css` の 🔴）。',
    ).toEqual([]);
  });

  it('🔴 `--color-sidebar-border` は 3:1 を満たさない（だから装飾にしか使っていない）という事実を固定する', () => {
    // 🔴 「満たしていないことを知らずに情報を載せる」ことを防ぐための**対照**である。
    //    値を上げたくなったら `docs/04` §7.9 の改訂（人間の判断）を経ること。
    const ratio = contrastRatio(
      resolveColor('--color-sidebar-border') ?? '',
      resolveColor('--color-sidebar-bg') ?? '',
    );
    expect(ratio).not.toBeNull();
    expect(ratio ?? 0).toBeLessThan(3);
  });

  it('🔴 除外した組（`--color-fg-placeholder` を前景に持つ）が意図どおり 4.5:1 を割っている', () => {
    // 🔴 「除外した組は実は通っていた」（＝ 除外が不要だった）ことを見分けるための対照である。
    //    §7.10 は disabled を**意図して約 2:1 に落としている**（有効な要素と区別するため）。
    const ratio = contrastRatio(
      resolveColor('--color-fg-placeholder') ?? '',
      resolveColor('--color-bg-inset') ?? '',
    );
    expect(ratio).not.toBeNull();
    expect(ratio ?? 0).toBeLessThan(4.5);
  });
});
