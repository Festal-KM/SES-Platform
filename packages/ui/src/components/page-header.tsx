// packages/ui/src/components/page-header.tsx
// 主平面の**帯** —— パンくず / 画面タイトル / primary アクション（1 つ）。
// `docs/04` §3.1（レイアウト図の 3 行目）/ §3.4（モバイルの primary は画面下部の固定バー）/ §7.3 / §7.5 / §7.6。
// SP-22 `T-22-05`（`T-12-21` が `apps/web/app/(main)/_shell/page-heading.tsx` に置いた描画をここへ移した）。
//
// ============================================================================
// 🔴 なぜ描画だけがここに来て、組み立ては `apps/web` に残るのか
// ============================================================================
// `docs/05` §2.3.1: **19 部品はすべて `packages/ui/src/components/**` に置く**。
// `apps/web/app/(main)/_shell/page-heading.tsx` に残るのは**値の組み立てだけ**である
// （`packages/i18n` での語の解決 / `next/link` の受け渡し / `canAct` の判定）。
// 🔴 **帯を各画面が自分の本文の先頭で描く**という置き場所の判断（`T-12-21`）は変えていない ——
//    RSC ではページのデータがレイアウトへ流れないため（詳細は `_shell/page-heading.tsx` 冒頭）。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. **タイトルを二重に描かない** —— `title` が `null` なら `h1` を描かない（詳細画面は
//    エンティティ名の `h1` を画面本体が持つ。`tests/static/page-heading-single.test.ts`）。
// 2. **パンくずの祖先はリンクで、現在地はリンクにせず `aria-current="page"`。**
// 3. 🔴 **primary アクションは 1 つだけ**（§7.6）。**出すか出さないかは呼び出し側が決める**
//    （`VIEWER` / `PARTNER_VIEWER` に作成系の導線を配らない判定は `apps/web` 側に在る）。
// 4. 🔴 **モバイルでは primary を画面下部の固定バーに置く**（§3.4）。**同じ 1 要素**で両方を満たし、
//    2 つ描いて片方を隠さない。🔴 `bottom-12`（48px）はボトムタブ（`fixed bottom-0` / 高さ 33px）の
//    **上**であり重ならない。
// 5. 🔴 **アイコンを 1 つも使わない**（§7.5「見出し全部」「ボタン全部」）。`<svg>` が出ない。
// 6. 🔴 **`'use client'` を宣言しない / 文言を持たない。**
// 7. 🔴 **ブレークポイントは `md:` だけを使う**（`page-heading.render.test.tsx` が固定している。
//    サイドバーの形態の境界（`xl`）を帯に持ち込まない —— 帯は幅で形を変えない）。
import type { ComponentType } from 'react';
import type { SidebarLinkProps } from './sidebar.js';
import { cn } from '../lib/cn.js';
import { PRIMARY_LINK_CLASSES } from '../lib/link-classes.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

export type PageHeaderCrumb = {
  /** 解決済みの語（🔴 `packages/i18n` は呼び出し側）。 */
  readonly label: string;
  /** `null` = 現在地（リンクにしない）。 */
  readonly href: string | null;
  /**
   * その項目に付ける `data-testid`（🔴 **呼び出し側が文字列リテラルで書く**。`docs/05` §17.7.3）。
   *
   * 🔴 **「どの項目に付けるか」の判断もこの部品の外に在る**（`T-12-21` の「最後のリンク項目
   *    = 戻り先に付ける」は本リポジトリの規約であり、汎用部品の関心ではない）。
   *    加えて `data-testid={条件 ? x : undefined}` の形を部品に持ち込むと、
   *    `tests/static/testid-inventory.test.ts` の「`packages/ui` は値を作らない」に反する
   *    （三項の `undefined` 側が「ローカルで計算した値」と判定される）。
   */
  readonly testId?: string;
};

export type PageHeaderAction = {
  readonly label: string;
  readonly href: string;
};

export type PageHeaderProps = {
  readonly trail: readonly PageHeaderCrumb[];
  /** `<nav aria-label>`（読み上げで「この列が何か」が分かる語）。 */
  readonly breadcrumbLabel: string;
  /** 🔴 `null` なら `h1` を描かない（上の 1）。 */
  readonly title?: string | null;
  /** 🔴 既に「出してよい」と判定された primary だけを渡す（上の 3）。 */
  readonly action?: PageHeaderAction | null;
  /** primary の `data-testid`（🔴 呼び出し側が文字列リテラルで書く。`docs/05` §17.7.3）。 */
  readonly testId?: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

function DefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** 🔴 帯と本文の間は §7.9 の `--space-4`（16px）。 */
const HEADING_CLASSES = 'mb-4';

/** パンくず（🔴 §7.3 の補助テキスト = 12px / `--color-fg-muted`）。 */
const TRAIL_CLASSES = 'm-0 flex flex-wrap items-center gap-x-1 p-0 text-xs text-fg-muted';
const TRAIL_LINK_CLASSES = cn('rounded-sm underline', TRANSITION_CLASSES, FOCUS_RING_CLASSES);

/** 画面タイトル（🔴 §7.3 の 1 段目 = 20px / 600。**これ以上大きくしない**）。 */
const TITLE_CLASSES = 'mt-1 text-title font-semibold text-fg';

/**
 * primary アクション。
 * 🔴 見た目は `packages/ui` の 1 実装（`PRIMARY_LINK_CLASSES`）から取り、**配置だけをここが足す**。
 * 🔴 モバイル = 画面下部の固定バー（§3.4）/ `md:` 以上 = 帯の中（§3.1）。**1 要素で両方**を満たす。
 */
const ACTION_CLASSES = cn(
  PRIMARY_LINK_CLASSES,
  'fixed inset-x-4 bottom-12 z-20 md:static md:z-auto md:ml-auto md:inset-x-auto',
);

function Crumb({
  crumb,
  last,
  linkComponent,
}: {
  readonly crumb: PageHeaderCrumb;
  readonly last: boolean;
  readonly linkComponent: ComponentType<SidebarLinkProps>;
}) {
  const Link = linkComponent;
  return (
    <li className="flex items-center gap-1">
      {crumb.href === null ? (
        <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
      ) : (
        // 🔴 `data-testid` は**props の素通しだけ**（値を部品側で作らない。`PageHeaderCrumb` の 🔴）。
        <Link className={TRAIL_LINK_CLASSES} href={crumb.href} data-testid={crumb.testId}>
          {crumb.label}
        </Link>
      )}
      {/* 区切りは装飾ではなく階層の表現。🔴 アイコンを使わない（§7.5）。 */}
      {last ? null : <span aria-hidden="true">/</span>}
    </li>
  );
}

export function PageHeader({
  trail,
  breadcrumbLabel,
  title = null,
  action = null,
  testId,
  linkComponent = DefaultLink,
}: PageHeaderProps) {
  const Link = linkComponent;
  return (
    <div className={HEADING_CLASSES} data-testid="app-page-heading">
      <nav aria-label={breadcrumbLabel} data-testid="app-page-breadcrumb">
        <ol className={TRAIL_CLASSES}>
          {trail.map((crumb, index) => (
            <Crumb
              key={`${crumb.label}-${String(index)}`}
              crumb={crumb}
              last={index === trail.length - 1}
              linkComponent={linkComponent}
            />
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {title === null ? null : <h1 className={TITLE_CLASSES}>{title}</h1>}
        {action === null ? null : (
          <Link className={ACTION_CLASSES} href={action.href} data-testid={testId}>
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
