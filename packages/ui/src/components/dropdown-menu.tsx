'use client';
// packages/ui/src/components/dropdown-menu.tsx
// 🔴 `docs/04` §5-13 の `DropdownMenu`: **行や画面の副次的な操作の格納。**
//    実装は `@radix-ui/react-dropdown-menu`（入出力は §5-13 のとおり「入力: 項目配列 / 出力: 選択」）。
//
// ============================================================================
// 🔴 §5-13 の 2 つの規約を、どう守ったか
// ============================================================================
// **① 🔴 primary / 破壊的操作をメニューに隠さない**（`S-013` の公開解除・`A-010` の停止は画面上の
//    secondary + 確認。§7.6）。**隠せる形を型から外す**:
//
//   - 項目は **`link`（遷移）** と **`action`（副次的な操作）** の 2 種だけで、
//     **`variant: 'destructive'` に相当する選択肢を持たない。** 破壊的操作は「赤くしてメニューに
//     入れる」のではなく**画面上に出して `Dialog` で確認する**のが条文であり、**赤い項目を
//     作れる口があると必ずそこに入る**（shadcn/ui の `DropdownMenuItem` は `variant="destructive"`
//     を持つが、**取り込まない**）。
//   - 🔴 **`Dialog` を項目から直接開かない**（メニューの中に確認を置かない）。`action` の
//     `onSelect` は呼び出し側の状態を変えるだけで、確認は画面の `Dialog` が受ける。
//
// **② 🔴 項目 7 つ以上にしない**（§5-13）。**「7 つ以上」= 7 も含む**ので上限は **6**
//    （`DROPDOWN_MENU_MAX_ITEMS`）。`Tabs` と同じ 2 段で守る:
//    **型**（1〜6 要素のタプルの合併）+ **実行時**（超えたら `Error`。黙って捨てない）。
//
// 🔴 **キーボード操作（↑↓ / Home / End / 文字での絞り込み）・`role="menu"` / `aria-*`・
//    `Esc` での閉じ・フォーカスの復帰を自作しない**（§5-13 / §7 の既定採用理由の表）。
// 🔴 **`focus-visible` のリングは `FOCUS_RING_CLASSES` と同一**（§7.10。
//    `../lib/overlay-classes.ts` の `OVERLAY_SURFACE_CLASSES` が取り込む）。
//    ⚠️ 項目の強調は `focus-visible` ではなく Radix の `data-[highlighted]` である ——
//    メニューの中の「いまどれ」はロービング tabindex ではなく `aria-activedescendant` 相当の
//    仕組みで表されるため（`../lib/overlay-classes.ts` の `DROPDOWN_MENU_ITEM_CLASSES`）。
// 🔴 **文言を持たない**（`../index.ts` 規約 5）。
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import {
  DROPDOWN_MENU_CONTENT_CLASSES,
  DROPDOWN_MENU_ITEM_CLASSES,
  type OverlayLinkProps,
} from '../lib/overlay-classes.js';

function DefaultLink({ href, className, children }: OverlayLinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** 🔴 §5-13「項目 7 つ以上にしない」= 上限 6（ファイル冒頭②）。 */
export const DROPDOWN_MENU_MAX_ITEMS = 6;

/** 遷移（別画面へ行くだけ。状態は変わらない）。 */
export type DropdownMenuLinkItem = {
  readonly kind: 'link';
  readonly label: string;
  readonly href: string;
};

/**
 * 副次的な操作。
 * 🔴 **破壊的操作をここに入れない**（ファイル冒頭①）。`Dialog` での確認を伴う操作は
 *    画面上の secondary ボタンに置く。
 */
export type DropdownMenuActionItem = {
  readonly kind: 'action';
  readonly label: string;
  readonly onSelect: () => void;
  /**
   * 一時的で自明な不能のときだけ立てる（§7.10）。
   * 🔴 **「権限が無い」「代理閲覧中」を `disabled` で表さない** —— その項目は
   *    **`items` から外す**（描画せず、理由テキストは画面側に置く。`docs/04` `U-10`）。
   */
  readonly disabled?: boolean;
};

export type DropdownMenuItem = DropdownMenuLinkItem | DropdownMenuActionItem;

/** 🔴 **1〜6 要素のタプルの合併**（`DROPDOWN_MENU_MAX_ITEMS` = 6。ファイル冒頭②）。 */
export type DropdownMenuItems =
  | readonly [DropdownMenuItem]
  | readonly [DropdownMenuItem, DropdownMenuItem]
  | readonly [DropdownMenuItem, DropdownMenuItem, DropdownMenuItem]
  | readonly [DropdownMenuItem, DropdownMenuItem, DropdownMenuItem, DropdownMenuItem]
  | readonly [DropdownMenuItem, DropdownMenuItem, DropdownMenuItem, DropdownMenuItem, DropdownMenuItem]
  | readonly [
      DropdownMenuItem,
      DropdownMenuItem,
      DropdownMenuItem,
      DropdownMenuItem,
      DropdownMenuItem,
      DropdownMenuItem,
    ];

export type DropdownMenuProps = {
  /**
   * メニューを開く当たり判定（`IconButton`〔`T-22-04`〕か `Button`）。
   * ⚠️ **トリガはメニューの「外」である** —— 見た目の選択は §7.6 の判断であり部品の判断では
   *    ないので、要素を受け取る（`Drawer` が `children` を持たないのとは別の話である）。
   */
  readonly trigger: ReactNode;
  readonly items: DropdownMenuItems;
  /** 揃え（Radix の `align`）。既定は右端（行の操作列に置くため）。 */
  readonly align?: 'start' | 'center' | 'end';
  /** `kind: 'link'` の項目を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` を渡す。 */
  readonly linkComponent?: ComponentType<OverlayLinkProps>;
  readonly className?: string;
  readonly 'data-testid'?: string;
};

export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  linkComponent: Link = DefaultLink,
  className,
  ...passThrough
}: DropdownMenuProps) {
  // 🔴 実行時の壁（ファイル冒頭②）。キャストで型の壁を越えた入力を黙って描かない。
  if (items.length > DROPDOWN_MENU_MAX_ITEMS) {
    // ⚠️ 連結せず 1 つのテンプレートにする理由は `./tabs.tsx` の同じ箇所に書いた。
    throw new Error(
      `DropdownMenu: 項目は ${String(DROPDOWN_MENU_MAX_ITEMS)} つまでです（docs/04 §5-13「項目 7 つ以上にしない」）。${String(items.length)} 件渡されました。`,
    );
  }
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className={cn(DROPDOWN_MENU_CONTENT_CLASSES, className)}
          align={align}
          sideOffset={4}
          {...passThrough}
        >
          {items.map((item) =>
            item.kind === 'link' ? (
              <DropdownMenuPrimitive.Item key={item.label} asChild>
                <Link href={item.href} className={DROPDOWN_MENU_ITEM_CLASSES}>
                  {item.label}
                </Link>
              </DropdownMenuPrimitive.Item>
            ) : (
              <DropdownMenuPrimitive.Item
                key={item.label}
                className={DROPDOWN_MENU_ITEM_CLASSES}
                disabled={item.disabled ?? false}
                onSelect={item.onSelect}
              >
                {item.label}
              </DropdownMenuPrimitive.Item>
            ),
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
