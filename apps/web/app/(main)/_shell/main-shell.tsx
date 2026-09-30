// apps/web/app/(main)/_shell/main-shell.tsx
// 主平面（`/`）の共通外枠の**値の組み立て**。描画は `@ses/ui` の `AppShell` が持つ。SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 なぜ描画がここに無いのか（`T-12-20` からの移動）
// ============================================================================
// `docs/05` §2.3.1: **19 部品はすべて `packages/ui/src/components/**` に置き、
// `apps/web/app/(main)/_shell/**` に残るのは値の組み立てだけである**
// （ロールで解決した nav 配列 / `t()` の呼び出し / `next/link` の受け渡し）。
// 機械検査は `tests/static/ui-primitive-single-impl.test.ts` (b)③
// （`apps/web` に `AppShell` / `PageHeader` / … を**宣言**するソースが無い。
// **props を組み立てて渡すだけのファイルは宣言ではない**）。
//
// 🔴 この 1 枚が受け持つのは次の 3 つだけである。
//   ① **ドメインの型 → 部品の props**（`ShellUsageIndicator` / `NavGroup` を解決済みの文字列にする）
//   ② **`packages/i18n` での語の解決**（`packages/ui` は `@ses/i18n` に依存しない。検査 (i)④）
//   ③ **`next/link` の受け渡し**（`packages/ui` は `next/*` に依存しない。同）
//
// 🔴 **`'use client'` を宣言しない。** 付けると、この外枠に包まれる**主平面の全画面**が
//    クライアントバンドルへ移る（`tests/static/client-db-boundary.test.ts`）。
// 🔴 **判断を置かない。** ロール別の出し分けは `lib/shell/nav.ts`、上限の選択は
//    `lib/shell/usage-indicator.ts` が 1 箇所で決めている（2 箇所に置くと片方だけ変わる）。
import type { ReactNode } from 'react';
import Link from 'next/link';
import { t } from '@ses/i18n';
import { AppShell, type AppShellLabels, type TopBarUsage } from '@ses/ui';
import type { NavGroup, NavItem } from '../../../lib/shell/nav';
import { resolveBottomTabs, resolveNavGroups } from '../../../lib/shell/nav-view';
import type { ShellUsageIndicator } from '../../../lib/shell/usage-indicator';

export type MainShellProps = {
  /** ワードマーク（`product.name`）。🔴 製品名を表示する唯一の箇所（`U-01`）。 */
  readonly wordmark: string;
  /** スコープ表示（`docs/04` §3.2 の #1）。`partnerCompanyName` が非 null なら 2 段。 */
  readonly organizationName: string;
  readonly partnerCompanyName: string | null;
  /** 「自分」= 氏名 + ロール名（§3.1「なぜこの操作ができないかの一次説明になる」）。 */
  readonly userName: string;
  readonly roleLabel: string;
  /** 上限インジケータ（🔴 80% 超のときだけ出す。金額を出さない）。 */
  readonly usage: ShellUsageIndicator;
  /**
   * 上限インジケータの遷移先（`S-038`）。
   * 🔴 **取引先所属では `null`**（`docs/04` §S-038 / `F-027 AC-1`）。
   *    `null` のときはリンクにせず、停止の事実と理由だけを出す。
   */
  readonly usageHref: string | null;
  /** サイドバーと「その他」に出す群と項目（🔴 **同じ 1 本**）。 */
  readonly nav: readonly NavGroup[];
  /** モバイルのボトムタブの手前 4 つ（5 つ目は「その他」）。 */
  readonly tabs: readonly NavItem[];
  /**
   * 現在地の判定に使うパス（🔴 `docs/04` §3.1「現在地 = 背景 + 文字色 + 左端 2px」）。
   *
   * 🔴 **RSC のレイアウトは自分のパスを知らない。** `usePathname` はクライアント専用であり、
   *    外枠に `'use client'` を付けると主平面の全画面がクライアントへ移る。そこで
   *    `apps/web/proxy.ts` がリクエストヘッダにパスを添え、`layout.tsx` が読んで渡す
   *    （`lib/shell/current-path.ts`）。
   */
  readonly currentPath: string;
  readonly children: ReactNode;
};

/**
 * 上限インジケータの props（`docs/04` §3.1 / §3.4 / `F-027 AC-6` / `BR-24`）。
 *
 * 🔴 **平常時（`NONE`）は `null` を返し、要素ごと描かない**（常時警告は無視される）。
 * 🔴 **停止中は残量ではなく「停止中」と理由を出す。**
 * 🔴 **件数・通数・GB だけで、金額は 1 つも出さない**（残量の文字列は
 *    `lib/shell/usage-indicator.ts` が件数として組み立てたものだけを使う）。
 */
function resolveUsage(usage: ShellUsageIndicator, href: string | null): TopBarUsage | null {
  if (usage.kind === 'NONE') return null;
  if (usage.kind === 'STOPPED') {
    return {
      state: 'STOPPED',
      headline: t('shell.header.usage.stopped'),
      detail: t('quota.aiDaily'),
      remaining: null,
      href,
    };
  }
  return {
    state: usage.metric.level,
    headline:
      usage.metric.level === 'REACHED' ? t('shell.header.usage.reached') : t('shell.header.usage.nearing'),
    detail: t(usage.metric.labelKey),
    remaining: `${t('usage.remaining.prefix')} ${usage.metric.remaining} ${t(usage.metric.unitKey)}`,
    href,
  };
}

/** ボトムタブと「その他」の語（`docs/04` §3.4）。 */
function shellLabels(): AppShellLabels {
  return {
    tabs: t('shell.tab.label'),
    more: t('shell.tab.more'),
    moreHeading: t('shell.tab.more.heading'),
  };
}

export function MainShell({
  wordmark,
  organizationName,
  partnerCompanyName,
  userName,
  roleLabel,
  usage,
  usageHref,
  nav,
  tabs,
  currentPath,
  children,
}: MainShellProps) {
  return (
    <AppShell
      header={{
        wordmark,
        homeHref: '/',
        scope: {
          organizationLabel: t('shell.header.scope.organizationLabel'),
          organizationName,
          // 🔴 「組織名 ＞ 自社名（御社）」の 2 段目。ホスト所属では `null`（行そのものを描かない）。
          companyName:
            partnerCompanyName === null
              ? null
              : `${partnerCompanyName}${t('shell.header.scope.ownCompanySuffix')}`,
        },
        usage: resolveUsage(usage, usageHref),
        // 🔴 通知（`S-032`）は Phase 2。**リンクにしない**（404 を作らない）。印は無彩色の Badge。
        notifications: { label: t('shell.header.notifications'), phase: t('shell.nav.note.phase2') },
        account: `${userName}（${roleLabel}）`,
      }}
      groups={resolveNavGroups(nav)}
      currentPath={currentPath}
      navLabels={{ nav: t('shell.nav.label'), toggle: t('shell.sidebar.toggle') }}
      tabs={resolveBottomTabs(tabs)}
      labels={shellLabels()}
      // 🔴 `packages/ui` は `next/*` に依存しない（`docs/05` §2.3.1）。ここで渡す。
      linkComponent={Link}
    >
      {children}
    </AppShell>
  );
}
