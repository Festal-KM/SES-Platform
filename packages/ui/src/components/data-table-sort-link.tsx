// packages/ui/src/components/data-table-sort-link.tsx
// 🔴 `DataTable` の列ヘッダの並び替え（`docs/04` §5-13 / `docs/05` §2.3.1 の 6b / §2.3.5）。
//    SP-22 `T-22-04`。
//
// ============================================================================
// 🔴 並び替えは「リンク」である（クライアントで並べ替えない）
// ============================================================================
// 🔴 **並び順はサーバが確定させる。** リンクの `href` にソートキーを載せ、既存の各一覧 API の
//    決定的順序（`F-008 AC-5` / `docs/05` §6.11.4）を変えない。
// 🔴 **クライアントで並べ替えない** —— **同じデータで順序が変わると、営業判断の根拠にも
//    監査の根拠にもならない**（`docs/05` §2.3.5 の 🔴）。「あのとき上から 3 番目に居た候補」が
//    再現できないと、提案の経緯を後から説明できない。
//
// ============================================================================
// ⚠️ `'use client'` を宣言しない（`docs/05` §2.3.1 の 6b との差分。**完了記録に出す**）
// ============================================================================
// `docs/05` §2.3.1 は 6b の 3 部品を `@ses/ui/client` に置くと定めており、**置き場所は従っている**
// （`../index.client.ts` が export する）。一方で本ファイルは **`'use client'` を宣言しない**:
//
//   ① 🔴 **並び替えはリンクである。** 状態・イベントハンドラ・フック・Radix のいずれも要らない
//      （href は呼び出し側が組み、遷移はブラウザが行う）。
//   ② 🔴 **`DataTable` の器はサーバコンポーネントである**（`T-22-04` 受け入れ基準 3）。
//      列ヘッダは器が描くため、ここに `'use client'` を置くと **8 列のヘッダごとに
//      クライアント境界が生まれる**（50 行 × 8 列の p95 に効く箇所で、得るものが 1 つも無い）。
//   ③ `tests/static/ui-overlay-contract.test.ts` は `'use client'` を宣言するファイルの集合を
//      **overlay 6 部品に凍結**している。境界を増やさないので、その凍結は 1 行も動かない。
//
// 🔴 **クライアント側からも使える**（`@ses/ui/client` から import する画面が `'use client'` である
//    ことは検査 (i)⑤ が担保する）。宣言が無いことは「クライアントで使えない」ことを意味しない ——
//    境界は**取り込む側**が宣言する。
//
// 🔴 文言を持たない（`../index.ts` の共通規約 5）。`next/link` にも依存しない（`linkComponent`）。
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/** 並び順の向き（`docs/05` §2.3.5 の `sort.dir`）。 */
export type DataTableSortDirection = 'asc' | 'desc';

/** いま効いている並び（`docs/05` §2.3.5 の `sort`）。 */
export type DataTableSort = {
  readonly key: string;
  readonly dir: DataTableSortDirection;
};

/**
 * 並び替えの向きを表す印（`docs/04` §7.5 の許可① =「テキストなしで意味が通る操作 … 並び替え」）。
 * 🔴 **`lucide-react` は `T-22-05` で入る**ため、ここでは**呼び出し側から `ReactNode` で受ける**
 *    （`packages/ui` に依存を足さない）。渡されなければ印は描かれず、向きは `<th aria-sort>` と
 *    `data-sort-state` が伝える（読み上げと E2E は印に依存しない）。
 */
export type DataTableSortIndicators = {
  readonly asc: ReactNode;
  readonly desc: ReactNode;
};

/** 導線の部品が受け取る props（`next/link` の `Link` がそのまま満たす）。 */
export type DataTableSortLinkProps = {
  /** 押したときに適用される並びの URL（**呼び出し側が組む**。既存 API の並びを変えない）。 */
  readonly href: string;
  /** 列ヘッダの語（解決済み）。 */
  readonly label: string;
  /** この列にいま効いている向き。`null` = この列では並んでいない。 */
  readonly active: DataTableSortDirection | null;
  readonly indicators?: DataTableSortIndicators;
  readonly linkComponent?: ComponentType<{
    readonly href: string;
    readonly className: string;
    readonly children: ReactNode;
    readonly 'data-testid'?: string;
  }>;
  /** testid の接頭辞（例 `engineer-list-sort-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  /** 列の id（testid の末尾に付く）。 */
  readonly columnId: string;
};

function DefaultLink({
  href,
  className,
  children,
  ...rest
}: {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
}) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

/**
 * 列ヘッダの並び替えリンク。**`<th>` は器（`DataTable`）が描き、`aria-sort` も器が持つ**
 * （`<th>` の属性であり、その中のリンクの属性ではない）。
 */
export function DataTableSortLink({
  href,
  label,
  active,
  indicators,
  linkComponent: Link = DefaultLink,
  testIdPrefix,
  columnId,
}: DataTableSortLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        // 🔴 文字サイズ・色は `TableHead` から継ぐ（列ヘッダだけ大きくしない。§7.3）。
        'inline-flex items-center gap-1 rounded-sm text-fg-muted',
        // 🔴 hover は**背景を 1 段暗く**する（§7.10: 文字色は変えない）。列ヘッダの面は
        //    `--color-bg-subtle` なので 1 段は `--color-bg-inset` である。
        'hover:bg-bg-inset',
        TRANSITION_CLASSES,
        FOCUS_RING_CLASSES,
      )}
      data-testid={`${testIdPrefix}${columnId}`}
    >
      {label}
      {active === null || indicators === undefined ? null : (
        <span aria-hidden="true">{active === 'asc' ? indicators.asc : indicators.desc}</span>
      )}
    </Link>
  );
}
