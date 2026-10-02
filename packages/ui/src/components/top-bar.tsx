// packages/ui/src/components/top-bar.tsx
// 主平面の Top Header（`docs/04` §3.1 のヘッダ 5 要素の表 / §3.2 の第二境界 / §3.4 のモバイル）。SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. 🔴 **5 要素とスコープ表示 2 段を変えない**（`T-22-05` 条文 8）:
//    ワードマーク / スコープ表示 / 上限インジケータ / 通知 / 自分。
//    ✅ **2026-10-02（`docs/04` 改訂 23 / §3.1 の ③）で「検索」が 6 つ目として入った**
//    （要素を**足しただけ**であり、5 要素のどれも消していない。並びは
//    **ワードマーク → 検索（幅いっぱい）→ スコープ表示 → 上限 → 通知 → 自分**）。
//    ⚠️ **ワードマークは Top Header に残した。** 改訂 23 ② は「サイドバー上端へ移す」と定めるが、
//    `app-header-wordmark` は凍結済みの `data-testid` であり（`U-22`）、移設は
//    **testid の移動 + `Sidebar` の構造変更**を伴う別タスクである（`docs/04` 側の未達として報告する）。
//    ⚠️ **ヘルプ（`circle-help`）は置いていない** —— 中身（「この画面でできること / できないこと」）の
//    出所が 1 つも無く、押して何も出ないアイコンは §3.1 の ③ が禁じた「動かない検索窓」と同じものに
//    なる（46 画面ぶんの説明が要るので別タスク）。
//
// 1b. 🔴 **検索と自分は「要素」で受ける**（値ではなく `ReactNode`）。理由はそれぞれ 1 つだけである:
//    - **検索** … `⌘K` / `Ctrl+K` の出し分けは**プラットフォームの判定**を要し、サーバの値では決まらない
//      （`apps/web/app/(main)/_shell/global-search.tsx` が client で決める）。
//    - **自分** … `DropdownMenu` は Radix（`@ses/ui/client`）であり、**この部品は主バレル側**である
//      （主バレルに overlay を載せると、`Button` 1 つのサーバ画面まで Radix を引き込む。
//      `../index.client.ts` 冒頭の 🔴）。
//    🔴 **他の要素を `ReactNode` にしない**（器が「何でも置ける場所」になると、ヘッダの規約が
//    コメントだけになる）。
// 2. 🔴 **ワードマークは製品名を表示する唯一の箇所**（`U-01`）。語は `product.name` から来る
//    （呼び出し側が解決して渡す。この部品は `@ses/i18n` に依存しない）。
// 3. 🔴 **第二境界の常時表現** —— パートナー所属では「組織名 ＞ 自社名」の **2 段**（§3.2 の #1）。
//    🔴 **折りたたみ・タップ展開にしない**（§3.4 の 2026-09-28 の判断。狭い画面を理由に
//    判断材料を隠さない）。🔴 **他社名・他社の件数を 1 つも出さない**（出す材料を props に持たない）。
// 4. 🔴 **上限インジケータは 80% 超のときだけ出す**（平常時は要素ごと描かない = `usage === null`）。
//    🔴 **件数で出し、金額を 1 つも出さない**（`F-027 AC-6` / `BR-24`）。停止中は残量ではなく理由。
//    🔴 取引先所属では `S-038` への導線を置かない（`href === null` ＝ **リンクにしない**）。
// 5. 🔴 **通知（`S-032`）は Phase 2 なのでリンクにしない**（404 を作らない）。印は無彩色の `Badge`。
// 6. 🔴 **1 段で密に**（要素間の余白を過剰にしない）。🔴 **影を足さない**（下 border だけで面を分ける）。
// 7. 🔴 **見出し・ボタンにアイコンを付けない**（§7.5 の「引き続き使わない場所」）。
//    ヘッダに `<svg>` は 1 つも出ない。
// 8. 🔴 **`'use client'` を宣言しない / 文言を持たない**（`../index.ts` の共通規約 4・5）。
import type { ComponentType, ReactNode } from 'react';
import { Badge } from './badge.js';
import type { SidebarLinkProps } from './sidebar.js';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/** 上限インジケータの状態（`data-usage-state`）。🔴 平常時は `usage === null` で要素ごと出さない。 */
export type TopBarUsageState = 'NEARING' | 'REACHED' | 'STOPPED';

export type TopBarUsage = {
  readonly state: TopBarUsageState;
  /** 見出し（`上限に接近` / `上限に到達` / `AI 機能 停止中`）。 */
  readonly headline: string;
  /** 対象（AI の単位名 / メール / ストレージ、または停止の理由）。 */
  readonly detail: string;
  /**
   * 残量（`残り 12 件`。🔴 **組み立ては呼び出し側**）。
   * 🔴 停止中は `null`（残量ではなく理由を出す）。🔴 **金額を渡せる形にしない**（`BR-24`）。
   */
  readonly remaining: string | null;
  /** 🔴 `S-038` への導線。**取引先所属では `null`**（`F-027 AC-1`）。 */
  readonly href: string | null;
};

export type TopBarScope = {
  /** 読み上げ専用の見出し語（`所属組織`）。 */
  readonly organizationLabel: string;
  readonly organizationName: string;
  /**
   * 自社名（`△△テック（御社）`。**接尾辞まで解決して渡す**）。
   * 🔴 `null` = ホスト所属（1 段）。**ホストでは行そのものを描かない。**
   */
  readonly companyName: string | null;
};

export type TopBarProps = {
  readonly wordmark: string;
  /** ワードマークの遷移先（ホーム）。 */
  readonly homeHref: string;
  /**
   * ✅ 検索の入口（`GlobalSearchBox`）。🔴 **本体カラムの幅いっぱい**に置く（§3.1 の ③）。
   * 🔴 **要素で受ける**（上の 1b）。`null` を許さない —— 検索は SES 営業の主動作であり、
   *    「この画面だけ検索の入口が無い」状態を器が作れないようにする。
   */
  readonly search: ReactNode;
  readonly scope: TopBarScope;
  readonly usage: TopBarUsage | null;
  /** 通知（🔴 Phase 2。語 + 無彩色の Badge）。 */
  readonly notifications: { readonly label: string; readonly phase: string };
  /**
   * ✅ 自分（会社名 + 氏名 + アバター + `DropdownMenu`）。🔴 **要素で受ける**（上の 1b）。
   * 🔴 **氏名とロール名のテキストを必ず含める**（`app-header-account`）—— アバターだけを置くと
   *    「なぜこの操作ができないか」の一次説明（ロール名）が画面から消える（§3.1）。
   */
  readonly account: ReactNode;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

function DefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/**
 * 🔴 **1 段で密に**（`T-22-05` の見た目の条件）。左右の gutter は本体（`PageBody`）と同じ 24px に
 *    揃える —— ヘッダは**本体カラムの上**に乗る要素であり（§3.1 の改訂 16）、左端が本文とずれると
 *    視線の起点が 2 つになる。
 * 🔴 **影を足さない**（階層は border と背景の差で表す。§7.9）。
 */
const HEADER_CLASSES = 'border-b border-border bg-bg';
const HEADER_ROW_CLASSES = 'flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2';

/** ワードマーク（🔴 §7.3 の 2 段目 = 16px / 600。画面タイトルより強くしない）。 */
const WORDMARK_CLASSES = cn(
  'shrink-0 rounded-sm text-lg font-semibold text-fg',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * 上限インジケータ。
 * 🔴 モバイルでは `w-full` でヘッダ直下の 1 行の帯になり、`md:` 以上ではヘッダの行に収まる
 *    （§3.4）。**同じ 1 要素**で両方を満たす（2 つ描いて片方を隠さない）。
 * 🔴 注意色（`--color-warning-*`）= 「直せば / 動けば進む」もの（§7.4）。**赤にしない。**
 */
const USAGE_CLASSES = cn(
  'order-last w-full rounded-sm bg-warning-bg px-2 py-1 text-xs text-warning md:order-none md:w-auto',
  TRANSITION_CLASSES,
);

function UsageIndicator({
  usage,
  linkComponent,
}: {
  readonly usage: TopBarUsage;
  readonly linkComponent: ComponentType<SidebarLinkProps>;
}) {
  const body = (
    <>
      <span className="font-semibold">{usage.headline}</span>
      <span className="ml-2">{usage.detail}</span>
      {/* 🔴 `data-testid` は**文字列リテラル**で書く（`docs/05` §2.3.1 / §17.7.3）。ヘッダの固定要素
          であり画面ごとに変わらないので、props で素通しする形にはしない。 */}
      {usage.remaining === null ? null : (
        <span className="ml-2" data-testid="app-header-usage-remaining">
          {usage.remaining}
        </span>
      )}
    </>
  );
  // 🔴 取引先所属（`href === null`）には `S-038` への導線を置かない（`F-027 AC-1`）。
  //    事実と理由は出す（気づけないまま機能が止まっている状態を作らない）。
  if (usage.href === null) {
    return (
      <span className={USAGE_CLASSES} data-testid="app-header-usage" data-usage-state={usage.state}>
        {body}
      </span>
    );
  }
  const Link = linkComponent;
  return (
    <Link className={USAGE_CLASSES} href={usage.href} data-testid="app-header-usage" data-usage-state={usage.state}>
      {body}
    </Link>
  );
}

export function TopBar({
  wordmark,
  homeHref,
  search,
  scope,
  usage,
  notifications,
  account,
  linkComponent = DefaultLink,
}: TopBarProps) {
  const Link = linkComponent;
  return (
    <header className={HEADER_CLASSES} data-testid="app-header">
      <div className={HEADER_ROW_CLASSES}>
        {/* 🔴 製品名を表示する唯一の箇所（`U-01`）。クリックでホーム（`S-003` / `S-004`）。 */}
        <Link className={WORDMARK_CLASSES} href={homeHref} data-testid="app-header-wordmark">
          {wordmark}
        </Link>
        {/* ✅ 検索（改訂 23。§3.1 の ③）。🔴 **本体カラムの幅いっぱい**に伸びる。
            🔴 モバイルでは行を分けて全幅にする（`md` 未満）—— 1 段に 6 要素は入らないが、
            **検索を隠さない**（`CLAUDE.md` §13.3「狭い画面を理由に判断材料を隠さない」）。 */}
        <div className="order-last w-full min-w-0 md:order-none md:min-w-48 md:flex-1" data-testid="app-header-search-slot">
          {search}
        </div>
        {/* 🔴 スコープ表示。取引先所属は「組織名 ＞ 自社名」の 2 段（§3.2 の #1）。
            🔴 モバイルでも組織名を隠さない（`CLAUDE.md` §13.3 / §3.4 の 2026-09-28 の判断）。 */}
        <div
          className="order-last w-full min-w-0 md:order-none md:w-auto"
          data-testid="app-header-scope"
          data-scope={scope.companyName === null ? 'HOST' : 'PARTNER'}
        >
          {/* 🔴 見出し語は `app-header-scope-organization` の**外**に置く —— 中に入れると
              同要素の文字列が「所属組織 + 組織名」になり、組織名そのものを照合している
              E2E / 描画テストが意味を変えられてしまう。 */}
          <span className="sr-only">{scope.organizationLabel}</span>
          <p className="text-xs text-fg-muted" data-testid="app-header-scope-organization">
            {scope.organizationName}
          </p>
          {scope.companyName === null ? null : (
            <p className="text-body font-medium text-fg" data-testid="app-header-scope-company">
              {scope.companyName}
            </p>
          )}
        </div>
        {usage === null ? null : <UsageIndicator usage={usage} linkComponent={linkComponent} />}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {/* 🔴 通知（`S-032`）は Phase 2。**リンクにしない**（404 を作らない）。 */}
          <span className="flex items-center gap-1 text-xs text-fg-muted" aria-disabled="true" data-testid="app-header-notifications">
            {notifications.label}
            <Badge variant="neutral">{notifications.phase}</Badge>
          </span>
          {/* 自分（会社名 + 氏名 + ロール名 + アバター。改訂 23 で `DropdownMenu` になった）。
              🔴 ロールが見えることが「なぜこの操作ができないか」の一次説明になる。
              🔴 `app-header-account` は**呼び出し側が出す**（凍結値。`U-22`）—— 器がテキストを
                 組まないのは、会社名の 2 段目と `DropdownMenu` のトリガが一体の当たり判定である
                 ためである（器が文字列を受けると、トリガの中に収められない）。 */}
          {account}
        </div>
      </div>
    </header>
  );
}
