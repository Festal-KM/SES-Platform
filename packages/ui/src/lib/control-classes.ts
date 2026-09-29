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
// ⚠️ **「ここ」の列は T-22-01（2026-09-29 の `docs/04` 改訂 16 = デザイントークン）で更新した。**
//    実色（`border-slate-300` 等）を semantic トークン（`border-border-strong` 等）へ置き換えた
//    ぶんを書き換えてあり、**判断の記録は 1 行も消していない**（置き換えの理由は「テーマ変数が
//    本リポジトリに無いから実色に置いた」→「`docs/04` §7.9 のトークンが入ったのでそれを指す」に
//    変わっただけで、**upstream の語をどう扱ったかという情報は残す必要がある**）。
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
// | `px-3` `bg-transparent` `outline-none` | 同じ | そのまま。`bg-transparent` は旧 `.ses-field input`（背景指定なし）と同じ見え方。`outline-none` は `FOCUS_RING_CLASSES` がリングと**対**で持つ（`docs/04` §7.10「`outline: none` を単独で書かない」） |
// | `rounded-md` | **`rounded-sm`** | T-22-01。`docs/04` §7.9 の radius は **2 段だけ**（入力欄 / ボタン / バッジ / セル = 4px、パネル / Dialog / Card = 6px）。`rounded-md`（6px）は後者の段であり、入力欄は 4px に寄せる |
// | `border` `border-input` | `border` **`border-border-strong`** | 🔴 upstream の `border-input` は本リポジトリでは**何も生成しない**（Tailwind v4 の既定 theme に `--color-input` は無い。そのまま写すと v4 の border 既定色 `currentColor` で文字色の枠が出る）。T-21-02 は既存画面に合わせて `border-slate-300` に置いたが、T-22-01 で **§7.9 の「区切り / 入力欄の輪郭」= `--color-border-strong`（= `slate-300`。値は同一）** を指す形にした |
// | 🔴 `text-base` + `md:text-sm` | **`text-lg md:text-body`**（実寸 16px → 14px。**同じ**） | 🔴 **落とさない。** iOS Safari は 16px 未満の入力欄にフォーカスすると自動ズームする。旧 `.ses-field input { font-size: 1rem }` が担っていたのはこれであり、14px 一本にすると T1 画面（`S-001` / `S-046`）でズームが起きる（`CLAUDE.md` §13.2「モバイルで操作まで完結」）。T-22-01 で名前だけ役割名に替えた —— §7.9 は `text-base` を直接書かず役割名（16px = `--text-lg`）で参照することを求めており、**6 トークン以外の文字サイズを画面ごとに作らない**ためである。`md:` は Tailwind の既定接頭辞（§13.3） |
// | `shadow-xs` | 同じ（**据え置く**） | ⚠️ ここだけ `docs/04` §7.9（「shadow は overlay にのみ使う」）と読みが分かれる。**`docs/05` §2.3.2 が「既存 `Input` / `Select` / `Textarea` の `shadow-xs` は入力欄の輪郭であり据え置く」と名指しで決めている**ため、実装設計に従って残す（§7.9 が禁じているのは「**カードを浮かせる**ための影」であり、1px 相当の輪郭は階層の表現ではない、という読み）。🔴 **`Card` の `shadow-sm` は撤去した**（あちらはまさに「浮かせるための影」である。`./card.tsx`）。**2 文書の食い違いとして完了報告に出す** |
// | `transition-[color,box-shadow]` | **`transition-colors`**（`TRANSITION_CLASSES`） | §7.9: 遷移の対象は background-color / border-color / color / opacity **のみ**。box-shadow（= `ring-*` の実体）を遷移から外したので、フォーカスリングは 150ms 待たずに即時に出る（キーボード操作では望ましい） |
// | `placeholder:text-muted-foreground` | **`placeholder:text-fg-placeholder`** | テーマ変数が無いため T-21-02 は `placeholder:text-slate-400` に置いた。T-22-01 で §7.9 の「未入力」= `--color-fg-placeholder`（値は同一）を指す形にした |
// | `disabled:cursor-not-allowed` | 同じ（`DISABLED_CLASSES`） | そのまま |
// | `disabled:pointer-events-none` | **取り込まない**（T-22-01 で撤去） | 🔴 ポインタイベントを受け取らないと `cursor: not-allowed` が出ず、§7.10 が要求する手がかりが消える。無効な `<input>` はイベントを発火しないので押下の封じ込めには不要（`lib/state-classes.ts`） |
// | `disabled:opacity-50` | **`disabled:bg-bg-inset disabled:text-fg-placeholder`** | T-21-02 は既存 `Button` に合わせて `disabled:opacity-60` にしていた。T-22-01 で §7.10 の定める 2 色の組に置換 —— 半透明は背景色を持つ行や帯の上で見え方が変わる（`lib/state-classes.ts`） |
// | `focus-visible:border-ring` `focus-visible:ring-[3px]` `focus-visible:ring-ring/50` | **`FOCUS_RING_CLASSES`**（2px + オフセット 2px、色は `--color-focus-ring`） | テーマ変数が無いため T-21-02 は実色に置換し、リングの形を `Button` と揃えていた。T-22-01 で **全プリミティブ共通の 1 定数**にした（§7.10 / `Q-04-6` 既定 ①）。🔴 `focus-visible:border-*` は**やめた** —— §7.10 の focus-visible は「2px のリング + 2px のオフセット」だけであり、部品ごとに枠線まで変えると「同じ役割の要素が同じ見え方をする」が崩れる |
// | `aria-invalid:border-destructive` | **`aria-invalid:border-danger-border`** | 同上（実色 → トークン）。§7.10 の error は「入力欄 = border `--color-danger-border` + 下にメッセージ」。フックは残す（`aria-invalid` を立てれば効く） |
// | `aria-invalid:ring-destructive/20` | 取り込まない | 上の 1 語で赤枠は出る。`/20` の不透明度合成はテーマ変数前提であり、実色に置き換えると**リングと枠で 2 系統の赤**が生まれる |
// | `selection:bg-primary` `selection:text-primary-foreground` | 取り込まない | 選択色は OS / ブラウザ既定のままにする（`--color-brand` を当てると選択範囲が「進行中」の意味を持つ色になる） |
// | `dark:bg-input/30` `dark:aria-invalid:ring-destructive/40` | 取り込まない | 🔴 **ダークモードを持たない**（`docs/04` `Q-04-3` 既定 ①。`tailwind.css` が `color-scheme: light` を宣言）。死んだ語を増やさない |
// | `data-slot="input"` | 取り込まない | upstream の `*:data-[slot=…]` セレクタを 1 つも使っていない。使う語を入れるときに属性ごと足す |
// | `h-9` `py-1` `file:*` | ここには置かない | 高さと file 入力は要素ごとに違う（`input.tsx` / `select.tsx` / `textarea.tsx` 側で足す） |
// ============================================================================
// 🔴 `docs/04` §7.10 の 8 状態（入力系 3 つに共通。T-22-01）
// ============================================================================
// | 状態 | ここでの実装 |
// |---|---|
// | default | 枠 `--color-border-strong` + 背景は透過（置かれた面の色を継ぐ） |
// | hover | **持たない**。§7.10 の hover は「背景を 1 段暗く」だが、入力欄は**押す対象ではなく書く対象**であり、ポインタが乗っただけで面が動くと「押せるもの」に見える（`Button` との弁別が消える） |
// | active | **持たない**（同上） |
// | selected | **持たない**。テキスト選択は OS / ブラウザの既定に任せる（`selection:*` を取り込まない理由と同じ） |
// | focus-visible | `FOCUS_RING_CLASSES`（全プリミティブ共通） |
// | disabled | `DISABLED_CLASSES`（文字 `--color-fg-placeholder` + 背景 `--color-bg-inset` + `cursor: not-allowed`） |
// | loading | **持たない**。進行中は送信ボタン側（`components/button.tsx` の `loading`）が表す |
// | error | `aria-invalid:border-danger-border` + 下のメッセージ（`components/field.tsx` の `FieldError`。文字は `--color-danger`） |
import { cn } from './cn.js';
import { DISABLED_CLASSES, FOCUS_RING_CLASSES, TRANSITION_CLASSES } from './state-classes.js';

/**
 * `Input` / `Select` / `Textarea` に共通の基底クラス。
 *
 * 🔴 ここに**バリアントで切り替えたい語を置かない**（`variant` / `size` として prop で
 *    列挙する。`lib/cn.ts` の新しい規律 1）。
 */
export const CONTROL_BASE_CLASSES = cn(
  'w-full min-w-0 rounded-sm border border-border-strong bg-transparent px-3 shadow-xs',
  'text-lg md:text-body',
  TRANSITION_CLASSES,
  'placeholder:text-fg-placeholder',
  DISABLED_CLASSES,
  FOCUS_RING_CLASSES,
  'aria-invalid:border-danger-border',
);

/**
 * 1 行の入力（`Input` / `Select`）の寸法。
 *
 * 🔴 upstream は `h-9`（36px）だが、本リポジトリの `Button` は `h-10`（40px）である。
 *    旧 `.ses-filter-form` は入力欄と検索ボタンを 1 本の帯に `align-items: flex-end` で
 *    並べるため、**高さが 4px ずれると帯の底が揃わない。** 高さは `Button` に合わせる。
 * ⚠️ 縦の詰めは `docs/04` §7.9 の spacing 7 段のうち `--spacing-2`（8px = ボタンの内側）に
 *    当たるが、**高さが `h-10` で固定されているため `py-*` は実効を持たない**（upstream の
 *    `py-1` をそのまま残す。段から外れた値を新たに持ち込まない）。
 */
export const CONTROL_FIELD_SIZE_CLASSES = 'h-10 py-1';
