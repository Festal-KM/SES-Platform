// packages/ui/src/index.client.ts — `@ses/ui/client` の公開 API（**クライアント部品だけ**）。
//
// ============================================================================
// 🔴 なぜバレルを 2 つに割るのか（`docs/05` §2.3.1 / §2.3.3）
// ============================================================================
// `package.json` の `exports` は **`"."` と `"./client"` の 2 つだけ**である
// （`packages/connectors` の `"."` / `"./aws"` と**同じ形**であり、理由も同じ）。
//
// 🔴 **主バレル（`./index.ts`）に overlay を載せない。** 載せると、`Button` を 1 つ使う
//    サーバコンポーネントが Radix と `'use client'` の塊を**参照していないのに**バンドルへ
//    引き込む。19 部品のうち**サーバのまま描けるのは 13 個**（`docs/05` §2.3.1 の表）であり、
//    その 13 個を描く画面がクライアント化する理由は 1 つも無い。
//
// 🔴 **`'use client'` はここ（バレル）に置かない。各部品ファイルの先頭にだけ置く。**
//    - 主バレル（`./index.ts`）にも `apps/web/app/(main)/layout.tsx` にも置かない ——
//      置くと**主平面の全画面**がクライアントバンドルへ移り、
//      `tests/static/client-db-boundary.test.ts` の前提（`'use client'` の閉包に `@ses/db` が
//      現れない）が「全画面が閉包に入る」形で崩れる。
//    - バレルは**再 export だけ**なので、境界を宣言するのは実体のあるファイルである。
//      再 export 経由でも、Next.js は各部品ファイルの `'use client'` を境界として扱う。
//    - 検査: `tests/static/ui-overlay-contract.test.ts`（このバレルが export する実装ファイルは
//      すべて `'use client'` を宣言している / 主バレル側は 1 つも宣言していない）。
//
// 🔴 **`@ses/ui/client` を import する側は、自身が `'use client'` を宣言していなければならない**
//    （`tests/static/ui-dependency-single-path.test.ts` (i)⑤）。サーバコンポーネントが
//    これを import すると、その画面が丸ごとクライアントへ移るためである。
//
// ============================================================================
// 🔴 ここに置く部品の条件
// ============================================================================
// **状態・イベントハンドラ・フック・Radix を要するもの**だけ（`docs/05` §2.3.1 の表の
// 「クライアント」の行）。T-22-03 時点の 6 部品は次のとおり:
//
//   | 部品 | クライアントである理由 |
//   |---|---|
//   | `Dialog` / `Drawer` | Radix（フォーカストラップ / `Esc` / スクロールロック） |
//   | `DropdownMenu` / `Tooltip` | Radix（方向キー / hover の遅延 / `aria-*` の紐づけ） |
//   | `Tabs` | Radix（方向キーでのタブ移動） |
//   | `Toast` | 閉じる操作（`onDismiss`）を受ける。⚠️ **フックは 1 つも使わない**（`components/toast.tsx`） |
//
// ⚠️ **後続タスクで増えるのは `DataTableSortLink` / `DataTableColumnToggle` /
//    `DataTableSelection`（`T-22-04`）と `SearchInput`（デバウンス）だけ**である
//    （`docs/05` §2.3.1 の表）。🔴 **サーバのまま描ける部品をここへ移さない。**
export { Dialog } from './components/dialog.js';
export type { DialogProps } from './components/dialog.js';
export { Drawer } from './components/drawer.js';
export type {
  DrawerDetailLink,
  DrawerItem,
  DrawerLinkProps,
  DrawerPassThrough,
  DrawerProps,
} from './components/drawer.js';
export { DROPDOWN_MENU_MAX_ITEMS, DropdownMenu } from './components/dropdown-menu.js';
export type {
  DropdownMenuActionItem,
  DropdownMenuItem,
  DropdownMenuItems,
  DropdownMenuLinkItem,
  DropdownMenuProps,
} from './components/dropdown-menu.js';
export { TABS_LIST_CLASSES, TABS_MAX_ITEMS, TABS_TRIGGER_CLASSES, Tabs } from './components/tabs.js';
export type { TabsItem, TabsItems, TabsProps } from './components/tabs.js';
export { Toast } from './components/toast.js';
export type { ToastKind, ToastProps, ToastSubject } from './components/toast.js';
export { Tooltip } from './components/tooltip.js';
export type { TooltipProps } from './components/tooltip.js';
// 🔴 overlay の component 層のクラス定数（`docs/04` §7.9 の ③）。**画面から組み直さない** ——
//    影が出てよい語（`shadow-md`）はこの 1 ファイルにしか無く、検査
//    （`tests/static/design-tokens.test.ts`）がそれを固定している。
export {
  DIALOG_PANEL_CLASSES,
  DIALOG_VIEWPORT_CLASSES,
  DRAWER_PANEL_CLASSES,
  DROPDOWN_MENU_CONTENT_CLASSES,
  DROPDOWN_MENU_ITEM_CLASSES,
  OVERLAY_BACKDROP_CLASSES,
  OVERLAY_BODY_CLASSES,
  OVERLAY_DEFINITION_LIST_CLASSES,
  OVERLAY_FOOTER_CLASSES,
  OVERLAY_LABEL_CLASSES,
  OVERLAY_LINK_CLASSES,
  OVERLAY_SURFACE_CLASSES,
  OVERLAY_TITLE_CLASSES,
  TOAST_PANEL_CLASSES,
  TOAST_VIEWPORT_CLASSES,
  TOOLTIP_CONTENT_CLASSES,
} from './lib/overlay-classes.js';
export type { OverlayLinkProps } from './lib/overlay-classes.js';
