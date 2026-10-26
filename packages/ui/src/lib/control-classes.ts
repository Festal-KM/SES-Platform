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
// | `shadow-xs` | **`shadow-control`**（✅ 2026-10-02。**値は `--shadow-xs` と同一**） | ⚠️ ここだけ `docs/04` §7.9（「shadow は overlay にのみ使う」）と読みが分かれる。**`docs/05` §2.3.2 が「既存 `Input` / `Select` / `Textarea` の `shadow-xs` は入力欄の輪郭であり据え置く」と名指しで決めている**ため、実装設計に従って残す（§7.9 が禁じているのは「**カードを浮かせる**ための影」であり、1px 相当の輪郭は階層の表現ではない、という読み）。🔴 **`Card` の `shadow-sm` は撤去した**（あちらはまさに「浮かせるための影」である。`./card.tsx`）。**2 文書の食い違いとして完了報告に出す** |
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
import { ROW_ACTION_HEIGHT_CLASS, ROW_ACTION_WIDTH_CLASS } from './layout-tokens.js';
import { CARD_SURFACE_CLASSES } from './surface-classes.js';
import { DISABLED_CLASSES, FOCUS_RING_CLASSES, TRANSITION_CLASSES } from './state-classes.js';

/**
 * `Input` / `Select` / `Textarea` に共通の基底クラス。
 *
 * 🔴 ここに**バリアントで切り替えたい語を置かない**（`variant` / `size` として prop で
 *    列挙する。`lib/cn.ts` の新しい規律 1）。
 */
export const CONTROL_BASE_CLASSES = cn(
  // ✅ 2026-10-13: Input の角丸は **8px**（`rounded-md`。`docs/design-system.md` §3.3）。
  'w-full min-w-0 rounded-md border border-border-strong bg-transparent px-3 shadow-control',
  'text-lg md:text-body',
  TRANSITION_CLASSES,
  'placeholder:text-fg-placeholder',
  DISABLED_CLASSES,
  FOCUS_RING_CLASSES,
  'aria-invalid:border-danger-border',
);

/**
 * 🔴 **操作要素の高さは 2 段だけ**（`docs/04` §7.9 の `--control-h-sm` / `--control-h-md` /
 *    `--input-h`。✅ 改訂 23 で名前が付いた）。**リポジトリで高さを決めているのはここ 1 箇所である**
 *    （`Button` / `IconButton` / `Input` / `Select` / `Textarea` がすべてこれを参照する）。
 *
 * 🔴 **`@theme` のトークンにはできない。** 高さの名前空間は Tailwind v4 に無く、`--control-h-md`
 *    を宣言しても `h-control-h-md` は 1 行も生成されない（`apps/web/app/tailwind.css` の
 *    食い違い表）。したがって**クラス定数 1 箇所**という既存の規律（component 層の置き場所。
 *    `docs/05` §2.3.2）で守る。
 *
 * 🔴 **値は `docs/04` §7.9 の 28px / 36px ではなく 32px / 40px である**（実装側を正とした）。
 *    理由は下の `CONTROL_FIELD_SIZE_CLASSES` の 🔴 と同じで、**`Button` と入力欄の底が
 *    1 本の帯（`Toolbar` / 絞り込みフォーム）で揃うこと**が先に決まっており、36px に下げると
 *    既存の全フォーム・全一覧の見え方が変わる。**食い違いは `docs/04` 側の訂正事項として報告する。**
 *
 * 🔴 **段を 3 つにしない。** 一覧の行内の操作は `sm`、フォームと primary は `md` である
 *    （`md` を行内に使うと 50 行の一覧で §7.1 の「ファーストビューに 12 行」が崩れる）。
 */
export const CONTROL_HEIGHT_CLASSES = {
  /** 32px … テーブル行内のボタン / `IconButton`（`size='sm'`）。 */
  sm: 'h-8',
  /**
   * 36px … フォームの `Input` / `Select` / primary・secondary ボタン（`size='default'`）。
   * ✅ **2026-10-13: 40px → 36px**（`docs/design-system.md` §4.2。デザインシステム v1.0）。
   */
  md: 'h-9',
} as const;

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
export const CONTROL_FIELD_SIZE_CLASSES = `${CONTROL_HEIGHT_CLASSES.md} py-1`;

/**
 * 🔴 **一覧の行の中の操作（146 × 32）の 1 実装**（`docs/design-system.md` §4.2 の `row-action`）。
 *
 * 🔴 **画面側で作らない。** 面（`bg-bg` + 枠）と hover は `packages/ui` の部品だけが持つ
 *    （`tests/static/ui-shadow-and-size.test.ts` / `ui-state-in-primitives.test.ts`）。
 * 🔴 **幅を固定する** —— 文言の長短で列が動くと、45px の行が並んだときに操作の列が揃わない。
 */
export const ROW_ACTION_LINK_CLASSES = cn(
  `inline-flex items-center justify-center gap-2 truncate rounded-sm border border-border-strong bg-bg px-3 text-cell font-medium text-fg ${ROW_ACTION_WIDTH_CLASS} ${ROW_ACTION_HEIGHT_CLASS}`,
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle active:bg-bg-inset',
  FOCUS_RING_CLASSES,
);

// ============================================================================
// ✅✅ 2026-10-19: 検索エリア（`S-010`）の 3 層と格子（改修指示書 §2）
// ============================================================================
/**
 * 検索エリアの**条件バー**（常時表示。本文を閉じても残る 1 行）。
 *
 * 🔴 **本文との間に藄い境界線**（指示書）。ヘッダの下線（`TABS_HEADER_ROW_CLASSES`）と
 *    合わせて、検索エリアは**ヘッダ / 本文 / 条件バーの 3 層**に見える。
 * 🔴 **高さを固定しない**（`min-h-11` = 44px）—— 狭い幅では操作が折り返すことを
 *    指示書が認めている（「狭い幅では…段組みを許容します」）。
 */
export const FILTER_SUMMARY_BAR_CLASSES =
  'flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-2';

/**
 * 条件バッジの列。🔴 **1 行固定で折り返さない**（入りきらない分は「＋N」）。
 * 🔴 **横スクロールを出さない**（指示書「ページ全体や条件バーに横スクロールを出さない」）。
 */
export const FILTER_SUMMARY_CHIPS_CLASSES = 'flex min-w-0 flex-1 items-center gap-2 overflow-hidden';

/** 本文（折りたためる部分）。🔴 padding 16 / 行間 12（指示書 §2）。 */
export const FILTER_BODY_CLASSES = 'flex flex-col gap-3 p-4';

/**
 * 🔴 **開閉の遷移**（指示書「150〜180ms 程度。動きを減らす設定では抑制」）。
 *
 * 🔴 **`grid-template-rows` を遷移させる**（`0fr` ↔ `1fr`）—— 中身の高さを
 *    測らずに滑らかに開閉できる唯一の CSS の書き方である。
 * ⚠️ 遷移中は中身を `overflow-hidden` にする必要があるが、**開いた後は外す**
 *    （指示書「アニメーション用の overflow: hidden で、展開後のプルダウンが途中で
 *    切れないように」）。その切り替えは呼び出し側が行う。
 */
export const FILTER_BODY_COLLAPSE_CLASSES =
  'grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none';

/** 開いているときの行の寸法。 */
export const FILTER_BODY_COLLAPSE_OPEN_CLASSES = 'grid-rows-[1fr]';
/** 閉じているときの行の寸法。 */
export const FILTER_BODY_COLLAPSE_CLOSED_CLASSES = 'grid-rows-[0fr]';

/**
 * 検索項目の格子。
 *
 * 🔴 **列数はビューポート幅ではなく「検索エリア自身の幅」で決める**（指示書 §2）。
 *    したがって**ブレークポイントの接頭辞（`lg:` 等）を使わない** —— 列数は
 *    呼び出し側が `ResizeObserver` で測って渡す（`CLAUDE.md` §13.3 の「独自のブレーク
 *    ポイントを定義しない」を破らずに、器の幅で段組みを変える唯一の方法）。
 * 🔴 **子に `min-w-0`**（指示書）—— grid の子は既定 `min-width:auto` で、置かないと
 *    バッジの列が器を押し広げる。
 */
export const FILTER_GRID_CLASSES = 'grid items-end gap-3 [&>*]:min-w-0';

/** 列数（1 / 2 / 4）。🔴 **文字列を組み立てない**（Tailwind はソースの文字列を走査する）。 */
export const FILTER_GRID_COLUMN_CLASSES = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
} as const;

/** 4 列のときだけ単価が 2 列分を占める（指示書 §2）。 */
export const FILTER_GRID_SPAN_2_CLASSES = 'col-span-2';

// ============================================================================
// ✅✅ 2026-10-19: 「保存した条件」の一覧（改修指示書 §5）
// ============================================================================
/**
 * 保存条件の一覧の器。
 * 🔴 **検索エリアが無制限に伸びないよう 280px でスクロール**（指示書 §5）。
 */
export const FILTER_SAVED_LIST_CLASSES = 'grid max-h-70 gap-2 overflow-y-auto';

/** 保存条件の列数（広い 3 / 狭い 2 または 1。指示書 §5）。 */
export const FILTER_SAVED_COLUMN_CLASSES = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
} as const;

/**
 * 保存条件のカード。🔴 **コンパクトに**（大きなアイコンやイラストは置かない。指示書 §5）。
 */
export const FILTER_SAVED_CARD_CLASSES = cn(
  // 🔴 **面は `CARD_SURFACE_CLASSES` の 1 定義から取る**（`Card` / `KpiCard` と同じ面）。
  //    カードの面を 2 箰所で書くと「どれがカードか」が画面ごとに変わる。
  CARD_SURFACE_CLASSES,
  'flex min-w-0 flex-col gap-1 rounded-md p-3',
);

/** 適用中のカードだけ。🔴 **藄いアクセント背景と枠**（指示書 §5）。 */
export const FILTER_SAVED_CARD_ACTIVE_CLASSES = 'border-brand bg-brand-bg';

/** 行全体を占める（キーワード欄）。🔴 **列数ごとに literal で持つ**（文字列を組み立てない）。 */
export const FILTER_GRID_FULL_SPAN_CLASSES = {
  1: 'col-span-1',
  2: 'col-span-2',
  4: 'col-span-4',
} as const;

/** 🔴 一覧の行の hover（面の色だけ。拡大・影・下線を出さない）。 */
export const ROW_HOVER_CLASSES = 'hover:bg-row-hover-bg';

// ============================================================================
// ✅✅ 2026-10-16: 複数選択を**ポップアップ**で選び、選んだものを**バッジ**で見せる
//     （人間の明示指示「スキルの部分が縦幅を増やしており、バランスを崩しています。
//      スキルの部分はポップアップや Tip で選択肢を表示して、選択させるような形で、
//      表示させるのはバッチ風の表示にするのがいいでしょうね。」）
// ============================================================================
/**
 * 複数選択の**引き金**（`<summary>`）。
 *
 * 🔴 **`<select multiple>` をやめた理由**: `size` を 3 まで詰めてもリストボックスは
 *    **3 行ぶんの高さ**を占め、同じ行に並ぶ `Select`（`h-9` = 36px）の 2 倍以上になる。
 *    絞り込みの帯の縦幅を小さくするという人間の指示（同日）と正面から衝突していた。
 * 🔴 **見え方は他の入力欄と同じ**（`CONTROL_BASE_CLASSES`）—— 枠・角丸・影・フォーカスリングを
 *    画面側で組み直さない。並んだときに 1 つだけ違う形の欄にしない。
 * 🔴 **`marker:content-none` + `list-none`** で `<summary>` の既定の三角を消す
 *    （印は呼び出し側が `Icon` で置く。Safari は `list-none` だけでは消えない）。
 *
 * ✅✅ **2026-10-19: `min-h-9` → `h-9`（固定）**（人間の明示指示「幅以上に選択されたとしても
 *    行間が高くなることがないようにする」）。
 * 🔴 **伸びる余地を 1 つも残さない。** 旧実装は `min-h-9` + `flex-wrap` で、選んだバッジが
 *    欄の幅を超えると 2 行目に折り返して**欄ごと背が高くなり**、同じ行の `単価` と
 *    その下の行の位置が動いていた。折り返しをやめ（`MULTI_SELECT_BADGE_ROW_CLASSES` が
 *    `flex-nowrap` + `overflow-hidden` を持つ）、高さを他の入力欄と同じ 36px に固定する。
 * 🔴 **溢れたバッジは「+N」で数える**（呼び出し側）—— 単に切り落とすと、
 *    「選んだはずのものが消えた」と見分けが付かない。
 * 🔴 **開いているときは枠をブランド色にする**（`group-open/skills:` ではなく
 *    `aria-expanded` でも効くよう `group-open` と両方は持たない）。`<details>` の
 *    `open` に連動させるため、呼び出し側が `group-open/…` の接頭辞を足す形は取らず、
 *    ここでは**枠の色だけ**を持ち、開閉の表現は呼び出し側の `Icon` の回転に任せる。
 */
export const MULTI_SELECT_TRIGGER_CLASSES = cn(
  CONTROL_BASE_CLASSES,
  'flex h-9 cursor-pointer list-none items-center gap-2 py-1 marker:content-none',
);

/**
 * ✅✅ **引き金の中のバッジの列**（2026-10-19。人間の明示指示「幅以上に選択されたとしても
 * 行間が高くなることがないようにする」）。
 *
 * 🔴 **折り返さない**（`flex` の既定は `nowrap`）—— ここが「縦に伸びない」ことの本体である。
 *    いくつ選んでも欄の高さは `h-9` のまま変わらない。
 * 🔴 **`min-w-0`** —— flex の子は既定で `min-width:auto`（= 中身の min-content 幅）を持ち、
 *    これが無いと**バッジが欄そのものを押し広げる**（溢れの指定が効かない）。
 * 🔴 **`flex-1`** —— 右端の印（`Icon`）を欄の右端に固定するため、残りの幅をすべて取る。
 * ✅✅ **2026-10-19: 横スクロール → `overflow-hidden` + 「＋N」**（改修指示書 §3）。
 * 🔴 **切り落としっ本しにしない** —— 指示書は「単に overflow: hidden で隠して、選択された
 *    項目が見えなくなる実装は禁止」と書いている。入りきらない分は**呼び出し側が
 *    「＋N」にまとめ、そこから確認・解除できる**（`_search/skill-multi-select.tsx`）。
 *    横スクロールをやめたのは、**流せることが見た目から分からない**からである。
 */
export const MULTI_SELECT_BADGE_ROW_CLASSES = 'flex min-w-0 flex-1 items-center gap-1 overflow-hidden';

// 🔴 **ポップアップの面（`MULTI_SELECT_PANEL_CLASSES`）は `./overlay-classes.ts` に在る。**
//    理由: 重なる面の影（`shadow-overlay`）を書いてよいのは `./overlay-classes.ts` だけであり
//    （`docs/04` §7.9 / `tests/static/design-tokens.test.ts`）、影の置き場所を 2 つにしない。

/**
 * ✅✅ **選んだものを表すバッジの `×`**（2026-10-18。人間の明示指示「選択したらバッジで
 * 表示するようにして」+ 受領画像）。
 *
 * 🔴 **画面側に `hover:` を書かせないための定数である**（`tests/static/ui-state-in-primitives.test.ts`
 *    の (j)。8 状態は `packages/ui` のプリミティブが持つ —— 画面に書くと、その画面だけ
 *    押し心地と focus リングが違う状態になる）。
 * 🔴 **既定は控えめ、hover で濃く。** `×` はバッジの中の小さな的であり、常に濃いと
 *    「バッジそのものより `×` が目立つ」状態になる（語が主で、外す操作は従である）。
 * 🔴 **`shrink-0`** —— バッジが折り返しても `×` が潰れない。
 */
export const MULTI_SELECT_BADGE_REMOVE_CLASSES = cn(
  'shrink-0 rounded-sm text-fg-muted',
  TRANSITION_CLASSES,
  'hover:text-fg',
  FOCUS_RING_CLASSES,
);

/**
 * 引き金が**開いている**ときの枠。🔴 指示書のアクセント色（ブランド藍）。
 * 🔴 **画面側に `border-brand` を書かせない**（色の決定を `packages/ui` に残す）。
 */
export const MULTI_SELECT_TRIGGER_OPEN_CLASSES = 'border-brand';

/**
 * 引き金の中のバッジ 1 つ。
 *
 * 🔴 **幅を止める**（`max-w-32` = 128px）—— 指示書「長いスキル名はバッジ内で省略し」。
 *    止めないと 1 つの長い語で欄が埋まり、「＋N」の場所が残らない。
 */
export const MULTI_SELECT_BADGE_CLASSES = 'max-w-32 shrink-0 gap-1';

/**
 * ポップオーバーの中に出すときのバッジ（幅を止めない）。
 * 🔴 **画面側に `max-w-*` を書かせないための定数である**（`ui-screen-width.test.ts` (c)）。
 */
export const MULTI_SELECT_BADGE_WIDE_CLASSES = 'max-w-full';

/** バッジの中の語。🔴 **省略する**（全文は `title` と読み上げの語で確認できる）。 */
export const MULTI_SELECT_BADGE_LABEL_CLASSES = 'truncate';

/**
 * 「＋N」。🔴 **バッジに見えるが押せる**（指示書「＋N から省略された項目を
 * 確認・解除できる」）。単なる文字にすると「見えない条件」が残る。
 */
export const MULTI_SELECT_OVERFLOW_CLASSES = cn(
  'inline-flex h-6 shrink-0 cursor-pointer items-center rounded-xs border border-border-strong bg-bg px-2 text-cell font-medium text-fg-muted',
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle',
  FOCUS_RING_CLASSES,
);

/** ポップアップの中の 1 行（チェックボックス + 語）。🔴 行ごと押せる（当たり判定を広く取る）。 */
export const MULTI_SELECT_OPTION_CLASSES = cn(
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-body text-fg',
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle',
);

/**
 * ✅✅ **選んである行**（2026-10-19。受領モックはチェック済みの行に面が付いている）。
 *
 * 🔴 **hover（`--color-bg-subtle`）と別の色にする**（`./state-classes.ts` の `SELECTED_CLASSES`
 *    と同じ規律）—— 同じ色だと「いま選んである行」と「いまポインタが乗っている行」が
 *    区別できない。
 * 🔴 **左端 2px の縦棒（`SELECTED_CLASSES`）は持たせない** —— あれは一覧の行・現在地・タブの
 *    印であり、2px の内側余白しか無いポップアップの行に付けると入れ子の線に見える。
 *    ここは**チェックボックスそのものが選択の印**であり、面は補助である。
 */
export const MULTI_SELECT_OPTION_SELECTED_CLASSES = 'bg-brand-bg';

/**
 * ✅✅ **ポップアップの中の検索欄の器**（2026-10-19。人間の明示指示 + 受領モック
 * 「スキルを検索…」）。
 *
 * 🔴 **`relative`** は左の虫眼鏡（`absolute`）の基準点である。
 * 🔴 **一覧とは別の層に置く**（`MULTI_SELECT_LIST_CLASSES` だけがスクロールする）——
 *    検索欄が一緒に流れると、絞り込んだ語を確かめながらスクロールできない。
 */
export const MULTI_SELECT_SEARCH_CLASSES = 'relative mb-2 shrink-0';

/** ポップアップの中の「該当なし」の 1 行。🔴 空のパネルを出さない（壊れて見える）。 */
export const MULTI_SELECT_EMPTY_CLASSES = 'px-2 py-3 text-body text-fg-muted';
