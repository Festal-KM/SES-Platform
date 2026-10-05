// apps/web/app/(main)/_shell/main-shell.render.test.tsx
// 共通外枠の描画（docs/04 §3.1 / §3.2 / §3.4 / §7.5 / §7.9 / §7.10）。T-12-20 → SP-22 `T-22-05`。
//
// 🔴 なぜ描画のテストが要るか: 外枠が守るのは**見えていること**そのものである ——
//    「第二境界が常時見えている」「未実装の項目がリンクになっていない」「平常時に上限の警告を
//    出さない」「現在地が背景 + 文字色 + 左端 2px で示される」は、いずれも DOM に出たかどうかでしか
//    確かめられない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`home-sections.render.test.tsx` と同じ方針）。
//
// ============================================================================
// 🔴 `T-22-05` で**判定を変えた 2 件**（どちらも `docs/04` 改訂 16 の条文に合わせた追随であり、
//    緩めたものは 1 つも無い）
// ============================================================================
// | # | 旧 | 新 | 根拠 |
// |---|---|---|---|
// | 1 | 「サイドバーにアイコンを 1 つも使わない」（`<svg>` が 0 件） | 🔴 **全項目にアイコンが在る**（`<svg>` の数 = 項目数）+ **比喩アイコンを使えない**（写像が閉じている） | `docs/04` §7.5 ③（改訂 16 で**禁止を解除**。人間の決定 2026-09-29）/ §11-22。旧判定は改訂前の条文そのものであり、**条文が変わったので判定も変わる** |
// | 2 | DOM の順序が ヘッダ → サイドバー → 本文 | 🔴 **サイドバー → ヘッダ → 本文** | `docs/04` §3.1 の改訂 16（**サイドバーを 1 本の柱にし、ヘッダをその右＝本体カラムの上に置く**）。旧判定は旧構成（ヘッダが全幅）を固定していた |
//
// 🔴 それ以外（スコープ表示 2 段 / ロール別の項目集合 / 上限インジケータ / 404 を作らない /
//    期限バッジ / ボトムタブ）の判定は**1 つも緩めていない**。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import {
  buildBottomTabs,
  buildMainNav,
  buildNavSections,
  buildSettingsIndex,
  navItems,
  navSectionsWithTabs,
} from '../../../lib/shell/nav';
import type { ShellUsageIndicator } from '../../../lib/shell/usage-indicator';
import { findOrganizationSettings, MainShell, type MainShellProps } from './main-shell';

const HOST_ORG = 'テスト商事株式会社';
const PARTNER_COMPANY = 'テストパートナー株式会社';

function render(overrides: Partial<MainShellProps> = {}): string {
  const props: MainShellProps = {
    wordmark: t('product.name'),
    organizationName: HOST_ORG,
    partnerCompanyName: null,
    userName: '山田太郎',
    roleLabel: t('members.role.SALES'),
    usage: { kind: 'NONE' },
    usageHref: '/settings/usage',
    nav: buildMainNav({ audience: 'HOST', role: 'SALES' }),
    // 🔴 既定は「第 2 階層の帯を描かない」状態である（`sections` を渡していない ＝ 候補が 0 件。
    //    ホストの `人材管理` はタブが 1 つなので `navSectionsWithTabs` が外す）。
    settingsIndex: buildSettingsIndex({ audience: 'HOST', role: 'SALES' }),
    tabs: buildBottomTabs(),
    currentPath: '/engineers',
    children: createElement('main', { 'data-testid': 'shell-probe' }),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(MainShell, props));
}

function partnerMarkup(overrides: Partial<MainShellProps> = {}): string {
  return render({
    partnerCompanyName: PARTNER_COMPANY,
    roleLabel: t('members.role.PARTNER_SALES'),
    // 🔴 取引先所属では `S-038` への導線を持たない（docs/04 §S-038 / F-027 AC-1）。
    usageHref: null,
    nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }),
    settingsIndex: buildSettingsIndex({ audience: 'PARTNER', role: 'PARTNER_SALES' }),
    ...overrides,
  });
}

/**
 * ✅ 2026-10-03: **第 2 階層の帯が出うる状態**（候補のセクションを渡す）。
 * 🔴 ✅ **2026-10-04: 候補を全部渡す形に変えた**（どれを描くかは `@ses/ui` の
 *    `currentNavSectionIndex` が `currentPath` から決める）。理由は「App Router のレイアウトが
 *    ソフトナビゲーションで再描画されない」ことであり、**帯の選択をサーバで 1 本に絞ると
 *    移動後も前の画面のタブが残る**（`_shell/nav-current.tsx` 冒頭の実測）。
 * 🔴 **ここで項目を書き写さない**（書き写すと、実装と期待値が同時にずれたときに気づけない）。
 */
function sectionMarkup(
  audience: 'HOST' | 'PARTNER',
  role: 'SALES' | 'PARTNER_SALES',
  currentPath: string,
): string {
  const context = { audience, role } as const;
  const overrides: Partial<MainShellProps> = {
    nav: buildMainNav(context),
    settingsIndex: buildSettingsIndex(context),
    sections: navSectionsWithTabs(buildNavSections(context)),
    currentPath,
  };
  return audience === 'HOST' ? render(overrides) : partnerMarkup(overrides);
}

/** `data-testid="x"` の付いた開始タグを 1 つ取り出す（属性の並び順に依存しない照合のため）。 */
function tagOf(html: string, testId: string): string {
  const match = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  return match?.[0] ?? '';
}

describe('ヘッダ（docs/04 §3.1 の 5 要素）', () => {
  it('ワードマークはホームへのリンクで、製品名は `product.name` から来る（U-01）', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-wordmark"');
    expect(html).toContain(t('product.name'));
    expect(html).toMatch(/<a[^>]*data-testid="app-header-wordmark"[^>]*href="\/"/);
  });

  it('🔴 ホスト所属のスコープ表示は組織名の 1 段（自社名の行を持たない）', () => {
    const html = render();
    expect(html).toContain('data-scope="HOST"');
    expect(html).toContain(HOST_ORG);
    expect(html).not.toContain('app-header-scope-company');
  });

  it('🔴 取引先所属のスコープ表示は「組織名 ＞ 自社名」の 2 段（第二境界の常時表現。§3.2 の #1）', () => {
    const html = partnerMarkup();
    expect(html).toContain('data-scope="PARTNER"');
    const organization = html.indexOf('app-header-scope-organization');
    const company = html.indexOf('app-header-scope-company');
    expect(organization).toBeGreaterThanOrEqual(0);
    expect(company).toBeGreaterThan(organization);
    expect(html).toContain(HOST_ORG);
    expect(html).toContain(`${PARTNER_COMPANY}${t('shell.header.scope.ownCompanySuffix')}`);
  });

  it('🔴 スコープ表示は 2 段のまま（折りたたみ・タップ展開にしない。§3.4 の 2026-09-28 の判断）', () => {
    const html = partnerMarkup();
    // スコープの器の中に開閉ウィジェットが無い（`<details>` / `<summary>` / `aria-expanded`）。
    const scope = /data-testid="app-header-scope"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(scope).not.toContain('<details');
    expect(scope).not.toContain('aria-expanded');
    expect(scope).not.toContain('hidden');
  });

  it('スコープ表示に読み上げ専用の見出し語が付く（組織名そのものの文字列は変えない）', () => {
    const html = render();
    expect(html).toContain(`<span class="sr-only">${t('shell.header.scope.organizationLabel')}</span>`);
    // 🔴 見出し語は `app-header-scope-organization` の**外**に在る（同要素の文字列は組織名だけ）。
    //    ⚠️ T-22-05: クラス名は semantic トークンへ移ったので**クラスを凍結しない**。
    //       固定するのは「その要素の中身が組織名そのものである」ことである（判定は同じ）。
    expect(html).toMatch(
      new RegExp(`<p[^>]*data-testid="app-header-scope-organization"[^>]*>${HOST_ORG}</p>`),
    );
  });

  it('自分は氏名 + ロール名で出る（なぜこの操作ができないかの一次説明）', () => {
    expect(render()).toContain(`山田太郎（${t('members.role.SALES')}）`);
  });

  it('🔴 通知（S-032 = Phase 2）は項目を出すがリンクにしない', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-notifications"');
    expect(html).toContain(t('shell.header.notifications'));
    expect(html).not.toMatch(/<a[^>]*data-testid="app-header-notifications"/);
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*data-testid="app-header-notifications"/);
    // 🔴 印は無彩色の Badge（`Phase 2`）である（注記テキストを置き換えた。§3.1 の改訂 16）。
    expect(html).toContain(t('shell.nav.note.phase2'));
  });

  it('🔴 ヘッダのアイコンは「検索」の 1 つだけ（§7.5 の許可① / 装飾を足さない）', () => {
    // ✅ 2026-10-02（改訂 23）: §3.1 の ③ が **全幅の検索**を足した。虫めがねは §7.5 の許可①
    //    （テキストなしで意味が通る操作）に**名指しで列挙**されている語である。
    // 🔴 **それ以外のアイコンを置かない**（ベル / `?` / アバターの画像 / 比喩アイコン）——
    //    通知は Phase 2 で押せず、ヘルプは中身の出所が無い（押して何も出ない印は装飾である）。
    const html = render();
    const header = /data-testid="app-header"[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    expect(header.length).toBeGreaterThan(0);
    expect((header.match(/<svg/g) ?? []).length).toBe(1);
    expect(header).toContain('lucide-search');
    // 🔴 画像は 1 つも無い（アバターはイニシャルの円である。`CLAUDE.md` §3.2 の顔写真を扱わない）。
    expect(header).not.toContain('<img');
    // 🔴 未読ドット・ベル・ヘルプを描いていない（架空の未読を作らない / 404 を作らない）。
    for (const forbidden of ['lucide-bell', 'lucide-circle-help', 'lucide-zap', 'lucide-lightbulb']) {
      expect(header, forbidden).not.toContain(forbidden);
    }
  });

  it('✅ 検索は既存の検索画面へ遷移し、近道は既定で `Ctrl+K`（macOS だけ島が差し替える）', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-search"');
    expect(html).toContain('href="/engineers"');
    expect(html).toContain(t('shell.header.search.shortcutDefault'));
    expect(html).toContain(t('shell.header.search.placeholder'));
  });

  it('✅ 自分はアバター + 氏名（ロール名）で、`DropdownMenu` のトリガになっている', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-avatar"');
    expect(html).toContain('data-testid="app-header-account-trigger"');
    expect(html).toContain('data-testid="app-header-account"');
    // 🔴 氏名とロール名のテキストが在る（アバターだけにしない。§3.1）。
    expect(html).toContain('山田太郎（営業）');
    // 🔴 イニシャルは 1 文字（日本語の氏名）。
    expect(html).toMatch(/data-testid="app-header-avatar"[^>]*>山</);
  });

  it('🔴 `組織設定` の項目はナビの到達性から決まる（2 つのロール表を作らない）', () => {
    // ホストの `SALES`（既定の合成）は `設定` の索引に `settings-organization` を持たないので、
    // メニューの項目も出ない。🔴 **ここでロールを見ていない**ことがこの検査の主旨である。
    const html = render();
    expect(html).not.toContain('href="/settings/organization"');

    // ✅ 2026-10-03: 探す先がサイドバーの `設定` 群から `/settings` の索引（`settingsIndex`）へ
    //    移った。🔴 **出る側も固定する** —— 出ない側だけを見ていると、索引を渡し忘れた状態
    //    （= `OWNER` でもメニューから `組織設定` が消えた状態）でも緑になる。
    // ⚠️ `DropdownMenu`（Radix）の中身は**開くまで DOM に出ない**ため、描画結果では表明できない。
    //    判定の関数（`findOrganizationSettings`）を直接見る。
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const found = findOrganizationSettings(
        buildMainNav({ audience: 'HOST', role }),
        buildSettingsIndex({ audience: 'HOST', role }),
      );
      expect(found?.reach, role).toEqual({ kind: 'LINK', href: '/settings/organization' });
      expect(found?.labelKey, role).toBe('orgSettings.title');
    }
    for (const role of ['SALES', 'VIEWER'] as const) {
      expect(
        findOrganizationSettings(
          buildMainNav({ audience: 'HOST', role }),
          buildSettingsIndex({ audience: 'HOST', role }),
        ),
        role,
      ).toBeUndefined();
    }
    for (const role of ['PARTNER_ADMIN', 'PARTNER_SALES'] as const) {
      expect(
        findOrganizationSettings(
          buildMainNav({ audience: 'PARTNER', role }),
          buildSettingsIndex({ audience: 'PARTNER', role }),
        ),
        role,
      ).toBeUndefined();
    }
  });
});

describe('🔴 上限インジケータ（F-027 AC-6 / BR-24）', () => {
  it('🔴 80% 未満（NONE）では要素ごと描かれない', () => {
    expect(render()).not.toContain('app-header-usage');
  });

  it('接近しているときだけ、件数で残量を出す（金額を出さない）', () => {
    const usage: ShellUsageIndicator = {
      kind: 'NEARING',
      metric: {
        labelKey: 'usage.aiUnit.proposalDraft',
        remaining: '12',
        unitKey: 'usage.unit.count',
        level: 'NEARING',
      },
    };
    const html = render({ usage });
    expect(html).toContain('data-usage-state="NEARING"');
    expect(html).toContain(t('shell.header.usage.nearing'));
    expect(html).toContain(t('usage.aiUnit.proposalDraft'));
    expect(html).toContain(`${t('usage.remaining.prefix')} 12 ${t('usage.unit.count')}`);
    expect(html).toContain('data-testid="app-header-usage-remaining"');
    for (const money of ['USD', '$', 'ドル', '円']) expect(html).not.toContain(money);
  });

  it('🔴 停止中は残量ではなく「停止中」と理由を出す', () => {
    const html = render({ usage: { kind: 'STOPPED' } });
    expect(html).toContain('data-usage-state="STOPPED"');
    expect(html).toContain(t('shell.header.usage.stopped'));
    expect(html).toContain(t('quota.aiDaily'));
    expect(html).not.toContain(t('usage.remaining.prefix'));
  });

  it('🔴 取引先所属では停止の事実と理由だけを出し、S-038 への導線を置かない（F-027 AC-1）', () => {
    const html = partnerMarkup({ usage: { kind: 'STOPPED' } });
    expect(html).toContain('data-usage-state="STOPPED"');
    expect(html).toContain(t('quota.aiDaily'));
    // インジケータがリンクになっていない。ナビにも `S-038` の項目が無い。
    expect(html).not.toMatch(/<a[^>]*data-testid="app-header-usage"/);
    expect(html).toMatch(/<span[^>]*data-testid="app-header-usage"/);
    expect(html).not.toContain('href="/settings/usage"');
  });
});

describe('🔴 サイドバー（モックアップの 5 項目 / §7.5 ③ アイコンの許可）', () => {
  /** サイドバーの `<nav>` だけを取り出す（ヘッダ・本文・「その他」と混ぜない）。 */
  function sidebarOf(html: string): string {
    return /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  }

  it('🔴 ① 5 項目がフラットに並ぶ（群の見出しが 1 つも無い。2026-10-03 / 10-04）', () => {
    const html = render();
    const sidebar = sidebarOf(html);
    expect(sidebar.length).toBeGreaterThan(0);
    // 画像の 6 項目から `レポート` を外した 5 項目（2026-10-04 の人間の明示指示）。
    for (const id of ['home', 'chat', 'engineers', 'projects', 'settings']) {
      expect(sidebar, id).toContain(`data-testid="app-nav-${id}"`);
    }
    for (const key of [
      'shell.nav.home',
      'shell.nav.chat',
      'shell.nav.host.engineers',
      'shell.nav.host.projects',
      'shell.nav.host.settings',
    ] as const) {
      expect(sidebar, key).toContain(t(key));
    }
    // 🔴 `レポート` は項目ごと出ない（Phase 3 まで実体が無く、押しても何も無い項目を常設しない）。
    expect(sidebar).not.toContain('data-testid="app-nav-reports"');
    expect(sidebar).not.toContain(t('shell.nav.host.reports'));
    // 🔴 群の要素が 1 つも無い（`primary` も含めて群名を描かない）。
    for (const id of ['primary', 'sales', 'comms', 'analytics']) {
      expect(sidebar, id).not.toContain(`data-testid="app-nav-${id}"`);
    }
    // 🔴 旧 4 群の語がサイドバーに出ない（`営業` はヘッダのロール名に在るので射程を柱に限る）。
    for (const key of ['shell.nav.group.sales', 'shell.nav.group.comms', 'shell.nav.group.analytics'] as const) {
      expect(sidebar, key).not.toContain(t(key));
    }
    // 🔴 畳んだ項目の語がサイドバーに残っていない（二重の入口を作らない）。
    for (const key of [
      'shell.nav.tasks',
      'shell.nav.host.candidates',
      'shell.nav.interviews',
      'shell.nav.host.contracts',
      'shell.nav.host.assignments',
      'orgSettings.title',
      'auditLogs.title',
      'skillDictionary.title',
    ] as const) {
      expect(sidebar, key).not.toContain(t(key));
    }
  });

  it('🔴 ① `設定` は索引（`/settings`）を指し、7 項目を柱に並べない', () => {
    const sidebar = sidebarOf(render({ nav: buildMainNav({ audience: 'HOST', role: 'OWNER' }) }));
    expect(sidebar).toMatch(/<a[^>]*data-testid="app-nav-settings"[^>]*href="\/settings"/);
    for (const testId of [
      'app-nav-settings-organization',
      'app-nav-settings-partner-companies',
      'app-nav-settings-sending-domains',
      'app-nav-settings-usage',
      'app-nav-settings-retention',
      'app-nav-settings-audit-logs',
      'app-nav-settings-skills',
    ]) {
      expect(sidebar, testId).not.toContain(`data-testid="${testId}"`);
    }
  });

  it('🔴 ① 全項目にアイコンが 1 つずつ付く（§7.5 ③ = 改訂 16 で禁止を解除。走査性のため）', () => {
    const html = render();
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(sidebar.length).toBeGreaterThan(0);
    const items = navItems(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    // 項目ごとに 1 つ + 開閉トグルの 1 つ。
    expect((sidebar.match(/<svg/g) ?? []).length).toBe(items.length + 1);
    // 🔴 `<img>` は使わない（セットは `lucide-react` の 1 つに固定。写像が閉じている）。
    expect(sidebar).not.toContain('<img');
  });

  it('🔴 ② ホストと取引先で語が違う（母集団が違うことを語で示す = 第二境界の常時表現）', () => {
    const host = render();
    const partner = partnerMarkup();
    expect(host).toContain(t('shell.nav.host.engineers'));
    expect(host).not.toContain(t('shell.nav.partner.engineers'));
    expect(partner).toContain(t('shell.nav.partner.engineers'));
    // ✅ 2026-10-04: `レポート` の語はどちらの所属にも出ない（項目ごと外した）。
    expect(partner).not.toContain(t('shell.nav.partner.reports'));
    expect(host).not.toContain(t('shell.nav.partner.reports'));
    // 🔴 見えてはいけない導線は**DOM から取り除かれている**（CSS で隠れているだけにしない）。
    //    🔴 `共有の設定`（経路 4）は第 2 階層へ移ったので、**ホストの外枠には帯ごと出ない**
    //       （下の「第 2 階層の帯」の検査が、取引先にだけ出ることを固定する）。
    expect(host).not.toContain(t('shell.nav.partner.shares'));
    expect(host).not.toContain('href="/engineer-shares"');
    expect(partnerMarkup()).not.toContain('href="/engineer-shares"');
  });

  it('🔴 ③ ✅ 2026-10-05: 未実装の項目が 1 つも無い（`チャット` を実装した）', () => {
    const html = render();
    const sidebar = sidebarOf(html);
    // 🔴 `aria-disabled` の項目（押せない項目）が柱に 1 つも無い。
    expect(sidebar).not.toContain('aria-disabled="true"');
    // 🔴 `Phase N` Badge の testid も 1 つも出ない（語も出ない）。
    expect(sidebar).not.toContain('data-testid="app-nav-phase-');
    expect(sidebar).not.toContain(t('shell.nav.note.phase2'));
    expect(sidebar).not.toContain(t('shell.nav.note.phase3'));
    // 🔴 サイドバーに注記（`案件から開きます` / `提案から開きます`）を持つ項目は無い ——
    //    `候補` / `面談・結果` は畳み込みで項目ごと無くなり、案件詳細 / 提案詳細から開く。
    expect(sidebar).not.toContain(t('shell.nav.note.fromProject'));
    expect(sidebar).not.toContain(t('shell.nav.note.fromProposal'));
  });

  it('🔴 ③ チャットに件数バッジを出さない（未読の実体が無い。実装後も変わっていない）', () => {
    const sidebar = sidebarOf(render());
    // モックアップは `3` を出しているが、架空の数は「見たのに消えない」を作る。
    // ✅ 2026-10-05: 項目が `<a>` になったので、掴む形も `<a>` に改めた（**検査は 1 つも緩めていない**）。
    const chat = /<a[^>]*data-testid="app-nav-chat"[\s\S]*?<\/a>/.exec(sidebar)?.[0] ?? '';
    expect(chat.length).toBeGreaterThan(0);
    expect(chat).not.toMatch(/>\s*\d+\s*</);
    expect(chat).toContain('href="/chat"');
  });

  it('実在する画面はリンクになる（チャット / 人材管理 / 案件管理 / 設定）', () => {
    const html = render({ nav: buildMainNav({ audience: 'HOST', role: 'OWNER' }) });
    for (const [testId, href] of [
      ['app-nav-home', '/'],
      ['app-nav-chat', '/chat'],
      ['app-nav-engineers', '/engineers'],
      ['app-nav-projects', '/projects'],
      ['app-nav-settings', '/settings'],
    ] as const) {
      expect(html, testId).toMatch(new RegExp(`<a[^>]*data-testid="${testId}"[^>]*href="${href}"`));
    }
  });

  it('🔴 ④ 現在地は 背景 + 文字色 の 2 点で示される（太字だけで示さない / 左端の帯は出さない）', () => {
    const html = render({ currentPath: '/engineers/e1' });
    const current = tagOf(html, 'app-nav-engineers');
    expect(current).toContain('aria-current="page"');
    // ✅ 2026-10-02: サイドバーが**濃色（濃紺）**になったため、白地用の `SELECTED_CLASSES`
    //    （`bg-brand-bg` = `indigo-50`）から濃色用の component トークンに差し替わった
    //    （`docs/04` `U-25` / §7.9 改訂 23）。
    // ✅ **2026-10-04（人間の明示指示「ハイライトの左端に色がついているのはなくして」）: 左端
    //    2px の色帯を外した。** 🔴 **背景と文字色は残す**（これが無いと現在地が分からなくなる）。
    //    ⚠️ `docs/04` §3.1 / §7.10 の「3 点」とは食い違う（人間の指示が優先。設計書の追随は別途）。
    expect(current).toContain('bg-sidebar-selected-bg');
    expect(current).toContain('text-sidebar-selected-fg');
    // 🔴 帯が戻ってこないことを固定する（トークンの宣言ごと消してある）。
    expect(current).not.toContain('border-l-2');
    expect(current).not.toContain('border-l-sidebar-selected-bar');
    // 🔴 透明な 2px の場所取りも残っていない（帯が無いので取る場所が無い）。
    expect(sidebarOf(html)).not.toContain('border-l-transparent');
    // 🔴 太字で示していない（weight を現在地の手がかりにしない）。
    expect(current).not.toContain('font-bold');
    expect(current).not.toContain('font-semibold');
    // 現在地は 1 項目だけ（前方一致が別の項目を飲み込まない）。
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    // ホームは完全一致のときだけ光る。
    expect(tagOf(html, 'app-nav-home')).not.toContain('aria-current');
  });

  it('🔴 ④ 第 2 階層の画面でも親の項目が光る（畳み込みで「どこに居るか」が消えない）', () => {
    // 🔴 `提案` / `提案依頼` / `共有の設定` / `監査ログ` / `スキル辞書` は**親と別のパス**である。
    //    `NavItem.sectionPaths` が無いと、これらの画面で 6 項目が 1 つも光らない。
    for (const [currentPath, testId] of [
      ['/proposals', 'app-nav-projects'],
      ['/proposals/abc/approve', 'app-nav-projects'],
      ['/proposal-requests', 'app-nav-projects'],
      ['/skills', 'app-nav-settings'],
      ['/audit-logs', 'app-nav-settings'],
      ['/settings/organization', 'app-nav-settings'],
    ] as const) {
      const html = render({ nav: buildMainNav({ audience: 'HOST', role: 'OWNER' }), currentPath });
      expect(tagOf(html, testId), currentPath).toContain('aria-current="page"');
      // 🔴 光るのは 1 項目だけ（射程が重なっていない）。
      const sidebar = sidebarOf(html);
      expect((sidebar.match(/aria-current="page"/g) ?? []).length, currentPath).toBe(1);
    }
    // 取引先の `共有の設定` でも `人材管理` が光る（射程は所属で変わる）。
    const partner = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }),
      currentPath: '/engineer-shares',
    });
    expect(tagOf(partner, 'app-nav-engineers')).toContain('aria-current="page"');
    // 🔴 ホスト側では `/engineer-shares` が射程に入らない（第二境界）。
    const host = render({ currentPath: '/engineer-shares' });
    expect(sidebarOf(host)).not.toContain('aria-current="page"');
  });

  it('🔴 ④ ホームは完全一致のときだけ現在地になる', () => {
    const html = render({ currentPath: '/' });
    expect(tagOf(html, 'app-nav-home')).toContain('aria-current="page"');
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it('🔴 ④ 現在地が取れないとき（ヘッダが欠けたとき）はどの項目も光らない', () => {
    expect(render({ currentPath: '' })).not.toContain('aria-current="page"');
  });

  it('🔴 ⑤ 2 形態の切替は JS を持たない（`<input type="checkbox">` + CSS）', () => {
    const html = render();
    expect(html).toContain('data-testid="app-sidebar-toggle"');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="app-sidebar-toggle"/);
    // 🔴 語は方向を断定しない（既定の形態が幅で変わるため）。
    expect(html).toContain(t('shell.sidebar.toggle'));
    // 🔴 `xl` の 1 本だけが形態の境界である（1440 / 1920 に別の境界を作らない）。
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(sidebar).toContain('xl:');
    expect(sidebar).not.toMatch(/\b2xl:/);
    // 🔴 上端にワードマークを置かない（製品名は Top Header の 1 箇所のみ = U-01）。
    const toggleRow = sidebar.slice(0, sidebar.indexOf('data-testid="app-nav-home"'));
    expect(toggleRow).not.toContain(t('product.name'));
  });

  it('🔴 外枠は primary アクション（作成系の導線）を持たない', () => {
    const html = render();
    // ✅ 2026-10-02（改訂 23）: `<button>` は **1 つだけ**在る —— 「自分」の `DropdownMenu` の
    //    トリガである（§3.1 が定めた 3 項目までのメニュー）。🔴 **作成系の導線は 1 本も無い**
    //    （それが本検査の主旨である。器が権限差分を持たない）。
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).toContain('data-testid="app-header-account-trigger"');
    expect(html).not.toContain('href="/engineers/new"');
    expect(html).not.toContain('href="/projects/new"');
    expect(html).not.toContain('href="/proposals/new"');
  });

  it('🔴 hover で動かない（拡大・浮き上がり・影・下線を出さない。§7.10）', () => {
    const html = render();
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    for (const forbidden of ['hover:scale', 'hover:shadow', 'hover:underline', 'hover:-translate', 'shadow-lg']) {
      expect(sidebar, forbidden).not.toContain(forbidden);
    }
  });
});

describe('🔴 モバイル（docs/04 §3.4）', () => {
  it('ボトムタブは 5 つ（ホーム / 人材 / 案件 / チャット / その他。2026-10-03 に 6 項目へ合わせた）', () => {
    const html = render();
    for (const id of ['home', 'engineers', 'projects', 'chat', 'more']) {
      expect(html, id).toContain(`data-testid="app-tab-${id}"`);
    }
    expect(html).toContain(t('shell.tab.more'));
    // 🔴 旧タブ（`提案` / `候補`）は手前の 4 つから外れた（`提案` は第 2 階層、`候補` は案件詳細）。
    const tabs = /data-testid="app-bottom-tabs"[\s\S]*?data-testid="app-tab-more"/.exec(html)?.[0] ?? '';
    expect(tabs).not.toContain('data-testid="app-tab-proposals"');
    expect(tabs).not.toContain('data-testid="app-tab-candidates"');
  });

  it('🔴 ボトムタブの 5 つにアイコンが付く（ラベルが 2〜3 文字に切り詰まっているため）', () => {
    const html = render();
    const tabs = /data-testid="app-bottom-tabs"[\s\S]*?data-testid="app-tab-more"/.exec(html)?.[0] ?? '';
    expect((tabs.match(/<svg/g) ?? []).length).toBe(4);
    // 5 つ目（その他）のアイコンは `<summary>` の中に在る。
    expect(/data-testid="app-tab-more-summary"[\s\S]*?<svg/.test(html)).toBe(true);
  });

  it('🔴 「その他」からサイドバーと同じ 5 項目に到達でき、並びを保つ', () => {
    const html = render();
    // 同じ項目表から描くので、サイドバーの項目はすべて「その他」にも在る（接頭辞だけが違う）。
    const ids = ['home', 'chat', 'engineers', 'projects', 'settings'];
    for (const id of ids) {
      expect(html, id).toContain(`data-testid="app-more-nav-${id}"`);
    }
    const order = ids.map((id) => html.indexOf(`data-testid="app-more-nav-${id}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('🔴 「その他」でもアイコン・`Phase N` Badge をデスクトップと同じにする（隠さない）', () => {
    const html = render();
    const more = /data-testid="app-tab-more"[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(more.length).toBeGreaterThan(0);
    // ✅ 2026-10-05: `Phase N` を持つ項目が 0 件になったので、「その他」にも Badge は出ない。
    //    🔴 **「デスクトップと同じにする」という不変条件は保っている**（どちらにも出ない）。
    expect(more).not.toContain('data-testid="app-more-nav-phase-');
    // 🔴 柱（サイドバー）側にも 1 つも出ない（`sidebarOf` はこの describe の外なので、同じ抽出をここで行う）。
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(sidebar.length).toBeGreaterThan(0);
    expect(sidebar).not.toContain('data-testid="app-nav-phase-');
    const items = navItems(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    // 「その他」の一覧にも項目ごとに 1 つのアイコンが在る（+ `<summary>` の 1 つ）。
    expect((more.match(/<svg/g) ?? []).length).toBe(items.length + 1);
  });

  it('開閉は `<details>` で行う（クライアントコンポーネントを増やさない）', () => {
    expect(render()).toMatch(/<details[^>]*data-testid="app-tab-more"/);
  });
});

// ============================================================================
// 🔴 第 2 階層の帯（2026-10-03。サイドバーを 6 項目に畳んだぶんの到達手段）
// ============================================================================
// 🔴 **ここが「機能が消えていない」ことの描画側の表明である。** 畳んだだけでは
//    `S-019` 提案 / `S-017` 提案依頼 / `S-015` 共有の設定 に到達できない
//    （ロール別の到達集合の一致は `tests/static/nav-reach.test.ts` が別に証明する）。
describe('🔴 第 2 階層の帯（`SectionNav`）', () => {
  it('🔴 `案件管理` の配下では 案件一覧 / 提案 / 提案依頼 のタブが出る（業務ループの順）', () => {
    const html = sectionMarkup('HOST', 'SALES', '/proposals');
    expect(html).toContain('data-testid="app-section-nav"');
    for (const [id, href] of [
      ['projects', '/projects'],
      ['proposals', '/proposals'],
      ['proposal-requests', '/proposal-requests'],
    ] as const) {
      expect(html, id).toMatch(
        new RegExp(`<a[^>]*data-testid="app-section-tab-${id}"[^>]*href="${href}"`),
      );
    }
    const order = ['projects', 'proposals', 'proposal-requests'].map((id) =>
      html.indexOf(`data-testid="app-section-tab-${id}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 🔴 いま開いているタブが現在地として示される（§7.10 の selected = 下端 2px + ブランド色）。
    const current = tagOf(html, 'app-section-tab-proposals');
    expect(current).toContain('aria-current="page"');
    expect(current).toContain('border-b-brand');
    expect(current).toContain('text-brand');
    // 🔴 hover で現在地の色が置き換わらない（§7.10 の `selected > hover`）。`cn()` が
    //    `hover:text-fg` を落としているので、生成 CSS の順序に依存しない。
    expect(current).toContain('hover:text-brand');
    expect(current).not.toContain('hover:text-fg"');
    expect(current).not.toMatch(/hover:text-fg\s/);
    // 🔴 太字だけで示していない（weight を現在地の手がかりにしない）。
    expect(current).not.toContain('font-bold');
    expect(tagOf(html, 'app-section-tab-projects')).not.toContain('aria-current');
    expect(tagOf(html, 'app-section-tab-projects')).toContain('border-b-transparent');
  });

  it('🔴 取引先の `人材管理` の配下にだけ `共有の設定` のタブが出る（経路 4 / 第二境界）', () => {
    const partner = sectionMarkup('PARTNER', 'PARTNER_SALES', '/engineer-shares');
    expect(partner).toMatch(
      /<a[^>]*data-testid="app-section-tab-engineer-shares"[^>]*href="\/engineer-shares"/,
    );
    expect(partner).toContain(t('shell.nav.partner.shares'));
    expect(tagOf(partner, 'app-section-tab-engineer-shares')).toContain('aria-current="page"');
    // 🔴 ホストの `人材管理` はタブが 1 つなので帯ごと出ない（`共有の設定` は DOM に無い）。
    const host = sectionMarkup('HOST', 'SALES', '/engineers');
    expect(host).not.toContain('data-testid="app-section-nav"');
    expect(host).not.toContain('data-testid="app-section-tab-engineer-shares"');
  });

  it('🔴 どのセクションにも属さない画面では帯ごと描かない（空の帯を置かない）', () => {
    for (const currentPath of ['/', '/settings', '/skills']) {
      expect(sectionMarkup('HOST', 'SALES', currentPath), currentPath).not.toContain(
        'data-testid="app-section-nav"',
      );
    }
  });

  it('🔴 帯は Top Header の直下・本文の手前に在る（ヘッダから続く 1 枚の面）', () => {
    const html = sectionMarkup('HOST', 'SALES', '/proposals');
    const header = html.indexOf('data-testid="app-header"');
    const section = html.indexOf('data-testid="app-section-nav"');
    const slot = html.indexOf('data-testid="app-page-heading-slot"');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(section).toBeGreaterThan(header);
    expect(slot).toBeGreaterThan(section);
  });

  it('🔴 帯はアイコンを持たず（§7.5 の装飾の禁止）、タブは折り返さない語で出る', () => {
    const html = sectionMarkup('HOST', 'SALES', '/proposals');
    const nav = /data-testid="app-section-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(nav.length).toBeGreaterThan(0);
    expect(nav).not.toContain('<svg');
    // 🔴 和文は文字単位で折り返せるため、`whitespace-nowrap` が無いと 1 文字ずつ割れる。
    expect(tagOf(html, 'app-section-tab-proposal-requests')).toContain('whitespace-nowrap');
    // 🔴 影を足さない / 独自ブレークポイントを使わない。
    expect(nav).not.toMatch(/\bshadow-/);
    expect(nav).not.toMatch(/(?:min|max)-\[/);
  });
});

describe('レイアウト（docs/04 §3.1 のレイアウト図。改訂 16）', () => {
  it('🔴 サイドバー → ヘッダ → 本文 の順（サイドバーは 1 本の柱で、ヘッダはその右）', () => {
    const html = render();
    const sidebar = html.indexOf('data-testid="app-sidebar"');
    const header = html.indexOf('data-testid="app-header"');
    const probe = html.indexOf('data-testid="shell-probe"');
    expect(sidebar).toBeGreaterThanOrEqual(0);
    expect(header).toBeGreaterThan(sidebar);
    expect(probe).toBeGreaterThan(header);
  });

  it('パンくず / 画面タイトル / primary アクションの領域が本文の手前に在る（中身は各画面が持つ）', () => {
    const html = render();
    expect(html.indexOf('data-testid="app-page-heading-slot"')).toBeLessThan(
      html.indexOf('data-testid="shell-probe"'),
    );
  });

  it('🔴 独自ブレークポイントを使わない（Tailwind 既定の `md:` / `xl:` のみ）', () => {
    const html = render();
    expect(html).not.toMatch(/(?:min|max)-\[/);
    expect(html).not.toMatch(/\bmax-(?:sm|md|lg|xl):/);
  });

  it('🔴 影を足さない（階層は border と背景の差で表す。§7.9）', () => {
    expect(render()).not.toMatch(/\bshadow-/);
  });
});

// ============================================================================
// 🔴 提案依頼の期限バッジ（docs/04 §3.1 取引先列。T-12-21）
// ============================================================================
// ✅ 2026-10-03: 畳み込みで `提案依頼` は第 2 階層へ移ったので、**期限は親の `案件管理` の行が
//    預かる**（`lib/shell/nav.ts` の `NavContext` の 🔴）。サイドバーはどの画面でも見えている
//    唯一の面であり、ここから期限が消えると取引先（1 日 4〜5 時間の主利用者）が気づけない。
// 🔴 **`data-testid` は `app-nav-proposal-requests-due` のまま**（凍結。`docs/04` `U-22`）——
//    値の意味（最も近い返答期限）も変えていない。変えたのは**どの行に付くか**だけである。
describe('🔴 提案依頼の期限バッジ（docs/04 §3.1 取引先列。T-12-21）', () => {
  const DUE = '残り 2 日';

  it('取引先のサイドバーと「その他」の両方に出る（項目表は 1 本なので同じ値）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    expect(html).toContain('data-testid="app-nav-proposal-requests-due"');
    expect(html).toContain('data-testid="app-more-nav-proposal-requests-due"');
    expect(html).toContain(DUE);
  });

  it('🔴 件数を出さない（出すのは期限だけ。CLAUDE.md §3.1 / F-004 AC-4）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    // バッジの中身に「N 件」に相当する表現が無い。
    const badge = /data-testid="app-nav-proposal-requests-due"[^>]*>(.*?)<\/span>/s.exec(html);
    expect(badge).not.toBeNull();
    expect(badge?.[1] ?? '').not.toMatch(/\d+\s*件/);
  });

  it('残り時間が無ければバッジの要素ごと出さない', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: null }),
    });
    expect(html).not.toContain('app-nav-proposal-requests-due');
  });

  it('🔴 ホストには出ない', () => {
    const html = render({
      nav: buildMainNav({ audience: 'HOST', role: 'SALES', proposalRequestDueText: DUE }),
    });
    expect(html).not.toContain('app-nav-proposal-requests-due');
  });

  it('読み上げ専用の見出し語が添えられる（「残り 2 日」が何の残りか分かる）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    expect(html).toContain(`<span class="sr-only">${t('shell.nav.proposalRequests.due.label')}</span>`);
  });

  it('🔴 状態バッジにアイコンを付けない（§7.5 / §5-1。色 + 形状 + 語で区別する）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    const badge = /data-testid="app-nav-proposal-requests-due"[\s\S]*?<\/span>/.exec(html)?.[0] ?? '';
    expect(badge.length).toBeGreaterThan(0);
    expect(badge).not.toContain('<svg');
  });
});

// ============================================================================
// 🔴 アイコンのみの形態の点（dot）。T-22-05 のレビュー指摘 11
// ============================================================================
// `SIDEBAR_MARK_CLASSES.sidebar` はアイコンのみの形態で `Phase N` / 注記と一緒に**期限バッジも
// 隠す**。`xl` 未満は既定でアイコンのみなので、**1024–1279px の取引先利用者は既定で返答期限を
// 見られない**（取引先は 1 日 4〜5 時間の主利用者。`CLAUDE.md` §1.2）。
// そこでバッジの代わりに点を出す —— 🔴 **件数も期限の文字も出さず**、語は `sr-only` が持つ。
describe('🔴 アイコンのみの形態の点（期限バッジの代替。T-22-05 レビュー指摘 11）', () => {
  const DUE = '残り 2 日';
  const DOT = 'data-testid="app-nav-proposal-requests-due-dot"';

  function dueMarkup(): string {
    return partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
  }

  /** 点の `<span …/>` そのもの（クラスを読むため）。 */
  function dotTag(html: string): string {
    return /<span[^>]*data-testid="app-nav-proposal-requests-due-dot"[^>]*>/.exec(html)?.[0] ?? '';
  }

  it('🔴 期限バッジを持つ項目に点が出て、アイコンのみの形態でだけ見える', () => {
    const html = dueMarkup();
    expect(html).toContain(DOT);
    const tag = dotTag(html);
    // 🔴 ラベル・印（`SIDEBAR_MARK_CLASSES`）の**裏返し**の 4 クラス。
    //    展開形（既定の `xl` 以上 / `xl` 未満でチェック時）では消え、アイコンのみの形態で現れる。
    for (const cls of ['block', 'group-has-checked:hidden', 'xl:hidden', 'xl:group-has-checked:block']) {
      expect(tag, cls).toContain(cls);
    }
    // 🔴 注意色（§7.4「直せば / 動けば進む」）。**赤にしない。**
    expect(tag).toContain('bg-warning');
    expect(tag).not.toContain('bg-danger');
  });

  it('🔴 点は件数も期限の文字も出さない（CLAUDE.md §3.1 / F-004 AC-4）', () => {
    const html = dueMarkup();
    // 空要素である（子テキストを持たない）。
    expect(html).toMatch(/data-testid="app-nav-proposal-requests-due-dot"[^>]*>\s*<\/span>/);
    const tag = dotTag(html);
    expect(tag).not.toContain(DUE);
    expect(tag).not.toMatch(/\d+\s*件/);
    // 🔴 装飾なので読み上げからは外し、語は隣の `sr-only` が持つ。
    expect(tag).toContain('aria-hidden="true"');
    expect(html).toContain(t('shell.nav.proposalRequests.due.dot'));
    expect(t('shell.nav.proposalRequests.due.dot')).not.toMatch(/\d/);
  });

  it('🔴 期限バッジを持たない項目には点が出ない（「まだ無い」は「対応が要る」ではない）', () => {
    const html = dueMarkup();
    // 点は 1 つだけで、それは期限バッジを持つ `案件管理` の行に在る。
    expect((html.match(/app-nav-proposal-requests-due-dot/g) ?? []).length).toBe(1);
    // ✅ 2026-10-05: `チャット` は `Phase N` ではなくリンクになったが、**点は出さない**
    //    （期限バッジを持つのは `案件依頼` を預かる `案件管理` の行だけである）。
    const chatItem = tagOf(html, 'app-nav-chat');
    expect(chatItem).not.toContain('bg-warning');
    expect(chatItem).not.toContain('-due-dot');
    // 「その他」（常に語が見える一覧）にも点は出さない。
    expect(html).not.toContain('app-more-nav-proposal-requests-due-dot');
  });

  it('期限が無ければ点も出ない（ホスト / 残り時間なし）', () => {
    expect(
      partnerMarkup({ nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: null }) }),
    ).not.toContain('-due-dot');
    expect(render({ nav: buildMainNav({ audience: 'HOST', role: 'SALES', proposalRequestDueText: DUE }) })).not.toContain(
      '-due-dot',
    );
  });
});

describe('🔴 読み上げ（アイコンのみの形態でも語が失われない。docs/04 §3.1）', () => {
  it('項目には `title` と読み上げ用の語の写しが付く', () => {
    const html = render();
    const link = tagOf(html, 'app-nav-engineers');
    expect(link).toContain(`title="${t('shell.nav.host.engineers')}"`);
    // 🔴 見える語が `display: none` になっても、`sr-only` の写しが読み上げに残る。
    expect(html).toContain(`<span class="sr-only">${t('shell.nav.host.engineers')}</span>`);
    // 🔴 `aria-label` で打ち消さない（打ち消すと期限バッジの語が読み上げから消える）。
    expect(link).not.toContain('aria-label');
  });
});
