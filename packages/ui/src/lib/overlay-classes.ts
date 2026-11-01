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
// したがって **影の語はここ 1 箇所**に置く —— 入力欄の `shadow-control` が
// `./control-classes.ts` の 1 箇所であるのと**同じ形**である。検査は
// `tests/static/design-tokens.test.ts`（`docs/05` §17.7 (h)）が
// 「`packages/ui` の `shadow-` は control-classes.ts の `shadow-control` と overlay-classes.ts の
// `shadow-overlay` の 2 箇所だけ」に固定する。
//
// ✅ **2026-10-02（`docs/04` §7.9 改訂 23）で `--shadow-overlay` が `@theme` に入った。**
//    🔴 **方針が変わった**（旧文は「宣言しない」であり、その根拠は `docs/05` §2.3.2 だった）。
//    改訂 23 は **影の名前を 2 つに固定することで、名前の側から規約を守る**ことを決めた ——
//    `--shadow-overlay` / `--shadow-control` 以外の影は**名前が無い**ので、新しい要素に
//    「輪郭だから」と言って影を足すには `@theme` への追記（= 設計の改訂）が要る。
//    ⚠️ **「画面からも `shadow-overlay` と書けてしまう」という旧文の懸念は残る。** そこを
//    埋めるのは名前ではなく検査であり、`tests/static/ui-shadow-and-size.test.ts` が
//    **`packages/ui` の外（`apps/web/app/**`）で影の語を書けないこと**を固定する。
//    🔴 **値は Tailwind 既定の `--shadow-md` と同一なので、見た目は 1px も変わっていない。**
//
// ============================================================================
// 🔴 影の有無以外に、ここで 1 箇所に寄せているもの
// ============================================================================
// - **面の色と枠**（`bg-surface` + `border border-border`）。overlay は「下の面から浮いている」
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
  // ✅ 2026-10-02: `bg-bg` → `bg-surface` / `shadow-md` → `shadow-overlay`（**どちらも値は同一**）。
  'border border-border bg-surface shadow-overlay',
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
 * ✅✅ **2026-10-19: 1 項目の入力だけの `Dialog` の幅**（400px。`S-010` の条件の保存）。
 *
 * 🔴 **画面側に `max-w-*` を書かせないための定数である**
 *    （`tests/static/ui-screen-width.test.ts` (c)。幅の決定を `packages/ui` に残す）。
 */
export const DIALOG_PANEL_NARROW_CLASSES = 'max-w-100';

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

/**
 * ✅✅ **複数選択（`<details>` + チェックボックス）のポップアップの面**（2026-10-16。人間の
 * 明示指示「スキルの部分はポップアップや Tip で選択肢を表示して、選択させるような形で、
 * 表示させるのはバッチ風の表示にするのがいいでしょうね。」）。
 *
 * 🔴 **重ねる**（`absolute`）—— 押したときに下の条件や表を押し下げると、選んでいる間に
 *    画面が動いて別のものを押すことになる。**絞り込みの帯の高さは開いても変わらない。**
 * 🔴 **面と影は `OVERLAY_SURFACE_CLASSES` の 1 定義**である（`DropdownMenu` と同じ）——
 *    画面側で枠・背景・影を組み直さない。**ここに置くのは、重なる面の影（`shadow-overlay`）を
 *    書いてよいのがこのファイルだけだからである**（`docs/04` §7.9 /
 *    `tests/static/design-tokens.test.ts`）。
 * 🔴 **`z-20`**（`DropdownMenu` の `z-50` より下）—— Radix の overlay は画面に固定で重なるが、
 *    こちらは**絞り込みカードの中**に収まる。同じ高さにすると、`Dialog` が開いているときに
 *    下の絞り込みのポップアップが前に出る。
 * 🔴 **縦に伸びすぎない**（`MULTI_SELECT_LIST_CLASSES` の `max-h-56` ＝ 224px で内側スクロール）。
 *    辞書が増えても帯は変わらない。
 * ✅✅ **2026-10-19: スクロールを一覧の層へ下ろした**（受領モックの検索欄は常に見えている）。
 *    🔴 **この面は `overflow-hidden`** —— 面自体が流れると、絞り込みの語を打ちながら
 *       候補を見ることができない（検索欄が上に流れて消える）。
 * ⚠️ **外側をクリックしても閉じない**（`<details>` の素の挙動）。閉じるには引き金をもう一度
 *    押す —— クライアントの島を持ち込まないための意図的な割り切りであり、絞り込みの
 *    アコーディオン（`DISCLOSURE_SUMMARY_CLASSES`）と同じ考え方である。
 *    🔴 **だから `Dialog` / `DropdownMenu` の代わりに使ってよい場所は限られる** ——
 *    画面に固定で重なる overlay（`OVERLAY_BACKDROP_CLASSES` を伴うもの）には使わない。
 */
export const MULTI_SELECT_PANEL_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'absolute top-full right-0 left-0 z-20 mt-1 flex flex-col overflow-hidden rounded-md p-2',
);

/**
 * ✅✅ **ポップアップの中の選択肢の一覧**（2026-10-19）。**スクロールするのはここだけである。**
 *
 * 🔴 **`max-h-56`（224px）** —— 面の高さの上限をここが持つ（旧実装は面そのものが持っていた）。
 *    辞書が何件に増えても、絞り込みの帯の下に出る塊の高さは変わらない。
 */
export const MULTI_SELECT_LIST_CLASSES = 'flex max-h-56 flex-col overflow-y-auto';

// ============================================================================
// ✅✅ 2026-10-19: 検索エリアの**ポップオーバー**（`S-010` の改修指示書 §3 / §4）
// ============================================================================
// 🔴 **`role="dialog"` を持たない**。モーダルではなく、引き金の真下に開く面である
//    （`tests/static/ui-primitive-single-impl.test.ts` ① が `role="dialog"` を `packages/ui` の
//    `components/**` に限っている —— ここはクラス定数だけを置く）。
/**
 * ポップオーバーの面（スキルの複数選択 / 条件バーの「＋N」）。
 *
 * 🔴 **幅は引き金以上**（`min-w-full`）**かつ 360px を目安**（`w-90`。指示書の 320〜380px）。
 * 🔴 **画面端から 16px 離す**（`max-w-[calc(100vw-2rem)]`。ビューポート基準の値は
 *    寸法の段の話ではないので `ui-shadow-and-size.test.ts` (b) の対象外である）。
 * 🔴 **`z-30`** —— `MULTI_SELECT_PANEL_CLASSES`（`z-20`）より上、Radix の overlay（`z-50`）より下。
 */
export const POPOVER_PANEL_CLASSES = cn(
  OVERLAY_SURFACE_CLASSES,
  'absolute top-full left-0 z-30 mt-1 flex w-90 min-w-full max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-hidden rounded-lg p-2',
);

/** 右端に寄せるポップオーバー（条件バーの「＋N」。左に出すと画面外に出る）。 */
export const POPOVER_PANEL_END_CLASSES = cn(POPOVER_PANEL_CLASSES, 'right-0 left-auto');

/** ポップオーバー上部の検索欄（**32px**。指示書 §3）。🔴 高さの指定を画面側に書かせない。 */
export const POPOVER_SEARCH_INPUT_CLASSES = 'h-8 pl-8';

/**
 * 選択肢の一覧。🔴 **ここだけが縦に流れる**（指示書「一覧部分のみ最大 240px」= `max-h-60`）。
 * 🔴 上の検索欄と下の件数行は流れない（絞り込みながら件数を見られる）。
 */
export const POPOVER_LIST_CLASSES = 'flex max-h-60 flex-col overflow-y-auto';

/**
 * 選択肢 1 行（**36px**。指示書 §3）。
 * 🔴 **未選択の行に大きな空のチェックボックスを置かない**（指示書）——
 *    選んである印は**右端の小さなチェック**と淡い面である。
 * 🔴 hover（`--color-bg-subtle`）と selected（`--color-brand-bg`）を別の色にする（§7.10）。
 */
export const POPOVER_OPTION_CLASSES = cn(
  'flex h-9 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-fg',
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle',
  FOCUS_RING_CLASSES,
);

/** 選んである行。 */
export const POPOVER_OPTION_SELECTED_CLASSES = 'bg-brand-bg text-brand';

/** ポップオーバーの下部（「N 件選択中」と「選択をクリア」）。 */
export const POPOVER_FOOTER_CLASSES =
  'flex shrink-0 items-center justify-between gap-2 border-t border-border px-2 pt-2 text-xs text-fg-muted';

/** 「すべて」「選択中 N」の小さな切り替えの器。 */
export const POPOVER_SEGMENT_CLASSES = 'flex shrink-0 items-center gap-1 px-1';

/** 切り替えの 1 つ。🔴 selected は§7.10 と同じ 2 色の組で表す。 */
export const POPOVER_SEGMENT_ITEM_CLASSES = cn(
  'cursor-pointer rounded-sm px-2 py-1 text-xs font-medium text-fg-muted',
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle',
  FOCUS_RING_CLASSES,
);

/** 選ばれている切り替え。 */
export const POPOVER_SEGMENT_ITEM_SELECTED_CLASSES = 'bg-brand-bg text-brand';

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
