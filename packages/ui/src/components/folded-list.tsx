// packages/ui/src/components/folded-list.tsx
// 🔴 docs/04 §10.3「多数行（履歴・タイムライン・詳細画面内の展開リスト）」の共通規約（2026-09-18、改訂 13。
//    SP-12 `T-12-14` ③）: **折りたたんだ後の形は共通 —— 直近 N 行 + 「すべて表示」**。打ち切りではなく展開であり、
//    展開後は全行を描く（モバイルでも全行に到達できる）。並び順は呼び出し側の定めを保ち、展開の前後で行の順序を変えない。
//    折りたたみ始める閾値の既定は 11 行以上（10 行以下は全件）。**画面固有の例外（打ち切る・「他 N 件」で省略する）を作らない。**
//
// 🔴 shadcn/ui の取り込みではなく本リポジトリ固有。`index.ts` の共通規約 4「`'use client'` を付けない」に従い、
//    展開の状態はネイティブの `<details>` / `<summary>` に持たせる（フック無し。サーバコンポーネントからも描ける）。
//    残りの行は DOM に**常に存在**する（`<details>` が閉じているあいだは表示されないだけ）ので、「隠した行を後から取りに行く」
//    経路が無く、E2E の `toHaveCount` は折りたたみの内外を問わず全行を数える。
// 🔴 文言を持たない（共通規約 5）。「すべて表示」の語は呼び出し側が `packages/i18n` から解決して渡す。
//    件数を語に混ぜない（「他 N 件」は `F-004 AC-3` / `AC-4` の走査が「見えない件数の示唆」として禁じる語であり、
//    ここで既定の文言を作ると全画面がその語を持つことになる）。件数は `data-*` 属性に置く。
// 🔴 行（`rows`）は呼び出し側が `<li key=…>` として渡す。**このコンポーネントは行を並べ替えない・間引かない**。
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/** 直近として常に見せる行数（docs/04 §10.3「直近 10 行」）。折りたたむのはこれを**超えた**とき（= 11 行以上）。 */
export const FOLDED_LIST_DEFAULT_VISIBLE_COUNT = 10;

export type FoldedListProps = {
  /** 並び済みの行。各要素は `key` を持つ `<li>` であること。 */
  readonly rows: readonly ReactNode[];
  /** 「すべて表示」の語（`packages/i18n`）。 */
  readonly showAllLabel: string;
  /** 常に見せる行数。既定 `FOLDED_LIST_DEFAULT_VISIBLE_COUNT`。経験内容（`S-006` / `S-023` セクション 3）のように既定と違う閾値を持つ画面だけが渡す。 */
  readonly visibleCount?: number;
  /** 行のリスト（`<ol>`）に当てるクラス。折りたたみの内外で同じ器を描く。 */
  readonly listClassName?: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
};

/**
 * 直近 `visibleCount` 行 + 「すべて表示」。`rows.length <= visibleCount` なら折りたたまず全件を 1 つのリストに描く。
 *
 * 描画の形（折りたたむとき）:
 *   <div data-folded="true" data-total-count="12" data-hidden-count="2">
 *     <ol>…直近 10 行…</ol>
 *     <details><summary>すべて表示</summary><ol>…残り 2 行…</ol></details>
 *   </div>
 */
export function FoldedList({
  rows,
  showAllLabel,
  visibleCount = FOLDED_LIST_DEFAULT_VISIBLE_COUNT,
  listClassName,
  className,
  'data-testid': testId,
}: FoldedListProps) {
  const folded = rows.length > visibleCount;
  const visible = folded ? rows.slice(0, visibleCount) : rows;
  const rest = folded ? rows.slice(visibleCount) : [];
  return (
    <div
      className={className}
      data-testid={testId}
      data-folded={folded ? 'true' : 'false'}
      data-total-count={rows.length}
      data-hidden-count={rest.length}
    >
      <ol className={cn('flex flex-col gap-3', listClassName)}>{visible}</ol>
      {folded ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 underline underline-offset-2">{showAllLabel}</summary>
          <ol className={cn('mt-3 flex flex-col gap-3', listClassName)}>{rest}</ol>
        </details>
      ) : null}
    </div>
  );
}
