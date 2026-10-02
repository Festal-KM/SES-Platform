// packages/ui/src/components/data-table.tsx
// 🔴 同型データの一覧の器（`docs/04` §5-13 / §7.1 / §10.3 / `docs/05` §2.3.5）。SP-22 `T-22-04`。
//    shadcn/ui の取り込みではなく本リポジトリ固有（`Table`〔`./table.tsx`〕の上に組む）。
//
// ============================================================================
// 🔴 この器がサーバコンポーネントであること（`T-22-04` 受け入れ基準 3）
// ============================================================================
// 🔴 **行の描画をクライアントへ移さない。** 既定 50 行 × 8 列は §7 の応答目標（p95）に直接効く。
//    `'use client'` を付けない（`../index.ts` の共通規約 4）ので、
//    **状態・イベントハンドラ・フックをこのファイルに持ち込めない。**
//    クライアント側に在るのは 3 部品だけである（`docs/05` §2.3.1 の 6b。`../index.client.ts`）:
//      - `DataTableSortLink`（`./data-table-sort-link.tsx`）… 並び替え。**リンク**であり境界を宣言しない
//      - `DataTableSelectionCheckbox`（`./data-table-selection.tsx`）… 行選択。Phase 1 で使う画面は 0
//      - `DataTableColumnToggle`（`./data-table-column-toggle.tsx`）… 列表示切替。**Radix を使うので
//        この器は import しない**（器が Radix を引き込まない）。画面が `Toolbar` に置く
//
// ============================================================================
// 🔴 §5-13 / §7.1 / §10.3 の条文 → この実装
// ============================================================================
// | 条文 | 実装 |
// |---|---|
// | 🔴 **`<table>` を保つ**（`TBD-22` の確定。CSS Grid にしない） | `./table.tsx` の `Table` / `TableRow` / `TableHead` / `TableCell`。**列幅は `minWidth` + `grow` を `style` で当てる**（`table-layout: auto` の下で「下限を持ち、余りは伸縮する列に配分」が成立する。`docs/04` §7.1 の `minmax()` の**挙動**を `<table>` で満たす） |
// | 🔴 **既定 8 列 + 操作列。9 列目以降は列表示切替へ** | `hideable` を持たない列が 8 を超えたら**実行時に落とす**（下の壁）。`DataTable` は行数を知らない（既定 50 / 25 / 100 は画面が `limit` として API に渡す。`docs/05` §2.3.5） |
// | 🔴 **列の隠す順序は列定義の `priority` で決め、画面ごとに実装しない** | `priority='lg'` → `hidden lg:table-cell` / `'sm'` → `hidden sm:table-cell` / `'always'` → 常に描く。🔴 **`max-*:` の打ち消し方向を使わない**（モバイル優先。`tailwind-breakpoints.test.ts`）。§10.3 の表が一次資料であり、**この器は表を持たない**（画面の列定義に写す） |
// | 🔴 **名称セルは既存 `NameCell` に委譲**（`U-16`） | 列定義が `nameCell` を持つとき `./name-cell.tsx` を描く。🔴 **2 つ目の実装を持たない**（`lg` 以上 = 切り詰め + `title` / `lg` 未満 = 折り返し / 下限幅 10rem はあちらが持つ） |
// | 🔴 **1 レコードをカードに割る表示形態を持たない**（§11-12） | **モバイル用の別レイアウトを持たない。** 狭い画面でも「列を間引いたテーブル」のままである（`priority`）。カードに割ると 1 万件の走査性が消え、行の高さが内容で変わる |
// | 🔴 **`selection` は任意で、省略が既定 = 選択列を描かない** | `selection?:`。`S-015` の `F-016 AC-1` と `S-019` の `U-18` を**部品側で**守る（改訂 17）。検査 (m)③ が「渡している呼び出しが 0 件」を見る |
// | sticky ヘッダは**下 border**で示す（🔴 影で示さない。§7.9） | `DATA_TABLE_HEADER_CLASSES`（`sticky top-0` + `border-b`）。**`shadow-*` を 1 語も書かない** |
// | 🔴 並び替えは**リンク**（クライアントで並べ替えない） | `./data-table-sort-link.tsx`。理由はそちらの冒頭 |
// | 空状態 | `empty`（`EmptyState` を受ける）。🔴 **初回空と絞込 0 は呼び出し側が文言を分ける**（§10.1 / §10.4） |
// | 骨格 | `loadingRows`。🔴 **実際に入る行数**（画面が `limit` を渡す）と**実際の列数**で描く（跳ねない。§5-13） |
// | カーソルページング | `./pagination.tsx`（別部品）。🔴 **この器はページングを知らない**（オフセット・総件数の prop を持たない） |
//
// ⚠️ **`docs/05` §2.3.5 のスケッチとの差分（3 点。完了記録に出す）**
//   ① **`rowHref`（行クリック）を持たない。** HTML では `<tr>` をリンクにできず、実現するには
//      クライアントの `onClick` か全セルの `<a>` 化が要る。前者は受け入れ基準 3（器はサーバ）に反し、
//      後者は 8 列 × 50 行 = 400 個の `<a>` を生む。`docs/04` §10.3 は全文への到達を
//      **「行クリック**または**名称セル自体が詳細画面へのリンク」**と定めているので、**後者**を採る
//      （`nameCell.href`）。**判断材料を隠していない**（`U-16` の組は `NameCell` が保つ）。
//   ② **`sort` に加えて `sortHref` を受け取る。** §2.3.5 は「リンクの `href` にソートキーを載せる」と
//      定めているが、href の組み立ては URL（既存のクエリ）の話であり `packages/ui` は
//      `next/navigation` に依存しない（§2.3.1）。したがって**呼び出し側から関数で受ける**。
//   ③ **`rowAttributes`（行の `data-*` と `className`）を受け取る**（`T-22-06` で追加）。
//      理由は `DataTableRowAttributes` の 🔴 にある —— `S-019` の「保留と送信失敗は別の印」を
//      検証している E2E が `<tr>` の属性を掴んでおり、器が通せないと**検出器が弱くなる**。
//      🔴 **`data-testid` は通さない**（凍結された行の testid を画面から上書きさせない）。
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import {
  DataTableSortLink,
  type DataTableSort,
  type DataTableSortDirection,
  type DataTableSortIndicators,
} from './data-table-sort-link.js';
import { DataTableSelectionCheckbox, type DataTableSelection } from './data-table-selection.js';
import { NameCell, type NameCellLinkProps } from './name-cell.js';
import { Skeleton } from './skeleton.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableCellWhitespace,
} from './table.js';

/** 🔴 §7.1 の「既定 8 列 + 操作列」。9 列目以降は `hideable` を持って列表示切替へ。 */
export const DATA_TABLE_MAX_VISIBLE_COLUMNS = 8;

/** 🔴 名称列の下限幅（10rem。`U-16` / `1a1e7f8`）。どのブレークポイントでも維持する。 */
export const DATA_TABLE_NAME_COLUMN_MIN_REM = 10;

/**
 * 列を落とす順序（`docs/05` §2.3.5）。🔴 **値で持つ**（画面が `hidden lg:` を直書きしない）。
 * `docs/04` §10.3 の「テーブルの列ごとの省略方針」の表が一次資料である。
 */
export type ColumnPriority = 'always' | 'lg' | 'sm';

/**
 * 🔴 **`max-*:` の打ち消し方向を使わない**（モバイル優先。`tests/static/tailwind-breakpoints.test.ts`）。
 * `always` は**クラスを出さない**（`./table.tsx` の `align='inherit'` と同じ規律）。
 */
const PRIORITY_CLASSES: Readonly<Record<ColumnPriority, string>> = {
  always: '',
  lg: 'hidden lg:table-cell',
  sm: 'hidden sm:table-cell',
};

/** 名称セル（`NameCell` に委譲する列）の定義。 */
export type DataTableNameCell<Row> = {
  /** 名称の全文（本文と `title` の両方に使う）。 */
  readonly name: (row: Row) => string;
  /** 全文へ到達する導線。🔴 `null` ならリンクを描かず、どの境界でも切り詰めない（`NameCell` の規約）。 */
  readonly href: (row: Row) => string | null;
};

type DataTableColumnBase = {
  readonly id: string;
  /** 🔴 解決済み文字列（i18n は呼び出し側。`docs/05` §2.3.1）。 */
  readonly header: string;
  /** 🔴 `docs/04` §10.3 の表が一次資料。 */
  readonly priority: ColumnPriority;
  /** 🔴 下限幅（名称列は 10rem をどの境界でも維持。`U-16`）。 */
  readonly minWidth: `${number}rem`;
  /** 🔴 余りを配分する列（明示した列だけが伸びる。§7.1 の `2xl` の定め）。 */
  readonly grow?: true;
  /** 省略 = 並び替え不可。 */
  readonly sortKey?: string;
  /** 🔴 9 列目以降（列表示切替に格納する）。 */
  readonly hideable?: true;
  /** 既存 `TableCell` の prop をそのまま通す。 */
  readonly whitespace?: TableCellWhitespace;
};

/**
 * 列定義（`docs/05` §2.3.5）。
 * 🔴 **`cell` と `nameCell` は排他**である —— `NameCell` は `<td>` 自身を描くため、
 *    両方を許すと `<td>` が入れ子になる（`DataTable` 側で 2 つ目の名称セル実装を持たない）。
 */
export type DataTableColumn<Row> =
  | (DataTableColumnBase & {
      readonly cell: (row: Row) => ReactNode;
      readonly nameCell?: never;
    })
  | (DataTableColumnBase & {
      readonly cell?: never;
      readonly nameCell: DataTableNameCell<Row>;
    });

/**
 * 行（`<tr>`）に足す属性。🔴 **`data-*` と `className` だけ**である。
 *
 * ============================================================================
 * 🔴 なぜこの穴が要るのか（`T-22-06` で足した。**装飾のためではない**）
 * ============================================================================
 * `S-019`（提案一覧）の行は、状態そのものを `<tr>` の属性として持っている:
 *   `data-state` / `data-failure-kind` / `data-send-hold` / `data-in-progress`。
 * 🔴 **これは E2E の掴み手であり、`CLAUDE.md` §7 の「0 件」を守っているテストの一部である** ——
 *    `tests/e2e/proposal-cycle.spec.ts` は「保留（`APPROVED` + 理由）と `SUBMIT_FAILED` が
 *    **別の印**であること」を、`tests/e2e/home.mobile.spec.ts` は「`SUBMIT_FAILED` の行が
 *    保留の印を持たないこと」を、**行の属性**で検証している（`docs/05` §10.4「失敗と保留を
 *    混同しない」）。器が行の属性を通せないと、この 2 本は `<td>` の中を覗く形に書き換える
 *    しかなくなり、**検出器が弱くなる**。
 * 🔴 **`data-testid` は受け取らない。** 行の testid は `testIdPrefix` + `rowKey` が決める
 *    （凍結された値〔`docs/04` `U-22`〕を画面から上書きできてはならない）。
 * 🔴 **見た目の自由を与えるための穴ではない。** `className` を許すのは
 *    `docs/04` §S-019 の「`検査中` / `送信中` の行は進行中の表現（点線枠）」のためである。
 */
export type DataTableRowAttributes = {
  readonly className?: string;
  /**
   * 🔴 **行の testid は渡せない**（型で封じる）。値は `testIdPrefix` + `rowKey` が決める ——
   *    凍結された値（`docs/04` `U-22`）を画面から上書きできてはならない。
   */
  readonly 'data-testid'?: never;
  readonly [key: `data-${string}`]: string | undefined;
};

export type DataTableProps<Row> = {
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** 行に足す `data-*` / `className`（上の 🔴）。省略が既定。 */
  readonly rowAttributes?: (row: Row) => DataTableRowAttributes;
  /**
   * 操作列（🔴 **1 行につき 1 つ**。一括操作は `Toolbar` 側）。
   * 🔴 **操作列はどのブレークポイントでも隠さない**（`S-015`: 1 件ずつの解除がモバイルで完結すること）。
   */
  readonly rowAction?: (row: Row) => ReactNode;
  /** 操作列の列ヘッダの語。`rowAction` を渡すなら必須（文言を持たないため）。 */
  readonly rowActionHeader?: string;
  /** いま効いている並び。 */
  readonly sort?: DataTableSort;
  /** 並び替えリンクの href を組む（`docs/05` §2.3.5 との差分 ②。ファイル冒頭）。 */
  readonly sortHref?: (key: string, dir: DataTableSortDirection) => string;
  /** 並び替えの向きの印（`lucide-react` は `T-22-05`。それまでは `undefined` で印を描かない）。 */
  readonly sortIndicators?: DataTableSortIndicators;
  /** 🔴 利用者が外した列（`hideable` を持つ列だけが対象）。`priority` とは別の仕組みである。 */
  readonly hiddenColumnIds?: readonly string[];
  /** 空状態（`EmptyState` を受ける）。🔴 初回空と絞込 0 の文言は呼び出し側が分ける。 */
  readonly empty: ReactNode;
  /** 🔴 骨格の行数（**実際に入る行数** = 画面が API に渡す `limit`）。渡すと行の代わりに骨格を描く。 */
  readonly loadingRows?: number;
  /** 🔴 **省略が既定 = 行選択を描かない**（§5-13 改訂 17）。 */
  readonly selection?: DataTableSelection<Row>;
  /** 導線（名称セル）を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` を渡す。 */
  readonly linkComponent?: ComponentType<NameCellLinkProps>;
  /** testid の接頭辞（例 `engineer-list-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  readonly className?: string;
  /** 器（`overflow-x-auto` の `<div>`）に足すクラス（`./table.tsx` の `containerClassName`）。 */
  readonly containerClassName?: string;
};

/**
 * 🔴 sticky ヘッダ（§5-13）。**下 border で示し、影で示さない**（§7.9 の 🔴
 * 「テーブルの sticky ヘッダは影ではなく下 border で示す」）。
 * ⚠️ `sticky` が効くには背景が要る（透過だと行が透けて読めない）。
 * ✅ 2026-10-02: 面は `--color-table-header-bg`（**値は従来と同一の `slate-50`**）。列ヘッダの地は
 *    「部品 1 つのための色」なので component 層の名前を持つ（§7.9 の ③）—— 行の hover と
 *    同じ `slate-50` でも**別の判断**であり、片方だけ変えたくなる日に差分が読める。
 * 🔴 ✅ 2026-10-03: **この `slate-50` が「何の上の `slate-50`」かは `Table` の器が決める。**
 *    `acbdd80` でページ地が `slate-50` になった直後は**ページ地と同値**で分離が消えていた。
 *    `./table.tsx` の器が `CARD_SURFACE_CLASSES`（白）を持つようになったので、列ヘッダは
 *    再び**白地の上の `slate-50`** に戻った。🔴 **値は 1 つも変えていない**（理由と実測は
 *    `./table.tsx` 冒頭の 🔴）。したがって `DataTable` 側の変更は 0 行である。
 */
export const DATA_TABLE_HEADER_CLASSES = 'sticky top-0 z-10 bg-table-header-bg';

/** 列 1 つの寸法（`docs/05` §2.3.3-4(c): 列定義由来の寸法は prop に残す）。 */
function columnStyle(column: DataTableColumnBase): CSSProperties {
  // 🔴 `grow` を持つ列だけが余りを受ける（`width: 100%` を複数列に与えると比例配分される）。
  return column.grow === true ? { minWidth: column.minWidth, width: '100%' } : { minWidth: column.minWidth };
}

function ariaSortOf(column: DataTableColumnBase, sort: DataTableSort | undefined): 'ascending' | 'descending' | 'none' | undefined {
  if (column.sortKey === undefined) return undefined;
  if (sort === undefined || sort.key !== column.sortKey) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowAttributes,
  rowAction,
  rowActionHeader,
  sort,
  sortHref,
  sortIndicators,
  hiddenColumnIds,
  empty,
  loadingRows,
  selection,
  linkComponent,
  testIdPrefix,
  className,
  containerClassName,
}: DataTableProps<Row>) {
  // ==========================================================================
  // 実行時の壁（🔴 型で縛れないものを、黙って描かせない）
  // ==========================================================================
  const alwaysShownCount = columns.filter((column) => column.hideable !== true).length;
  if (alwaysShownCount > DATA_TABLE_MAX_VISIBLE_COLUMNS) {
    throw new Error(
      `DataTable: 列表示切替に入らない列は ${String(DATA_TABLE_MAX_VISIBLE_COLUMNS)} 列までです（docs/04 §7.1「既定 8 列 + 操作列。9 列目以降は列表示切替に格納する」）。${String(alwaysShownCount)} 列渡されました。`,
    );
  }
  const nameColumnTooNarrow = columns
    .filter((column) => column.nameCell !== undefined)
    .filter((column) => Number.parseFloat(column.minWidth) < DATA_TABLE_NAME_COLUMN_MIN_REM)
    .map((column) => `${column.id}=${column.minWidth}`);
  if (nameColumnTooNarrow.length > 0) {
    throw new Error(
      `DataTable: 名称列の下限幅は ${String(DATA_TABLE_NAME_COLUMN_MIN_REM)}rem をどのブレークポイントでも維持します（docs/04 §10.3 / U-16）。${nameColumnTooNarrow.join(', ')}`,
    );
  }
  const sortableWithoutHref = columns.filter((column) => column.sortKey !== undefined).map((column) => column.id);
  if (sortableWithoutHref.length > 0 && sortHref === undefined) {
    throw new Error(
      `DataTable: sortKey を持つ列があるのに sortHref が渡されていません（並び順はサーバが確定させます。docs/05 §2.3.5）。対象: ${sortableWithoutHref.join(', ')}`,
    );
  }
  if (rowAction !== undefined && rowActionHeader === undefined) {
    throw new Error('DataTable: rowAction を渡すときは rowActionHeader（操作列の語）も渡してください（packages/ui は文言を持ちません）。');
  }

  // ==========================================================================
  // 列の絞り込み（🔴 `hideable` を持つ列だけが「利用者が外した列」の対象）
  // ==========================================================================
  const hidden = hiddenColumnIds ?? [];
  const shown = columns.filter((column) => !(column.hideable === true && hidden.includes(column.id)));
  const columnCount = shown.length + (selection === undefined ? 0 : 1) + (rowAction === undefined ? 0 : 1);
  const selectedKeys = selection === undefined ? [] : selection.selectedKeys;

  return (
    <Table
      data-testid={`${testIdPrefix}table`}
      className={className}
      containerClassName={containerClassName}
    >
      <TableHeader className={DATA_TABLE_HEADER_CLASSES}>
        <TableRow>
          {selection === undefined ? null : (
            <TableHead scope="col" className="w-10">
              {selection.onToggleAll === undefined ? null : (
                <DataTableSelectionCheckbox
                  checked={rows.length > 0 && selectedKeys.length === rows.length}
                  onToggle={selection.onToggleAll}
                  aria-label={selection.allLabel}
                  testIdPrefix={`${testIdPrefix}select-`}
                  target="all"
                />
              )}
            </TableHead>
          )}
          {shown.map((column) => (
            <TableHead
              key={column.id}
              scope="col"
              style={columnStyle(column)}
              className={PRIORITY_CLASSES[column.priority]}
              aria-sort={ariaSortOf(column, sort)}
              data-column-id={column.id}
            >
              {column.sortKey === undefined || sortHref === undefined ? (
                column.header
              ) : (
                <DataTableSortLink
                  href={sortHref(
                    column.sortKey,
                    sort !== undefined && sort.key === column.sortKey && sort.dir === 'asc' ? 'desc' : 'asc',
                  )}
                  label={column.header}
                  active={sort !== undefined && sort.key === column.sortKey ? sort.dir : null}
                  indicators={sortIndicators}
                  linkComponent={linkComponent}
                  testIdPrefix={`${testIdPrefix}sort-`}
                  columnId={column.id}
                />
              )}
            </TableHead>
          ))}
          {/* 🔴 操作列はどのブレークポイントでも隠さない（`S-015`）。 */}
          {rowAction === undefined ? null : <TableHead scope="col">{rowActionHeader}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loadingRows === undefined ? null : (
          // 🔴 骨格は**実際に入る行数・列数**で描く（3 行の骨格の後に 50 行が入ると画面が跳ねる）。
          Array.from({ length: loadingRows }, (_unused, index) => (
            <TableRow key={index} data-testid={`${testIdPrefix}skeleton-row-${index}`} aria-hidden="true">
              {Array.from({ length: columnCount }, (_unusedCell, cellIndex) => (
                <TableCell key={cellIndex}>
                  <Skeleton />
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
        {loadingRows !== undefined || rows.length > 0
          ? null
          : (
              <TableRow data-testid={`${testIdPrefix}empty-row`}>
                <TableCell colSpan={columnCount} whitespace="normal">
                  {empty}
                </TableCell>
              </TableRow>
            )}
        {loadingRows !== undefined
          ? null
          : rows.map((row) => {
              const key = rowKey(row);
              return (
                // 🔴 行の testid は器が決める（`rowAttributes` の `data-testid` は型で封じてある
                //    ので、先に書いても上書きされない）。**属性の並びは移行前と同じ**
                //    （`class` → `data-testid` → 画面が足した `data-*`）。
                <TableRow
                  key={key}
                  data-testid={`${testIdPrefix}row-${key}`}
                  {...(rowAttributes === undefined ? {} : rowAttributes(row))}
                >
                  {selection === undefined ? null : (
                    <TableCell className="w-10">
                      <DataTableSelectionCheckbox
                        checked={selectedKeys.includes(key)}
                        onToggle={() => {
                          selection.onToggleRow(key);
                        }}
                        aria-label={selection.rowLabel(row)}
                        testIdPrefix={`${testIdPrefix}select-`}
                        target={key}
                      />
                    </TableCell>
                  )}
                  {shown.map((column) =>
                    column.nameCell === undefined ? (
                      <TableCell
                        key={column.id}
                        style={columnStyle(column)}
                        className={PRIORITY_CLASSES[column.priority]}
                        whitespace={column.whitespace}
                        data-column-id={column.id}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ) : (
                      // 🔴 名称セルは `NameCell` に委譲する（切り詰め / 折り返し / 下限幅 / `title` /
                      //    導線の組はあちらが持つ。`U-16`）。
                      <NameCell
                        key={column.id}
                        name={column.nameCell.name(row)}
                        href={column.nameCell.href(row)}
                        linkComponent={linkComponent}
                        linkTestId={`${testIdPrefix}link-${key}`}
                        style={columnStyle(column)}
                        className={PRIORITY_CLASSES[column.priority]}
                        data-column-id={column.id}
                      />
                    ),
                  )}
                  {rowAction === undefined ? null : <TableCell>{rowAction(row)}</TableCell>}
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}
