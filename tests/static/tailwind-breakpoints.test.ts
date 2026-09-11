// tests/static/tailwind-breakpoints.test.ts
// 🔴 **ブレークポイントは Tailwind CSS の既定に従う。独自定義しない。**（`CLAUDE.md` §13.3）
// 🔴 **`@ses/ui` のクラスが本番ビルドで消えない。**（`docs/sprints/SP-21` T-21-01 ②）
//
// この 2 つは「Tailwind の設定が確定していること」の 2 面である（T-21-01「Tailwind の設定確定と
// 移行の安全網」）。どちらも **レビューの目視では守れない** ので機械で検査する。
//
// ============================================================================
// (1) ブレークポイント —— なぜ「独自定義しない」なのか
// ============================================================================
// `CLAUDE.md` §13 は画面を 3 階層（Tier 1 モバイル完結 / Tier 2 モバイル閲覧可 /
// Tier 3 デスクトップ主体）に割り当て、`docs/04` が全画面の Tier を決めている。**Tier は
// 「どの幅で何が起きるか」の共通語であり、画面ごとに独自の幅を持ち込むとこの共通語が壊れる。**
// 「この画面だけ 900px で折り返す」が 20 画面ぶん増えると、モバイル E2E の
// `expectNoHorizontalOverflow` が守っているものが画面ごとにバラバラになり、
// **「どの幅で確認すればよいか」を誰も言えなくなる。**
//
// 検査するのは次の 3 つ（T-21-01 の受け入れ基準 (1)）。
//
//   (1-a) CSS に `--breakpoint-*` の宣言・上書きが無い（v4 は `@theme` でこれを行う）。
//   (1-b) `className` に**任意値の画面幅バリアント**（`min-[900px]:` / `max-[42rem]:`）が無い。
//   (1-c) 使ってよい画面幅の接頭辞は `sm:` / `md:` / `lg:` / `xl:` / `2xl:` だけである。
//         🔴 `max-sm:` 等も許さない —— 既定値を使っていても「上から下へ打ち消す」書き方が混ざると、
//         モバイル優先（`hidden sm:table-cell`）と逆向きの規則が同じ画面に同居する。
//         畳みたい列は**モバイル優先で書き直す**（`docs/04` §S-041 の列の間引きがこれに当たる）。
//
// ⚠️ **手書き `@media` の幅は「既定値と同じ値であること」だけを見る**（1-d）。
//    唯一の手書き `@media`（`globals.css` の `(max-width: 640px)`。`S-041` の列の間引き）は
//    T-21-04 で `hidden sm:table-cell` へ移り、T-21-07 で `globals.css` ごと削除された。
//    **したがって現在この検査の対象は 0 件である。検査は消さない** —— 次に手書き `@media` を
//    足す者が既定から外れた幅を持ち込まないための歯止めであり、対象が 0 件の今こそ外しやすい。
//
// ⚠️ コンテナクエリ（`@container` / `@md:`）は**ブレークポイントではない**（親要素の幅で効く）。
//    §13.3 の射程外なのでここでは検査しない。導入するなら別途方針を決めること。
//
// ============================================================================
// (2) コンテンツ検出 —— なぜ `@source` が要るのか（実測した壊れ方）
// ============================================================================
// Tailwind v4 の自動コンテンツ検出は、①走査の起点が `process.cwd()`（`next build` の実行
// ディレクトリ ＝ `apps/web`）で、②`.gitignore` のパス（`node_modules/` / `dist/`）を除外する。
// `packages/ui/src` はそのどちらにも掛からない場所にあるため、**`@ses/ui` だけが使うクラスは
// 生成 CSS に含まれない。**
//
// 🔴 T-21-01 着手時の実測（`pnpm --filter @ses/web build` の出力 CSS）:
//    `hover:bg-slate-700` / `focus-visible:ring-slate-400` / `disabled:opacity-60` /
//    `bg-transparent` / `h-8` … **いずれも 0 件**。`@source` を足した後は**すべて 1 件**。
//    （`bg-slate-900` だけは足す前から含まれていた。`apps/web` 側が同じクラスを使っていたためで、
//    `@ses/ui` が拾われていた証拠ではない。**1 クラスだけ見て安心しない。**）
//
// 🔴 **これはテストが落ちない壊れ方である。** DOM も testid も文言も正しく、見た目だけが消える。
//    したがって「`@source` の行が在ること」を静的に固定し、消えたら落ちるようにする。
//    ⚠️ ここが守るのは**設定が在ること**までである。**生成 CSS の実測**（T-21-01 の受け入れ
//    基準 ②）は、この検査では代替できない（ビルド成果物はリポジトリに無い）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 走査対象のルート（`apps/*` と `packages/*` の両方。**減らさない**）。 */
const SCAN_ROOTS: readonly string[] = [
  path.join(repoRoot, 'apps'),
  path.join(repoRoot, 'packages'),
];

const SKIPPED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '.git',
  '__fixtures__',
]);

/** Tailwind の既定ブレークポイント（v4）。これ以外の幅を持ち込まない。 */
const DEFAULT_SCREENS = ['sm', 'md', 'lg', 'xl', '2xl'] as const;
/** 既定ブレークポイントの実値（px）。手書き `@media` の幅の照合に使う。 */
const DEFAULT_SCREEN_PX = new Set([640, 768, 1024, 1280, 1536]);

/** 使ってよい画面幅の接頭辞（T-21-01 の受け入れ基準 (1)-③）。 */
const ALLOWED_SCREEN_VARIANTS = new Set<string>(DEFAULT_SCREENS);

/** サイズ名として画面幅バリアントに使われうる名前（既定でないものを含む）。 */
const SCREEN_SIZE_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'];

/** 任意値の画面幅バリアント（`min-[900px]` / `max-[42rem]`）＝ 独自ブレークポイントそのもの。 */
const ARBITRARY_SCREEN_VARIANT = /^(?:min|max)-\[[^\]]*\]$/;
/** 名前付きの打ち消し方向バリアント（`max-sm` / `min-md`）。 */
const NAMED_RANGE_VARIANT = new RegExp(`^(?:min|max)-(?:${SCREEN_SIZE_NAMES.join('|')})$`);

/**
 * 画面幅バリアントか。
 * 🔴 `max-width` のような **CSS プロパティ名**を誤検知しないよう、`min-` / `max-` は
 *    「任意値（`[...]`）」か「既知のサイズ名」が続く場合だけを画面幅バリアントとみなす。
 *    誤検知する検査は、いずれ緩められて意味を失う。
 * ⚠️ コンテナクエリ（`@md:` / `@max-[…]:`）は `@` で始まるためここに掛からない（意図どおり。
 *    ファイル冒頭のとおり §13.3 の射程外）。
 */
function isScreenVariant(variant: string): boolean {
  if (ARBITRARY_SCREEN_VARIANT.test(variant)) return true;
  if (NAMED_RANGE_VARIANT.test(variant)) return true;
  return SCREEN_SIZE_NAMES.includes(variant);
}

type SourceFile = { readonly label: string; readonly text: string };

function collectFiles(root: string, extensions: readonly string[]): SourceFile[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIR_NAMES.has(entry.name)) return [];
      return collectFiles(absolute, extensions);
    }
    if (!entry.isFile()) return [];
    if (!extensions.some((extension) => entry.name.endsWith(extension))) return [];
    return [
      {
        label: path.relative(repoRoot, absolute).split(path.sep).join('/'),
        text: readFileSync(absolute, 'utf8'),
      },
    ];
  });
}

/**
 * 🔴 CSS のコメントを落としてから検査する。落とさないと、**「`--breakpoint-*` を宣言しない」と
 *    注意書きしたコメント自体が違反として検出される**（`apps/web/app/tailwind.css` で実際に起きた）。
 *    規律を書き残せない検査は、書き残しをやめる方向に人を動かす。
 */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const cssFiles = SCAN_ROOTS.flatMap((root) => collectFiles(root, ['.css'])).map((file) => ({
  label: file.label,
  text: stripCssComments(file.text),
}));
const componentFiles = SCAN_ROOTS.flatMap((root) => collectFiles(root, ['.tsx']));

/**
 * ソース中の**文字列リテラル**（`'…'` / `"…"` / テンプレートの静的部分）を空白で割って
 * 候補トークンにする。抽出は TypeScript の AST で行う。
 *
 * 🔴 **ファイル全体を空白で割らない。** `{ sm: … }` のようなオブジェクトキーを画面幅バリアントと
 *    誤検知する。
 * 🔴 **正規表現で文字列を切り出さない。** コメント中の説明（本ファイルの `max-sm:` のような
 *    バッククォート引用）まで拾ってしまい、**コメントを書いた瞬間に落ちる検査**になる。
 *    誤検知する検査は、いずれ緩められて意味を失う。
 */
function classTokens(text: string, fileName = 'source.tsx'): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TSX,
  );
  const literals: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // テンプレートの静的部分（`… ${x} …` の各断片）はクラス名を含みうる。
      literals.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return literals.flatMap((literal) => literal.split(/\s+/).filter(Boolean));
}

/** クラス 1 つからバリアント部分（最後の `:` より前の各セグメント）を取り出す。 */
function variantsOf(token: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of token) {
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    if (char === ':' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  // 末尾（`current`）はユーティリティ本体であってバリアントではない。
  return segments;
}

type Violation = { readonly label: string; readonly detail: string };

/** 走査結果は 1 度だけ作る（`.tsx` の構文解析を検査のたびに繰り返さない）。 */
const componentVariants: readonly {
  readonly label: string;
  readonly token: string;
  readonly variant: string;
}[] = componentFiles.flatMap((file) =>
  classTokens(file.text, file.label).flatMap((token) =>
    variantsOf(token).map((variant) => ({ label: file.label, token, variant })),
  ),
);

function findVariantViolations(predicate: (variant: string) => boolean): Violation[] {
  return componentVariants
    .filter(({ variant }) => predicate(variant))
    .map(({ label, token, variant }) => ({ label, detail: `${token}（${variant}:）` }));
}

describe('🔴 ブレークポイントは Tailwind の既定に従う（CLAUDE.md §13.3 / SP-21 T-21-01 ①）', () => {
  it('走査が空振りしていない（対照）', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
    expect(componentFiles.length).toBeGreaterThanOrEqual(50);
    // 既定の接頭辞は実際に使われている（＝ トークン抽出が機能している）。
    const used = new Set(componentVariants.map(({ variant }) => variant));
    expect([...ALLOWED_SCREEN_VARIANTS].some((variant) => used.has(variant))).toBe(true);
  });

  it('CSS に `--breakpoint-*` の宣言・上書きが無い（v4 の `@theme`）', () => {
    const offenders = cssFiles
      .filter((file) => /--breakpoint-/.test(file.text))
      .map((file) => file.label);
    expect(
      offenders,
      `--breakpoint-* を宣言している CSS があります: ${offenders.join(', ')}\n` +
        '🔴 ブレークポイントを独自定義しないでください（CLAUDE.md §13.3）。' +
        'Tier（docs/04）は既定の幅を共通語にしています。',
    ).toEqual([]);
  });

  it('🔴 任意値の画面幅バリアント（`min-[…]:` / `max-[…]:`）が 1 件も無い', () => {
    const offenders = findVariantViolations((variant) => ARBITRARY_SCREEN_VARIANT.test(variant));
    expect(
      offenders.map((violation) => `${violation.label}: ${violation.detail}`),
      '任意値の画面幅バリアントは独自ブレークポイントそのものです。' +
        '既定の `sm:` / `md:` / `lg:` / `xl:` / `2xl:` に寄せてください。',
    ).toEqual([]);
  });

  it('🔴 画面幅の接頭辞は `sm:` / `md:` / `lg:` / `xl:` / `2xl:` だけである', () => {
    const offenders = findVariantViolations(
      (variant) => isScreenVariant(variant) && !ALLOWED_SCREEN_VARIANTS.has(variant),
    );
    expect(
      offenders.map((violation) => `${violation.label}: ${violation.detail}`),
      '許されていない画面幅バリアントがあります（`max-sm:` / `min-md:` / `xs:` など）。\n' +
        '🔴 モバイル優先で書き直してください（例: `max-sm:hidden` ではなく `hidden sm:table-cell`）。' +
        '打ち消し方向が混ざると、同じ画面の中で規則が 2 つになります。',
    ).toEqual([]);
  });

  it('手書き `@media` の幅が Tailwind の既定値だけを使っている', () => {
    // 🔴 T-21-07 時点で対象は 0 件である（唯一の手書き `@media` だった `globals.css` の
    //    `(max-width: 640px)` は削除済み）。**0 件でもこの検査は残す** —— 次に手書き `@media`
    //    を足す者が既定から外れた幅を持ち込まないための歯止めである（CLAUDE.md §13.3）。
    const offenders = cssFiles.flatMap((file) =>
      [...file.text.matchAll(/\(\s*(?:min|max)-width\s*:\s*([^)]+?)\s*\)/g)]
        .map((match) => match[1] ?? '')
        .filter((raw) => {
          const pixels = /^(\d+(?:\.\d+)?)px$/.exec(raw);
          if (pixels === null) return true;
          return !DEFAULT_SCREEN_PX.has(Number(pixels[1]));
        })
        .map((raw) => `${file.label}: @media (…: ${raw})`),
    );
    expect(
      offenders,
      '既定のブレークポイント以外の幅を手書き @media で持ち込んでいます。' +
        `使ってよい値: ${[...DEFAULT_SCREEN_PX].join(' / ')}px（CLAUDE.md §13.3）。`,
    ).toEqual([]);
  });
});

describe('🔴 Tailwind のコンテンツ検出（SP-21 T-21-01 ②）', () => {
  const entryPath = path.join(repoRoot, 'apps', 'web', 'app', 'tailwind.css');
  const entry = readFileSync(entryPath, 'utf8');

  it('`apps/web/app/tailwind.css` が `packages/ui` のソースを `@source` で明示している', () => {
    const sources = [...entry.matchAll(/@source\s+(['"])(.*?)\1/g)].map((match) => match[2] ?? '');
    const resolved = sources.map((source) =>
      path.resolve(path.dirname(entryPath), source).split(path.sep).join('/'),
    );
    const uiSource = path.join(repoRoot, 'packages', 'ui', 'src').split(path.sep).join('/');
    expect(
      resolved,
      '`@ses/ui` のソースが Tailwind のコンテンツ検出に入っていません。\n' +
        '🔴 v4 の自動検出は `process.cwd()`（= apps/web）を起点にし、`node_modules/` と `dist/` を' +
        '除外するため、pnpm workspace の `packages/ui` は拾われません。' +
        '**`@ses/ui` を使う画面のスタイルが本番ビルドから無言で消えます**（テストは落ちません）。',
    ).toContain(uiSource);
  });

  it('自動検出を `source(none)` で止めていない（`apps/web` 自身が拾われなくなる）', () => {
    expect(/@import\s+['"]tailwindcss['"][^;]*source\(\s*none\s*\)/.test(entry)).toBe(false);
  });

  it('`@source` が指すディレクトリが実在する（陳腐化の検知）', () => {
    const sources = [...entry.matchAll(/@source\s+(['"])(.*?)\1/g)].map((match) => match[2] ?? '');
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const absolute = path.resolve(path.dirname(entryPath), source);
      expect(() => readdirSync(absolute), `@source '${source}' が実在しません`).not.toThrow();
    }
  });
});

describe('検査そのものの検査（fixtures。空振り・誤検知の対照）', () => {
  const fixturesDir = path.join(here, '__fixtures__', 'tailwind-breakpoints');
  const read = (name: string) => readFileSync(path.join(fixturesDir, name), 'utf8');

  it('任意値の画面幅バリアントを検出する', () => {
    const variants = classTokens(read('arbitrary-variant.violation.tsx')).flatMap(variantsOf);
    expect(variants.filter((variant) => ARBITRARY_SCREEN_VARIANT.test(variant))).toEqual([
      'min-[900px]',
      'max-[42rem]',
    ]);
  });

  it('既定以外の画面幅バリアント（`max-sm:` / `xs:`）を検出する', () => {
    const variants = classTokens(read('non-default-variant.violation.tsx')).flatMap(variantsOf);
    expect(
      variants.filter(
        (variant) => isScreenVariant(variant) && !ALLOWED_SCREEN_VARIANTS.has(variant),
      ),
    ).toEqual(['max-sm', 'xs', 'min-md']);
  });

  it('既定の画面幅バリアントと、画面幅でないバリアントを誤検知しない', () => {
    const variants = classTokens(read('clean.ok.tsx')).flatMap(variantsOf);
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.filter((variant) => ARBITRARY_SCREEN_VARIANT.test(variant))).toEqual([]);
    expect(
      variants.filter(
        (variant) => isScreenVariant(variant) && !ALLOWED_SCREEN_VARIANTS.has(variant),
      ),
    ).toEqual([]);
  });

  it('`--breakpoint-*` の上書きを検出する', () => {
    expect(/--breakpoint-/.test(read('custom-breakpoint.violation.css'))).toBe(true);
  });
});
