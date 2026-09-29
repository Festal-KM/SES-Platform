// packages/ui/src/lib/overlay-classes.ts
// overlay 部品（`Dialog` / `Drawer` / `DropdownMenu` / `Tooltip` / `Toast`）が共有する
// **component 層**のクラス定数（`docs/04` §7.9 の ③ component 層 / `docs/05` §2.3.2 の
// 「component 層は `@theme` に置かない。置き場所は `packages/ui` のクラス定数」）。
//
// ============================================================================
// 🔴 なぜ 5 部品の面の語をこの 1 ファイルに集めるのか（影の話である）
// ============================================================================
// `docs/04` §7.9 が **shadow を許すのは overlay と入力欄の輪郭だけ**である。5 つの部品が
// それぞれ `shadow-md` を書くと、許可の範囲が 5 箇所に散り、**「新しい要素に影を足した」のか
// 「overlay だから正しい」のかを機械で見分けられなくなる**（§7.9 の 🔴「新しい要素に『輪郭
// だから』と言って影を足せない」）。
//
// したがって **影の語はここ 1 箇所**に置く —— 入力欄の `shadow-xs` が
// `./control-classes.ts` の 1 箇所であるのと**同じ形**である。検査は
// `tests/static/design-tokens.test.ts`（`docs/05` §17.7 (h)）が
// 「`packages/ui` の `shadow-` は control-classes.ts の `shadow-xs` と overlay-classes.ts の
// `shadow-md` の 2 箇所だけ」に固定する。
//
// 🔴 **`@theme` に `--shadow-overlay` を宣言しない。** `docs/05` §2.3.2 の shadow の行が
//    「宣言しない（既定の `shadow-sm` / `shadow-md` を使う）」と定めており、
//    `design-tokens.test.ts` の `FORBIDDEN_TOKEN_PATTERNS` が `/^--shadow-/` を禁じている
//    （宣言すると画面からも `shadow-overlay` と書けてしまい「overlay の中だけ」の縛りが消える）。
//    ⚠️ `components/card.tsx` の冒頭コメントに「`--shadow-overlay` は宣言だけしてある」と
//    書かれているが、**実際には宣言されていない**（T-22-01 時点の記述の誤り）。完了報告で提起する。
//
// ============================================================================
// 🔴 影の有無以外に、ここで 1 箇所に寄せているもの
// ============================================================================
// - **面の色と枠**（`bg-bg` + `border border-border`）。overlay は「下の面から浮いている」
//   ことを影で示す唯一の場所なので、面の色が部品ごとに違うと影の意味が読めない。
// - **`z-index` の段**（背景 `z-40` / 前面 `z-50`）。`docs/04` は段を定めていないが、
//   **2 段しか使わない**ことをここで固定する（部品ごとに `z-*` を足すと重なり順が破綻する）。
// - **`focus-visible` のリング**（`./state-classes.ts` の `FOCUS_RING_CLASSES` と同一。§7.10）。
//
// 🔴 **遷移・アニメーションを持たない**（§7.9 / §7.10）。Radix は `data-[state=open]` を
//    出すが、`transform` / `height` を遷移させてはならず（`docs/04` §7.9）、フェードだけの
//    ために `tailwindcss-animate` を入れることもしない（依存の追加は人間の承認事項）。
//    overlay は「開いた / 閉じた」が状態として読めれば足りる。
import type { ReactNode } from 'react';
import { cn } from './cn.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from './state-classes.js';

/**
 * overlay の中の**遷移**を描く部品が受け取る props（`next/link` の `Link` がそのまま満たす）。
 *
 * 🔴 **`href` を必須に持つ**ことが、この型を「遷移専用」にしている —— `<button>` を渡す形が
 *    満たせないので、`Drawer` の出口（§5-13「遷移 1 本で閉じる」）に実行系を差し込めない。
 * 🔴 `packages/ui` は **`next/link` に依存しない**（`docs/05` §2.3.1）。既定は素の `<a>` で、
 *    Next.js の画面が `linkComponent={Link}` を渡す（`components/name-cell.tsx` と同じ形）。
 */
export type OverlayLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
};

/**
 * 背景（`Dialog` / `Drawer` の後ろを覆う面）。
 *
 * 🔴 **`bg-black/50` と書かない** —— 無彩色の極（`bg-white` / `bg-black`）は
 *    `docs/04` §7.9 の ① primitive 層の直接参照であり、`design-tokens.test.ts` が落とす。
 *    semantic の `--color-fg`（`slate-900`）に不透明度を掛ける形で、**色の出所を semantic 層に
 *    保つ**（component 層は semantic だけを参照する。§7.9）。
 */
export const OVERLAY_BACKDROP_CLASSES = 'fixed inset-0 z-40 bg-fg/50';

/**
 * overlay の面（5 部品に共通）。**影が出てよい唯一の語がここに在る。**
 *
 * 🔴 radius は部品ごとに足す（`Dialog` / `Drawer` / `DropdownMenu` = 6px のパネル段、
 *    `Tooltip` / `Toast` の小さな面 = 4px)。`docs/04` §7.9 の 2 段のどちらかであることは
 *    `design-tokens.test.ts` の radius 検査が担保する。
 */
export const OVERLAY_SURFACE_CLASSES = cn(
  'border border-border bg-bg shadow-md',
  FOCUS_RING_CLASSES,
);

/**
 * `Dialog` の器（画面中央に寄せるだけの層）。
 *
 * 🔴 **`pointer-events-none`** —— この層は面いっぱいに広がるため、当たり判定を持つと
 *    背景（`OVERLAY_BACKDROP_CLASSES`）へのクリックが届かず、**Radix の「外側クリックで閉じる」が
 *    効かなくなる**（閉じる手段をキーボードだけに狭めない）。当たり判定はパネル側で戻す。
 */
export const DIALOG_VIEWPORT_CLASSES =
  'pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4';

/**
 * `Dialog` のパネル。
 *
 * 🔴 **`max-h-[85vh] overflow-hidden`**: `docs/04` §5-13 の「**スクロールが必要な量を入れない**
 *    （入るなら Drawer かページ）」を**構造で**表す。`overflow-y-auto` を付けると「入れてよい」に
 *    なるので付けない —— 入りきらない設計は**その場で見て分かる**。型の側でも本文を
 *    `string` に限っており（`components/dialog.tsx` の `body`）、一覧・ゲート結果・差分のような
 *    スクロールする塊は**渡せない**。
 * 🔴 **`max-w-120`（480px）** —— 確認と 1 項目の入力に足る幅であり、これ以上広げると
 *    「判断材料を押し込む」余地が生まれる（§7.2）。
 */
export const DIALOG_PANEL_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'pointer-events-auto flex max-h-[85vh] w-full max-w-120 flex-col gap-4 overflow-hidden rounded-md p-6',
);

/**
 * `Drawer` のパネル（右から出る側面パネル）。
 *
 * 🔴 **モバイル（`sm` 未満）は全画面オーバーレイ**（`docs/04` §3.4 の 🔴。下からのシートに
 *    すると内容が入りきらず「判断材料を隠す」側に倒れる）。`inset-y-0 right-0 w-full` が
 *    そのまま全画面になり、`sm:w-100`（400px）で側面パネルに戻る。
 * 🔴 **`overflow-y-auto`** —— `Drawer` は読み取りのためのパネルであり、`Dialog` と違って
 *    スクロールしてよい（§5-13 の「入るなら Drawer かページ」）。
 * 🔴 角丸は側面に接する辺だけ（全画面のときは接する辺が無いので `sm:` から）。
 */
export const DRAWER_PANEL_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'fixed inset-y-0 right-0 z-50 flex w-full flex-col gap-4 overflow-y-auto p-6 sm:w-100 sm:rounded-l-md',
);

/** `DropdownMenu` の面。 */
export const DROPDOWN_MENU_CONTENT_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'z-50 flex min-w-48 flex-col rounded-md p-1',
);

/**
 * `DropdownMenu` の項目。
 *
 * 🔴 hover と **Radix の `data-[highlighted]`**（キーボードで辿ったときの強調）を**同じ見た目**に
 *    する —— ポインタとキーボードで「いまどれを選んでいるか」の表し方が違うと、§7.10 の
 *    「同じ役割の要素が同じ見え方をする」が破れる。
 * 🔴 **`disabled` は `data-[disabled]` で表す**（`./state-classes.ts` の `DISABLED_CLASSES` を
 *    使えない）—— Radix のメニュー項目は `<button disabled>` ではなく `role="menuitem"` の
 *    要素であり、無効は `data-disabled` 属性で示される。**色の組は §7.10 と同一**
 *    （文字 `--color-fg-placeholder` + 背景 `--color-bg-inset` + `cursor: not-allowed`）。
 */
export const DROPDOWN_MENU_ITEM_CLASSES = cn(
  'flex cursor-pointer items-center rounded-sm px-3 py-2 text-left text-body text-fg outline-none',
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle data-[highlighted]:bg-bg-subtle',
  'data-[disabled]:cursor-not-allowed data-[disabled]:bg-bg-inset data-[disabled]:text-fg-placeholder',
);

/**
 * `Tooltip` の面。
 *
 * 🔴 **`max-w-80`** で幅を止める —— 長くなるということは「判断材料を入れている」ことであり、
 *    §5-13 が禁じている用法である（触端末で開けない場所に判断材料を置かない）。
 */
export const TOOLTIP_CONTENT_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'z-50 max-w-80 rounded-sm px-3 py-2 text-xs text-fg',
);

/**
 * `Toast` の器（画面下端に寄せる層）。
 *
 * 🔴 **`pointer-events-none`** —— 器は画面幅いっぱいに広がるので、当たり判定を持つと
 *    下端の操作（モバイルのボトムタブ。`docs/04` §3.4）を覆って押せなくする。
 */
export const TOAST_VIEWPORT_CLASSES =
  'pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4';

/** `Toast` のパネル。 */
export const TOAST_PANEL_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'pointer-events-auto flex w-full max-w-120 flex-col gap-2 rounded-md p-4',
);

/**
 * overlay の中の導線（`Drawer` の詳細画面へのリンク / `Toast` の対象へのリンク）。
 *
 * 🔴 `./link-classes.ts` の `SECONDARY_LINK_CLASSES`（`--color-fg-muted`）を使わない ——
 *    overlay の中の導線は**副次ではなく、そのパネルの出口そのもの**である
 *    （`Drawer` の末尾は詳細画面への遷移 1 本で閉じる。`docs/04` §4.1）。
 * 🔴 **`Button` の見た目にしない** —— 押した先で何かが起きる操作（実行系）と、
 *    場所が変わるだけの遷移を、同じ見た目にしないため（§7.6）。
 */
export const OVERLAY_LINK_CLASSES = cn(
  'inline-block text-body font-medium text-fg underline underline-offset-2',
  FOCUS_RING_CLASSES,
);

/** overlay の表題（`Dialog` / `Drawer`）。§7.3 の 2 段目（セクション見出し）= 16px / 600。 */
export const OVERLAY_TITLE_CLASSES = 'text-lg font-semibold text-fg';

/** overlay の本文・補助テキスト。§7.3 の本文（14px / 400）。 */
export const OVERLAY_BODY_CLASSES = 'text-body text-fg';

/** overlay の中のラベル（`Drawer` の項目名 / `Toast` の種別）。§7.3 の補助テキスト。 */
export const OVERLAY_LABEL_CLASSES = 'text-xs text-fg-muted';

/**
 * overlay の中の操作行（`Dialog` のフッタ）。
 *
 * 🔴 **`justify-end`** で右端に寄せ、**`キャンセル` を先・確定を後**に置く
 *    （`components/dialog.tsx` の描画順。§7.8 の用語と §7.6 の摩擦）。
 */
export const OVERLAY_FOOTER_CLASSES = 'flex flex-wrap items-center justify-end gap-3';

/**
 * overlay の中の読み取り項目のリスト（`Drawer` の `対象 / 相手 / 状態 / 経過時間 / 期限`）。
 *
 * 🔴 **定義リスト**で描く（`docs/04` §7.2「1 件の属性の羅列 = 定義リスト」。
 *    1 行しかないテーブルにしない）。
 */
export const OVERLAY_DEFINITION_LIST_CLASSES = 'flex flex-col gap-3';
