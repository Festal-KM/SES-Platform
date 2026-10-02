// packages/ui/src/components/table.tsx
// shadcn/ui の `Table` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/table.json`。
// upstream の各基底（原文）:
//   Table 器  : relative w-full overflow-x-auto
//   Table     : w-full caption-bottom text-sm
//   TableHeader: [&_tr]:border-b
//   TableBody : [&_tr:last-child]:border-0
//   TableFooter: border-t bg-muted/50 font-medium [&>tr]:last:border-b-0
//   TableRow  : border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50
//               data-[state=selected]:bg-muted
//   TableHead : h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground
//               [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]
//   TableCell : p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0
//               [&>[role=checkbox]]:translate-y-[2px]
//   TableCaption: mt-4 text-sm text-muted-foreground
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | 🔴 器の `relative w-full overflow-x-auto` | 同じ | **落とさない。** 横溢れを器の内側に閉じ込める唯一の仕掛けであり、モバイル E2E の `expectNoHorizontalOverflow`（`document.documentElement` の横溢れを見る）が守っているものそのもの（`docs/sprints/SP-21` T-21-05 ③） |
// | `w-full caption-bottom text-sm` | 同じ | そのまま |
// | （`border-collapse` は書かない） | 同じ | Tailwind の preflight が `table { border-collapse: collapse }` を当てる（実測: `tailwindcss@4.3.3/preflight.css:171`）。既存画面の `border-collapse` は冗長 |
// | 🔴 `border-b` / `border-t`（色を書かない） | `border-b border-border` のように**色を必ず書く** | **v4 の border 既定色は `currentColor` である。** upstream は自分の `globals.css` で `* { @apply border-border }` を当てている。T-21-02 の時点では本リポジトリに `--color-border` が無く（実測: `theme.css` に 0 件）実色 `border-slate-200` に置いた。**T-22-01 で `docs/04` §7.9 の `--color-border`（= `slate-200`。値は同一）を宣言したので、上流と同じ語に戻った。** 色を書かなければ文字色の濃い罫線が出る点は変わらない |
// | `bg-muted/50` `bg-muted` `text-muted-foreground` | `bg-bg-subtle`（`slate-50`）/ `bg-brand-bg`（下の selected）/ `text-fg-muted`（`slate-500`） | T-21-02 は実色に置換していた（既存画面の `border-b border-slate-200 text-left text-slate-500` に合わせた）。T-22-01 で §7.9 の semantic トークンに置き換えた（**値は同一**。🔴 component 層は `@theme` ではなく `../lib/state-classes.ts` のクラス定数に置く。`docs/05` §2.3.2） |
// | `text-sm`（`Table`） | **`text-cell`**（13px） | 🔴 T-22-01。`docs/04` §7.3 の「テーブルのセル = 13px / 400」。**50 行 × 8 列を 1 画面に収めるための 1px**（§7.1）であり、**12px 以下にしない**（日本語の漢字が潰れる）。列ヘッダは `TableHead` が 12px に落とす |
// | `font-medium`（`TableHead`） | 同じ + **`text-xs`**（12px） | §7.3 の「テーブルの列ヘッダ = 12px / 500 / `--color-fg-muted`」。🔴 **大文字化・字間拡大をしない**（英語 SaaS の作法。日本語に大文字は無く、字間を開けると単語の切れ目が読めなくなる） |
// | 🔴 `whitespace-nowrap`（`TableHead` / `TableCell`） | 同じ。ただし `whitespace` prop で切り替えられる | **落とさない**（移行前の `.ses-table th, td { white-space: nowrap }` と同じ）。ただし折り返したいセル（スキル一覧など）が実在するため、**`className` ではなく prop で選ばせる** —— `cn()` は競合解決をせず `whitespace-normal` を渡しても勝てないため（`../lib/cn.ts` の規律 2） |
// | `p-2`（`TableCell`） / `px-2`（`TableHead`） | `px-3 py-2` | 既存 20 画面の実装（`px-3 py-2` が 57 + 32 箇所）に合わせる。**間隔だけの差** |
// | `[&:has([role=checkbox])]:pr-0` `[&>[role=checkbox]]:translate-y-[2px]` | 同じ | `S-013`（公開範囲）が表の中にチェックボックスを持つ |
// | `has-aria-expanded:bg-muted/50` | 取り込まない | 展開できる行を持つ表が無い。効かない語を増やさない |
// | `data-[state=selected]:bg-muted` | **`SELECTED_ROW_CLASSES`**（背景 `--color-brand-bg` + 文字 `--color-brand` + 左端 2px） | フックは残す（行選択を作るときに使う。`docs/04` §5-13 のとおり **`DataTable` の行選択は既定で無効**であり、現に使っている画面は無い）。T-22-01 で §7.10 の selected に揃えた —— 🔴 **hover と selected を同じ見た目にしない**（`--color-bg-subtle` と `--color-brand-bg` で分ける。選択は maintained、hover は transient） |
// | `"use client"`（upstream の table.tsx に付いている） | **付けない** | 🔴 状態もイベントハンドラも持たない器である。付けると、これを描いていた**サーバコンポーネントの画面が丸ごとクライアントバンドルへ移る**（T-21-02 の受け入れ基準 ③） |
// | `data-slot="table-*"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
//
// ============================================================================
// 🔴 `docs/04` §7.10 の 8 状態（`TableRow`。T-22-01）
// ============================================================================
// | 状態 | ここでの実装 |
// |---|---|
// | default | 下 border `--color-border` |
// | hover | 背景 `--color-row-hover-bg`（transient）。**文字色は変えない**。⚠️ Tailwind は `hover:` を `@media (hover: hover)` に包むので、触端末では hover が残らない |
// | active | **持たない**。行は押下の対象ではなく（行クリックの遷移はリンクが担う）、押下中の面を作ると「ボタンの行」に見える |
// | selected | `SELECTED_ROW_CLASSES`（背景 `--color-brand-bg` + 文字 `--color-brand` + 左端 2px。maintained） |
// | focus-visible | **行自身は持たない**（`<tr>` はフォーカスを受けない）。セルの中のリンク・ボタンが各自のリングを持つ |
// | disabled / loading / error | **持たない**。行の読み込み中は `Skeleton`（Phase 3b）、エラーは領域のメッセージ（§7.10） |
//
// ⚠️ **移行時の注意**: 既存画面は `<div className="overflow-x-auto"><table …>` と自前で器を
//    書いている（14 箇所）。`Table` は器を内蔵するので、**移行では外側の器を残さず外す**
//    （二重にしても壊れないが、`overflow-x-auto` が 2 段になると横スクロールの起点が
//    どちらか読めなくなる）。器へクラスを渡したいときは `containerClassName` を使う。
import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { SELECTED_ROW_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/** セルの折り返し。🔴 `className` では基底の `whitespace-nowrap` に勝てないため prop にする。 */
export type TableCellWhitespace = 'nowrap' | 'normal';

const WHITESPACE_CLASSES: Readonly<Record<TableCellWhitespace, string>> = {
  nowrap: 'whitespace-nowrap',
  normal: 'whitespace-normal',
};

/**
 * セルの左右の詰め方。🔴 `className` では基底の `px-3` に勝てないため prop にする（`whitespace` と同じ規律）。
 * `compact`（`px-2`）は、列数が多く 1 行の幅が決まっている表（`S-016` の 8 列 + 右パネル。T-11-12）のためにある。
 * 既定は upstream からの置換値 `px-3` のまま（既存 20 画面の見た目を変えない）。
 */
export type TableCellPadding = 'normal' | 'compact';

const HEAD_PADDING_CLASSES: Readonly<Record<TableCellPadding, string>> = {
  normal: 'px-3',
  compact: 'px-2',
};

/**
 * セルの内側（🔴 §7.9 の `--space-2`（8px）/ `--space-3`（12px）の 2 段だけ）。
 *
 * 🔴 **行の高さ（`docs/04` §7.9 の `--row-h` = 36px）はここから「結果として」決まる。**
 *    実測（2026-10-02）: `py-2`（8px）× 2 + `--text-cell`（13px）× 行間 1.5 = 19.5px → **35.5px**、
 *    `TableRow` の `border-b`（1px）を含めて **36.5px**（= §7.9 の 36px）。
 * 🔴 **高さのクラス（`h-9` 等）を当てない。** 当てると §7.9 自身が認めている
 *    「**名称セルが折り返す `lg` 未満では可変になる**」（`U-16`）が壊れ、2 行になった名称が
 *    セルから溢れる。**寸法に名前を与える目的は「画面ごとに違う値を書かせない」ことであり、
 *    固定することではない**（高さを決めているのは余白と文字サイズの段の組み合わせである）。
 */
const CELL_PADDING_CLASSES: Readonly<Record<TableCellPadding, string>> = {
  normal: 'px-3 py-2',
  compact: 'px-2 py-2',
};

/**
 * セルの縦位置。
 *
 * ============================================================================
 * 🔴 `align-middle` を基底に焼き込まない（T-21-04 の回帰調査で実測）
 * ============================================================================
 * **`vertical-align` はプロパティとしては継承しないが、行から伝播する。** HTML 標準の
 * UA スタイルシートが `td, th { vertical-align: inherit }` と
 * `thead, tbody, tfoot, table > tr { vertical-align: middle }` を持つためである。
 *
 * Chromium（Playwright）+ **本番ビルドの出力 CSS**で測った実測値:
 *
 * | `<tr>` | `<td>` | computed | 5 行のセルと並べたときのテキスト上端 |
 * |---|---|---|---|
 * | 指定なし | 指定なし | `middle` | 行の中央（48px） |
 * | `align-top` | **指定なし** | **`top`** | 行の上端（9px） |
 * | `align-top` | `align-middle` | `middle` | 行の中央（49px） |
 * | 指定なし | `align-middle` | `middle` | 行の中央（49px） |
 * | 指定なし | `align-top` | `top` | 行の上端（9px） |
 *
 * ここから 2 つが決まる:
 *   1. 🔴 **`TableCell` が基底で `align-middle` を出すと、行側の指定が届かなくなる**（3 行目）。
 *      `S-008`（版一覧）/ `S-036`（DNS レコード）のように**行内でセルの高さが大きく違う表**は
 *      上揃えでないと横に読めない。`className="align-top"` で上書きするのは
 *      **生成 CSS の順に依存した上書き**であり `../lib/cn.ts` の規律 2 が禁じている。
 *   2. 🔴 **既定は「何も出さない」でよい**（1 行目。UA が `middle` にする）。
 *      基底から語を消しても既定の見え方は変わらず、行側の指定が初めて効くようになる。
 *
 * したがって既定は `inherit`（＝クラスを出さない）とし、上書きは prop で受ける。
 */
export type TableCellAlign = 'inherit' | 'top' | 'middle' | 'bottom';

/** 🔴 `inherit` は**クラスを出さない**（UA の既定 `middle`、または `<tr>` の指定に従う）。 */
const ALIGN_CLASSES: Readonly<Record<TableCellAlign, string>> = {
  inherit: '',
  top: 'align-top',
  middle: 'align-middle',
  bottom: 'align-bottom',
};

/** チェックボックスを含むセルの詰め方（upstream と同じ）。 */
const CHECKBOX_CELL_CLASSES =
  '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]';

/**
 * 列ヘッダ（`<th>`）。
 * 🔴 サイズ・色・weight は `docs/04` §7.3 の「テーブルの列ヘッダ」（12px / 500 /
 *    `--color-fg-muted`）であり、**画面側で上書きしない**。
 */
const tableHeadVariants = cva('h-10 text-left text-xs font-medium text-fg-muted', {
  variants: {
    whitespace: WHITESPACE_CLASSES,
    align: ALIGN_CLASSES,
    padding: HEAD_PADDING_CLASSES,
  },
  defaultVariants: { whitespace: 'nowrap', align: 'inherit', padding: 'normal' },
});

/** セル（`<td>`）。文字サイズは `Table`（`--text-cell`）から継ぐ（セルごとに変えない）。 */
const tableCellVariants = cva('', {
  variants: {
    whitespace: WHITESPACE_CLASSES,
    align: ALIGN_CLASSES,
    padding: CELL_PADDING_CLASSES,
  },
  defaultVariants: { whitespace: 'nowrap', align: 'inherit', padding: 'normal' },
});

export type TableProps = ComponentProps<'table'> & {
  /**
   * 器（`overflow-x-auto` の `<div>`）に足すクラス。
   * ⚠️ upstream は器を触れないが、既存画面が器に枠線・角丸を持たせているため穴を開ける。
   * 🔴 `overflow-x-auto` を打ち消すクラスを渡さないこと（横溢れが `<html>` に抜ける）。
   */
  readonly containerClassName?: string;
};

export function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div className={cn('relative w-full overflow-x-auto', containerClassName)}>
      <table className={cn('w-full caption-bottom text-cell', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn(
        'border-t border-border bg-bg-subtle font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

// 🔴 `align` は `<td>` / `<th>` の**非推奨の HTML 属性**でもあり、React の型は
//    `"left" | "center" | "right" | "justify" | "char"` を宣言している。素で交差させると
//    `never` になるため `Omit` で外す（属性としては出さない。値は class に変換して使う）。
export type TableRowProps = Omit<ComponentProps<'tr'>, 'align'> & {
  /**
   * この行のセルの縦位置（`TableCellAlign` の表を読むこと）。
   * 🔴 **セル側が `align` を明示していないときにだけ効く**（明示されたセルはそちらが勝つ）。
   *    行内でセルの高さが大きく違う表（`S-008` / `S-036`）はここで `top` にする。
   */
  readonly align?: TableCellAlign;
};

export function TableRow({ className, align = 'inherit', ...props }: TableRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-border',
        TRANSITION_CLASSES,
        // hover（transient）: 背景を 1 段暗く。🔴 **文字色は変えない**（docs/04 §7.10）。
        // ✅ 2026-10-02: `bg-bg-subtle` → `bg-row-hover-bg`（**値は同一の `slate-50`**）。
        //    行の hover は「部品 1 つのための色」なので component 層の名前を持つ（§7.9 の ③）。
        'hover:bg-row-hover-bg',
        SELECTED_ROW_CLASSES,
        ALIGN_CLASSES[align],
        className,
      )}
      {...props}
    />
  );
}

export type TableHeadProps = Omit<ComponentProps<'th'>, 'align'> & {
  readonly whitespace?: TableCellWhitespace;
  /** 既定は `inherit`（`<tr>` の指定 → 無ければ UA の `middle`）。`TableCellAlign` の表を読むこと。 */
  readonly align?: TableCellAlign;
  /** 既定は `normal`（`px-3`）。`TableCellPadding` を読むこと。 */
  readonly padding?: TableCellPadding;
};

export function TableHead({
  className,
  whitespace = 'nowrap',
  align = 'inherit',
  padding = 'normal',
  ...props
}: TableHeadProps) {
  return (
    <th
      className={cn(
        tableHeadVariants({ whitespace, align, padding }),
        CHECKBOX_CELL_CLASSES,
        className,
      )}
      {...props}
    />
  );
}

export type TableCellProps = Omit<ComponentProps<'td'>, 'align'> & {
  readonly whitespace?: TableCellWhitespace;
  /** 既定は `inherit`（`<tr>` の指定 → 無ければ UA の `middle`）。`TableCellAlign` の表を読むこと。 */
  readonly align?: TableCellAlign;
  /** 既定は `normal`（`px-3 py-2`）。`TableCellPadding` を読むこと。 */
  readonly padding?: TableCellPadding;
};

export function TableCell({
  className,
  whitespace = 'nowrap',
  align = 'inherit',
  padding = 'normal',
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn(
        tableCellVariants({ whitespace, align, padding }),
        CHECKBOX_CELL_CLASSES,
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('mt-4 text-xs text-fg-muted', className)} {...props} />;
}
