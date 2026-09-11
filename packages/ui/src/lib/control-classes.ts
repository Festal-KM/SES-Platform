// packages/ui/src/lib/control-classes.ts
// 入力系プリミティブ（`Input` / `Select` / `Textarea`）が共有する基底クラス。
//
// 🔴 3 つに別々の文字列を持たせない。旧 `globals.css` の `.ses-field select` に
//    「入力欄と同じ見え方に揃える（同じ帯に並ぶ条件で、効く条件と効かない条件が見た目で
//    分かれないようにする）」と書かれていたとおり、**3 者がずれること自体が不具合**である。
//
// ============================================================================
// 🔴 upstream（shadcn/ui `new-york-v4`）との 1 語ずつの突き合わせ
// ============================================================================
// 照合日 2026-09-10 / 取得元 `https://ui.shadcn.com/r/styles/new-york-v4/input.json`。
// **`docs/03` §69 が「shadcn/ui は取り込み後のアップデートが手動」をリスクに挙げており、
// T-21-01 で `Button` が `whitespace-nowrap` / `shrink-0` の 2 語を落として実害になった。**
// 同じ取りこぼしを繰り返さないため、落とした語・置き換えた語をすべてここに書く。
//
// upstream `input.tsx` の基底（原文）:
//   h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base
//   shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary
//   selection:text-primary-foreground file:inline-flex file:h-7 file:border-0
//   file:bg-transparent file:text-sm file:font-medium file:text-foreground
//   placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed
//   disabled:opacity-50 md:text-sm dark:bg-input/30
//   focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50
//   aria-invalid:border-destructive aria-invalid:ring-destructive/20
//   dark:aria-invalid:ring-destructive/40
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `w-full` | 同じ | そのまま |
// | 🔴 `min-w-0` | 同じ | **落とさない。** `<input>` は既定 `size=20` 由来の min-content 幅を持ち、`min-width:auto` の flex アイテムとして置くとコンテナを押し広げる。旧 `.ses-filter-form`（`display:flex`）に並ぶため実害が出る。T-21-01 の `shrink-0` と**同じ種類の語**（見た目の好みではなく溢れの前提） |
// | `rounded-md` `px-3` `bg-transparent` `shadow-xs` `transition-[color,box-shadow]` `outline-none` | 同じ | そのまま。`bg-transparent` は旧 `.ses-field input`（背景指定なし）と同じ見え方 |
// | `border` `border-input` | `border` `border-slate-300` | 🔴 **`border-input` は本リポジトリでは何も生成しない。** `apps/web/app/tailwind.css` に `@theme` が無く、Tailwind v4 の既定 theme にも `--color-input` は無い（実測: `theme.css` に `--color-input` / `--color-ring` / `--color-primary` / `--color-muted` / `--color-destructive` / `--color-card` のいずれも 0 件）。**そのまま写すと枠線色が付かない**（v4 の border 既定色は `currentColor`）。既存画面の `border-slate-300`（8 箇所）に合わせる |
// | 🔴 `text-base` + `md:text-sm` | 同じ | **落とさない。** iOS Safari は 16px 未満の入力欄にフォーカスすると自動ズームする。旧 `.ses-field input { font-size: 1rem }` が担っていたのはこれであり、`text-sm` 一本にすると T1 画面（`S-001` / `S-046`）でズームが起きる（`CLAUDE.md` §13.2「モバイルで操作まで完結」）。`md:` は Tailwind の既定接頭辞（§13.3） |
// | `placeholder:text-muted-foreground` | `placeholder:text-slate-400` | テーマ変数が無いため実色に置換 |
// | `disabled:pointer-events-none` `disabled:cursor-not-allowed` | 同じ | そのまま |
// | `disabled:opacity-50` | `disabled:opacity-60` | 既存 `Button`（`disabled:opacity-60`）に合わせる。**同じ画面で 2 種類の無効表現を出さない**ため。数値のみの差 |
// | `focus-visible:border-ring` `focus-visible:ring-[3px]` `focus-visible:ring-ring/50` | `focus-visible:border-slate-400` `focus-visible:ring-2` `focus-visible:ring-slate-400` `focus-visible:ring-offset-2` | テーマ変数が無いため実色に置換し、**リングの形を既存 `Button` と同一にする**（同じ画面で 2 種類のフォーカス表現を出さない） |
// | `aria-invalid:border-destructive` | `aria-invalid:border-red-500` | 同上。フックは残す（`aria-invalid` を立てれば効く） |
// | `aria-invalid:ring-destructive/20` | 取り込まない | 上の 1 語で赤枠は出る。`/20` の不透明度合成はテーマ変数前提であり、実色に置き換えると**リングと枠で 2 系統の赤**が生まれる |
// | `selection:bg-primary` `selection:text-primary-foreground` | 取り込まない | テーマ変数前提。選択色は OS / ブラウザ既定のままにする |
// | `dark:bg-input/30` `dark:aria-invalid:ring-destructive/40` | 取り込まない | 🔴 **ダークモードを持たない。** `tailwind.css` が `color-scheme: light` を宣言しており、`dark:` は 1 つも効かない（死んだ語を増やさない） |
// | `data-slot="input"` | 取り込まない | upstream の `*:data-[slot=…]` セレクタを 1 つも使っていない。使う語を入れるときに属性ごと足す |
// | `h-9` `py-1` `file:*` | ここには置かない | 高さと file 入力は要素ごとに違う（`input.tsx` / `select.tsx` / `textarea.tsx` 側で足す） |

/**
 * `Input` / `Select` / `Textarea` に共通の基底クラス。
 *
 * 🔴 ここに**バリアントで上書きしたい語を置かない**（`cn()` は競合解決をしない。
 *    `lib/cn.ts` の規律 2 を参照）。
 */
export const CONTROL_BASE_CLASSES = [
  'w-full min-w-0 rounded-md border border-slate-300 bg-transparent px-3 shadow-xs',
  'text-base md:text-sm',
  'transition-[color,box-shadow] outline-none',
  'placeholder:text-slate-400',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60',
  'focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
  'aria-invalid:border-red-500',
].join(' ');

/**
 * 1 行の入力（`Input` / `Select`）の寸法。
 *
 * 🔴 upstream は `h-9`（36px）だが、本リポジトリの `Button` は `h-10`（40px）である。
 *    旧 `.ses-filter-form` は入力欄と検索ボタンを 1 本の帯に `align-items: flex-end` で
 *    並べるため、**高さが 4px ずれると帯の底が揃わない。** 高さは `Button` に合わせる。
 */
export const CONTROL_FIELD_SIZE_CLASSES = 'h-10 py-1';
