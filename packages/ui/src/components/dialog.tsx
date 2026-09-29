'use client';
// packages/ui/src/components/dialog.tsx
// 🔴 `docs/04` §5-13 の `Dialog`（`Modal`）: **不可逆な操作の確認**と、**1 項目の入力**。
//    実装は `@radix-ui/react-dialog`（2026-09-29 に人間が依存の追加を承認。§5-13 の末尾）。
//
// ============================================================================
// 🔴 `'use client'` はこのファイルの先頭に在る（`docs/05` §2.3.1）
// ============================================================================
// バレルは `"."`（サーバ）と `"./client"`（Radix 系）の 2 つだけで、**`'use client'` は
// `./client` 側の各ファイル先頭にだけ**置く。🔴 **主バレル（`../index.ts`）にも
// `apps/web/app/(main)/layout.tsx` にも置かない** —— 置くと主平面の全画面がクライアント
// バンドルへ移り、`tests/static/client-db-boundary.test.ts` の前提（`'use client'` の閉包に
// `@ses/db` が現れない）が「全画面が閉包に入る」形で崩れる。
//
// ============================================================================
// 🔴 §5-13 / §7.2 の規約を、どう**型**で守ったか
// ============================================================================
// | 条文 | 実装 |
// |---|---|
// | 🔴 **判断材料を押し込まない**（§7.2） | **`children` を受け取らない。** 本文は `body: string`（1〜2 文）で、一覧・ゲート結果・プレビュー・差分のような塊は**渡す口が無い** |
// | 🔴 **スクロールが必要な量を入れない**（入るなら Drawer かページ） | 上と同じ理由で**渡せない**うえ、パネルは `max-h-[85vh] overflow-hidden`（`../lib/overlay-classes.ts`）。`overflow-y-auto` を**付けない** —— 付けた瞬間に「入れてよい」になる |
// | 🔴 **モーダルの上にモーダルを重ねない**（§7.2） | `field` は「**1 項目の入力**」のための単一のスロットであり、ここに 2 枚目の `Dialog` を置く用途は無い（JSDoc で明示）。Radix の `modal` は既定 `true` のままにし、背後の操作を封じる |
// | **呼び出し元に判断材料が既にあること**が前提 | `body` が**確認文**であることを型の名前で表す（`description` ではなく `body`。「説明を足す欄」ではない） |
// | 🔴 取消の語は **`キャンセル`**（§7.8。`戻る` は画面遷移の語） | `cancelLabel` を**必須**にし、文言は `packages/i18n` から呼び出し側が渡す（`../index.ts` 規約 5） |
//
// 🔴 **キーボード操作・フォーカストラップ・スクリーンリーダ対応を自作しない**（§5-13 /
//    §7 の既定採用理由の表）。`Esc` / フォーカストラップ / スクロールロック / `aria-modal` /
//    `aria-labelledby` / `aria-describedby` はすべて Radix が持つ。**`role="dialog"` を自分で
//    書かない**（Radix が出す。`tests/static/ui-primitive-single-impl.test.ts` (b)①）。
//
// 🔴 **`focus-visible` のリングは `../lib/state-classes.ts` の `FOCUS_RING_CLASSES` と同一**
//    （`../lib/overlay-classes.ts` が取り込む。§7.10「全プリミティブで同一」）。
//
// ⚠️ **制御（`open` / `onOpenChange`）のみを受ける。** `Dialog.Trigger` を持たせないのは、
//    トリガの見た目（primary / secondary / テキストリンク）が §7.6 の判断であって部品の
//    判断ではないためである。呼び出し側が既存の `Button` を置き、`onOpenChange(true)` を呼ぶ。
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { SECONDARY_LINK_CLASSES } from '../lib/link-classes.js';
import {
  DIALOG_PANEL_CLASSES,
  DIALOG_VIEWPORT_CLASSES,
  OVERLAY_BACKDROP_CLASSES,
  OVERLAY_BODY_CLASSES,
  OVERLAY_FOOTER_CLASSES,
  OVERLAY_TITLE_CLASSES,
} from '../lib/overlay-classes.js';

/**
 * 🔴 **`children` を持たない**（上の表）。`Omit` で明示的に外し、
 *    `<Dialog …>{判断材料}</Dialog>` と書けないようにする。
 */
export type DialogProps = Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'children' | 'asChild' | 'className' | 'title'
> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 表題（`packages/i18n` の値を呼び出し側が渡す）。 */
  readonly title: string;
  /**
   * 確認文（1〜2 文）。
   * 🔴 **`string` である**（`ReactNode` ではない）。これが「判断材料を押し込まない」と
   *    「スクロールが必要な量を入れない」を型で守っている 1 行である（§7.2 / §5-13）。
   *    一覧・ゲート結果・プレビュー・単価の内訳を見せたいなら **ページ**を使う。
   */
  readonly body: string;
  /**
   * 🔴 **「1 項目の入力」の単数のスロット**（§5-13）。`Field` + `Input` 1 組だけを置く。
   *    複数項目のフォームはウィザード（ページ）であり、ここには入らない（§7.2）。
   *    🔴 **ここに 2 枚目の `Dialog` を置かない**（モーダルの上にモーダルを重ねない。§7.2）。
   */
  readonly field?: ReactNode;
  /**
   * 確定操作（**1 つ**）。`Button` か、サーバアクションの `<form>` の submit を渡す。
   * 🔴 **`Dialog` 自身は何も実行しない** —— 実行系の責務は呼び出し側に在り、部品は摩擦
   *    （§7.6）だけを提供する。
   */
  readonly confirm: ReactNode;
  /** 🔴 **`キャンセル`**（§7.8。`やめる` / `戻る` を使わない）。押しても何も起きない。 */
  readonly cancelLabel: string;
  /** パネルに足すクラス（余白・幅の調整のみ。`../lib/cn.ts` 規律 1）。 */
  readonly panelClassName?: string;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  body,
  field,
  confirm,
  cancelLabel,
  panelClassName,
  ...props
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY_BACKDROP_CLASSES} />
        <div className={DIALOG_VIEWPORT_CLASSES}>
          <DialogPrimitive.Content className={cn(DIALOG_PANEL_CLASSES, panelClassName)} {...props}>
            <DialogPrimitive.Title className={OVERLAY_TITLE_CLASSES}>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={OVERLAY_BODY_CLASSES}>
              {body}
            </DialogPrimitive.Description>
            {field}
            <div className={OVERLAY_FOOTER_CLASSES}>
              {/*
                🔴 取消を先、確定を後（§7.6 の摩擦。誤って確定を押す並びにしない）。
                🔴 取消を `Button` の `secondary` にしない —— 確定と取消が同じ形だと
                   「どちらが実行か」が形で読めなくなる（§7.6「すべてのボタンを同じサイズ・
                   同じ形状にしない」）。副次的な導線と同じ語を使う（`../lib/link-classes.ts`）。
              */}
              <DialogPrimitive.Close className={SECONDARY_LINK_CLASSES}>
                {cancelLabel}
              </DialogPrimitive.Close>
              {confirm}
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
