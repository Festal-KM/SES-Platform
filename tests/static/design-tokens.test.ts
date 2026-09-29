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
  RADIUS_UTILITY,
  classTokensOf,
  collectSourceFiles,
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
];

/** 文字サイズ 6 トークン（§7.3 の 6 種に 1 対 1）。`[トークン, px, 行間]`。 */
const TEXT_TOKENS: ReadonlyArray<readonly [token: string, px: number, lineHeight: string]> = [
  ['--text-title', 20, '1.4'],
  ['--text-lg', 16, '1.4'],
  ['--text-body', 14, '1.6'],
  ['--text-cell', 13, '1.5'],
  ['--text-xs', 12, '1.5'],
  ['--text-micro', 11, '1.4'],
];

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
 * 🔴 **`@theme` に宣言してはならないもの**（`docs/05` §2.3.2）。
 * - spacing … §7.9 の 7 段は Tailwind 既定スケールの `1` `2` `3` `4` `6` `8` `12` と 1 対 1 で
 *   一致する。宣言すると**同じ値が 2 つの名前を持つ**。
 * - component 層 … `@theme` に置くと**画面からも書けてしまい**「部品ごと」の縛りが消える
 *   （置き場所は `packages/ui` のクラス定数）。
 * - transition … 既定の `duration-150` / `ease-out` で足りる（トークンを起こさない）。
 * - shadow … overlay 部品（Phase 3b）の中で既定のユーティリティを使う。
 * - `--text-sm` / `--text-base` / `--text-2xl` … **宣言すると使ってよい名前に見える**（§17.7 (g)③）。
 */
const FORBIDDEN_TOKEN_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['spacing（Tailwind 既定スケールを使う）', /^--(?:space|spacing)-/],
  ['spacing の倍率（既定のまま）', /^--spacing$/],
  ['transition（既定の duration-150 / ease-out を使う）', /^--default-transition-/],
  ['shadow（overlay 部品の中で既定を使う）', /^--shadow-/],
  ['文字サイズの 6 トークン以外', /^--text-(?:sm|base|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/],
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

  it('🔴 `@theme` の `--color-*` は semantic の 27 個「だけ」である（component 層を置かない）', () => {
    const declaredColors = [...declared.keys()].filter((token) => /^--color-[a-z0-9-]+$/.test(token));
    expect(
      [...declaredColors].sort(),
      '🔴 component 層（`--focus-ring` / `--row-hover-bg` / `--table-header-bg` / `--badge-*` / ' +
        '`--sidebar-*`）を `@theme` に置かないでください（`docs/05` §2.3.2）。**`@theme` に置くと' +
        '画面からも書けてしまい「部品ごと」という縛りが消えます。** 置き場所は `packages/ui` の' +
        'クラス定数（`lib/state-classes.ts` / `lib/control-classes.ts` / `lib/link-classes.ts`）です。',
    ).toEqual([...SEMANTIC_COLORS.map(([token]) => token)].sort());
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

  it('文字サイズが 6 トークンで、実寸と行間が §7.3 の表と一致する', () => {
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
  label: toRepoRelative(absolute),
  tokens: classTokensOf(readSource(absolute), absolute).map(({ token }) => token),
}));

/**
 * 🔴 `packages/ui` で許す影は **`shadow-xs`（入力欄の輪郭）1 語だけ**で、置き場所も
 *    `lib/control-classes.ts` 1 ファイルだけである。
 *
 * ⚠️ **ここは `docs/04` §7.9 と `docs/05` §2.3.2 で読みが分かれた唯一の箇所である。**
 *    §7.9 は「shadow は overlay にのみ使う」、`docs/05` §2.3.2 は「既存 `Input` / `Select` /
 *    `Textarea` の `shadow-xs` は入力欄の輪郭であり**据え置く**」と書いている。実装は
 *    **実装設計（`docs/05`）に従い据え置き**、その範囲をここで 1 ファイル 1 語に固定した
 *    （`Card` の `shadow-sm` は「浮かせるための影」なので撤去した）。
 *    🔴 **食い違いの解消は文書側の判断**（`CLAUDE.md` §8.6 / §8.7）。完了報告で提起する。
 */
const SHADOW_ALLOWED_FILE = 'packages/ui/src/lib/control-classes.ts';
const SHADOW_ALLOWED_UTILITY = 'shadow-xs';

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
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 余白は 4 / 8 / 12 / 16 / 24 / 32 / 48px の 7 段です（`docs/04` §7.9）。' +
        '`p-5` / `gap-7` / `mt-9` / `gap-1.5` を書かないでください（Tailwind の既定スケールには' +
        '存在しますが、本プロダクトでは使いません。現状 48 種類からの収束です）。',
    ).toEqual([]);
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
        .map(({ token }) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 radius は `rounded-control`（4px = 入力欄 / ボタン / バッジ / セル）と ' +
        '`rounded-panel`（6px = パネル / Dialog / Drawer / Card）の 2 段だけです（`docs/04` §7.9）。' +
        '12px 以上の大きな角丸を使わないでください（密度の高い一覧で行の境界が曖昧になります）。' +
        '`rounded-full` はアバターとカウンタのみです。',
    ).toEqual([]);
  });

  it('🔴 影は「入力欄の輪郭」1 語だけで、他のプリミティブは 1 件も持たない', () => {
    const offenders = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => /^shadow(-|$)/.test(utilityOf(token)))
        .filter(
          (token) =>
            !(file.label === SHADOW_ALLOWED_FILE && utilityOf(token) === SHADOW_ALLOWED_UTILITY),
        )
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      offenders,
      '🔴 影は overlay（Dialog / Drawer / DropdownMenu / Tooltip / Toast。Phase 3b）の中だけです' +
        '（`docs/04` §7.9）。**階層は border と background の差で表す** —— カードを浮かせる影は' +
        '「どれが操作可能か」の手がかりを薄めます。唯一の例外は入力欄の輪郭' +
        `（${SHADOW_ALLOWED_FILE} の ${SHADOW_ALLOWED_UTILITY}。\`docs/05\` §2.3.2 の名指しの据え置き）です。`,
    ).toEqual([]);
    // 🔴 例外が「実在するから許している」ことを対照で示す（許可だけが残るのを防ぐ）。
    const allowed = uiFiles.find((file) => file.label === SHADOW_ALLOWED_FILE);
    expect(allowed?.tokens.some((token) => utilityOf(token) === SHADOW_ALLOWED_UTILITY)).toBe(true);
  });

  it('🔴 `packages/ui` に出現する `shadow-` は control-classes.ts の `shadow-xs` の 1 箇所だけ（§7.9 / §17.7 (h)）', () => {
    // 🔴 Phase 3b（T-22-03）で overlay 部品（Dialog / Drawer / DropdownMenu / Tooltip / Toast）が入るとき、
    //    この検査の許可対象を広げる必要がある。根拠は「§7.9 が overlay の影を認めているから」であり、
    //    「落ちたから広げる」ではない。広げるのは overlay 部品のファイルに限り、他の要素には広げない。
    const found = uiFiles.flatMap((file) =>
      file.tokens
        .filter((token) => /^shadow(-|$)/.test(utilityOf(token)))
        .map((token) => `${file.label}: ${token}`),
    );
    expect(
      found,
      '🔴 §7.9: 入力欄の輪郭（shadow-xs）は例外として 1 語 1 箇所に限る。新しい要素に影を足していないか確認してください。',
    ).toEqual([`${SHADOW_ALLOWED_FILE}: ${SHADOW_ALLOWED_UTILITY}`]);
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
const NEUTRAL_SURFACES = ['--color-bg', '--color-bg-subtle', '--color-bg-inset', '--color-neutral-bg'];
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
