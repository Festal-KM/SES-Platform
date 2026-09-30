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
// ============================================================================
// ✅ `T-22-06`（列表示切替の配線）で足した 2 点
// ============================================================================
// ① 🔴 **列ごとの `href`（リンク方式）**。`DataTableSortLink`（並び替え）と**同じ理由**である ——
//    **どの列を隠しているかは URL が持つ**（サーバが `hiddenColumnIds` を組む）ので、
//    切替は「状態を持つ操作」ではなく**遷移**である。リンクにすると次の 3 つが同時に成立する:
//      - 🔴 一覧の器（`DataTable`）と画面が**サーバコンポーネントのまま**でいられる
//        （関数 prop を要求しないので、画面が `'use client'` になる圧力が消える）
//      - 再読込・共有・戻るで同じ見え方に戻る（`<form method="get">` の検索と同じ規律）
//      - 中クリック・キーボードで開ける（`<a>` として振る舞う）
//    ⚠️ `onToggle`（ハンドラ方式）も残す —— URL に載せない一時的な切替を将来使う余地のため。
//    🔴 **2 方式の混在は実行時に落とす**（列ごとに挙動が違う切替を作らない）。
// ② 🔴 **閉じているときに掴める `data-testid`**。メニューの項目は Radix の `Portal` に載るため
//    **開くまで DOM に無い**（`apps/web/app/_components/ui-overlays.render.test.tsx` の実測）。
//    したがって「切替が置かれているか」「いまどの列を外しているか」を検査できる要素が
//    **1 つも無かった**。器の `<div>` に `${testIdPrefix}root` と `data-hidden-columns` を出す。
//
// 🔴 文言を持たない（`../index.ts` の共通規約 5）。列の語は `DataTableColumn.header` と同じ
//    文字列を呼び出し側が渡す（**隠す / 表示するのどちらの操作かも呼び出し側の文言**である）。
import type { ComponentType, ReactNode } from 'react';
import { DROPDOWN_MENU_MAX_ITEMS, DropdownMenu, type DropdownMenuItems } from './dropdown-menu.js';
import type { OverlayLinkProps } from '../lib/overlay-classes.js';

export type DataTableToggleableColumn = {
  /** 列の id（`DataTableColumn.id`）。 */
  readonly id: string;
  /** 列の語（`DataTableColumn.header` と同じ文字列）。 */
  readonly label: string;
  /** いま隠れているか。 */
  readonly hidden: boolean;
  /**
   * 🔴 **この列の表示 / 非表示を反転した URL**（リンク方式。ファイル冒頭 ①）。
   * 渡すなら**全列に渡す**（混在は実行時に落ちる）。省略したときは `onToggle` が要る。
   */
  readonly href?: string;
};

export type DataTableColumnToggleProps = {
  /**
   * 開く当たり判定（`IconButton` か `Button`）。
   * ⚠️ トリガはメニューの「外」である（見た目の選択は §7.6 の判断。`./dropdown-menu.tsx` と同じ）。
   */
  readonly trigger: ReactNode;
  /** 🔴 `hideable` を持つ列だけ（9 列目以降）。空なら**何も描かない**。 */
  readonly columns: readonly DataTableToggleableColumn[];
  /**
   * 列の表示 / 非表示を切り替える（ハンドラ方式）。
   * 🔴 **列が `href` を持つときは渡さない**（2 方式の混在は実行時に落とす）。
   */
  readonly onToggle?: (columnId: string) => void;
  /** リンク方式の項目を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` を渡す。 */
  readonly linkComponent?: ComponentType<OverlayLinkProps>;
  /** testid の接頭辞（例 `engineer-list-column-toggle-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
};

export function DataTableColumnToggle({
  trigger,
  columns,
  onToggle,
  linkComponent,
  testIdPrefix,
}: DataTableColumnToggleProps) {
  // 🔴 切替の対象が無いときはメニューそのものを描かない（空のメニューを開かせない）。
  if (columns.length === 0) return null;
  // 🔴 実行時の壁（`./dropdown-menu.tsx` の `DROPDOWN_MENU_MAX_ITEMS` = 6 と対）。
  //    ここで落とすのは、メニュー側の例外メッセージだけでは**どの一覧の話か**が分からないためである。
  if (columns.length > DROPDOWN_MENU_MAX_ITEMS) {
    throw new Error(
      `DataTableColumnToggle: 切替できる列は ${String(DROPDOWN_MENU_MAX_ITEMS)} 列までです（docs/04 §5-13「項目 7 つ以上にしない」）。${String(columns.length)} 列渡されました。9 列目以降が 7 列を超えるなら、その一覧は列を持ちすぎています（§7.1）。`,
    );
  }
  // 🔴 実行時の壁: 方式の混在（ファイル冒頭 ①）。「押すと URL が変わる列」と
  //    「押しても URL が変わらない列」が同じメニューに並ぶと、戻る・共有の挙動が列ごとに違う。
  const linkColumns = columns.filter((column) => column.href !== undefined);
  if (linkColumns.length > 0 && linkColumns.length !== columns.length) {
    throw new Error(
      `DataTableColumnToggle: href は全列に渡すか 1 列も渡さないかのどちらかです（列ごとに切替の挙動が変わらないため）。${String(linkColumns.length)}/${String(columns.length)} 列にだけ渡されました。`,
    );
  }
  const linkMode = linkColumns.length === columns.length;
  if (linkMode && onToggle !== undefined) {
    throw new Error(
      'DataTableColumnToggle: href（リンク方式）と onToggle（ハンドラ方式）は同時に渡せません（どちらが効いたのか分からない切替を作らない）。',
    );
  }
  if (!linkMode && onToggle === undefined) {
    throw new Error(
      'DataTableColumnToggle: 列の href か onToggle のどちらかが必要です（押しても何も起きない切替を描かない）。',
    );
  }
  // ⚠️ `DropdownMenuItems` は 1〜6 要素のタプルの合併である（型で件数を縛るため）。
  //    列は配列から組むので、ここでタプルに写す。🔴 **上の実行時の壁があるので、キャストで
  //    型の壁を越えた入力が黙って描かれることはない**（`./dropdown-menu.tsx` 側にも同じ壁がある）。
  const items = (
    linkMode
      ? columns.map((column) => ({
          kind: 'link' as const,
          label: column.label,
          href: column.href ?? '',
        }))
      : columns.map((column) => ({
          kind: 'action' as const,
          label: column.label,
          onSelect: () => {
            onToggle?.(column.id);
          },
        }))
  ) as unknown as DropdownMenuItems;
  return (
    // 🔴 閉じているときに掴める唯一の要素（ファイル冒頭 ②）。**見た目のためのクラスを持たない** ——
    //    置き場所（`Toolbar` の帯）のレイアウトはあちらが決める。
    <div
      data-testid={`${testIdPrefix}root`}
      data-hidden-columns={columns
        .filter((column) => column.hidden)
        .map((column) => column.id)
        .join(' ')}
    >
      <DropdownMenu
        trigger={trigger}
        items={items}
        linkComponent={linkComponent}
        data-testid={`${testIdPrefix}menu`}
      />
    </div>
  );
}
