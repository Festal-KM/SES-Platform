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
import type { BottomTab, SidebarGroup, SidebarItem, SidebarReach } from '@ses/ui';
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
