// apps/web/app/(main)/_shell/app-shell.render.test.tsx
// 共通外枠の描画（docs/04 §3.1 / §3.2 / §3.3 / §3.4 / §7.5）。
//
// 🔴 なぜ描画のテストが要るか: 外枠が守るのは**見えていること**そのものである ——
//    「第二境界が常時見えている」「未実装の項目がリンクになっていない」「平常時に上限の警告を
//    出さない」は、いずれも DOM に出たかどうかでしか確かめられない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`home-sections.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import { buildBottomTabs, buildMainNav } from '../../../lib/shell/nav';
import type { ShellUsageIndicator } from '../../../lib/shell/usage-indicator';
import { AppShell, type AppShellProps } from './app-shell';

const HOST_ORG = 'テスト商事株式会社';
const PARTNER_COMPANY = 'テストパートナー株式会社';

function render(overrides: Partial<AppShellProps> = {}): string {
  const props: AppShellProps = {
    wordmark: t('product.name'),
    organizationName: HOST_ORG,
    partnerCompanyName: null,
    userName: '山田太郎',
    roleLabel: t('members.role.SALES'),
    usage: { kind: 'NONE' },
    usageHref: '/settings/usage',
    nav: buildMainNav({ audience: 'HOST', role: 'SALES' }),
    tabs: buildBottomTabs(),
    children: createElement('main', { 'data-testid': 'shell-probe' }),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(AppShell, props));
}

function partnerMarkup(overrides: Partial<AppShellProps> = {}): string {
  return render({
    partnerCompanyName: PARTNER_COMPANY,
    roleLabel: t('members.role.PARTNER_SALES'),
    // 🔴 取引先所属では `S-038` への導線を持たない（docs/04 §S-038 / F-027 AC-1）。
    usageHref: null,
    nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }),
    ...overrides,
  });
}

describe('ヘッダ（docs/04 §3.3 の 5 要素）', () => {
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

  it('自分は氏名 + ロール名で出る（なぜこの操作ができないかの一次説明）', () => {
    expect(render()).toContain(`山田太郎（${t('members.role.SALES')}）`);
  });

  it('🔴 通知（S-032 = Phase 2）は項目を出すがリンクにしない', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-notifications"');
    expect(html).toContain(t('shell.header.notifications'));
    expect(html).not.toMatch(/<a[^>]*data-testid="app-header-notifications"/);
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*data-testid="app-header-notifications"/);
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

describe('🔴 サイドバー（docs/04 §3.3 の項目表 / §7.5 アイコン禁止）', () => {
  it('🔴 アイコンを 1 つも使わない（語だけで区別する）', () => {
    const html = render();
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });

  it('ホストと取引先で項目集合が違う（取引先にだけ「共有の設定」がある）', () => {
    const host = render();
    const partner = partnerMarkup();
    expect(host).toContain(t('shell.nav.host.engineers'));
    expect(host).not.toContain(t('shell.nav.partner.engineers'));
    expect(partner).toContain(t('shell.nav.partner.engineers'));
    expect(partner).toContain(t('shell.nav.partner.shares'));
    expect(host).not.toContain(t('shell.nav.partner.shares'));
  });

  it('🔴 取引先にも ⑤ ⑥ が出る（Issue #8 = 越境経路 5）', () => {
    const partner = partnerMarkup();
    expect(partner).toContain(t('shell.nav.partner.contracts'));
    expect(partner).toContain(t('shell.nav.partner.assignments'));
  });

  it('🔴 未実装の項目はリンクにならず、注記が付く（404 を作らない）', () => {
    const html = render();
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*data-testid="app-nav-contracts"/);
    expect(html).not.toMatch(/<a[^>]*data-testid="app-nav-contracts"/);
    expect(html).toContain(t('shell.nav.note.phase3'));
    expect(html).toContain(t('shell.nav.note.phase2'));
    // ② 候補・④ 面談は「実在するが単独の URL を持たない」ので別の注記になる。
    expect(html).toContain(t('shell.nav.note.fromProject'));
    expect(html).toContain(t('shell.nav.note.fromProposal'));
  });

  it('実在する画面はリンクになる（人材・案件・提案・提案依頼・設定の子項目）', () => {
    const html = render({ nav: buildMainNav({ audience: 'HOST', role: 'OWNER' }) });
    for (const [testId, href] of [
      ['app-nav-engineers', '/engineers'],
      ['app-nav-projects', '/projects'],
      ['app-nav-proposals', '/proposals'],
      ['app-nav-proposal-requests', '/proposal-requests'],
      ['app-nav-settings-audit-logs', '/audit-logs'],
      ['app-nav-settings-skills', '/skills'],
    ] as const) {
      expect(html, testId).toMatch(new RegExp(`<a[^>]*data-testid="${testId}"[^>]*href="${href}"`));
    }
  });

  it('🔴 外枠は primary アクション（作成系の導線）を持たない', () => {
    const html = render();
    expect(html).not.toContain('<button');
    expect(html).not.toContain('href="/engineers/new"');
    expect(html).not.toContain('href="/projects/new"');
    expect(html).not.toContain('href="/proposals/new"');
  });
});

describe('🔴 モバイル（docs/04 §3.4）', () => {
  it('ボトムタブは 5 つ（ホーム / 提案 / 候補 / チャット / その他）', () => {
    const html = render();
    for (const id of ['home', 'proposals', 'candidates', 'chat', 'more']) {
      expect(html, id).toContain(`data-testid="app-tab-${id}"`);
    }
    expect(html).toContain(t('shell.tab.more'));
  });

  it('🔴 「その他」からサイドバーと同じ項目に到達でき、業務ループの順序を保つ', () => {
    const html = render();
    // 同じ項目表から描くので、サイドバーの項目はすべて「その他」にも在る（接頭辞だけが違う）。
    for (const id of ['home', 'engineers', 'projects', 'proposals', 'settings']) {
      expect(html, id).toContain(`data-testid="app-more-nav-${id}"`);
    }
    const order = ['home', 'engineers', 'projects', 'candidates', 'proposals'].map((id) =>
      html.indexOf(`data-testid="app-more-nav-${id}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('開閉は `<details>` で行う（クライアントコンポーネントを増やさない）', () => {
    expect(render()).toMatch(/<details[^>]*data-testid="app-tab-more"/);
  });
});

describe('レイアウト（docs/04 §3.1 のレイアウト図）', () => {
  it('ヘッダ → サイドバー → 本文 の順で、本文（children）が描かれる', () => {
    const html = render();
    const header = html.indexOf('data-testid="app-header"');
    const sidebar = html.indexOf('data-testid="app-sidebar"');
    const probe = html.indexOf('data-testid="shell-probe"');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(sidebar).toBeGreaterThan(header);
    expect(probe).toBeGreaterThan(sidebar);
  });

  it('パンくず / 画面タイトル / primary アクションの領域が本文の手前に在る（中身は各画面が持つ）', () => {
    const html = render();
    expect(html.indexOf('data-testid="app-page-heading-slot"')).toBeLessThan(
      html.indexOf('data-testid="shell-probe"'),
    );
  });

  it('🔴 独自ブレークポイントを使わない（Tailwind 既定の `md:` のみ）', () => {
    const html = render();
    expect(html).not.toMatch(/(?:min|max)-\[/);
    expect(html).not.toMatch(/\bmax-(?:sm|md|lg|xl):/);
  });
});
