// packages/ui/src/components/pagination.tsx
// 🔴 カーソル方式のページ送り（`docs/04` §5-13 / §7.1 / §10.3 / `docs/05` §2.3.5 の `TBD-24`）。
//    SP-22 `T-22-04`。shadcn/ui の取り込みではなく本リポジトリ固有
//    （upstream の `Pagination` は**ページ番号（オフセット）前提**であり、本プロダクトの契約に反する）。
//
// ============================================================================
// 🔴 持たないもの（これがこの部品の設計の本体である）
// ============================================================================
// | 持たない | 理由（`docs/04` §7.1 / §10.3 / §5-13） |
// |---|---|
// | **オフセット / ページ番号** | 一覧は**カーソル方式**である（`docs/05` §6.1）。番号を出すには総件数が要り、総件数を出すには毎回 `COUNT(*)` が要る（1 万件規模で応答目標を割る） |
// | **総件数** | 🔴 `S-015`（匿名共有の設定）は **`total` を返さない API** と対になっている（`docs/05` §6.11.4。他社の母集団を推測させない）。**部品が総件数の prop を持つと、持っていない画面が「0 件」を出す** |
// | **無限スクロール** | 🔴 位置が失われ、比較の用を成さない（§10.3「多数行」）。**一覧を行き来しながら候補を絞る**業務では、戻ったときに同じ行が同じ場所に在ることが前提である |
//
// 🔴 **`prevCursor` は任意**（`docs/05` §2.3.5 の `TBD-24`）。現行の一覧 API は `nextCursor` だけを
//    返し、**応答にキーを足さない**方針である。したがって「前へ」は
//    ①API が `prevCursor` を持つ画面ではそれを使い ②持たない画面は **URL の `cursor` 履歴**
//    （ブラウザの戻る / 画面が積んだ 1 つ前のカーソル）で実現する。
//    → この部品は **href を受け取るだけ**でカーソルの組み立てを知らない。
//
// 🔴 `'use client'` を付けない（`../index.ts` の共通規約 4）。ページ送りは**リンク**であり、
//    並び替えと同じく**サーバが次の並びを確定させる**（`./data-table.tsx` の 🔴 と同じ理由）。
// 🔴 文言を持たない（共通規約 5）。`next/link` にも依存しない（`linkComponent`）。
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/** 導線の部品が受け取る props（`next/link` の `Link` がそのまま満たす）。 */
export type PaginationLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
};

function DefaultLink({ href, className, children, ...rest }: PaginationLinkProps) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

export type PaginationProps = {
  /** 次ページの URL。🔴 `null` = 次が無い（**リンクにしない**）。 */
  readonly nextHref: string | null;
  /**
   * 前ページの URL。🔴 **任意**（`TBD-24`）。`undefined` は「この画面は前へを持たない」、
   * `null` は「前へは在るが今は先頭にいる」を表す。
   */
  readonly prevHref?: string | null;
  readonly nextLabel: string;
  readonly prevLabel: string;
  readonly linkComponent?: ComponentType<PaginationLinkProps>;
  /** testid の接頭辞（例 `engineer-list-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  readonly className?: string;
};

/**
 * 🔴 見た目は secondary（§7.6「閲覧系はテキストリンクに落とす」）。8 状態は
 *    `FOCUS_RING_CLASSES` / `TRANSITION_CLASSES` をプリミティブ側で持つ（§7.10）。
 */
const LINK_CLASSES = cn(
  'inline-flex items-center rounded-sm border border-border-strong bg-bg px-3 py-2 text-body text-fg',
  'hover:bg-bg-subtle active:bg-bg-inset',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * 端（次が無い / 先頭にいる）の表し方。
 * 🔴 **`disabled` の `<button>` にしない**（§7.10: disabled は「一時的で自明な不能」だけ。
 *    ページの端は恒常的な事実である）。🔴 **要素を消さない** —— 消すと「次へ」の位置が
 *    行き来のたびに動き、50 行を繰る操作でボタンを探し直すことになる。
 */
const EDGE_CLASSES = 'inline-flex items-center rounded-sm border border-border px-3 py-2 text-body text-fg-placeholder';

export function Pagination({
  nextHref,
  prevHref,
  nextLabel,
  prevLabel,
  linkComponent: Link = DefaultLink,
  testIdPrefix,
  className,
}: PaginationProps) {
  return (
    <nav data-testid={`${testIdPrefix}pagination`} className={cn('flex items-center gap-2', className)}>
      {prevHref === undefined ? null : prevHref === null ? (
        <span data-testid={`${testIdPrefix}pagination-prev-edge`} aria-disabled="true" className={EDGE_CLASSES}>
          {prevLabel}
        </span>
      ) : (
        <Link href={prevHref} className={LINK_CLASSES} data-testid={`${testIdPrefix}pagination-prev`}>
          {prevLabel}
        </Link>
      )}
      {nextHref === null ? (
        <span data-testid={`${testIdPrefix}pagination-next-edge`} aria-disabled="true" className={EDGE_CLASSES}>
          {nextLabel}
        </span>
      ) : (
        <Link href={nextHref} className={LINK_CLASSES} data-testid={`${testIdPrefix}pagination-next`}>
          {nextLabel}
        </Link>
      )}
    </nav>
  );
}
