// packages/ui/src/components/data-table-column-toggle.tsx
// 🔴 `DataTable` の列表示切替（`docs/04` §7.1 / §5-13 / `docs/05` §2.3.1 の 6b / §2.3.5）。
//    SP-22 `T-22-04`。
//
// ============================================================================
// 🔴 これは「9 列目以降の置き場所」であって、列を隠す仕組み一般ではない
// ============================================================================
// `docs/04` §7.1: **既定 8 列 + 操作列。9 列目以降は列表示切替に格納する**
// （8 列を超えると横スクロールが常態化し、比較の用を成さなくなる）。
//
// 🔴 **ブレークポイントで列を落とすのは `priority` の仕事であり、この部品ではない**
//    （`./data-table.tsx`）。2 つを混ぜると、「いま消えている列は、狭いからか / 自分が外したからか」
//    が読めなくなる。
//      - `priority`（`always` / `lg` / `sm`）= **幅**で落ちる。§10.3 の表が一次資料。
//      - `hideable` + この部品 = **利用者が外す**。9 列目以降だけが対象。
//
// 🔴 **監視画面（`A-005` / `A-006`）と経路 5（`S-044` / `S-045`）には `hideable` が 1 つも無い**
//    （`docs/05` §2.3.5 / §6.11.4。検査 (m)①②）。したがってこの部品はそれらの画面に出ない。
//
// 🔴 `DropdownMenu`（Radix）を使う（`docs/05` §2.3.5「`hideable` を持つ列だけ
//    `DataTableColumnToggle`（`DropdownMenu`）」）。**器（`DataTable`）はこのファイルを import しない** ——
//    import すると 50 行 × 8 列をサーバで描く器が Radix と `'use client'` の塊を引き込む。
//    **画面が `Toolbar` の `filters` に置く。**
//
// 🔴 文言を持たない（`../index.ts` の共通規約 5）。列の語は `DataTableColumn.header` と同じ
//    文字列を呼び出し側が渡す。
import type { ReactNode } from 'react';
import { DROPDOWN_MENU_MAX_ITEMS, DropdownMenu, type DropdownMenuItems } from './dropdown-menu.js';

export type DataTableToggleableColumn = {
  /** 列の id（`DataTableColumn.id`）。 */
  readonly id: string;
  /** 列の語（`DataTableColumn.header` と同じ文字列）。 */
  readonly label: string;
  /** いま隠れているか。 */
  readonly hidden: boolean;
};

export type DataTableColumnToggleProps = {
  /**
   * 開く当たり判定（`IconButton` か `Button`）。
   * ⚠️ トリガはメニューの「外」である（見た目の選択は §7.6 の判断。`./dropdown-menu.tsx` と同じ）。
   */
  readonly trigger: ReactNode;
  /** 🔴 `hideable` を持つ列だけ（9 列目以降）。空なら**何も描かない**。 */
  readonly columns: readonly DataTableToggleableColumn[];
  /** 列の表示 / 非表示を切り替える。 */
  readonly onToggle: (columnId: string) => void;
  /** testid の接頭辞（例 `engineer-list-column-toggle-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
};

export function DataTableColumnToggle({ trigger, columns, onToggle, testIdPrefix }: DataTableColumnToggleProps) {
  // 🔴 切替の対象が無いときはメニューそのものを描かない（空のメニューを開かせない）。
  if (columns.length === 0) return null;
  // 🔴 実行時の壁（`./dropdown-menu.tsx` の `DROPDOWN_MENU_MAX_ITEMS` = 6 と対）。
  //    ここで落とすのは、メニュー側の例外メッセージだけでは**どの一覧の話か**が分からないためである。
  if (columns.length > DROPDOWN_MENU_MAX_ITEMS) {
    throw new Error(
      `DataTableColumnToggle: 切替できる列は ${String(DROPDOWN_MENU_MAX_ITEMS)} 列までです（docs/04 §5-13「項目 7 つ以上にしない」）。${String(columns.length)} 列渡されました。9 列目以降が 7 列を超えるなら、その一覧は列を持ちすぎています（§7.1）。`,
    );
  }
  // ⚠️ `DropdownMenuItems` は 1〜6 要素のタプルの合併である（型で件数を縛るため）。
  //    列は配列から組むので、ここでタプルに写す。🔴 **上の実行時の壁があるので、キャストで
  //    型の壁を越えた入力が黙って描かれることはない**（`./dropdown-menu.tsx` 側にも同じ壁がある）。
  const items = columns.map((column) => ({
    kind: 'action' as const,
    label: column.label,
    onSelect: () => {
      onToggle(column.id);
    },
  })) as unknown as DropdownMenuItems;
  return <DropdownMenu trigger={trigger} items={items} data-testid={`${testIdPrefix}menu`} />;
}
