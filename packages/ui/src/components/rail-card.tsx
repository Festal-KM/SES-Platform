// packages/ui/src/components/rail-card.tsx
// 🔴 右レールの 3 部品（2026-10-02 の人間のブリーフ）: **`RailCard`（文字）/ `Timeline`
//    （今日のスケジュール）/ `RankedList`（優先アクション）**。ホーム（`S-003` / `S-004`）の
//    右側の縦列に積む。
//
// ============================================================================
// 🔴 なぜ 3 つを 1 ファイルに置くのか（**器を `children` にしないため**）
// ============================================================================
// 3 つは**同じ面（カードの枠 + 見出し + 右端の導線）**を共有する。素朴に作ると
// `RailCard` が `children: ReactNode` を取り、その中に `Timeline` を入れる形になるが——
//
//   🔴 **`children` を取る部品は「何でも入れられる器」であり、規約はコメントだけになる**
//      （`./drawer.tsx` 冒頭の 🔴。本タスクの目的そのものが崩れる: 担当者が中に任意の JSX を
//      入れられると、そこから規約の外のスタイルが入り込む）。
//
// そこで **枠（`RailFrame`）はこのファイルの中だけの実装とし、export しない。** 3 つの公開部品は
// いずれも「文字列と配列」だけを受け取る。**同じ面の実装は 1 つ**（`../lib/surface-classes.ts`）で
// あり、3 箇所に写していない。
//
// ============================================================================
// 🔴 「閉じる」ボタンを持たない（ブリーフとの差分。**報告対象**）
// ============================================================================
// ブリーフは「右端のリンク**または閉じるボタン**」を求めている。🔴 **閉じるは実装していない。**
// 閉じるにはハンドラ（`onDismiss`）を受ける口が要り、その口を作ると部品が `'use client'` になる。
// 主バレル（`../index.ts`）の部品に `'use client'` を付けると、**それを 1 つ使うだけの
// サーバコンポーネントがクライアントバンドルへ移る**（`../index.client.ts` 冒頭の 🔴 /
// `tests/static/ui-overlay-contract.test.ts` が「`'use client'` を宣言するファイル = overlay 6 部品」を
// 凍結している）。お知らせの既読は Phase 2 の通知（`S-032`）と同じサーバ側の経路で行う。
//
// 🔴 **`'use client'` を宣言しない / 文言を持たない**（`../index.ts` の共通規約 4・5）。
import type { ComponentType, ReactNode } from 'react';
import { Badge } from './badge.js';
import type { SidebarLinkProps } from './sidebar.js';
import { cn } from '../lib/cn.js';
import { SECONDARY_LINK_CLASSES } from '../lib/link-classes.js';
import { SELECTED_CLASSES } from '../lib/state-classes.js';
import { CARD_PADDING_CLASSES, CARD_SURFACE_CLASSES } from '../lib/surface-classes.js';

/** 右端の導線（**遷移 1 本だけ**。🔴 `onClick` を持たない = 実行系を差し込めない）。 */
export type RailCardLink = {
  readonly href: string;
  readonly label: string;
};

function DefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** 🔴 レールの見出しは §7.3 の 2 段目（16px / 600）。セクション見出しと同じ段である。 */
const RAIL_TITLE_CLASSES = 'm-0 min-w-0 truncate text-lg font-semibold text-fg';
/** 本文（14px / 400）。 */
const RAIL_BODY_CLASSES = 'm-0 text-body text-fg';
/** 補助（12px / `--color-fg-muted`）。 */
const RAIL_META_CLASSES = 'm-0 text-xs text-fg-muted';

type RailFrameProps = {
  readonly title: string;
  readonly link: RailCardLink | null;
  readonly testIdPrefix: string;
  readonly linkComponent: ComponentType<SidebarLinkProps>;
  readonly className: string | undefined;
  /**
   * ⚠️ **このファイルの中だけで使う内部実装である**（export しない）。公開部品は
   *    `children` を受け取らない（ファイル冒頭の 🔴）。
   */
  readonly children: ReactNode;
};

function RailFrame({
  title,
  link,
  testIdPrefix,
  linkComponent: Link,
  className,
  children,
}: RailFrameProps) {
  return (
    <section
      data-testid={`${testIdPrefix}root`}
      className={cn(CARD_SURFACE_CLASSES, CARD_PADDING_CLASSES, 'flex flex-col gap-2', className)}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className={RAIL_TITLE_CLASSES}>{title}</h2>
        {link === null ? null : (
          <Link
            className={cn('ml-auto shrink-0 rounded-sm underline', SECONDARY_LINK_CLASSES)}
            href={link.href}
            data-testid={`${testIdPrefix}link`}
          >
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

// ============================================================================
// `RailCard` — 文字だけのカード（お知らせ / 使い方のヒント / 標語）
// ============================================================================

export type RailCardProps = {
  readonly title: string;
  /**
   * 本体。🔴 **段落の配列**（解決済みの文字列）。
   * 🔴 **`ReactNode` を受け取らない** —— ここを `children` にした瞬間に、右レールが
   *    「何でも置ける場所」になる（ファイル冒頭の 🔴）。
   */
  readonly lines: readonly string[];
  /** 右端の導線（`null` なら描かない）。 */
  readonly link?: RailCardLink | null;
  readonly testIdPrefix: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

export function RailCard({
  title,
  lines,
  link = null,
  testIdPrefix,
  linkComponent = DefaultLink,
  className,
}: RailCardProps) {
  return (
    <RailFrame
      title={title}
      link={link}
      testIdPrefix={testIdPrefix}
      linkComponent={linkComponent}
      className={className}
    >
      {lines.map((line, index) => (
        <p key={`${String(index)}-${line}`} className={RAIL_BODY_CLASSES} data-testid={`${testIdPrefix}line-${index}`}>
          {line}
        </p>
      ))}
    </RailFrame>
  );
}

// ============================================================================
// `Timeline` — 今日のスケジュール
// ============================================================================

export type TimelineEntry = {
  /** 開始（`10:00`）。🔴 **整形済み**（分精度までを呼び出し側が決める）。 */
  readonly startLabel: string;
  /** 終了（`11:00`）。 */
  readonly endLabel: string;
  readonly title: string;
  /** 相手・場所など（`null` なら描かない）。 */
  readonly subtitle: string | null;
  /**
   * 🔴 **いま進行中の 1 行**。強調はこの行だけに付く（§7.10 の selected = 背景 + 文字 + 左端 2px）。
   * ⚠️ **複数行に `true` を渡しても部品は弾かない**（「いま」の判定は時刻の問題であり、
   *    時計を持たない部品には検証できない。`./page-greeting.tsx` の 🔴 と同じ分担）。
   */
  readonly current: boolean;
};

export type TimelineProps = {
  readonly title: string;
  readonly entries: readonly TimelineEntry[];
  /** 🔴 **0 件のときの文言**（`今日の予定はありません`）。**必須**（空の箱を出さない）。 */
  readonly emptyLabel: string;
  readonly link?: RailCardLink | null;
  readonly testIdPrefix: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

/**
 * 1 行の基底。🔴 **全行で左端 2px を場所取りする**（進行中の行だけ色が付く形にすると、
 * 強調が移ったときに行が 2px ずれて「予定が動いた」ように見える。`./sidebar.tsx` と同じ理由）。
 */
const TIMELINE_ROW_CLASSES = 'flex items-baseline gap-3 border-l-2 border-l-transparent py-1 pl-2';
/** 時刻は本文と同じ段で、数字が揃うように `tabular-nums`。 */
const TIMELINE_TIME_CLASSES = 'shrink-0 text-xs text-fg-muted tabular-nums';

export function Timeline({
  title,
  entries,
  emptyLabel,
  link = null,
  testIdPrefix,
  linkComponent = DefaultLink,
  className,
}: TimelineProps) {
  return (
    <RailFrame
      title={title}
      link={link}
      testIdPrefix={testIdPrefix}
      linkComponent={linkComponent}
      className={className}
    >
      {entries.length === 0 ? (
        // 🔴 0 件でも枠は残す（右レールの列が日によって消えると、場所の記憶が効かない）。
        //    中身は専用の文言 1 行である（`EmptyState` は画面本体の空状態のための部品であり、
        //    `Primary` / `Secondary` の導線を持つので右レールには重い）。
        <p className={RAIL_META_CLASSES} data-testid={`${testIdPrefix}empty`}>
          {emptyLabel}
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0" data-testid={`${testIdPrefix}list`}>
          {entries.map((entry, index) => (
            <li
              key={`${String(index)}-${entry.startLabel}-${entry.title}`}
              data-testid={`${testIdPrefix}item-${index}`}
              data-current={entry.current ? 'true' : undefined}
              // 🔴 進行中の行だけ §7.10 の selected（背景 + 文字 + 左端 2px）を当てる。
              className={cn(TIMELINE_ROW_CLASSES, entry.current ? SELECTED_CLASSES : null)}
            >
              <span className={TIMELINE_TIME_CLASSES}>
                {entry.startLabel}–{entry.endLabel}
              </span>
              <span className="min-w-0">
                <span className="block text-body">{entry.title}</span>
                {entry.subtitle === null ? null : (
                  <span className={cn('block', RAIL_META_CLASSES)}>{entry.subtitle}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </RailFrame>
  );
}

// ============================================================================
// `RankedList` — 優先アクション
// ============================================================================

export type RankedListItem = {
  /**
   * 🔴 **順位は呼び出し側が渡す**（部品は並べ替えない）。
   *    理由: 優先順位は業務の判断（期限・金額・滞留日数の重み）であり、**決定的な算出は
   *    `packages/domain` の仕事**である（`CLAUDE.md` §12.3: 順位を部品や LLM に決めさせない）。
   *    部品が並べ替えると、画面に出ている順と API が返した順が食い違っても誰も気づけない。
   */
  readonly rank: number;
  readonly title: string;
  readonly subtitle: string | null;
  /**
   * 右端の印（`残り 2 日`）。
   * 🔴 **色は渡せない。** `urgent` が注意色（§7.4 の「直せば / 動けば進む」）を選び、
   *    それ以外は無彩色である（`./badge.tsx` の `StatusBadge` と同じ分担 ——
   *    **画面は色を渡せない**）。
   */
  readonly badge: { readonly text: string; readonly urgent: boolean } | null;
};

export type RankedListProps = {
  readonly title: string;
  readonly items: readonly RankedListItem[];
  /** 🔴 **0 件のときの文言**。**必須**（空の箱を出さない）。 */
  readonly emptyLabel: string;
  readonly link?: RailCardLink | null;
  readonly testIdPrefix: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

/**
 * 順位の数字（🔴 **円形はアバターとカウンタのみ**という §7.9 の例外のうちの「カウンタ」である）。
 * 🔴 無彩色（順位そのものに良し悪しは無い。1 位を brand で塗ると「進行中」の意味と衝突する）。
 */
const RANK_CLASSES =
  'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-bg-inset text-micro font-medium text-fg-muted tabular-nums';

export function RankedList({
  title,
  items,
  emptyLabel,
  link = null,
  testIdPrefix,
  linkComponent = DefaultLink,
  className,
}: RankedListProps) {
  return (
    <RailFrame
      title={title}
      link={link}
      testIdPrefix={testIdPrefix}
      linkComponent={linkComponent}
      className={className}
    >
      {items.length === 0 ? (
        <p className={RAIL_META_CLASSES} data-testid={`${testIdPrefix}empty`}>
          {emptyLabel}
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid={`${testIdPrefix}list`}>
          {items.map((item, index) => (
            <li
              key={`${String(item.rank)}-${item.title}`}
              data-testid={`${testIdPrefix}item-${index}`}
              className="flex items-baseline gap-2"
            >
              {/* 🔴 渡された順位をそのまま描く（1 から振り直さない）。 */}
              <span className={RANK_CLASSES} aria-hidden="true">
                {item.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-fg">{item.title}</span>
                {item.subtitle === null ? null : (
                  <span className={cn('block', RAIL_META_CLASSES)}>{item.subtitle}</span>
                )}
              </span>
              {item.badge === null ? null : (
                <Badge
                  variant={item.badge.urgent ? 'warning' : 'neutral'}
                  data-testid={`${testIdPrefix}badge-${index}`}
                >
                  {item.badge.text}
                </Badge>
              )}
            </li>
          ))}
        </ol>
      )}
    </RailFrame>
  );
}
