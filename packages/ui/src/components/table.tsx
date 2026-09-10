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
// | 🔴 `border-b` / `border-t`（色を書かない） | `border-b border-slate-200` のように**色を必ず書く** | **v4 の border 既定色は `currentColor` である。** upstream は自分の `globals.css` で `* { @apply border-border }` を当てているが、本リポジトリにその宣言も `--color-border` も無い（実測: `theme.css` に 0 件）。**そのまま写すと文字色の濃い罫線が出る** |
// | `bg-muted/50` `bg-muted` `text-foreground` `text-muted-foreground` | `bg-slate-50` `bg-slate-100` `text-slate-500` | テーマ変数が無いため実色に置換（既存画面の `border-b border-slate-200 text-left text-slate-500` に合わせる） |
// | 🔴 `whitespace-nowrap`（`TableHead` / `TableCell`） | 同じ。ただし `whitespace` prop で切り替えられる | **落とさない**（現況 `.ses-table th, td { white-space: nowrap }` と同じ）。ただし折り返したいセル（スキル一覧など）が実在するため、**`className` ではなく prop で選ばせる** —— `cn()` は競合解決をせず `whitespace-normal` を渡しても勝てないため（`../lib/cn.ts` の規律 2） |
// | `p-2`（`TableCell`） / `px-2`（`TableHead`） | `px-3 py-2` | 既存 20 画面の実装（`px-3 py-2` が 57 + 32 箇所）に合わせる。**間隔だけの差** |
// | `[&:has([role=checkbox])]:pr-0` `[&>[role=checkbox]]:translate-y-[2px]` | 同じ | `S-013`（公開範囲）が表の中にチェックボックスを持つ |
// | `has-aria-expanded:bg-muted/50` | 取り込まない | 展開できる行を持つ表が無い。効かない語を増やさない |
// | `data-[state=selected]:bg-muted` | `data-[state=selected]:bg-slate-100` | フックは残す（行選択を作るときに使う） |
// | `"use client"`（upstream の table.tsx に付いている） | **付けない** | 🔴 状態もイベントハンドラも持たない器である。付けると、これを描いていた**サーバコンポーネントの画面が丸ごとクライアントバンドルへ移る**（T-21-02 の受け入れ基準 ③） |
// | `data-slot="table-*"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
//
// ⚠️ **移行時の注意**: 既存画面は `<div className="overflow-x-auto"><table …>` と自前で器を
//    書いている（14 箇所）。`Table` は器を内蔵するので、**移行では外側の器を残さず外す**
//    （二重にしても壊れないが、`overflow-x-auto` が 2 段になると横スクロールの起点が
//    どちらか読めなくなる）。器へクラスを渡したいときは `containerClassName` を使う。
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/** セルの折り返し。🔴 `className` では基底の `whitespace-nowrap` に勝てないため prop にする。 */
export type TableCellWhitespace = 'nowrap' | 'normal';

const WHITESPACE_CLASSES: Readonly<Record<TableCellWhitespace, string>> = {
  nowrap: 'whitespace-nowrap',
  normal: 'whitespace-normal',
};

/** チェックボックスを含むセルの詰め方（upstream と同じ）。 */
const CHECKBOX_CELL_CLASSES =
  '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]';

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
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
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
        'border-t border-slate-200 bg-slate-50 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-slate-200 transition-colors hover:bg-slate-50 data-[state=selected]:bg-slate-100',
        className,
      )}
      {...props}
    />
  );
}

export type TableHeadProps = ComponentProps<'th'> & {
  readonly whitespace?: TableCellWhitespace;
};

export function TableHead({ className, whitespace = 'nowrap', ...props }: TableHeadProps) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-slate-500',
        WHITESPACE_CLASSES[whitespace],
        CHECKBOX_CELL_CLASSES,
        className,
      )}
      {...props}
    />
  );
}

export type TableCellProps = ComponentProps<'td'> & {
  readonly whitespace?: TableCellWhitespace;
};

export function TableCell({ className, whitespace = 'nowrap', ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle',
        WHITESPACE_CLASSES[whitespace],
        CHECKBOX_CELL_CLASSES,
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('mt-4 text-sm text-slate-500', className)} {...props} />;
}
