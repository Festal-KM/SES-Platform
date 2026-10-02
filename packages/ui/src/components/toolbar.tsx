// packages/ui/src/components/toolbar.tsx
// 🔴 一覧の上の帯（`docs/04` §5-13 / §3.2-2 / §5-10）。SP-22 `T-22-04`。
//    shadcn/ui の取り込みではなく本リポジトリ固有。
//
// ============================================================================
// 🔴 この部品の存在理由は「置き場所を固定すること」である
// ============================================================================
// 🔴 **母集団の 1 行（§3.2-2）と §5-10 の説明ブロックの置き場所を、ここに固定する。**
//    画面ごとに位置が変わると、**取引先が「自社分だけか」を毎画面で探すことになる**
//    （取引先は 1 日 4〜5 時間滞在する主利用者であり、説明不足は蓄積する。`CLAUDE.md` §1.2）。
//
//   | 段 | 内容 | 根拠 |
//   |---|---|---|
//   | 1 | 検索 / フィルタ（`filters`） | §5-13「一覧の上の帯」 |
//   | 2 | **母集団の 1 行**（`population`） | §3.2-2 の表の #2（「御社が登録した人材 128 件」）。**フィルタ帯の直下** |
//   | 3 | **見える範囲の説明**（`scopeNote`） | §5-10（「上記一覧のフィルタ帯直下」）。取引先向けの 1 行 |
//   | 4 | 一括操作（`bulkActions`） | §5-13。🔴 **モバイルで既定にしない** |
//
// 🔴 **他社の件数・存在・示唆を含めない**（§3.2 の「表現しないこと」/ `F-004 AC-4` / `F-006 AC-2`）。
//    → 文言はこの部品が持たない（共通規約 5）。**自社の範囲を肯定形で書く**のは呼び出し側の責務で
//      あり、**この部品は「他社」に相当する 2 つ目の母集団を受け取る prop を持たない**。
//
// ============================================================================
// 🔴 一括操作をモバイルで既定にしない（`CLAUDE.md` §13.3 / §5-13）
// ============================================================================
// 誤タップの影響が大きい（特に一括承認・一括送信）。実装は **`<details>`（既定は閉じる）**とした。
//   - 🔴 **`hidden lg:flex` で消さない** —— `CLAUDE.md` §13.3 は「Tier 3 の画面をモバイルで
//     非表示にしない。劣化はさせても遮断はしない」と定めている。消すのは遮断である。
//   - 🔴 **`<details open>` を `lg` 以上で開く**ことは CSS ではできない（`open` は属性であり、
//     ブレークポイントで切り替えるには `'use client'` が要る）。**どの幅でも既定で閉じる**方を選んだ ——
//     「既定にしない」を満たす最も単純な形であり、**幅によって既定が変わらない**ぶん挙動が読める。
//   - ⚠️ Phase 1 に一括操作は 1 つも無い（`DataTable` の `selection` を渡す画面が 0 件。
//     `S-015` の `F-016 AC-1` / `S-019` の `U-18`）。ここは**置き場所の予約**である。
//
// 🔴 `'use client'` を付けない（`../index.ts` の共通規約 4。展開は `<details>`）。
// 🔴 文言を持たない（共通規約 5）。
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_CLASSES } from '../lib/state-classes.js';

export type ToolbarProps = {
  /**
   * 🔴 **母集団の 1 行**（§3.2-2 の #2）。解決済みの文字列（件数を含む）。
   * **必須である** —— 一覧に母集団の明示が無い状態を作らないため。
   */
  readonly population: string;
  /**
   * 🔴 §5-10 の「見える範囲の説明ブロック」（取引先向け。1 行）。ホストの画面では `undefined`。
   * **自社の範囲を肯定形で書いた文字列**を渡す（否定形は他社の存在を意識させる）。
   */
  readonly scopeNote?: string;
  /** 検索欄・フィルタ（画面が組む。`SearchInput` / `Select` など）。 */
  readonly filters?: ReactNode;
  /**
   * ✅ 2026-10-03（SP-22 段④ / 人間のワイヤーフレーム「件数バー」）:
   * 🔴 **母集団の 1 行の右端**に置く補助（`S-010` の並び順の説明など）。
   *
   * 🔴 **なぜ `population` と同じ行なのか**: ワイヤーフレームの件数バーは
   *    「左に 母集団・件数 / 右に 並び順」の 1 本の帯である。画面側で別の行に積むと、
   *    **帯の中身の位置が画面ごとに変わる**（この部品の存在理由そのものを崩す）。
   * 🔴 **件数・他社の存在・示唆を含めない**（§3.2 の「表現しないこと」）。この穴は
   *    **並び順・表示の説明のため**であり、2 つ目の母集団を置く場所ではない。
   * ⚠️ `ReactNode` を受けるのは `filters` / `bulkActions` と同じ理由である ——
   *    画面が凍結済みの `data-testid` を持つ要素をそのまま渡せる必要がある
   *    （`project-list-order-note` は `docs/04` `U-22` の凍結対象で、E2E が掴んでいる）。
   */
  readonly note?: ReactNode;
  /** 一括操作。🔴 **どの幅でも既定で閉じた `<details>` の中に入る**（上の表）。 */
  readonly bulkActions?: ReactNode;
  /** 一括操作の開閉の語（`packages/i18n`）。`bulkActions` を渡すなら必須。 */
  readonly bulkActionsLabel?: string;
  /** 選択件数（一括操作の対象。`data-*` に出し、語には混ぜない）。 */
  readonly selectedCount?: number;
  /** testid の接頭辞（例 `engineer-list-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  readonly className?: string;
};

export function Toolbar({
  population,
  scopeNote,
  filters,
  note,
  bulkActions,
  bulkActionsLabel,
  selectedCount,
  testIdPrefix,
  className,
}: ToolbarProps) {
  // 🔴 実行時の壁: 語の無い開閉は押せない（`aria-label` の代わりに語を要求する。共通規約 5）。
  if (bulkActions !== undefined && bulkActionsLabel === undefined) {
    throw new Error(
      'Toolbar: bulkActions を渡すときは bulkActionsLabel（開閉の語）も渡してください（packages/ui は文言を持ちません）。',
    );
  }
  return (
    <div
      data-testid={`${testIdPrefix}toolbar`}
      // セクション間は §7.9 の `--space-4`（16px。「`Toolbar` の内側」）。
      className={cn('flex flex-col gap-4', className)}
    >
      {filters === undefined ? null : (
        <div data-testid={`${testIdPrefix}toolbar-filters`} className="flex flex-wrap items-end gap-3">
          {filters}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {/* 🔴 件数バー: 左に母集団の 1 行、右に `note`（並び順の説明）。
            🔴 母集団は補助テキストの段（§7.3: 12px / `--color-fg-muted`）。 */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p data-testid={`${testIdPrefix}toolbar-population`} className="text-xs text-fg-muted">
            {population}
          </p>
          {note === undefined ? null : (
            <div data-testid={`${testIdPrefix}toolbar-note`}>{note}</div>
          )}
        </div>
        {/* 🔴 §5-10 の説明ブロック。**フィルタ帯の直下**であることがこの部品の約束である。 */}
        {scopeNote === undefined ? null : (
          <p data-testid={`${testIdPrefix}toolbar-scope-note`} className="text-xs text-fg-muted">
            {scopeNote}
          </p>
        )}
      </div>
      {bulkActions === undefined ? null : (
        <details
          data-testid={`${testIdPrefix}toolbar-bulk`}
          data-selected-count={selectedCount ?? 0}
          className="border-t border-border pt-2"
        >
          <summary className={cn('cursor-pointer text-body font-medium text-fg underline', FOCUS_RING_CLASSES)}>
            {bulkActionsLabel}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">{bulkActions}</div>
        </details>
      )}
    </div>
  );
}
