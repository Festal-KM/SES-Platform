// packages/ui/src/components/sidebar.tsx
// 主平面のグローバルナビ（`docs/04` §3.1 のサイドバーの項目表 / §3.4 の「その他」/ §7.5 ③）。SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 この部品が守るもの（`docs/04` §3.1 / §7.10 / `SP-22` `T-22-05` の条文 2〜7）
// ============================================================================
// 1. 🔴 **上端にワードマークを置かない**（製品名は Top Header の 1 箇所のみ = `U-01`）。
//    上端に在るのは**開閉トグルだけ**である。
// 2. 🔴 **2 形態**（展開 / アイコンのみ）。**境界は Tailwind 既定の `xl` の 1 本だけ**で、
//    `xl` 未満は既定でアイコンのみ / `xl` 以上は既定で展開（`docs/04` §3.1 / §7.1）。
//    🔴 **アイコンのみでも項目の順序とグループの区切りを変えない**（順序が業務ループを教える）。
// 3. 🔴 **群は `営業` / `連絡` / `分析` / `設定` の 4 つ**（`U-20` / §11-21）。**ホームは群に属さず最上段**。
//    区切りは**線ではなく余白 + 小さな群名**で表す（罫線を増やして画面を分割しない）。
// 4. 🔴 **全項目に Lucide アイコン**（`./../icons.ts` の閉じた写像）。比喩アイコンは構造的に入らない。
// 5. 🔴 **未実装の項目はリンクにしない**（`<span>` で描き `href` を持たせない）。**404 を作らない。**
//    印は**無彩色の `Badge`**（`Phase 2` / `Phase 3`）であり、注記テキストを置き換えたものである。
// 6. **現在地** = 背景 `--color-brand-bg` + 文字 `--color-brand` + **左端 2px**（`SELECTED_CLASSES`）。
//    🔴 **太字だけで示さない**（日本語ゴシックは太字の差が弱く、10 項目以上の縦並びでは走査できない）。
// 7. 🔴 **hover は 150ms の色変化のみ**（拡大・浮き上がり・影・下線を出さない。§7.10）。
// 8. 🔴 **`'use client'` を宣言しない。** 状態もイベントハンドラもフックも持たない（下の 🔴）。
// 9. 🔴 **文言を持たない**（`../index.ts` の共通規約 5）。語は呼び出し側が `packages/i18n` から渡す。
//
// ============================================================================
// 🔴 なぜ 2 形態の切り替えを「チェックボックス + CSS」で作るのか（`T-22-05` 条文 3 の括弧）
// ============================================================================
// 条文は「**切替は利用者の明示操作で選択を保持する**（🔴 `'use client'` を増やさず `<details>` /
// CSS で実現できる範囲に収める）」と定めている。外枠に `'use client'` を付けると、**それに包まれる
// 主平面の全画面**がクライアントバンドルへ移る（`tests/static/client-db-boundary.test.ts` の前提が
// 崩れる）ため、JS を使わずに済ませなければならない。
//
// 🔴 **`<details>` は使えない。** `<details>` は閉じたとき `<summary>` 以外の子を**隠す**
//    （新しい Chromium は `::details-content` の `content-visibility: hidden` で実装しており、
//    子側の `display` では覆せない）。アイコンのみの形態は「隠れる」ではなく「ラベルが消えて
//    アイコンが残る」なので、ナビを `<details>` の中に置くと**閉じた瞬間にナビが消える。**
//    したがって開閉の状態は**ナビの外側に持つ**しかなく、`<input type="checkbox">`（+ `<label>`）が
//    JS 無しで状態を持てる唯一の要素である。**選択はレイアウトの DOM が生き続ける限り保たれる**
//    （App Router の画面遷移ではレイアウトが再生成されない ＝ `app-tab-more` の `<details>` と同じ）。
//
// 🔴 **チェックの意味は「既定と逆の形態にする」である**（`xl` 以上では折りたたみ、`xl` 未満では展開）。
//    1 ビットの状態で「既定が幅によって違う」2 形態を両方向に切り替えるには、これしかない
//    （`checked` を「展開」に固定すると、既定が展開である `xl` 以上で**折りたためなくなる**）。
//    読み上げの語（`labels.toggle`）も方向を断定せず「切り替える」にすること。
//
// 🔴 **4 クラスの優先順は特異度で決まり、宣言順に依存しない**（実測。`tailwind` 4 の出力）:
//      `hidden`                        … (0,1,0)
//      `group-has-checked:block`       … (0,2,0) —— `:is(:where(.group):has(*:checked) *)`
//      `xl:block`                      … (0,1,0) / `@media`
//      `xl:group-has-checked:hidden`   … (0,2,0) / `@media`（**同特異度で後に出る**）
//    → `xl` 未満: 未チェック = アイコンのみ / チェック = 展開。`xl` 以上: 逆。**両方向に効く。**
//
// 🔴 **`:has(*:checked)` の射程を外枠全体にしない。** `group` はサイドバーを包む**専用の器**に
//    付ける（`SIDEBAR_SHELL_CLASSES`）。外枠のルートに付けると、**本文のフォームのチェックボックス
//    1 つでサイドバーの形が変わる**（`S-013` の公開範囲のチェックボックスが実例になる）。
import type { ComponentType, ReactNode } from 'react';
import { Badge } from './badge.js';
import { Icon, type IconName } from '../icons.js';
import { cn } from '../lib/cn.js';
import { ICON_CONTROL_CLASSES } from './button.js';
import { FOCUS_RING_CLASSES, SELECTED_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/**
 * リンクを描く要素（`docs/05` §2.3.1）。🔴 **`packages/ui` は `next/*` に依存しない**ので、
 * `apps/web` が `next/link` を渡す。未指定なら素の `<a>`。
 */
export type SidebarLinkProps = {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly title?: string;
  readonly 'aria-current'?: 'page';
  readonly 'data-testid'?: string;
};

/** 🔴 `linkComponent` 未指定のときの既定（素の `<a>`。`docs/05` §2.3.1）。 */
export function SidebarDefaultLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** 遷移先（🔴 `LINK` 以外は `<a>` を作らない ＝ 404 に飛ぶリンクを 1 つも作らない）。 */
export type SidebarReach =
  | { readonly kind: 'LINK'; readonly href: string }
  | { readonly kind: 'UNAVAILABLE' };

/**
 * 項目に添えるバッジ（`提案依頼` の返答期限。`docs/04` §3.1 取引先列）。
 * 🔴 **件数を入れない**（件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
 */
export type SidebarBadge = {
  /** 読み上げのための見出し語（画面では項目名の隣にあるので文脈で読める）。 */
  readonly label: string;
  /** 値（`残り 2 日`）。🔴 組み立ては呼び出し側の 1 実装が行う。 */
  readonly text: string;
};

export type SidebarItem = {
  /** `data-testid` の接尾辞（kebab-case）。 */
  readonly id: string;
  /** 解決済みのラベル（🔴 `packages/i18n` は呼び出し側）。 */
  readonly label: string;
  /** 🔴 `docs/04` §3.1 の表のアイコン名（写像に無い名前は型エラー）。 */
  readonly icon: IconName;
  readonly reach: SidebarReach;
  /**
   * 🔴 未実装の印（`Phase 2` / `Phase 3`）。**解決済みの語**を渡す（`null` なら描かない）。
   * 🔴 **無彩色の Badge で描く**（未実装は障害でも注意でもない。`docs/04` §3.1 / §7.4）。
   * ⚠️ 語をこの部品に持たせない（`../index.ts` の共通規約 5）—— 呼び出し側が
   *    `packages/i18n`（`shell.nav.note.phase2` / `phase3`）から解決して渡す。
   */
  readonly phase: string | null;
  /**
   * 実在するが単独の URL を持たない項目の注記（`案件から開きます`）。
   * 🔴 **`Phase N` とは別物である** —— あちらは「まだ無い」、こちらは「別の入口から開く」。
   */
  readonly note: string | null;
  readonly badge: SidebarBadge | null;
};

/**
 * 群（`docs/04` §3.1 の 4 群 + 群名なしの最上段）。
 * 🔴 **群の順序と項目の順序は呼び出し側の項目表が持つ**（この部品は並べ替えない）。
 */
export type SidebarGroup = {
  readonly id: string;
  /** 群名。🔴 `null` = 群名なし（最上段のホーム）。 */
  readonly label: string | null;
  readonly items: readonly SidebarItem[];
};

/** サイドバーと「その他」は**同じ項目表**を描くので、`data-testid` の接頭辞を分ける。 */
export type SidebarVariant = 'sidebar' | 'more';

export type SidebarLabels = {
  /** `<nav aria-label>`。 */
  readonly nav: string;
  /** 🔴 開閉トグルの語。**方向を断定しない**（上の 🔴）。 */
  readonly toggle: string;
};

// ============================================================================
// 🔴 component 層のクラス（`docs/04` §7.9 の ③。semantic トークンだけを参照する）
// ============================================================================

/** 開閉トグルの `<input>` と `<label>` を結ぶ id。🔴 外枠は 1 リクエストに 1 つだけ描かれる。 */
const SIDEBAR_TOGGLE_ID = 'ses-sidebar-form';

/**
 * サイドバーを包む器。🔴 **`group` はここに付ける**（`:has(*:checked)` の射程を
 * 「サイドバーの中のチェックボックス」に限るため。上の 🔴）。
 * 🔴 `md:` 未満はボトムタブに置き換わる（`docs/04` §3.4。**T-12-20 の境界を変えない**）。
 */
const SIDEBAR_SHELL_CLASSES = 'group hidden shrink-0 md:block';

/**
 * 柱そのもの。🔴 **環境バナー直下から画面下端までの 1 本**（§3.1 の改訂 16）。
 *
 * - 幅: 🔴 **アイコンのみ 56px / 展開 224px**。切り替えは上の 4 クラスの規則で行う。
 * - 🔴 **影を足さない**（階層は border と背景の差で表す。§7.9）。
 * - `sticky top-0 h-dvh` … 50 行の一覧を読んでいる間もナビに戻れる（`overflow-y-auto` は
 *   16 項目が縦に収まらない小さな高さのため）。**`self-start` が無いと `sticky` が効かない**
 *   （flex の既定 `align-items: stretch` で高さが確定してしまう）。
 */
const SIDEBAR_CLASSES = cn(
  'flex flex-col self-start overflow-y-auto border-r border-border bg-bg pb-3',
  'md:sticky md:top-0 md:h-dvh',
  'w-14 group-has-checked:w-56 xl:w-56 xl:group-has-checked:w-14',
  TRANSITION_CLASSES,
);

/** 上端（🔴 **開閉トグルだけ**。ワードマークを置かない。§3.1-2）。 */
const SIDEBAR_TOGGLE_ROW_CLASSES = 'flex items-center px-2 py-2';

/**
 * 開閉トグルの見た目。
 *
 * 🔴 **`IconButton` を使えない** —— `<button>` は押しても何も起きない（ハンドラを持てば
 *    `'use client'` になる）。**見た目は `IconButton` と同じ 1 実装から取る**
 *    （`ICON_CONTROL_CLASSES`。同じ見た目のローカル実装を 2 つ作らない。SP-21 `T-21-02` ①）。
 * 🔴 フォーカスリングは**隣の `<input>`（`peer`）から**当てる —— 実際にフォーカスを受けるのは
 *    `sr-only` の `<input>` であり、`<label>` は受けない。リングが無いとキーボードで
 *    トグルの位置を見失う（§7.10 の focus-visible は全プリミティブで同一）。
 */
const SIDEBAR_TOGGLE_CLASSES = cn(
  ICON_CONTROL_CLASSES,
  'cursor-pointer',
  'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
);

/**
 * 群。🔴 **区切りは線ではなく余白**（`mt-4`）で表す（罫線を増やして画面を分割しない）。
 * 最初の群（ホーム）には余白を付けない。
 */
const SIDEBAR_GROUP_CLASSES = 'px-2';
const SIDEBAR_GROUP_SPACED_CLASSES = 'mt-4 px-2';

/**
 * 群名。🔴 **`--text-micro` + `--color-fg-muted`**（§7.3 の最小段）。
 * 🔴 アイコンのみの形態では語が消える（余白だけが残って区切りは保たれる）。
 */
const SIDEBAR_GROUP_LABEL_CLASSES = 'mb-1 px-2 text-micro text-fg-muted';

/**
 * 1 項目の行。🔴 **密に**（`docs/04` §7.1 の「一覧はファーストビューに 12 行以上」と同じ思想で、
 * 16 項目が縦に走査できる高さにする）。
 *
 * - `border-l-2 border-l-transparent` … 🔴 現在地の左端 2px を**全項目で場所取り**する
 *   （選択で 2px ずれると、現在地が動いたのか項目が動いたのか読めない）。
 * - 🔴 hover は**背景の色変化だけ**（150ms）。拡大・浮き上がり・影・下線を出さない（§7.10）。
 */
const SIDEBAR_ITEM_BASE_CLASSES = cn(
  'flex items-center gap-2 rounded-sm border-l-2 border-l-transparent px-2 py-1 text-body',
  TRANSITION_CLASSES,
);
const SIDEBAR_LINK_CLASSES = cn(
  SIDEBAR_ITEM_BASE_CLASSES,
  'text-fg hover:bg-bg-subtle active:bg-bg-inset',
  FOCUS_RING_CLASSES,
);
/** 🔴 未実装の項目（`<span>`）。押せないので hover を持たない。 */
const SIDEBAR_UNAVAILABLE_CLASSES = cn(SIDEBAR_ITEM_BASE_CLASSES, 'text-fg-muted');
/** 🔴 現在地 = 背景 + 文字色 + 左端 2px の 3 点（§7.10 の selected）。**太字だけで示さない。** */
const SIDEBAR_CURRENT_CLASSES = cn(SIDEBAR_LINK_CLASSES, SELECTED_CLASSES);

/**
 * ラベル（**見える語**）。
 * 🔴 アイコンのみの形態では消える（上の 4 クラスの規則）。「その他」の一覧では常に見える。
 * 🔴 `aria-hidden` を立てる —— 読み上げに出すのは隣の `sr-only` の写しである（下の 🔴）。
 */
const SIDEBAR_LABEL_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'min-w-0 truncate hidden group-has-checked:block xl:block xl:group-has-checked:hidden',
  more: 'min-w-0 truncate',
};

/** 項目の右に添えるもの（`Phase N` / 期限バッジ）。ラベルと同じ規則で出し入れする。 */
const SIDEBAR_MARK_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'ml-auto hidden group-has-checked:block xl:block xl:group-has-checked:hidden',
  more: 'ml-auto',
};

/** 期限バッジ（🔴 注意色 = 「直せば / 動けば進む」もの。§7.4）。 */
const SIDEBAR_BADGE_CLASSES = 'ml-1';

// ============================================================================
// 現在地の判定（🔴 純粋関数。テストが固定する）
// ============================================================================
/**
 * `currentPath` がその項目の遷移先の中に居るか。
 *
 * 🔴 **ホーム（`/`）だけは完全一致**である（前方一致にすると全画面がホームの現在地になる）。
 * 🔴 区切りは `/` を含めて見る —— `/engineers` が `/engineer-shares` を飲み込まないため。
 */
export function isCurrentNavPath(currentPath: string, href: string): boolean {
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

// ============================================================================
// 描画
// ============================================================================

function ItemMarks({ item, variant }: { readonly item: SidebarItem; readonly variant: SidebarVariant }) {
  if (item.phase === null && item.badge === null && item.note === null) return null;
  return (
    <span className={SIDEBAR_MARK_CLASSES[variant]}>
      {item.note === null ? null : <span className="text-micro text-fg-muted">{item.note}</span>}
      {item.phase === null ? null : (
        <Badge
          variant="neutral"
          data-testid={variant === 'sidebar' ? `app-nav-phase-${item.id}` : `app-more-nav-phase-${item.id}`}
        >
          {item.phase}
        </Badge>
      )}
      {item.badge === null ? null : (
        <Badge
          variant="warning"
          className={SIDEBAR_BADGE_CLASSES}
          data-testid={
            variant === 'sidebar' ? 'app-nav-proposal-requests-due' : 'app-more-nav-proposal-requests-due'
          }
        >
          <span className="sr-only">{item.badge.label}</span>
          {item.badge.text}
        </Badge>
      )}
    </span>
  );
}

/**
 * 1 項目。
 *
 * 🔴 **ラベルを 2 つ描く**（見える語 + `sr-only` の写し）。アイコンのみの形態では見える語が
 *    `display: none` になり**読み上げからも消える**ため、語が消えない写しが要る（§3.1 の
 *    「アイコンのみの形態では `title` と `aria-label` に日本語ラベルを必ず持たせる」）。
 *    🔴 `aria-label` を要素に置く形は採らない —— 置くと**子孫の読み上げが打ち消され、
 *    期限バッジ（`最も近い返答期限 残り 2 日`）が読み上げから消える。**
 */
function SidebarEntry({
  item,
  variant,
  currentPath,
  linkComponent,
}: {
  readonly item: SidebarItem;
  readonly variant: SidebarVariant;
  readonly currentPath: string;
  readonly linkComponent: ComponentType<SidebarLinkProps>;
}) {
  const body = (
    <>
      <Icon name={item.icon} />
      <span className="sr-only">{item.label}</span>
      <span className={SIDEBAR_LABEL_CLASSES[variant]} aria-hidden="true">
        {item.label}
      </span>
      <ItemMarks item={item} variant={variant} />
    </>
  );
  if (item.reach.kind === 'UNAVAILABLE') {
    // 🔴 未実装・単独の URL を持たない画面。項目は出すが**リンクにしない**（404 を作らない）。
    return (
      <li>
        <span
          className={SIDEBAR_UNAVAILABLE_CLASSES}
          aria-disabled="true"
          title={item.label}
          data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
        >
          {body}
        </span>
      </li>
    );
  }
  const current = variant === 'sidebar' && isCurrentNavPath(currentPath, item.reach.href);
  const Link = linkComponent;
  return (
    <li>
      <Link
        className={current ? SIDEBAR_CURRENT_CLASSES : SIDEBAR_LINK_CLASSES}
        href={item.reach.href}
        title={item.label}
        aria-current={current ? 'page' : undefined}
        data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
      >
        {body}
      </Link>
    </li>
  );
}

export type SidebarNavListProps = {
  readonly groups: readonly SidebarGroup[];
  readonly variant: SidebarVariant;
  readonly currentPath: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

/**
 * 群と項目の一覧。🔴 **サイドバーと「その他」が同じ関数を通る**（2 本持つと、どちらかにだけ
 *    項目が増えた状態が必ず生まれる。`docs/04` §3.4「業務ループの順序は『その他』の中で保つ」）。
 */
export function SidebarNavList({
  groups,
  variant,
  currentPath,
  linkComponent = SidebarDefaultLink,
}: SidebarNavListProps) {
  return (
    <>
      {groups.map((group, index) => (
        <div
          key={group.id}
          className={index === 0 ? SIDEBAR_GROUP_CLASSES : SIDEBAR_GROUP_SPACED_CLASSES}
          data-sidebar-group={group.id}
        >
          {group.label === null ? null : (
            <p
              className={cn(SIDEBAR_GROUP_LABEL_CLASSES, SIDEBAR_LABEL_CLASSES[variant])}
              data-testid={variant === 'sidebar' ? `app-nav-${group.id}` : `app-more-nav-${group.id}`}
            >
              {group.label}
            </p>
          )}
          <ul>
            {group.items.map((item) => (
              <SidebarEntry
                key={item.id}
                item={item}
                variant={variant}
                currentPath={currentPath}
                linkComponent={linkComponent}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export type SidebarProps = {
  readonly groups: readonly SidebarGroup[];
  /** 現在地の判定に使う（🔴 `next/navigation` を使わない。`docs/05` §2.3.1）。 */
  readonly currentPath: string;
  readonly labels: SidebarLabels;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

export function Sidebar({ groups, currentPath, labels, linkComponent = SidebarDefaultLink }: SidebarProps) {
  return (
    <div className={SIDEBAR_SHELL_CLASSES}>
      <nav className={SIDEBAR_CLASSES} aria-label={labels.nav} data-testid="app-sidebar">
        <div className={SIDEBAR_TOGGLE_ROW_CLASSES}>
          {/* 🔴 開閉の状態はここ 1 つだけが持つ（JS を使わない。ファイル冒頭の 🔴）。 */}
          <input
            id={SIDEBAR_TOGGLE_ID}
            type="checkbox"
            className="peer sr-only"
            aria-label={labels.toggle}
            data-testid="app-sidebar-toggle"
          />
          <label
            htmlFor={SIDEBAR_TOGGLE_ID}
            className={SIDEBAR_TOGGLE_CLASSES}
            data-testid="app-sidebar-toggle-control"
          >
            <Icon name="panel-left" />
          </label>
        </div>
        <SidebarNavList
          groups={groups}
          variant="sidebar"
          currentPath={currentPath}
          linkComponent={linkComponent}
        />
      </nav>
    </div>
  );
}
