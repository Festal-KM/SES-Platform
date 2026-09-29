// packages/ui/src/components/data-table-selection.tsx
// 🔴 `DataTable` の行選択（`docs/04` §5-13 の改訂 17 / `docs/05` §2.3.1 の 6b / §2.3.5）。
//    SP-22 `T-22-04`。
//
// ============================================================================
// 🔴 行選択は既定で無効である（**この部品が存在すること自体が既定ではない**）
// ============================================================================
// `docs/04` §5-13（改訂 17）:
//   🔴 **行選択は既定で無効であり、画面が明示的に要求したときだけ描画する。**
//      選択列を「あるのが普通」にすると、
//        ① `S-015` の**一括の共有・解除を作らない**定め（`F-016 AC-1`）と
//        ② `S-019` の Phase 1 で**選択チェックボックスを描かない**定め（`U-18`）
//      が**部品側から破れる**。既定を無効にしておけば、選択が出ている画面は本書が明示した画面だけになる。
//
// 🔴 **Phase 1 で `selection` を渡す画面は 0 である**（`docs/05` §2.3.5 / §6.11.4）。
//    機械検査は `tests/static/datatable-column-contract.test.ts` (m)③（`selection` 属性の出現 0 件）。
//    → **ここは型と描き方の定義だけ**であり、現に選択列を出す画面は無い。
//
// ⚠️ 名前について（`docs/05` の 2 つの節の突き合わせ。**完了記録に出す**）:
//    §2.3.5 のコードは **`DataTableSelection<Row>` を「設定の型」**として宣言している
//    （`readonly selection?: DataTableSelection<Row>`）。§2.3.1 の表は同じ名前を
//    **「クライアント部品」**として挙げている。**1 つの名前に型と部品を両方は割り当てられない**ので、
//    型は §2.3.5 のまま `DataTableSelection<Row>`、部品は `DataTableSelectionCheckbox` とした。
//
// ⚠️ `'use client'` を宣言しない理由は `./data-table-sort-link.tsx` の冒頭と同じ
//    （フック・Radix を使わない。ハンドラは props で受けるため、**サーバから描くことは構造的にできない**）。
// 🔴 文言を持たない（`../index.ts` の共通規約 5）。`aria-label` の語は呼び出し側が渡す。
import { Checkbox } from './checkbox.js';

/**
 * 行選択の設定（`docs/05` §2.3.5 の `DataTableSelection<Row>`）。
 * 🔴 **`DataTable` の prop は任意であり、省略が既定 = 選択列を描かない。**
 */
export type DataTableSelection<Row> = {
  /** いま選ばれている行のキー（`rowKey` の値）。 */
  readonly selectedKeys: readonly string[];
  /** 1 行の選択を切り替える。 */
  readonly onToggleRow: (key: string) => void;
  /**
   * 全行の選択を切り替える（列ヘッダのチェックボックス）。
   * 🔴 **省略すると列ヘッダにチェックボックスを描かない** —— 「全部選ぶ」は一括操作そのもので
   *    あり、1 件ずつの選択とは危険度が違う（`CLAUDE.md` §13.3）。
   */
  readonly onToggleAll?: () => void;
  /** 列ヘッダのチェックボックスの `aria-label`（解決済み）。 */
  readonly allLabel: string;
  /** 各行のチェックボックスの `aria-label`（解決済み。行の名称を含めるのは呼び出し側の判断）。 */
  readonly rowLabel: (row: Row) => string;
};

export type DataTableSelectionCheckboxProps = {
  readonly checked: boolean;
  readonly onToggle: () => void;
  /** 🔴 必須（テキストの無い操作には `aria-label` が要る。§5-13 の `IconButton` と同じ規律）。 */
  readonly 'aria-label': string;
  /** testid の接頭辞（例 `proposal-list-select-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  /** 行のキー、または列ヘッダを表す語（testid の末尾に付く）。 */
  readonly target: string;
};

/** 選択のチェックボックス 1 つ（列ヘッダと各行で同じ形を使う）。 */
export function DataTableSelectionCheckbox({
  checked,
  onToggle,
  'aria-label': ariaLabel,
  testIdPrefix,
  target,
}: DataTableSelectionCheckboxProps) {
  return (
    <Checkbox
      checked={checked}
      onChange={onToggle}
      aria-label={ariaLabel}
      data-testid={`${testIdPrefix}${target}`}
    />
  );
}
