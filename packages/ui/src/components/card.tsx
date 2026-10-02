// packages/ui/src/components/card.tsx
// shadcn/ui の Card を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。S-003 / S-004 のセクション
// カード（要対応キュー等の骨格）。SP-21 / SP-22 T-22-01。
//
// 🔴 **`Card` を既定の入れ物にしない**（`docs/04` §7.2 / §7 の既定採用理由の表）。
//    採用するのは「性質の異なる情報を並列に置く場合」に限る。
//
// ============================================================================
// 🔴 T-22-01 で `shadow-sm` を撤去した（`docs/04` §7.9 の shadow の規約）
// ============================================================================
// §7.9: **shadow は overlay（Dialog / Drawer / DropdownMenu / Tooltip / Toast）にのみ使う。**
// 🔴 **階層は border と background の差で表す**（`--color-border` + `--color-bg-subtle`）——
// **カードを浮かせるための shadow を乱用しない。影が多い画面は「どれが操作可能か」の手がかりを
// 失う。** したがってカードの立体感は 1px の境界線だけで表す。
// ⚠️ **訂正（T-22-03）**: 旧文はここに「`--shadow-overlay` は宣言だけしてあり、使うのは
//    Phase 3b の overlay 部品である」と書いていたが、**そのトークンは宣言されていない**
//    （`docs/05` §2.3.2 の shadow の行が「宣言しない（既定の `shadow-sm` / `shadow-md` を使う）」と
//    定めており、`tests/static/design-tokens.test.ts` の `FORBIDDEN_TOKEN_PATTERNS` が
//    `/^--shadow-/` を `@theme` で禁じている）。T-22-03 で入った overlay 部品は
//    **Tailwind 既定の `shadow-md`** を使い、その語は `../lib/overlay-classes.ts` の 1 箇所にしか無い。
//
// | 語 | T-21 まで | T-22-01 | 理由 |
// |---|---|---|---|
// | radius | `rounded-lg`（8px） | `rounded-md`（6px） | §7.9 の radius は 2 段だけ。カードはパネルの段 |
// | 影 | `shadow-sm` | **なし** | 上記 |
// | 枠線 | `border-slate-200` | `border-border` | 同値（`slate-200`）をトークンで指す |
// | 背景 | `bg-white` | `bg-bg` | 同値（`white`）をトークンで指す |
// | `CardTitle` | `text-base font-semibold text-slate-900` | `text-lg font-semibold text-fg` | §7.3 の 2 段目（セクション見出し）= **16px / 600**。`text-base` と実寸は同じで、役割名で参照する（§7.9） |
// | `CardDescription` | `text-sm text-slate-500` | `text-body text-fg-muted` | 実寸は同じ 14px。§7.3 の「本文（値・説明）」であり、**補助テキストの 12px ではない**（カードの説明は注記ではなく内容である） |
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';
import { CARD_SURFACE_CLASSES } from '../lib/surface-classes.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  // ✅ 2026-10-02: 面を `CARD_SURFACE_CLASSES`（`bg-surface`）から取る。**値は同一（白）** であり、
  //    見た目は変わらない。🔴 **`KpiCard` / `RailCard` / `Timeline` / `RankedList` と同じ 1 定数**を
  //    使う（カードの面が 5 箇所に散ると「どれがカードか」が画面ごとに変わる）。
  return <div className={cn(CARD_SURFACE_CLASSES, className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold text-fg', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-body text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}
