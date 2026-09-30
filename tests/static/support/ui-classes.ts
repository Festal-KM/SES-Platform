// tests/static/support/ui-classes.ts
// 🔴 **Tailwind のクラス名を「ソースから拾う」部分と「何が違反か」の定義を 1 箇所に集める**
//    （`docs/05` §17.4 の「同じ検証を 2 箇所に書かない」）。
//
// ============================================================================
// なぜ support に切り出すか
// ============================================================================
// `docs/05` §17.7.1 の (a)(c)(f)(g)(j) は **同じ走査（TSX のリテラルからクラス名を拾う）に対して
// 違う許否を当てる**検査である。走査と判定を各テストに写すと、次の 2 つが必ず起きる。
//
//   ① 片方だけ直る —— 例えば「テンプレートの各断片も拾う」という改善を (a) にだけ入れると、
//      (f) は同じ穴を残したまま緑を保つ。**穴の場所が検査ごとに違う**状態は、「この検査は何を
//      保証しているのか」を誰も言えなくなる終わり方をする。
//   ② 誤検知の直し方が分岐する —— 正規表現でファイル全体を割る実装は**コメント中の説明**まで
//      拾う（本リポジトリのプリミティブは upstream との差分を表で残している）。その回避を
//      検査ごとに書くと、いずれ「コメントを消す」方向に倒れる。
//
// 🔴 **`T-22-01` が置いた `tests/static/design-tokens.test.ts`（`packages/ui` 側）と
//    `T-22-02` が置く (a)(c)(f)(g)(j)(k)（`apps/web` 側）は、この 1 ファイルの検出器を共有する。**
//    **どの範囲を見るか**はそれぞれのテストが持ち、**何が違反か**はここ 1 箇所である。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { TOKEN_TEXT_SCALE } from '../../../packages/ui/src/lib/cn.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `tests/static/support` → リポジトリルート。 */
export const repoRoot = path.resolve(here, '..', '..', '..');

const SKIPPED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '.git',
  '__fixtures__',
]);

export function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * `root` 以下の実装ソースを集める。`*.test.ts(x)` / `*.render.test.tsx` / `__fixtures__` は除く
 * （テストは「参照する側」であり、規約の対象は実装側だけである）。
 */
export function collectSourceFiles(root: string, extensions: readonly string[] = ['.tsx']): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return SKIPPED_DIR_NAMES.has(entry.name) ? [] : collectSourceFiles(absolute, extensions);
      }
      if (!entry.isFile()) return [];
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
      return extensions.some((extension) => entry.name.endsWith(extension)) ? [absolute] : [];
    })
    .sort();
}

/** クラス名候補 1 つと、それが書かれていた行。 */
export type ClassToken = { readonly token: string; readonly line: number };

/**
 * ソース中の**文字列リテラル**（`'…'` / テンプレートの静的部分）を空白で割ってクラス名候補にする。
 *
 * 🔴 **ファイル全体を正規表現で割らない**（`tailwind-breakpoints.test.ts` と同じ理由）——
 *    コメントに書いた説明まで拾ってしまい、**規律を書き残した瞬間に落ちる検査**になる。
 *    誤検知する検査は、いずれ緩められて意味を失う。
 * ⚠️ 行番号は**そのリテラル断片の開始行**である。ラチェットのスナップショットは「違反の件数」を
 *    固定するためのものであり、行の同一性を追跡するものではないので、この粗さで足りる。
 */
export function classTokensOf(text: string, fileName = 'source.tsx'): ClassToken[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tokens: ClassToken[] = [];
  const push = (node: ts.Node, literal: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    for (const candidate of literal.split(/\s+/)) {
      if (candidate !== '') tokens.push({ token: candidate, line });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      push(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      push(node, node.head.text);
      for (const span of node.templateSpans) push(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return tokens;
}

/** ユーティリティ本体（バリアント接頭辞を落とした部分）。`hover:bg-slate-50` → `bg-slate-50`。 */
export function utilityOf(token: string): string {
  let depth = 0;
  let last = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) last = index + 1;
  }
  return token.slice(last);
}

/** バリアント接頭辞の列（`hover:md:bg-x` → `['hover','md']`）。 */
export function variantsOf(token: string): string[] {
  const utility = utilityOf(token);
  const head = token.slice(0, token.length - utility.length);
  return head === '' ? [] : head.slice(0, -1).split(':');
}

// ============================================================================
// (a) 色 — primitive 層の直接参照と任意値
// ============================================================================

export const PALETTE_NAMES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const;

/** 色を取るユーティリティの接頭辞（`docs/05` §17.7.1 (a) の列挙）。 */
const COLOR_UTILITY_PREFIX =
  '(?:text|bg|border|border-[xytrbl]{1,2}|ring|ring-offset|accent|caret|decoration|divide|fill|stroke|outline|placeholder|from|via|to|shadow)';

/** ① primitive 層の直接参照（`text-slate-700` / `bg-amber-50` / `ring-slate-400` …）。 */
export const RAW_COLOR = new RegExp(
  `^${COLOR_UTILITY_PREFIX}-(?:${PALETTE_NAMES.join('|')})-\\d{1,3}(?:/\\d{1,3})?$`,
);

/**
 * ② 無彩色の極（`bg-white` / `text-black`）。
 * 🔴 **`transparent` / `current` / `inherit` は対象外**（`docs/05` §17.7.1 (a)）——
 *    あれらは「色の選択」ではなく構造（下の層を見せる / 継承する）の表明である。
 */
export const RAW_EXTREME_COLOR = new RegExp(`^${COLOR_UTILITY_PREFIX}-(?:white|black)(?:/\\d{1,3})?$`);

/**
 * ③ 任意値の色（`bg-[#fff]` / `text-[rgb(…)]` / `text-[var(--color-…)]`）。
 * 🔴 **`var(--color-…)` も違反である**（`docs/05` §17.7.1 (a)）—— トークンを参照していても、
 *    ユーティリティを経由しない任意値は `cn()` の衝突解決の外に出るため、後から重ねた semantic
 *    クラスと**どちらが勝つか分からない**（`docs/05` §2.3.3 の規律 2 と同じ壊れ方）。
 */
export const ARBITRARY_COLOR = new RegExp(
  `^${COLOR_UTILITY_PREFIX}-\\[(?:#|rgb|hsl|oklch|color-mix|var\\(--color-)`,
);

/** 違反している色ユーティリティなら true。 */
export function isRawColorClass(token: string): boolean {
  const utility = utilityOf(token);
  return RAW_COLOR.test(utility) || RAW_EXTREME_COLOR.test(utility) || ARBITRARY_COLOR.test(utility);
}

// ============================================================================
// (f) spacing — §7.9 の 7 段
// ============================================================================

export const SPACING_UTILITY =
  /^(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-(-?(?:\d+(?:\.\d+)?|\[[^\]]+\]|auto|px))$/;

/** §7.9 の 7 段（4 / 8 / 12 / 16 / 24 / 32 / 48px）+ 「段ではなく無し」の 3 語。 */
export const ALLOWED_SPACING = new Set(['0', '1', '2', '3', '4', '6', '8', '12', 'auto', 'px']);

/** 違反している spacing ユーティリティなら、その値を返す。 */
export function offScaleSpacingValue(token: string): string | null {
  const match = SPACING_UTILITY.exec(utilityOf(token));
  if (match === null) return null;
  const value = match[1] as string;
  return ALLOWED_SPACING.has(value) ? null : value;
}

/**
 * 🔴 **spacing の恒久例外（リポジトリ全体で 1 件のみ）。** `AppShell` のボトムタブの逃がし。
 *
 * - `component`: 部品の**ファイル名**で判定する —— 例外は「その部品の責務」に付いており、
 *   置き場所に付いていない。✅ **`T-22-05` で `AppShell` が
 *   `packages/ui/src/components/app-shell.tsx` へ移った**（ディレクトリで縛っていたら移動で
 *   例外が消えていた。この定数の設計はその移動を予期して書かれていた）。
 * - 🔴 **増やさない。** 2 件目が必要になったと思ったら、それは余白の段の問題である。
 *
 * 🔴 **`support` に置くのは、`apps/web` 側（`ui-spacing-scale.test.ts`）と `packages/ui` 側
 *    （`design-tokens.test.ts`）の両方が同じ 1 件を指すためである** —— 2 箇所に書くと、
 *    片方だけが例外を増やせる状態になる（`docs/05` §17.4「同じ検証を 2 箇所に書かない」）。
 */
export const PERMANENT_SPACING_EXCEPTION = {
  component: 'app-shell.tsx',
  utility: 'pb-24',
  reason:
    '🔴 `fixed` なボトムタブ（モバイル）の高さ分の逃がしであり、余白の段ではない。' +
    'これを段に寄せると最後の行がタブの下に隠れる（docs/04 §3.1 / SP-22 §4.1 の恒久例外 1 件）',
} as const;

/** その語がその位置で恒久例外に当たるか（`absolute` はファイルの絶対パス）。 */
export function isPermanentSpacingException(absolute: string, token: string): boolean {
  return (
    token === PERMANENT_SPACING_EXCEPTION.utility &&
    path.basename(absolute) === PERMANENT_SPACING_EXCEPTION.component
  );
}

// ============================================================================
// (g) 文字サイズ — §7.9 の 6 トークン
// ============================================================================

/**
 * §7.9 の 6 トークン（`docs/04` §7.9 / `docs/05` §2.3.2）。
 * 🔴 **`packages/ui` の `TOKEN_TEXT_SCALE` から導く**（`cn()` の `extendTailwindMerge` の登録名と
 *    同じ 1 箇所）。ここに写すと、`@theme` / `cn()` / 検査の 3 者のうち検査だけが古くなる
 *    （3 者が一致することは `design-tokens.test.ts` のミラーテスト = `docs/05` §17.7.1 (h) が見る）。
 */
export const ALLOWED_TEXT_SIZES = new Set<string>(TOKEN_TEXT_SCALE);

/**
 * 🔴 **任意値は「長さに見えるもの」だけを文字サイズとして扱う。**
 *    `text-[…]` は Tailwind では文字サイズと文字色の両方に使われる形であり、
 *    `text-[var(--color-fg)]` / `text-[#111827]` は **(a) の任意値の色**が拾う。
 *    ここで両方拾うと同じ 1 語が 2 つの検査で数えられ、ラチェットの行数が二重に立つ。
 */
const ARBITRARY_LENGTH = /^\[-?[0-9.]+(?:px|rem|em|%|ch|ex|pt|vw|vh)\]$/;

const TEXT_SIZE_UTILITY = /^text-(xs|sm|base|lg|xl|[2-9]xl|title|body|cell|micro|\[[^\]]+\])$/;

/** 違反している文字サイズユーティリティなら、その値を返す。 */
export function offScaleTextSizeValue(token: string): string | null {
  const match = TEXT_SIZE_UTILITY.exec(utilityOf(token));
  if (match === null) return null;
  const value = match[1] as string;
  if (value.startsWith('[')) return ARBITRARY_LENGTH.test(value) ? value : null;
  return ALLOWED_TEXT_SIZES.has(value) ? null : value;
}

// ============================================================================
// radius — §7.9 の 2 段（`packages/ui` 側でのみ使う）
// ============================================================================

export const RADIUS_UTILITY = /^rounded(?:-[xytrbleks]{1,2})?(?:-(.+))?$/;
/** §7.9 の 2 段（`docs/05` §2.3.2 の名前）+ 打ち消しの `none`。 */
export const ALLOWED_RADIUS = new Set<string>(['sm', 'md', 'none']);

// ============================================================================
// (j) 8 状態 — 画面側にバリアントを書かない
// ============================================================================

/**
 * 🔴 §7.10 の 8 状態は**プリミティブが持つ**。画面側にこのバリアントが現れたら、その画面だけ
 *    見え方が違う状態が生まれる（`docs/04` §7.10 / `docs/05` §17.7.1 (j)）。
 */
export const STATE_VARIANTS = [
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
  'disabled',
] as const;

/** 画面側に書いてはならない状態バリアントなら、その名前を返す。 */
export function stateVariantOf(token: string): string | null {
  for (const variant of variantsOf(token)) {
    if ((STATE_VARIANTS as readonly string[]).includes(variant)) return variant;
    // `data-[state=selected]:` も §7.10 の 8 状態の 1 つ（selected）であり、部品が出す。
    if (/^data-\[state=/.test(variant)) return variant;
    // 親・兄弟の状態に連動させる形も「画面が状態の見え方を決めている」ことに変わりはない。
    if (/^(?:group|peer)-(?:hover|focus|focus-visible|active|disabled)$/.test(variant)) return variant;
  }
  return null;
}

// ============================================================================
// (c) 幅 — 画面ファイルに幅の指定が無い
// ============================================================================

/** `max-w-*`（`docs/05` §17.7.1 (c) ①）。 */
export const MAX_WIDTH_UTILITY = /^max-w-/;

/** 違反している幅ユーティリティなら、その値を返す。 */
export function maxWidthValueOf(token: string): string | null {
  const utility = utilityOf(token);
  return MAX_WIDTH_UTILITY.test(utility) ? utility : null;
}

export function readSource(absolute: string): string {
  return readFileSync(absolute, 'utf8');
}
