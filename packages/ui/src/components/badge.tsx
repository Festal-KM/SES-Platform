// packages/ui/src/components/badge.tsx
// shadcn/ui の `Badge` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/badge.json`。
// upstream の基底（原文）:
//   inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full
//   border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap
//   transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px]
//   focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20
//   dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `inline-flex` `items-center` `justify-center` `gap-1` `rounded-full` `px-2` `py-0.5` `text-xs` | 同じ | 既存の実装（`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold`）とも一致する |
// | 🔴 `w-fit` `shrink-0` `whitespace-nowrap` `overflow-hidden` | 同じ | **1 語も落とさない。** T-21-01 で `Button` からこの 2 語（`shrink-0` / `whitespace-nowrap`）が落ちていたために、狭い flex コンテナで**ラベルが 1 文字ずつ折り返して隣の要素と重なる**実害が出た。バッジは表のセルと flex 行の中にしか置かれないため、同じ壊れ方をする位置にある |
// | `font-medium` | `font-semibold` | 既存 3 箇所（`sending-domain-status.tsx` / 管理平面 2 画面）が `font-semibold`。**同じ見た目のローカル実装を 2 つ作らない**ため既存に合わせる |
// | `border border-transparent` | `border` のみを基底に置き、**色はバリアント側**が持つ | 🔴 `cn()` は競合解決をしないため、基底の `border-transparent` とバリアントの `border-slate-300` を両方 class に載せると**どちらが勝つか読めない**（`../lib/cn.ts` の規律 2）。upstream は `cn = twMerge` なので成立している書き方であり、**そのまま写してはいけない語**である |
// | `transition-[color,box-shadow]` | `transition-colors` | 影を変えるバリアントが無い |
// | `focus-visible:*` `aria-invalid:*` `dark:*` | 取り込まない | テーマ変数が無く生成されない（`../lib/control-classes.ts` の表に同じ）。本リポジトリのバッジは状態表示であり、フォーカスを受けない |
// | `[&>svg]:pointer-events-none` `[&>svg]:size-3` | 取り込まない | アイコン（`lucide-react`）を持たない |
// | `asChild`（`radix-ui` の `Slot`） | 取り込まない | 新規依存。リンクとして使いたくなったら `<a>` の中にバッジを置く |
// | バリアント名 `default` / `secondary` / `destructive` / `outline` / `ghost` / `link` | `neutral` / `success` / `warning` / `danger` / `outline` | 🔴 本リポジトリのバッジは**状態**（`VERIFIED` / `PENDING` / `REGISTERED` / `FAILED`）を色で示す用途しかなく、upstream の `default`（primary 色）に対応するものが無い。色の実値は既存 `sending-domain-status.tsx` の対応表をそのまま使う |
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'outline';

/**
 * 🔴 枠線色・背景色・文字色は**すべてここが持つ**（基底に置かない）。
 *    基底とバリアントの両方が同じプロパティのユーティリティを出すと、`cn()` では
 *    どちらが勝つか決められない（`../lib/cn.ts`）。
 */
const VARIANT_CLASSES: Readonly<Record<BadgeVariant, string>> = {
  neutral: 'border-transparent bg-slate-100 text-slate-700',
  success: 'border-transparent bg-emerald-100 text-emerald-800',
  warning: 'border-transparent bg-amber-100 text-amber-800',
  danger: 'border-transparent bg-red-100 text-red-800',
  outline: 'border-slate-300 bg-transparent text-slate-700',
};

export type BadgeProps = ComponentProps<'span'> & {
  readonly variant?: BadgeVariant;
};

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}
