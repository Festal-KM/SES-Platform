// apps/web/lib/shell/nav-view.ts
// グローバルナビの**項目表（`MessageKey`）→ 部品の props（解決済みの文字列）**への変換。SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 なぜこの 1 枚が挟まるのか
// ============================================================================
// `packages/ui` は **`@ses/i18n` に依存しない**（`docs/05` §2.3.1 / 検査 (i)④。依存すると部品が
// 文言を持ち、`no-hardcoded-copy` の射程から逃げる）。一方 `./nav.ts` は**語を持たない**
// （`MessageKey` だけを持つので、項目集合をレンダリングせずに単体テストで固定できる）。
// 🔴 **したがって「キーを値にする」工程がどこかに 1 つだけ要る。それがここである。**
//
// 🔴 **ここに判断を置かない。** ロール別の出し分け・並び・アイコン・`Phase N` の有無はすべて
//    `./nav.ts` が決めており、この関数は**写すだけ**である（2 箇所で判断すると、片方だけ変わる）。
import { t } from '@ses/i18n';
import type {
  BottomTab,
  NavIndexItem,
  SectionNavItem,
  SidebarGroup,
  SidebarItem,
  SidebarReach,
} from '@ses/ui';
import type { NavGroup, NavItem } from './nav';

function resolveReach(item: NavItem): SidebarReach {
  // 🔴 `UNAVAILABLE` は `href` を持たない型である（404 に飛ぶリンクを構造的に作れない）。
  return item.reach.kind === 'LINK' ? { kind: 'LINK', href: item.reach.href } : { kind: 'UNAVAILABLE' };
}

function resolveItem(item: NavItem): SidebarItem {
  return {
    id: item.id,
    label: t(item.labelKey),
    icon: item.icon,
    reach: resolveReach(item),
    // 🔴 `Phase N`（無彩色の Badge）と注記（別の入口から開く）は別物であり、混ぜない。
    phase: item.phaseKey === null ? null : t(item.phaseKey),
    note: item.noteKey === null ? null : t(item.noteKey),
    badge:
      item.badge === null
        ? null
        : {
            label: t(item.badge.labelKey),
            text: item.badge.text,
            // 🔴 アイコンのみの形態で点に添える語（`packages/ui` の `SidebarBadge.dotLabel`）。
            dotLabel: t(item.badge.dotLabelKey),
          },
    // 🔴 現在地の射程（第 2 階層 / 索引の遷移先）。**ここで組み立てない**（`./nav.ts` が持つ）。
    sectionPaths: item.sectionPaths,
  };
}

/** サイドバーと「その他」に渡す群（🔴 **同じ 1 本**。2 本持つと片方にだけ項目が増える）。 */
export function resolveNavGroups(groups: readonly NavGroup[]): readonly SidebarGroup[] {
  return groups.map((group) => ({
    id: group.id,
    label: group.labelKey === null ? null : t(group.labelKey),
    items: group.items.map(resolveItem),
  }));
}

/**
 * モバイルのボトムタブ（手前の 4 つ）。
 * 🔴 **サイドバーと同じアイコン**を使う（`./nav.ts` の `buildBottomTabs` が決める）。
 */
export function resolveBottomTabs(tabs: readonly NavItem[]): readonly BottomTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    label: t(tab.labelKey),
    icon: tab.icon,
    reach: resolveReach(tab),
  }));
}

/**
 * 第 2 階層のタブ（`SectionNav`）。
 *
 * 🔴 **`LINK` の項目だけを渡す**（押せないタブを置かない。`packages/ui` の `SectionNavItem` は
 *    `href` を必須にしているので、**型としても押せないタブを作れない**）。
 *    `apps/web/lib/shell/nav.ts` の `buildNavSections` は現に `LINK` だけを返すが、
 *    ここで落としておくことで「後から `pending` を足したら黙ってタブが消える」ではなく
 *    「足せない」側に倒れる。
 */
export function resolveSectionTabs(items: readonly NavItem[]): readonly SectionNavItem[] {
  return items.flatMap((item) =>
    item.reach.kind === 'LINK'
      ? [{ id: item.id, label: t(item.labelKey), href: item.reach.href }]
      : [],
  );
}

/**
 * 索引（`NavIndex`。`/settings`）の項目。
 *
 * 🔴 **`LINK` の項目だけを渡す**（上と同じ理由。索引に 404 への行を作らない）。
 *    `Phase N` / 注記は型として受けられるようにしてあるが（`packages/ui` の `NavIndexItem`）、
 *    **`UNAVAILABLE` の項目はそもそも渡さない。**
 */
export function resolveNavIndexItems(items: readonly NavItem[]): readonly NavIndexItem[] {
  return items.flatMap((item) =>
    item.reach.kind === 'LINK'
      ? [
          {
            id: item.id,
            label: t(item.labelKey),
            icon: item.icon,
            href: item.reach.href,
            phase: item.phaseKey === null ? null : t(item.phaseKey),
            note: item.noteKey === null ? null : t(item.noteKey),
          },
        ]
      : [],
  );
}
