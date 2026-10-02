// packages/ui/src/components/global-search-box.tsx
// 🔴 上部バーの検索の入口（2026-10-02 の人間のブリーフ）。**見た目は入力欄、実体は遷移 1 本。**
//
// ============================================================================
// 🔴 「動かない検索窓」を作らない（本ファイルの主眼）
// ============================================================================
// ブリーフは「**見た目のみ**。`⌘K` の表示。🔴 **`href` で既存の検索画面へ遷移する**」と定めている。
// 素朴に `<input>` を置くと次のどちらかになる:
//
//   ① 入力はできるが `Enter` で何も起きない → **壊れている機能に見える**（しかも「検索した
//      つもり」で先に進めなくなる。§7.8 の「失敗を黙って飲まない」と同じ性質の害）。
//   ② デバウンスと候補表示を実装する → `'use client'` が要り、**上部バー（＝ 主平面の全画面を
//      包む外枠）がクライアントバンドルへ移る**（`../index.client.ts` 冒頭の 🔴）。
//      既にある `SearchInput`（`@ses/ui/client`）は**一覧の絞り込み**のための部品であり、
//      横断検索はそれとは別の画面（`S-005` / `S-010` 等の検索条件）に属する。
//
// 🔴 **したがって `<a>`（遷移）である。** 入力欄の見た目を借りて「ここから検索に入れる」ことを
//    示し、押すと**実在する検索画面**へ行く。🔴 **`href` は必須**（遷移先の無い飾りを置かない）。
//    `⌘K` は**その画面に入る近道の予告**であり、キーバインド自体は Phase 2 の仕事である
//    （実装されるまで**嘘にならない**ように、押せる導線を必ず隣に置く形にしてある）。
//
// 🔴 **`'use client'` を宣言しない / 文言を持たない**（`../index.ts` の共通規約 4・5）。
import type { ComponentType } from 'react';
import type { SidebarLinkProps } from './sidebar.js';
import { cn } from '../lib/cn.js';
import { CONTROL_FIELD_SIZE_CLASSES } from '../lib/control-classes.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';
import { Icon } from '../icons.js';

export type GlobalSearchBoxProps = {
  /** 🔴 **必須**。既存の検索画面への遷移先。 */
  readonly href: string;
  /** 入力欄に見える文字（`案件・人材・提案を検索`）。🔴 未入力の色で描く。 */
  readonly placeholder: string;
  /**
   * 近道の表示（`⌘K`）。🔴 **語は呼び出し側が持つ**（共通規約 5。Windows では `Ctrl+K` に
   * なるため、**部品が記号を決めない**）。`null` なら描かない。
   */
  readonly shortcutHint: string | null;
  /** 読み上げの語（`検索`）。🔴 入力欄に見えるが実体はリンクなので、語が無いと用途が伝わらない。 */
  readonly label: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

function DefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/**
 * 入力欄の見た目を借りる。
 *
 * 🔴 **`CONTROL_BASE_CLASSES` をそのまま使わない。** あれは `w-full` と
 *    `placeholder:` / `aria-invalid:` / `disabled:` を含む**入力欄のための基底**であり、
 *    リンクに当てると効かない語が増える（`../index.ts` の規約 3「死んだ語を増やさない」）。
 *    🔴 **高さだけは `CONTROL_FIELD_SIZE_CLASSES`（= `--input-h`）から取る** ——
 *    上部バーで入力欄と同じ段に見えることが「検索欄だ」と読める条件である。
 * 🔴 **影は持たない。** 入力欄の輪郭の `shadow-control` は「書く対象」の印であり、
 *    これは遷移する要素である（影の許可を 3 箇所目に広げない。§7.9）。
 */
const BOX_CLASSES = cn(
  'inline-flex min-w-0 items-center gap-2 rounded-sm border border-border-strong px-3',
  CONTROL_FIELD_SIZE_CLASSES,
  'text-body text-fg-placeholder hover:bg-bg-subtle',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * 近道の表示。🔴 **`<kbd>`** で描く（見た目だけの装飾ではなく「キー」であることを DOM で示す）。
 * 🔴 無彩色（§7.4 の 6 系統を装飾に使わない）。
 */
const SHORTCUT_CLASSES =
  'ml-auto shrink-0 rounded-sm border border-border bg-bg-subtle px-1 text-micro text-fg-muted';

export function GlobalSearchBox({
  href,
  placeholder,
  shortcutHint,
  label,
  linkComponent: Link = DefaultLink,
  className,
}: GlobalSearchBoxProps) {
  return (
    <Link className={cn(BOX_CLASSES, className)} href={href} data-testid="app-header-search">
      {/* 🔴 §7.5 の許可①（テキストなしで意味が通る操作 = 検索）。印であって意味ではない。 */}
      <Icon name="search" />
      <span className="sr-only">{label}</span>
      <span className="min-w-0 truncate" aria-hidden="true">
        {placeholder}
      </span>
      {shortcutHint === null ? null : (
        <kbd className={SHORTCUT_CLASSES} aria-hidden="true">
          {shortcutHint}
        </kbd>
      )}
    </Link>
  );
}
