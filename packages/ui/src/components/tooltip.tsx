'use client';
// packages/ui/src/components/tooltip.tsx
// 🔴 `docs/04` §5-13 の `Tooltip`: **切り詰めた文字列の全文、列ヘッダの補足。**
//    実装は `@radix-ui/react-tooltip`（入出力は §5-13 のとおり「入力: 文字列 / 出力: なし」）。
//
// ============================================================================
// 🔴 §5-13 / `U-16` / `CLAUDE.md` §13.3 の規約を、どう**型**で守ったか
// ============================================================================
// 条文: 🔴 **ツールチップだけにしか無い情報を作らない**（触端末で開けない）/
//       🔴 **判断材料をツールチップに入れない**。
//
// - **`content: string`**（`ReactNode` ではない）。要素を渡せないので、ゲート結果・表・
//   リンク・ボタンを入れられない。**型がそのまま「文字列の補足だけ」を表している。**
// - ⚠️ **それでも「そこにしか無い情報」は型では防げない**（文字列でも新情報は書ける）。
//   本部品ができるのは「入れられる形を狭めること」までであり、残りは呼び出し側の規約である
//   （`docs/04` `U-16` は **`lg` 以上の切り詰め + `title` 属性 + 同じ行に全文への導線**の
//   **組**を求めており、`components/name-cell.tsx` がその組を実装している）。
//   🔴 **一覧の名称セルに本部品を使わない** —— あちらは `title` 属性で全文を出す（触端末でも
//   長押しで読めるうえ、行が 1 万件あっても overlay を 1 万個作らない）。本部品は
//   **列ヘッダの補足**のような「数が少なく、無くても判断できる」場所に限る。
//
// 🔴 **`Esc` での閉じ・hover / focus の遅延・`aria-describedby` の紐づけを自作しない**
//    （§5-13 / §7 の既定採用理由の表）。Radix が持つ。
// 🔴 **`Provider` を部品の内側に持つ。** アプリのルートに Provider を置く形にすると、
//    **`apps/web/app/(main)/layout.tsx` に `'use client'` を足す**ことになり、主平面の全画面が
//    クライアントバンドルへ移る（`docs/05` §2.3.1 の 🔴。`client-db-boundary` の前提が崩れる）。
//    ⚠️ 代償は Provider が tooltip ごとに立つことだが、置き場所が 1 箇所（列ヘッダ等）で
//    件数が少ないため実害が無い。**一覧の行ごとに置く用途は上の 🔴 で禁じている。**
// 🔴 **文言を持たない**（`../index.ts` 規約 5）。
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { TOOLTIP_CONTENT_CLASSES } from '../lib/overlay-classes.js';

export type TooltipProps = {
  /**
   * 補足の文字列。
   * 🔴 **`string` である**（`ReactNode` ではない）。これが「判断材料を入れない」を型で守って
   *    いる 1 行である（ファイル冒頭）。
   */
  readonly content: string;
  /** ツールチップを持つ要素（列ヘッダの語など）。 */
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly className?: string;
  readonly 'data-testid'?: string;
};

export function Tooltip({ content, children, side = 'top', className, ...passThrough }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={cn(TOOLTIP_CONTENT_CLASSES, className)}
            side={side}
            sideOffset={4}
            {...passThrough}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
