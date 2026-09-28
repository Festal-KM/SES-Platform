// apps/web/app/(main)/_shell/app-shell.tsx
// 主平面（`/`）の共通外枠 —— ヘッダ + サイドバー（グローバルナビ）+ モバイルのボトムタブ。
// docs/04 §3.1（レイアウト図・ヘッダ 5 要素の表・サイドバーの項目表）/ §3.2（第二境界の表現）/ §3.4（モバイル）/ §7.5（アイコン）。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. **アイコンを 1 つも使わない**（docs/04 §7.5「グローバルナビの全項目」）。語だけで区別する。
// 2. **第二境界を常時表現する** —— 取引先所属では「組織名 ＞ 自社名」の 2 段（§3.2 の #1）。
//    🔴 外枠に出すのは**自分の所属と自分の氏名だけ**である。他社名・他社の件数・ホストの商流を出さない。
// 3. **404 を作らない** —— 未実装の項目はリンクにせず `aria-disabled` + 注記で出す（`nav.ts`）。
// 4. **`'use client'` を宣言しない** —— 状態もイベントハンドラも持たない。モバイルの「その他」の
//    開閉は `<details>`（ブラウザの機能）で行う。付けると、この外枠に包まれる**主平面の全画面**が
//    クライアントバンドルへ移る（`_components/auth-shell.tsx` と同じ規律。
//    `tests/static/client-db-boundary.test.ts`）。
// 5. **primary アクションを外枠から出さない** —— 作成系の導線は各画面が権限差分つきで持っている
//    （`VIEWER` / 取引先の閲覧専用に、押せない導線を外枠から配らない）。**帯の primary も同じで、
//    出すか出さないかは画面が決める**（`_shell/page-heading.tsx` の `canAct`）。
// 7. **バッジに件数を出さない** —— `③ 提案依頼` に添えるのは「最も近い返答期限」だけである
//    （件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。`NavBadgeMark` の 🔴。
// 6. **ブレークポイントは Tailwind の既定だけ**（`md:` のみ。`CLAUDE.md` §13.3）。
//
// 🔴 サイドバーと「その他」の一覧は**同じ項目表（`buildMainNav`）から描く**。2 本持つと、
//    どちらかにだけ項目が増える状態が必ず生まれる（§3.4「業務ループの順序は『その他』の中で保つ」）。
//    DOM には両方が同時に存在する（表示を CSS で切り替える）ため、`data-testid` の接頭辞を分ける。
import type { ReactNode } from 'react';
import Link from 'next/link';
import { t } from '@ses/i18n';
import type { NavItem } from '../../../lib/shell/nav';
import type { ShellUsageIndicator } from '../../../lib/shell/usage-indicator';

export type AppShellProps = {
  /** ワードマーク（`product.name`）。🔴 製品名を表示する唯一の箇所（`U-01`）。 */
  readonly wordmark: string;
  /** スコープ表示（§3.2 の #1）。`partnerCompanyName` が非 null なら 2 段。 */
  readonly organizationName: string;
  readonly partnerCompanyName: string | null;
  /** 「自分」= 氏名 + ロール名（§3.1「なぜこの操作ができないかの一次説明になる」）。 */
  readonly userName: string;
  readonly roleLabel: string;
  /** 上限インジケータ（🔴 80% 超のときだけ出す。金額を出さない）。 */
  readonly usage: ShellUsageIndicator;
  /**
   * 上限インジケータの遷移先（`S-038`）。
   * 🔴 **取引先所属では `null`**（`docs/04` §S-038「導線はホスト側にしか置かない。取引先には
   *    操作の場所で示す」/ `F-027 AC-1`）。`null` のときはリンクにせず、停止の事実と理由だけを出す。
   */
  readonly usageHref: string | null;
  /** サイドバーと「その他」に出す項目（業務ループ ①〜⑥ の順）。 */
  readonly nav: readonly NavItem[];
  /** モバイルのボトムタブの手前 4 つ（5 つ目は「その他」）。 */
  readonly tabs: readonly NavItem[];
  readonly children: ReactNode;
};

const NAV_LINK_CLASSES = 'block rounded px-2 py-1 text-sm text-slate-900 hover:bg-slate-100';
const NAV_DISABLED_CLASSES = 'block px-2 py-1 text-sm text-slate-400';
const NAV_NOTE_CLASSES = 'ml-2 text-xs text-slate-400';

/**
 * ナビを描く場所。サイドバーと「その他」は**同じ項目表**を描くため、`data-testid` が衝突しない
 * ように接頭辞を分ける（DOM には両方が同時に存在する）。
 *
 * 🔴 接頭辞は**三項演算子でテンプレートリテラルを並べて**書く。`data-testid={testId}` のように
 *    変数へ逃がすと `tests/static/testid-inventory.test.ts` が値を凍結できず、この画面だけ
 *    testid の安全網から外れる（同テストの `UNRESOLVED_ALLOWLIST` は「増やさない」）。
 */
type NavVariant = 'sidebar' | 'more';

/**
 * 項目に添えるバッジ（`③ 提案依頼` の期限バッジ。docs/04 §3.1 取引先列）。
 *
 * 🔴 **件数を描かない。** 描くのは「最も近い返答期限」の残り時間だけであり、値の組み立ては
 *    `lib/proposal-requests/remaining.ts` の `formatRemaining`（1 実装）が行っている
 *    （件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
 * 🔴 語（最も近い返答期限）は読み上げ専用で添える —— 画面では項目名の隣にあるので文脈で読めるが、
 *    読み上げでは「残り 2 日」が何の残りなのかが分からない（スコープ表示の見出し語と同じ作法）。
 * 🔴 アイコンを使わない（§7.5）。色 + 語で示す。
 */
function NavBadgeMark({
  badge,
  variant,
}: {
  readonly badge: NavItem['badge'];
  readonly variant: NavVariant;
}) {
  if (badge === null) return null;
  return (
    <span
      className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-xs text-amber-900"
      data-testid={variant === 'sidebar' ? 'app-nav-proposal-requests-due' : 'app-more-nav-proposal-requests-due'}
    >
      <span className="sr-only">{t(badge.labelKey)}</span>
      {badge.text}
    </span>
  );
}

/**
 * 1 項目。🔴 `LINK` 以外は `<a>` を作らない（押せない導線を押せる形で見せない。404 を作らない）。
 */
function NavEntry({ item, variant }: { readonly item: NavItem; readonly variant: NavVariant }) {
  if (item.reach.kind === 'LINK') {
    return (
      <li>
        <Link
          className={NAV_LINK_CLASSES}
          href={item.reach.href}
          data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
        >
          {t(item.labelKey)}
          <NavBadgeMark badge={item.badge} variant={variant} />
        </Link>
      </li>
    );
  }
  if (item.reach.kind === 'UNAVAILABLE') {
    return (
      <li>
        {/* 🔴 未実装・単独の URL を持たない画面。項目は出すが**リンクにしない**（docs/04 §3.1 の並びを欠けさせない）。 */}
        <span
          className={NAV_DISABLED_CLASSES}
          aria-disabled="true"
          data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
        >
          {t(item.labelKey)}
          <span className={NAV_NOTE_CLASSES}>{t(item.reach.noteKey)}</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <p
        className="px-2 pt-3 text-xs font-bold text-slate-500"
        data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
      >
        {t(item.labelKey)}
      </p>
      <ul className="ml-2">
        {item.children.map((child) => (
          <NavEntry key={child.id} item={child} variant={variant} />
        ))}
      </ul>
    </li>
  );
}

function NavList({
  items,
  variant,
}: {
  readonly items: readonly NavItem[];
  readonly variant: NavVariant;
}) {
  return (
    <ul>
      {items.map((item) => (
        <NavEntry key={item.id} item={item} variant={variant} />
      ))}
    </ul>
  );
}

/**
 * 上限インジケータ（docs/04 §3.1 / §3.4）。
 *
 * 🔴 `NONE` のときは**要素ごと描かない**（平常時の常時警告を作らない）。
 * 🔴 停止中は残量ではなく「停止中」と理由を出す。**件数・通数・GB だけで、金額は 1 つも出さない**
 *    （`F-027 AC-6` / `BR-24`）。
 * 🔴 モバイルでは `w-full` でヘッダ直下の 1 行の帯になり、`md:` 以上ではヘッダの行に収まる
 *    （§3.4）。**同じ 1 要素**で両方を満たす（2 つ描いて片方を隠さない）。
 */
const USAGE_INDICATOR_CLASSES =
  'order-last w-full rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 md:order-none md:w-auto';

function UsageIndicator({
  usage,
  href,
}: {
  readonly usage: ShellUsageIndicator;
  readonly href: string | null;
}) {
  if (usage.kind === 'NONE') return null;
  const body =
    usage.kind === 'STOPPED' ? (
      <>
        <span className="font-bold">{t('shell.header.usage.stopped')}</span>
        <span className="ml-2">{t('quota.aiDaily')}</span>
      </>
    ) : (
      <>
        <span className="font-bold">
          {usage.metric.level === 'REACHED'
            ? t('shell.header.usage.reached')
            : t('shell.header.usage.nearing')}
        </span>
        <span className="ml-2">{t(usage.metric.labelKey)}</span>
        <span className="ml-2" data-testid="app-header-usage-remaining">
          {`${t('usage.remaining.prefix')} ${usage.metric.remaining} ${t(usage.metric.unitKey)}`}
        </span>
      </>
    );
  const state = usage.kind === 'STOPPED' ? 'STOPPED' : usage.metric.level;
  // 🔴 取引先所属（`href === null`）には `S-038` への導線を置かない（`docs/04` §S-038 / `F-027 AC-1`）。
  //    事実と理由は出す（気づけないまま機能が止まっている状態を作らない）。
  if (href === null) {
    return (
      <span className={USAGE_INDICATOR_CLASSES} data-testid="app-header-usage" data-usage-state={state}>
        {body}
      </span>
    );
  }
  return (
    <Link href={href} className={USAGE_INDICATOR_CLASSES} data-testid="app-header-usage" data-usage-state={state}>
      {body}
    </Link>
  );
}

export function AppShell({
  wordmark,
  organizationName,
  partnerCompanyName,
  userName,
  roleLabel,
  usage,
  usageHref,
  nav,
  tabs,
  children,
}: AppShellProps) {
  return (
    <div data-testid="app-shell">
      <header className="border-b border-slate-200 bg-white" data-testid="app-header">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          {/* ワードマーク（`U-01`）。クリックでホーム（`S-003` / `S-004`）。 */}
          <Link
            className="shrink-0 text-base font-bold text-slate-900"
            href="/"
            data-testid="app-header-wordmark"
          >
            {wordmark}
          </Link>
          {/* 🔴 スコープ表示。取引先所属は「組織名 ＞ 自社名」の 2 段（§3.2 の #1）。
              🔴 モバイルでも組織名を隠さない —— 折りたたみはクライアント状態を要し、
              かつ「狭い画面を理由に判断材料を隠さない」（`CLAUDE.md` §13.3）。 */}
          <div
            className="order-last w-full min-w-0 md:order-none md:w-auto"
            data-testid="app-header-scope"
            data-scope={partnerCompanyName === null ? 'HOST' : 'PARTNER'}
          >
            {/* 🔴 画面では組織名だけが見えていれば足りるが、読み上げでは「この文字列が何なのか」が
                文脈から分からない（ヘッダに並ぶ他の語と区別できない）。見出し語を読み上げ専用で添える。
                🔴 `app-header-scope-organization` の**外**に置く —— 中に入れると同要素の文字列が
                「所属組織 + 組織名」になり、組織名そのものを照合している E2E / 描画テストが
                意味を変えられてしまう。 */}
            <span className="sr-only">{t('shell.header.scope.organizationLabel')}</span>
            <p className="text-xs text-slate-500" data-testid="app-header-scope-organization">
              {organizationName}
            </p>
            {partnerCompanyName === null ? null : (
              <p className="text-sm font-medium text-slate-900" data-testid="app-header-scope-company">
                {`${partnerCompanyName}${t('shell.header.scope.ownCompanySuffix')}`}
              </p>
            )}
          </div>
          <UsageIndicator usage={usage} href={usageHref} />
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/* 🔴 通知（`S-032`）は Phase 2。**リンクにしない**（404 を作らない）。 */}
            <span
              className="text-xs text-slate-400"
              aria-disabled="true"
              data-testid="app-header-notifications"
            >
              {t('shell.header.notifications')}
              <span className={NAV_NOTE_CLASSES}>{t('shell.nav.note.phase2')}</span>
            </span>
            {/* 自分（氏名 + ロール名）。 */}
            <p className="text-xs text-slate-700" data-testid="app-header-account">
              {`${userName}（${roleLabel}）`}
            </p>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* 🔴 サイドバー（左固定）。`md:` 未満ではボトムタブに置き換わる（§3.4）。 */}
        <nav
          className="hidden w-56 shrink-0 border-r border-slate-200 px-3 py-4 md:block"
          aria-label={t('shell.nav.label')}
          data-testid="app-sidebar"
        >
          <NavList items={nav} variant="sidebar" />
        </nav>
        {/* 🔴 `pb-24` はボトムタブ（`fixed`）に隠れる領域の逃がし。`md:` 以上では不要。 */}
        <div className="min-w-0 flex-1 pb-24 md:pb-0">
          {/* 🔴 パンくず / 画面タイトル / primary アクション（1 つ）の領域（§3.1 のレイアウト図）。
              ✅ **T-12-21 で中身が入った**: 帯の実体は `_shell/page-heading.tsx` の `<PageHeading>` であり、
              **各画面が自分の本文の先頭で描く**（直下の `children` の先頭に在る）。
              🔴 **消さないこと。** レイアウトから帯を描けない理由は `page-heading.tsx` 冒頭にある
                 （RSC ではページのデータがレイアウトへ流れず、並列ルートで受け取ると読み取りが
                 二重になり、クライアントコンテキストにすると外枠が `'use client'` になる）。
                 この要素は**帯が入る位置の印**であり、`app-shell.render.test.tsx` が
                 「本文の手前」を固定している。 */}
          <div data-testid="app-page-heading-slot" />
          {children}
        </div>
      </div>

      {/* 🔴 モバイルのボトムタブ 5 つ（§3.4）。5 つ目の「その他」から全項目に到達でき、
          その中では業務ループの順序を保つ（サイドバーと同じ `nav` を描く）。 */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white md:hidden"
        aria-label={t('shell.tab.label')}
        data-testid="app-bottom-tabs"
      >
        {tabs.map((tab) =>
          tab.reach.kind === 'LINK' ? (
            <Link
              key={tab.id}
              className="flex-1 px-1 py-2 text-center text-xs text-slate-900"
              href={tab.reach.href}
              data-testid={`app-tab-${tab.id}`}
            >
              {t(tab.labelKey)}
            </Link>
          ) : (
            <span
              key={tab.id}
              className="flex-1 px-1 py-2 text-center text-xs text-slate-400"
              aria-disabled="true"
              data-testid={`app-tab-${tab.id}`}
            >
              {t(tab.labelKey)}
            </span>
          ),
        )}
        {/* 🔴 開閉は `<details>`（ブラウザの機能）で行う。クライアントコンポーネントにしない。 */}
        <details className="relative flex-1" data-testid="app-tab-more">
          <summary
            className="cursor-pointer list-none px-1 py-2 text-center text-xs text-slate-900"
            data-testid="app-tab-more-summary"
          >
            {t('shell.tab.more')}
          </summary>
          <div className="absolute right-0 bottom-full max-h-96 w-64 overflow-y-auto border border-slate-200 bg-white p-3 shadow-lg">
            <p className="mb-1 text-xs font-bold text-slate-500">{t('shell.tab.more.heading')}</p>
            <NavList items={nav} variant="more" />
          </div>
        </details>
      </nav>
    </div>
  );
}
