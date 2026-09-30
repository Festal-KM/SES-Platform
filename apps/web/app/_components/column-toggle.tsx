'use client';

// apps/web/app/_components/column-toggle.tsx
// 🔴 一覧の**列表示切替**（`docs/04` §7.1「既定 8 列 + 操作列。9 列目以降は列表示切替に格納する」/
//    §5-13 の `Toolbar`）。SP-22 `T-22-06`（`S-010` への配線）。
//
// ============================================================================
// 🔴 このファイルが存在する理由は「クライアント境界をここに宣言するため」である
// ============================================================================
// `DataTableColumnToggle` は `@ses/ui/client`（Radix の `DropdownMenu` を合成する）に在り、
// **`@ses/ui/client` を import するファイルは自身が `'use client'` を宣言していなければならない**
// （`tests/static/ui-dependency-single-path.test.ts` (i)⑤。宣言が無いと、その画面が丸ごと
// クライアントバンドルへ移り `client-db-boundary.test.ts` の前提が崩れる）。
//
// 🔴 したがって**境界はここ 1 ファイルに閉じる**。一覧の画面（`S-010` ほか）と器（`DataTable`）は
//    **サーバコンポーネントのまま**であり、50 行 × 8 列の描画はサーバに残る（`docs/05` §2.3.5 /
//    `T-22-04` 受け入れ基準 3）。**画面に `'use client'` を持ち込まない**ためのファイルである。
//
// ============================================================================
// 🔴 これは「2 つ目の部品」ではない（検査 (b) = `docs/05` §17.7.1 の二重実装禁止）
// ============================================================================
// **見た目・状態・a11y を 1 行も持たない。** メニュー・キーボード操作・`role` / `aria-*`・
// フォーカスの復帰・上限 6 項目の壁は**すべて `packages/ui` 側**（`DataTableColumnToggle` →
// `DropdownMenu` → Radix）に在り、ここは
//   ① `'use client'` の宣言（上記 (i)⑤）
//   ② トリガの `Button`（`@ses/ui` の部品。`variant` を選ぶだけ）
//   ③ `linkComponent={Link}`（`packages/ui` は `next/*` に依存しない〔検査 (i)④〕ため、
//      Next.js のリンクを渡せるのは `apps/web` 側だけである）
// の 3 つを繋いでいるだけである。
// 🔴 検査 (b)③ が禁じているのは `AppShell` / `PageHeader` / `DataTable` / `Drawer` / `EmptyState` /
//    `Skeleton` / `Toast` / `StatusBadge` を `apps/web` で**宣言すること**であり、本ファイルは
//    そのいずれも宣言しない（`@radix-ui/*` も `role="dialog"` も持たない = (b)①② にも触れない）。
// 🔴 **ここに列の定義・隠す規則・文言を持たせない。** 持たせた時点で「もう 1 つの部品」になる ——
//    どの列が `hideable` かは列定義（画面）、隠れているかは URL、語は `packages/i18n` が持つ。
//
// 🔴 **状態を持たない。** どの列を隠しているかは **URL のクエリ**が持ち、サーバが
//    `hiddenColumnIds` を組んで `DataTable` に渡す（`lib/ui/hidden-columns.ts`）。
//    ここはフックを 1 つも使わず、`useRouter` も持たない —— 項目は**リンク**であり、
//    遷移は `next/link` が行う（並び替え〔`DataTableSortLink`〕と同じ規律: 表示の状態は URL）。
// 🔴 文言を持たない（`packages/i18n` から画面が引いた文字列を props で受ける。`CLAUDE.md` §3.5）。
import Link from 'next/link';
import { Button } from '@ses/ui';
import { DataTableColumnToggle, type DataTableToggleableColumn } from '@ses/ui/client';

/**
 * 切替 1 件。🔴 **`href` は必須である**（この画面群では URL が唯一の置き場所であり、
 * ハンドラ方式〔押しても URL が変わらない〕を選べる形にしない）。
 */
export type ColumnToggleItem = DataTableToggleableColumn & {
  /** その列の表示 / 非表示を反転した URL（検索条件とページの位置を保ったもの）。 */
  readonly href: string;
};

export function ColumnToggle({
  columns,
  triggerLabel,
  testIdPrefix,
}: {
  /** 🔴 `hideable` を持つ列だけ（9 列目以降）。空なら部品側が何も描かない。 */
  readonly columns: readonly ColumnToggleItem[];
  /** メニューを開く語（例「表示する列」）。`packages/i18n` が出所。 */
  readonly triggerLabel: string;
  /** testid の接頭辞（例 `project-list-column-toggle-`）。 */
  readonly testIdPrefix: string;
}) {
  return (
    <DataTableColumnToggle
      // 🔴 secondary（§7.6）。列の出し入れは primary でも破壊的操作でもない。
      trigger={
        <Button type="button" variant="secondary" data-testid={`${testIdPrefix}trigger`}>
          {triggerLabel}
        </Button>
      }
      columns={columns}
      linkComponent={Link}
      testIdPrefix={testIdPrefix}
    />
  );
}
