// apps/web/app/admin/_components/console-nav.tsx
// 管理平面（`/admin`）の共通ナビ —— 🔴 **横並びタブ 5 グループ**（docs/04 §3.3-2 の区別手段 #2）。
//
// ============================================================================
// 🔴 主平面と「形式そのもの」を変える
// ============================================================================
// 主平面は**左サイドバー・縦積み・業務ループ ①〜⑥ の順**である。管理平面はステージに属さず
// 順序を持たないため、**画面上部の横並びタブ**にする。運営者は 2 つの平面を行き来する
// （代理閲覧）ので、「いまどちらにいるか」がナビの形だけで読めることが誤操作防止になる。
// 平面帯（`運営者コンソール`）は `app/admin/layout.tsx` が別に描く（区別手段 #1）。
//
// ============================================================================
// 🔴 14 画面の割り当て（docs/04 §3.3-2 の表）と、ナビに**置かない**画面
// ============================================================================
// | タブ | 画面 | ナビでの扱い |
// |---|---|---|
// | 監視 | `A-005` 運用監視 | `/admin/monitoring` |
// | 監視 | `A-011` 原価・粗利ダッシュボード | 未実装（Phase 3）→ リンクにしない |
// | テナント | `A-002` テナント一覧 | `/admin/tenants` |
// | 契約 | `A-004` 利用量・クォータ管理 | `/admin/usage` |
// | 契約 | `A-013` サンドボックステナントの管理 | 未実装（Phase 2 へ持ち越し。SP-10 `T-10-08`）→ リンクにしない |
// | 記録 | `A-006` 監査ログ横断検索 | `/admin/audit-logs` |
// | 記録 | `A-007` 代理閲覧の開始 / `A-008` 代理閲覧の記録 | 未実装（Phase 2）→ リンクにしない |
// | 運用 | `A-009` お知らせ・機能フラグ | 未実装（Phase 2）→ リンクにしない |
// | 運用 | `A-012` デモ環境の合成データ管理 | `/admin/demo`。🔴 `demo` / `development` でのみ**項目自体が存在する**（`F-053 AC-6`） |
//
// 🔴 **ナビに置かない 4 画面と、その理由**（docs/04 の導線の定義に従う。ここで作り直さない）:
//   - `A-001` 運営者サインイン … 未認証のためナビを持たない（§3.3-2 の表の「ナビ外」）。
//     実装上も本ナビは**認証済みの区画のレイアウトからだけ**描かれ、`/admin/signin` には現れない。
//   - `A-003` テナント詳細 / `A-010` 契約管理 … **テナント単位の画面**であり単独の URL を持たない
//     （`A-002` の行 → `A-003` → `A-010`）。ナビに置ける遷移先が存在しない。
//   - 🔴 `A-014` テナントの開設 … 導線は `A-002` の中にあり、**`PLATFORM_OWNER` にだけ描かれる**
//     （`BR-44`。`app/admin/tenants/page.tsx` の `canProvision`）。本ナビは運営者ロールを読まない
//     ため、ここに置くと `PLATFORM_SUPPORT` にも項目が現れ、**`BR-44`（グレーアウトでは見せない）を破る**。
//
// 🔴 **アイコンを付けない**（docs/04 §7.5）。🔴 **文言は `packages/i18n`**（`CLAUDE.md` §3.5）。
// 🔴 **`'use client'` を宣言しない**（状態を持たない）。
import Link from 'next/link';
import { isSeedableAppEnv, type AppEnvKind } from '@ses/config';
import { t, type MessageKey } from '@ses/i18n';

/** 5 グループ（docs/04 §3.3-2）。**増やさない**（14 画面はこの 5 つで完結している）。 */
export const ADMIN_NAV_TAB_IDS = ['monitoring', 'tenants', 'contracts', 'records', 'operations'] as const;

export type AdminNavTabId = (typeof ADMIN_NAV_TAB_IDS)[number];

type AdminNavItem = {
  readonly id: string;
  readonly labelKey: MessageKey;
  /** `null` = 未実装（🔴 リンクにしない。404 を作らない）。 */
  readonly href: string | null;
  /** 未実装のときの注記（Phase）。 */
  readonly noteKey: MessageKey | null;
};

type AdminNavTab = {
  readonly id: AdminNavTabId;
  readonly labelKey: MessageKey;
  readonly items: readonly AdminNavItem[];
};

function item(id: string, labelKey: MessageKey, href: string): AdminNavItem {
  return { id, labelKey, href, noteKey: null };
}

function pending(id: string, labelKey: MessageKey, noteKey: MessageKey): AdminNavItem {
  return { id, labelKey, href: null, noteKey };
}

/**
 * 🔴 `A-012` だけが環境で存在が変わる（`F-053 AC-6`「`production` / `sandbox` / `staging` では
 *    画面も API も存在しない」）。判定は `packages/config` の `isSeedableAppEnv` —— 管理平面の
 *    ホーム（`app/admin/page.tsx`）と API-A16 のガードと**同じ 1 関数**を通す。
 */
export function buildAdminConsoleNav(appEnv: AppEnvKind): readonly AdminNavTab[] {
  return [
    {
      id: 'monitoring',
      labelKey: 'shell.admin.tab.monitoring',
      items: [
        item('monitoring', 'admin.monitoring.title', '/admin/monitoring'),
        pending('cost-dashboard', 'shell.admin.item.costDashboard', 'shell.nav.note.phase3'),
      ],
    },
    {
      id: 'tenants',
      labelKey: 'shell.admin.tab.tenants',
      items: [item('tenants', 'admin.tenants.title', '/admin/tenants')],
    },
    {
      id: 'contracts',
      labelKey: 'shell.admin.tab.contracts',
      items: [
        item('usage', 'admin.usage.title', '/admin/usage'),
        pending('sandbox-tenants', 'shell.admin.item.sandboxTenants', 'shell.nav.note.phase2'),
      ],
    },
    {
      id: 'records',
      labelKey: 'shell.admin.tab.records',
      items: [
        item('audit-logs', 'admin.auditLogs.title', '/admin/audit-logs'),
        pending('impersonation-start', 'shell.admin.item.impersonationStart', 'shell.nav.note.phase2'),
        pending('impersonation-records', 'shell.admin.item.impersonationRecords', 'shell.nav.note.phase2'),
      ],
    },
    {
      id: 'operations',
      labelKey: 'shell.admin.tab.operations',
      items: [
        pending('announcements', 'shell.admin.item.announcements', 'shell.nav.note.phase2'),
        ...(isSeedableAppEnv(appEnv) ? [item('demo', 'admin.demo.title', '/admin/demo')] : []),
      ],
    },
  ];
}

export type AdminConsoleNavProps = {
  readonly appEnv: AppEnvKind;
  /** いま開いているタブ（各区画のレイアウトが渡す）。 */
  readonly current: AdminNavTabId | null;
};

export function AdminConsoleNav({ appEnv, current }: AdminConsoleNavProps) {
  return (
    <nav
      className="flex flex-wrap gap-x-6 gap-y-3 border-b border-slate-200 bg-slate-50 px-4 py-2"
      aria-label={t('shell.admin.nav.label')}
      data-testid="admin-console-nav"
    >
      {buildAdminConsoleNav(appEnv).map((tab) => (
        <div key={tab.id} data-testid={`admin-nav-tab-${tab.id}`} data-current={tab.id === current}>
          <p className="text-xs font-bold text-slate-500">{t(tab.labelKey)}</p>
          <ul className="flex flex-wrap gap-x-3">
            {tab.items.map((navItem) => (
              <li key={navItem.id}>
                {navItem.href === null ? (
                  // 🔴 未実装の画面。項目は出すが**リンクにしない**（404 を作らない）。
                  <span
                    className="text-sm text-slate-400"
                    aria-disabled="true"
                    data-testid={`admin-nav-${navItem.id}`}
                  >
                    {t(navItem.labelKey)}
                    {navItem.noteKey === null ? null : (
                      <span className="ml-1 text-xs text-slate-400">{t(navItem.noteKey)}</span>
                    )}
                  </span>
                ) : (
                  <Link
                    className="text-sm text-slate-900 underline-offset-2 hover:underline"
                    href={navItem.href}
                    data-testid={`admin-nav-${navItem.id}`}
                  >
                    {t(navItem.labelKey)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
