// packages/ui/src/components/skeleton.tsx
// 🔴 ローディングの骨格（`docs/04` §5-13 / §10.4 の `Load` / `部分Load`）。SP-22 `T-22-04`。
//    shadcn/ui の `Skeleton`（`bg-accent animate-pulse rounded-md`）を土台に、本リポジトリの
//    トークンへ置き換えた。
//
// 照合日 2026-09-30 / `https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json`。
// upstream の基底（原文）: `bg-accent animate-pulse rounded-md`
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `bg-accent` | **`bg-bg-inset`**（`slate-100`） | テーマ変数 `--color-accent` は本リポジトリに無く、写すと **CSS を 1 行も生成しない**（`../index.ts` の共通規約 2）。§7.9 の「面」の最も内側（`--color-bg-inset`）を当てる |
// | `animate-pulse` | 同じ | §7.9 の transition の規約は **`transition-*`（状態変化）** に対する定めであり、待ち時間を示す `animation` は対象外。🔴 動くのは **opacity だけ**（`transform` / `height` を動かさない = 50 行の一覧が波打たない） |
// | `rounded-md`（6px） | **`rounded-sm`**（4px） | §7.9 の radius 2 段のうち、骨格が代理しているのは**セルの中の文字列**であってパネルではない |
// | `data-slot="skeleton"` | 取り込まない | 理由は `../lib/control-classes.ts` の表に同じ |
//
// ============================================================================
// 🔴 この部品が守る条文（`docs/04` §5-13 / §7.10 / §10.4）
// ============================================================================
//   🔴 **実際に入る行数・列数に合わせる。** 3 行の骨格の後に 50 行が入ると画面が跳ねる。
//      → **行数・列数はこの部品が決めない。** `DataTable` が `loadingRows`（画面が渡す `limit`）と
//        列定義の数だけ `Skeleton` を並べる（`./data-table.tsx`）。骨格 1 つは「1 つの値の代理」である。
//   🔴 **スピナーで画面全体を覆わない。** → 覆う形（全画面オーバーレイ / `fixed` / `inset-0`）を
//      この部品は**持たない**。§10.4 の `部分Load` が全画面で定義されている前提が崩れるためであり、
//      「どこが待ちで、どこはもう読める」が読めなくなる。
//
// 🔴 `'use client'` を付けない（`../index.ts` の共通規約 4）。🔴 文言を持たない（共通規約 5）——
//    `aria-hidden` にして読み上げから外し、進行の語（「読み込み中」）は**領域の側**が持つ。
import { cn } from '../lib/cn.js';

/**
 * 骨格の高さ。**代理する文字の段**（§7.3）に対応させる。
 * 🔴 「好きな高さ」を作らせない —— 高さが自由だと、骨格と実データで行の高さが変わって跳ねる。
 */
export type SkeletonHeight = 'cell' | 'body' | 'title';

/** §7.3 の段の実寸（13 / 14 / 20px）に近い既定スケールの高さ。 */
const HEIGHT_CLASSES: Readonly<Record<SkeletonHeight, string>> = {
  cell: 'h-3',
  body: 'h-4',
  title: 'h-6',
};

/**
 * 骨格の幅。🔴 **任意寸法を受け取らない**（`w-[137px]` が画面ごとに増えるのを止める）。
 * `full` は列の幅いっぱい、`half` / `quarter` は短い値（日付・件数）の代理。
 */
export type SkeletonWidth = 'full' | 'half' | 'quarter';

const WIDTH_CLASSES: Readonly<Record<SkeletonWidth, string>> = {
  full: 'w-full',
  half: 'w-1/2',
  quarter: 'w-1/4',
};

export type SkeletonProps = {
  /** 既定は `cell`（一覧のセル）。 */
  readonly height?: SkeletonHeight;
  /** 既定は `full`。 */
  readonly width?: SkeletonWidth;
  /** 縦に並べる本数（定義リスト・段落の代理）。既定 1。 */
  readonly lines?: number;
  readonly className?: string;
};

/** 骨格 1 本。`lines` を渡すと同じ形を縦に並べる（間隔は §7.9 の `--space-2` = 8px）。 */
export function Skeleton({ height = 'cell', width = 'full', lines = 1, className }: SkeletonProps) {
  const bar = cn('animate-pulse rounded-sm bg-bg-inset', HEIGHT_CLASSES[height], WIDTH_CLASSES[width]);
  if (lines <= 1) {
    return <span aria-hidden="true" className={cn('block', bar, className)} />;
  }
  return (
    <span aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_unused, index) => (
        // 🔴 `key` は位置でよい（骨格は同型で、並べ替えも差分更新も起きない）。
        <span key={index} className={bar} />
      ))}
    </span>
  );
}
