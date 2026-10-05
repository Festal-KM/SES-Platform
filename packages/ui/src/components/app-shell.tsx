// packages/ui/src/components/app-shell.tsx
// 主平面（`/`）の共通外枠 —— サイドバー（1 本の柱）+ その右に Top Header と本体 + モバイルのボトムタブ。
// `docs/04` §3.1（レイアウト図 / ヘッダ 5 要素 / サイドバーの項目表）/ §3.2 / §3.4 / §7.5。SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 構造（`docs/04` §3.1 の改訂 16。**旧構成から変えた 1 点**）
// ============================================================================
//   ┌──────────────────────────────────────────────┐
//   │ [環境バナー] [代理閲覧バナー]  ※全幅・最上部     │ ← 🔴 **この外枠の外側**（`app/layout.tsx`）
//   ├────────────┬─────────────────────────────────┤
//   │ サイドバー  │ Top Header（ワードマーク / スコープ │
//   │（環境バナー ├─────────────────────────────────┤
//   │  直下から   │ PageHeader（各画面が本文の先頭で描く）│
//   │  画面下端   ├─────────────────────────────────┤
//   │  まで）     │ Main Content                     │
//   └────────────┴─────────────────────────────────┘
//
// 🔴 **旧構成は「ヘッダが全幅で、その下にサイドバー」だった。** 改訂 16 で
//    **サイドバーを 1 本の柱にし、ヘッダをその右（本体カラムの上）に置く**。理由（§3.1）:
//    ①ヘッダが全幅だとサイドバーの上端にヘッダの高さ分の空白ができ、**縦に並ぶ 10 項目以上を
//    走査する起点が下にずれる** ②ヘッダの内容（スコープ / 上限 / 通知 / 自分）は**いま見ている
//    本体に対する文脈**であり、本体カラムの上に乗るほうが係り先が一致する ③管理平面の
//    「全幅の平面帯」と主平面の帯の有無が、**同じ最上部の 1 行**で比較できる。
//    🔴 **したがって DOM の順序も サイドバー → ヘッダ → 本文 である**（`app-shell.render.test.tsx`）。
// 🔴 **環境バナー・代理閲覧バナーが最上部・全幅であることは変えない**（`CLAUDE.md` §11.1 /
//    `F-028 AC-1`）。それらはこの部品の外（ルートレイアウト）に在る。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. 🔴 **`'use client'` を宣言しない。** 状態もイベントハンドラもフックも持たない。付けると、
//    この外枠に包まれる**主平面の全画面**がクライアントバンドルへ移る
//    （`tests/static/client-db-boundary.test.ts`）。開閉は `<details>`（「その他」）と
//    `<input type="checkbox">` + CSS（サイドバーの 2 形態。`./sidebar.tsx` 冒頭の 🔴）で行う。
//    🔴 ✅ **2026-10-04: クライアントが要る 2 点は「差し替え口」で受ける**（この外枠は
//    サーバのままである）—— `linkComponent`（現在地のクラスを当てるリンク）と `sectionGate`
//    （第 2 階層の帯をどれか 1 つだけ描く器）。実装は `apps/web` 側の島
//    （`app/(main)/_shell/nav-current.tsx`）に在り、**`packages/ui` に `'use client'` を
//    1 つも増やしていない**（`tests/static/ui-overlay-contract.test.ts` が overlay 6 部品で
//    凍結している。主バレルから `'use client'` へ辺が伸びると `Button` 1 つの画面まで引き込む）。
// 2. 🔴 **サイドバーと「その他」は同じ項目表（`groups`）から描く。** 2 本持つと、どちらかにだけ
//    項目が増えた状態が必ず生まれる（§3.4「業務ループの順序は『その他』の中で保つ」）。
//    DOM には両方が同時に存在するため、`data-testid` の接頭辞を分ける（`./sidebar.tsx`）。
// 3. 🔴 **primary アクションを外枠から出さない** —— 作成系の導線は各画面が権限差分つきで持つ
//    （`VIEWER` / 取引先の閲覧専用に、押せない導線を外枠から配らない）。`<button>` が 1 つも出ない。
// 4. 🔴 **ロール別の出し分けは呼び出し側が DOM から取り除く**（この部品は渡された項目を描くだけで、
//    `hidden` で隠す枝を持たない）。
// 5. 🔴 **影を足さない**（階層は border と背景の差で表す。§7.9）。
// 6. **ブレークポイントは Tailwind の既定だけ**（`md:` = サイドバー / ボトムタブの切り替え、
//    `xl:` = サイドバーの 2 形態。`CLAUDE.md` §13.3）。
import type { ComponentType, ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import { cn } from '../lib/cn.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';
import { currentNavSectionIndex } from '../lib/current-nav-path.js';
import {
  SectionNav,
  SectionNavDefaultGate,
  type SectionGateProps,
  type SectionNavItem,
} from './nav-panel.js';
import {
  Sidebar,
  SidebarNavList,
  type SidebarGroup,
  type SidebarLabels,
  type SidebarLinkProps,
  type SidebarReach,
} from './sidebar.js';
import { TopBar, type TopBarProps } from './top-bar.js';

/** モバイルのボトムタブ 1 つ（`docs/04` §3.4。🔴 **5 つのうち手前の 4 つ**。5 つ目は「その他」）。 */
export type BottomTab = {
  readonly id: string;
  readonly label: string;
  /** 🔴 **ボトムタブにはアイコンを付ける**（ラベルが 2〜3 文字に切り詰まっており、アイコンが弁別の主役）。 */
  readonly icon: IconName;
  readonly reach: SidebarReach;
};

export type AppShellLabels = {
  /** ボトムタブの `<nav aria-label>`。 */
  readonly tabs: string;
  /** 5 つ目のタブの語（`その他`）。 */
  readonly more: string;
  /** 「その他」を開いたときの見出し（`すべての項目`）。 */
  readonly moreHeading: string;
};

export type AppShellProps = {
  /** Top Header の 5 要素（`./top-bar.tsx`）。 */
  readonly header: TopBarProps;
  /** サイドバーと「その他」に出す群と項目（🔴 **同じ 1 本**）。 */
  readonly groups: readonly SidebarGroup[];
  /**
   * **初回描画（水和前）の現在地**（🔴 `next/navigation` を使わない。`docs/05` §2.3.1）。
   * 🔴 クライアント遷移への追随は `linkComponent` と `sectionGate` の 2 つの島が行う
   *    （`./sidebar.tsx` 冒頭の 6b / `./nav-panel.tsx` 冒頭の 1）。
   */
  readonly currentPath: string;
  readonly navLabels: SidebarLabels;
  readonly tabs: readonly BottomTab[];
  readonly labels: AppShellLabels;
  /**
   * 🔴 **第 2 階層のタブを持つセクションの全体**（2026-10-03 の畳み込みの到達手段。
   *    `./nav-panel.tsx` の `SectionNav`）。**空 / 未指定なら帯ごと描かない。**
   *
   * ✅ **2026-10-04: 「いま居るセクションの 1 つ」から「候補の全体」に変えた。**
   *    🔴 理由: 帯は**どのセクションに居るかで出る / 出ないが変わる**ので、1 つだけ渡す形では
   *    **クライアント遷移で帯が前の画面のまま残る**（`/settings` に案件管理のタブが残り続ける
   *    実測症状）。候補を全部渡し、**どれを描くかを `sectionGate` が決める**。
   * 🔴 **タブが 1 つしか無いセクションを渡さない**のは呼び出し側の責務である
   *    （`apps/web/lib/shell/nav.ts` の `navSectionsWithTabs`。パスに依存しない判断なので
   *    サーバ側に置いたままでよい）。この部品は渡されたものを描くだけである（上の 4）。
   * 🔴 **サイドバーと同じ項目表から来る**（`lib/shell/nav.ts` の `buildNavSections`）—— 2 本持つと、
   *    どちらかにだけ項目が増えた状態が必ず生まれる（`groups` と同じ理由）。
   */
  readonly sections?: readonly AppShellSection[];
  /** 第 2 階層の `<nav aria-label>`（🔴 語は呼び出し側が `packages/i18n` から渡す）。 */
  readonly sectionTabsLabel?: string;
  /**
   * 🔴 第 2 階層の帯を**どれか 1 つだけ描く器**（既定は `SectionNavDefaultGate` = サーバのまま
   *    初回描画の添字を使う）。`apps/web` の `'use client'` の島を渡すと、クライアント遷移に
   *    追随する（`./nav-panel.tsx` の `SectionGateProps`）。
   */
  readonly sectionGate?: ComponentType<SectionGateProps>;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly children: ReactNode;
};

/** 第 2 階層のタブを持つセクション 1 つ（🔴 項目の出所は呼び出し側の 1 本の表）。 */
export type AppShellSection = {
  readonly id: string;
  readonly items: readonly SectionNavItem[];
};

function DefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** 🔴 サイドバーが「画面下端まで」届くための高さ（§3.1）。 */
const SHELL_CLASSES = 'flex min-h-dvh';

/**
 * 本体カラム。
 * 🔴 **`pb-24` は恒久例外である**（`tests/static/ui-spacing-scale.test.ts` の
 *    `PERMANENT_SPACING_EXCEPTION`）: `fixed` なボトムタブ（モバイル）の高さ分の逃がしであり、
 *    §7.9 の余白の段ではない。これを段（`pb-12` = 48px）に寄せると**最後の行がタブの下に隠れる。**
 *    ⚠️ 例外は**この部品の責務**に付いており、置き場所（`apps/web` / `packages/ui`）には付かない。
 *
 * ✅ **2026-10-02（人間のモックアップ）: 本体の地を `--color-bg-subtle`（`slate-50`）にした。**
 * 🔴 **トークンの値は変えていない**（`--color-bg` は白のまま）—— 変えると**白地を前提にした
 *    全画面**（`--color-fg` との組のコントラスト / `Card` の白との差）が同時に動く。**適用箇所で
 *    分ける**のが §7.9 の 3 層（semantic を参照する component 層）の形である。
 * 🔴 **カード・パネル・overlay は `--color-surface`（白）のまま**なので、「淡いグレーの地に白い面」
 *    という分離がここで初めて成立する（`../lib/surface-classes.ts` の 🔴 が予告していた判断）。
 * ⚠️ **影響は主平面の全画面に及ぶ**（`/admin` は別の外枠であり変わらない）。白い面を持たない画面
 *    （一覧の `DataTable` は器に地を持たない）は**表が地の上に直接載る**見え方になる ——
 *    列ヘッダ（`--color-table-header-bg` = `slate-50`）と行 hover（`--color-row-hover-bg` = 同）が
 *    **地と同値になるため、ヘッダと hover の分離が弱くなる**。これは器（`Table`）に面を与える
 *    変更（= `docs/04` §5-13 の改訂）を要するので本タスクでは行わず、完了報告に挙げる。
 */
const BODY_CLASSES = 'min-w-0 flex-1 bg-bg-subtle pb-24 md:pb-0';

/** ボトムタブ（🔴 `fixed bottom-0 z-10`。帯の primary（`bottom-12` / `z-20`）とは重ならない）。 */
const TABS_CLASSES = 'fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-bg md:hidden';
/** タブ 1 つの中身（🔴 アイコンを上・語を下の 2 段。`text-xs` = §7.3 の補助テキスト）。 */
const TAB_CONTENT_CLASSES = cn(
  'flex flex-col items-center gap-1 px-1 py-2 text-center text-xs',
  TRANSITION_CLASSES,
);
/** 手前の 4 つは等幅に割る（5 つ目の「その他」は器の `<details>` が `flex-1` を持つ）。 */
const TAB_BASE_CLASSES = cn('flex-1', TAB_CONTENT_CLASSES);
const TAB_LINK_CLASSES = cn(TAB_BASE_CLASSES, 'text-fg hover:bg-bg-subtle active:bg-bg-inset', FOCUS_RING_CLASSES);
/** 🔴 未実装のタブ。押せないので hover を持たない（`<a>` にしない = 404 を作らない）。 */
const TAB_UNAVAILABLE_CLASSES = cn(TAB_BASE_CLASSES, 'text-fg-muted');

/**
 * 「その他」の中身。
 * 🔴 **影を足さない**（§7.9。`border` + 背景で面を分ける）。旧実装の `shadow-lg` を落とした。
 * 🔴 **グループの区切りとアイコンをデスクトップと同じにする**（§3.4 の改訂 16）—— 同じ項目が
 *    端末で別の見え方をすると、迷ったときにデスクトップの記憶が使えない。
 */
const MORE_PANEL_CLASSES =
  'absolute right-0 bottom-full max-h-96 w-64 overflow-y-auto rounded-md border border-border bg-bg py-3';
const MORE_SUMMARY_CLASSES = cn(
  'cursor-pointer list-none',
  TAB_CONTENT_CLASSES,
  'text-fg hover:bg-bg-subtle active:bg-bg-inset',
  FOCUS_RING_CLASSES,
);

function BottomTabEntry({
  tab,
  linkComponent,
}: {
  readonly tab: BottomTab;
  readonly linkComponent: ComponentType<SidebarLinkProps>;
}) {
  const body = (
    <>
      <Icon name={tab.icon} />
      {tab.label}
    </>
  );
  if (tab.reach.kind === 'UNAVAILABLE') {
    return (
      <span className={TAB_UNAVAILABLE_CLASSES} aria-disabled="true" data-testid={`app-tab-${tab.id}`}>
        {body}
      </span>
    );
  }
  const Link = linkComponent;
  return (
    <Link className={TAB_LINK_CLASSES} href={tab.reach.href} data-testid={`app-tab-${tab.id}`}>
      {body}
    </Link>
  );
}

export function AppShell({
  header,
  groups,
  currentPath,
  navLabels,
  tabs,
  labels,
  sections = [],
  sectionTabsLabel,
  sectionGate: SectionGate = SectionNavDefaultGate,
  linkComponent = DefaultLink,
  children,
}: AppShellProps) {
  // 🔴 候補の射程は**タブの遷移先から引く**（書き写さない。`./nav-panel.tsx` の `SectionGateProps`）。
  const sectionCandidates = sections.map((section) => section.items.map((item) => item.href));
  // 🔴 初回描画（水和前）の添字。判定は `../lib/current-nav-path.ts` の 1 実装である。
  const initialSectionIndex = currentNavSectionIndex(currentPath, sectionCandidates);
  return (
    <div className={SHELL_CLASSES} data-testid="app-shell">
      {/* 🔴 サイドバー（左固定・画面下端まで）。`md:` 未満ではボトムタブに置き換わる（§3.4）。 */}
      <Sidebar
        groups={groups}
        currentPath={currentPath}
        labels={navLabels}
        linkComponent={linkComponent}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar {...header} linkComponent={linkComponent} />
        {/* 🔴 第 2 階層のタブ（Top Header の直下 = ヘッダから続く 1 枚の面）。
            🔴 **語が渡されていないときも描かない** —— `aria-label` の無いナビゲーションを
               作らない（読み上げで「この帯が何か」が分からなくなる）。
            🔴 **描かれるのは多くとも 1 本**（`SectionGate` が添字で選ぶ）。候補を全部渡すのは
               クライアント遷移で選び直せるようにするためである（`sections` の ✅）。 */}
        {sections.length === 0 || sectionTabsLabel === undefined ? null : (
          <SectionGate
            candidates={sectionCandidates}
            initialIndex={initialSectionIndex}
            bands={sections.map((section) => (
              <SectionNav
                key={section.id}
                items={section.items}
                currentPath={currentPath}
                label={sectionTabsLabel}
                linkComponent={linkComponent}
              />
            ))}
          />
        )}
        <div className={BODY_CLASSES}>
          {/* 🔴 パンくず / 画面タイトル / primary アクション（1 つ）が入る位置の印（§3.1 のレイアウト図）。
              帯の実体は `PageHeader` であり、**各画面が自分の本文の先頭で描く**（直下の `children` の
              先頭に在る）。🔴 **消さないこと** —— レイアウトから帯を描けない理由は
              `apps/web/app/(main)/_shell/page-heading.tsx` 冒頭にある。 */}
          <div data-testid="app-page-heading-slot" />
          {children}
        </div>
      </div>

      {/* 🔴 モバイルのボトムタブ 5 つ（§3.4）。5 つ目の「その他」から全項目に到達でき、
          その中では群の区切りとアイコンをデスクトップと同じにする。 */}
      <nav className={TABS_CLASSES} aria-label={labels.tabs} data-testid="app-bottom-tabs">
        {tabs.map((tab) => (
          <BottomTabEntry key={tab.id} tab={tab} linkComponent={linkComponent} />
        ))}
        {/* 🔴 開閉は `<details>`（ブラウザの機能）で行う。クライアントコンポーネントにしない。 */}
        <details className="relative flex-1" data-testid="app-tab-more">
          <summary className={MORE_SUMMARY_CLASSES} data-testid="app-tab-more-summary">
            <Icon name="menu" />
            {labels.more}
          </summary>
          <div className={MORE_PANEL_CLASSES}>
            <p className="mb-1 px-4 text-micro text-fg-muted">{labels.moreHeading}</p>
            <SidebarNavList
              groups={groups}
              variant="more"
              currentPath={currentPath}
              linkComponent={linkComponent}
            />
          </div>
        </details>
      </nav>
    </div>
  );
}
