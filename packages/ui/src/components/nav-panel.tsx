// packages/ui/src/components/nav-panel.tsx
// 主平面の**第 2 階層**の 2 部品。SP-22（2026-10-03。サイドバーを 6 項目のフラットに畳んだぶんの
// 到達手段。`apps/web/lib/shell/nav.ts` 冒頭の表）。
//
//   | 部品 | 何を描くか | どこに出るか |
//   |---|---|---|
//   | `SectionNav` | セクション内の**タブ**（`候補者一覧` / `共有の設定`、`案件一覧` / `提案` / `提案依頼`） | 外枠（`AppShell`）の Top Header の直下 |
//   | `NavIndex`   | 項目の**索引**（`設定` の 7 画面） | `/settings` の画面本体 |
//
// ============================================================================
// 🔴 なぜ `Tabs`（`./tabs.tsx`）を使わないのか
// ============================================================================
// `./tabs.tsx` は Radix の `role="tablist"` であり、`docs/04` §10.3 の「**同一対象の面の切替**」
// である（URL は動かない）。本部品が描くのは **別の URL への遷移**であり、
// 管理平面の `apps/web/app/admin/_components/console-nav.tsx` と同じ**ナビゲーション**である。
// 🔴 役割が違うものを同じ部品にすると、「タブを押したら URL が変わる画面」と「変わらない画面」が
//    見分けられなくなる（`./tabs.tsx` 冒頭の ⚠️ が管理平面のナビについて同じことを書いている）。
// ⚠️ 加えて `./tabs.tsx` は `'use client'` なので、**サーバコンポーネントからその定数
//    （`TABS_TRIGGER_CLASSES`）を import できない**（クライアント参照になる）。
// 🔴 **したがって「下端 2px + 文字 `--color-brand`」という見え方が 2 実装になる。**
//    §7.10 の selected の条文は 1 つなので値は同じであり、**条文が変わったら 2 箇所を直す**
//    必要がある。`docs/04` §5-13 に「遷移するタブ」を `Tabs` の形として足すか、本部品を
//    正式な部品として条文化するかは人間の判断事項であり、完了報告で申し送る。
//
// ============================================================================
// 🔴 この部品が守るもの
// ============================================================================
// 1. 🔴 **`'use client'` を宣言しない**（`../index.ts` の共通規約 4）。状態もフックも持たない。
//    現在地の判定は `../lib/current-nav-path.ts` の 1 実装に渡された `currentPath` で行う
//    —— **`usePathname` を使わない**（外枠に `'use client'` が付くと主平面の全画面が
//    クライアントバンドルへ移る）。
//    🔴 ✅ **2026-10-04: それでも「クライアント遷移で現在地が追随しない」ことは直した。**
//    App Router のレイアウトはソフトナビゲーションで再描画されないため、`currentPath` だけでは
//    **帯もタブも最初に着地した画面のまま固まる**（実測は `../lib/current-nav-path.ts` 冒頭）。
//    直し方は 2 つの差し替え口であり、**どちらも `apps/web` 側の `'use client'` の島が入る**:
//      - タブの現在地 … `linkComponent`（`SidebarLinkProps` の `matchPaths` / `currentClassName`）
//      - 🔴 **帯そのもの** … `SectionGate`（下の `SectionGateProps`）。帯は「いまどのセクションに
//        居るか」で**出る / 出ない**が変わるので、タブの色だけ直しても `/settings` に
//        **案件管理のタブが残り続ける**（実測した症状そのもの）。
// 2. 🔴 **文言を持たない**（共通規約 5）。語は呼び出し側が `packages/i18n` から渡す。
// 3. 🔴 **`next/*` に依存しない**（`docs/05` §2.3.1）。`linkComponent` を受け取る。
// 4. 🔴 **ロールで出し分けない。** 渡された項目を描くだけである（出し入れは
//    `apps/web/lib/shell/nav.ts` の 1 箇所が決める。`hidden` で隠す枝を持たない = `BR-44`）。
// 5. 🔴 **影を足さない**（階層は border と背景の差で表す。§7.9）。
// 6. 🔴 **アイコンは `../icons.ts` の閉じた写像だけ**（比喩アイコンが構造的に入らない）。
//    🔴 **タブにはアイコンを付けない** —— 語が 2〜5 文字で横に並ぶため、アイコンは弁別に寄与せず
//    §7.5 の装飾の禁止に当たる（アイコンが要るのは縦に 6 項目並ぶサイドバーとボトムタブである）。
import type { ComponentType, ReactNode } from 'react';
import { Badge } from './badge.js';
import { SidebarDefaultLink, type SidebarLinkProps } from './sidebar.js';
import { Icon, type IconName } from '../icons.js';
import { cn } from '../lib/cn.js';
import { isCurrentNavPath } from '../lib/current-nav-path.js';
import { CARD_SURFACE_CLASSES } from '../lib/surface-classes.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

// 🔴 `linkComponent` 未指定のときの既定は `SidebarDefaultLink`（`./sidebar.tsx`）である。
//    ✅ 2026-10-04: ここに在った同形のローカル実装（`DefaultLink`）を落とした ——
//    あちらは `currentClassName` / `matchPaths` を解釈するようになったので、**2 つ目の素の
//    `<a>` を残すと、タブだけが現在地のクラスを当てられない**という静かな差が生まれる。

// ============================================================================
// SectionNav（セクション内のタブ）
// ============================================================================

/** タブ 1 つ。🔴 **遷移先を必ず持つ**（押せないタブを置かない）。 */
export type SectionNavItem = {
  /** `data-testid` の接尾辞（kebab-case）。 */
  readonly id: string;
  /** 解決済みの語（🔴 `packages/i18n` は呼び出し側）。 */
  readonly label: string;
  readonly href: string;
};

export type SectionNavProps = {
  readonly items: readonly SectionNavItem[];
  /**
   * **初回描画（水和前）の現在地**（🔴 `next/navigation` を使わない）。
   * 🔴 クライアントでは `linkComponent` の島が `usePathname()` で上書きする（上の 1）。
   */
  readonly currentPath: string;
  /** `<nav aria-label>`（読み上げで「この帯が何か」が分かる語）。 */
  readonly label: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

/**
 * 帯。🔴 **Top Header と同じ地（`--color-bg`）+ 下端 1px** にする —— 本体の地は
 * `--color-bg-subtle` なので、ヘッダから続く 1 枚の面として読める（§7.9）。
 * 🔴 左右の gutter は本体（`PageBody` の `px-6`）と同じ 24px にして、**タブの語と本文の左端を揃える**。
 */
const SECTION_NAV_CLASSES = 'border-b border-border bg-bg px-6';

/** 🔴 折り返しを許す（モバイル幅で横スクロールを作らない。`CLAUDE.md` §13.3）。 */
const SECTION_NAV_LIST_CLASSES = 'flex flex-wrap items-stretch gap-6';

/**
 * タブ 1 つ。§7.10 の 8 状態のうち **default / hover / selected / focus-visible** を取る。
 *
 * 🔴 **`whitespace-nowrap`** —— 和文は文字単位で折り返せるため、無いと狭い幅で
 *    「案 / 件 / 一 / 覧」と 1 文字ずつ割れる（`tests/e2e/support/assertions.ts` の
 *    `one-char-per-line` がこの実害を検出する検出器である）。
 * 🔴 **選択されていないタブにも `border-b-2`（透明）を置く** —— 置かないと選択が切り替わるたびに
 *    2px だけ帯の高さが動く（§7.10 の「1px も動かさない」）。
 * 🔴 **hover と selected を同じ見え方にしない**（§7.10）: hover は文字を濃く、selected は
 *    ブランド色 + 下端 2px である。
 */
const SECTION_NAV_ITEM_CLASSES = cn(
  'inline-flex items-center border-b-2 border-b-transparent py-2 text-body font-medium whitespace-nowrap',
  'text-fg-muted hover:text-fg',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * 🔴 現在地 = **下端 2px + 文字 `--color-brand`**（§7.10 の selected の横並び版）。
 *    `SELECTED_CLASSES`（`../lib/state-classes.ts`）を使わないのは、あれが「背景 + 文字 +
 *    **左端** 2px」= 縦に並ぶものの形であり、横に並ぶタブで左端に線を引くと
 *    「1 つ目のタブの左だけに線がある」形になって意味が読めないからである（`./tabs.tsx` と同じ理由）。
 * 🔴 **太字だけで示さない**（日本語ゴシックは太字の差が弱い）。
 *
 * 🔴 **`hover:` を selected の色で塗り直す。** `SECTION_NAV_ITEM_CLASSES` が持つ
 *    `hover:text-fg`（特異度 0,2,0）は `text-brand`（0,1,0）より強く、そのままでは
 *    **現在地のタブにポインタが乗った瞬間に文字色が hover 色に置き換わる**（§7.10 の
 *    組み合わせ優先順は `selected > active > hover`）。`./sidebar.tsx` の
 *    `SIDEBAR_CURRENT_CLASSES` が同じ理由で同じことをしている。
 * ⚠️ 🔴 **塗り直しは `cn()`（`tailwind-merge`）が `hover:text-fg` を落とすことで効く** ——
 *    同じ群・同じ variant の後勝ちであり、**生成 CSS の順序に依存しない**
 *    （`tests/static/design-tokens.test.ts` が `cn('hover:bg-bg-subtle','hover:bg-sidebar-hover-bg')`
 *    で同じ畳み込みを固定している）。したがって class 属性には `hover:text-brand` だけが出る。
 */
const SECTION_NAV_CURRENT_CLASSES = cn(
  SECTION_NAV_ITEM_CLASSES,
  'border-b-brand text-brand hover:text-brand',
);

/**
 * セクション内のタブ（第 2 階層）。
 *
 * 🔴 **1 項目しか無いときに呼ばない**（帯が選択肢を示していない）。判定は
 *    `apps/web/lib/shell/nav.ts` の `currentNavSection` が持つ ——
 *    **この部品はロールも項目数も判断しない**（上の 4）。
 */
export function SectionNav({
  items,
  currentPath,
  label,
  linkComponent = SidebarDefaultLink,
}: SectionNavProps) {
  const Link = linkComponent;
  return (
    <nav className={SECTION_NAV_CLASSES} aria-label={label} data-testid="app-section-nav">
      <ul className={SECTION_NAV_LIST_CLASSES}>
        {items.map((item) => {
          // 🔴 ここで計算するのは**初回描画（水和前）**のぶんだけである（上の 1）。
          const current = isCurrentNavPath(currentPath, item.href);
          return (
            <li key={item.id}>
              <Link
                className={SECTION_NAV_ITEM_CLASSES}
                currentClassName={SECTION_NAV_CURRENT_CLASSES}
                matchPaths={[item.href]}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                data-testid={`app-section-tab-${item.id}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ============================================================================
// SectionGate（🔴 帯を「現在地のセクションのときだけ」描く器。2026-10-04）
// ============================================================================

export type SectionGateProps = {
  /**
   * 候補ごとの射程（**並びは `bands` と 1 対 1**）。出所は第 2 階層の表
   * （`apps/web/lib/shell/nav.ts` の `buildNavSections`）であり、ここで組み立てない。
   */
  readonly candidates: readonly (readonly string[])[];
  /**
   * 🔴 **初回描画（水和前）に選ばれた添字**（`-1` = どのセクションにも属さない = 帯を描かない）。
   *    計算は `../lib/current-nav-path.ts` の `currentNavSectionIndex` が 1 箇所で行う。
   */
  readonly initialIndex: number;
  /** 候補ごとの帯（**並びは `candidates` と 1 対 1**）。 */
  readonly bands: readonly ReactNode[];
};

/**
 * 🔴 既定の器（**サーバのまま**）。初回描画で選ばれた帯をそのまま描く。
 *
 * 🔴 **クライアント遷移に追随させるには、`apps/web` の `'use client'` の島を
 *    `AppShell` の `sectionGate` に渡す**（`usePathname()` で添字を作り直す）。
 *    **どちらの実装も同じ `candidates` / `bands` を受ける**ので、帯の中身は 1 箇所にしか無い。
 * 🔴 **描くのは多くとも 1 本**（添字が 1 つしか無い形にしてあるので、帯が 2 本出る状態を
 *    構造的に作れない）。
 */
export function SectionNavDefaultGate({ initialIndex, bands }: SectionGateProps) {
  if (initialIndex < 0) return null;
  return <>{bands[initialIndex] ?? null}</>;
}

// ============================================================================
// NavIndex（索引）
// ============================================================================

/** 索引の 1 項目。 */
export type NavIndexItem = {
  /** `data-testid` の接尾辞（kebab-case）。 */
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
  /**
   * 🔴 未実装の印（`Phase 2` / `Phase 3`）。**解決済みの語**を渡す（`null` なら描かない）。
   *    索引に未実装の項目は現時点で 1 つも無いが、**型で受けておかないと
   *    「`Phase N` を落として押せるように見せる」経路ができる**（`./sidebar.tsx` と同じ構え）。
   */
  readonly phase: string | null;
  /** 実在するが単独の URL を持たない項目の注記。🔴 **`Phase N` とは別物である。** */
  readonly note: string | null;
};

export type NavIndexProps = {
  readonly items: readonly NavIndexItem[];
  /** `<nav aria-label>`。 */
  readonly label: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

/**
 * 索引の面。🔴 **カードの面は `../lib/surface-classes.ts` の 1 箇所から取る**
 * （`rounded-md border border-border bg-surface` を書き写さない）。
 * 🔴 **`CARD_PADDING_CLASSES`（`p-4`）を器に当てない** —— 内側の余白は**行**が持つ
 * （行が面の端まで届かないと、押せる範囲が語の周りだけになる）。
 */
const NAV_INDEX_CLASSES = cn(CARD_SURFACE_CLASSES, 'divide-y divide-border');

/**
 * 1 行。🔴 **行そのものがリンクである**（語だけをリンクにしない = 押す的を小さくしない）。
 * 🔴 hover は**背景の色変化だけ**（150ms）。拡大・浮き上がり・影・下線を出さない（§7.10）。
 */
const NAV_INDEX_ITEM_CLASSES = cn(
  'flex items-center gap-3 px-4 py-3 text-body text-fg',
  'hover:bg-bg-subtle active:bg-bg-inset',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
);

/** 項目名（🔴 `min-w-0 truncate` で、長い語が行を縦に伸ばさない）。 */
const NAV_INDEX_LABEL_CLASSES = 'min-w-0 truncate';

/** 右端の印（`Phase N` / 注記）。 */
const NAV_INDEX_MARK_CLASSES = 'ml-auto flex items-center gap-2';
const NAV_INDEX_NOTE_CLASSES = 'text-micro text-fg-muted';

/**
 * 項目の索引（`設定` の 7 画面）。
 *
 * 🔴 **ここが `S-036` / `S-041` / `S-042` の唯一の入口である**（`apps/web/lib/shell/nav.ts` の
 *    `buildSettingsIndex` の 🔴）。項目を減らすと**機能が消える。**
 * ⚠️ **索引は現在地を持たない**（`/settings` を開いている人がその索引の中に居ることは自明であり、
 *    行を選択表示する意味が無い）。したがって `currentClassName` / `matchPaths` を渡さず、
 *    **2026-10-04 のクライアント遷移の問題もここには無い**（光る対象が 1 つも無い）。
 */
export function NavIndex({ items, label, linkComponent = SidebarDefaultLink }: NavIndexProps) {
  const Link = linkComponent;
  return (
    <nav aria-label={label} data-testid="app-nav-index">
      <ul className={NAV_INDEX_CLASSES}>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className={NAV_INDEX_ITEM_CLASSES}
              href={item.href}
              data-testid={`app-nav-index-${item.id}`}
            >
              <Icon name={item.icon} />
              <span className={NAV_INDEX_LABEL_CLASSES}>{item.label}</span>
              {item.phase === null && item.note === null ? null : (
                <span className={NAV_INDEX_MARK_CLASSES}>
                  {item.note === null ? null : <span className={NAV_INDEX_NOTE_CLASSES}>{item.note}</span>}
                  {item.phase === null ? null : (
                    <Badge variant="neutral" data-testid={`app-nav-index-phase-${item.id}`}>
                      {item.phase}
                    </Badge>
                  )}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
