// apps/web/app/admin/_components/console-nav.render.test.tsx
// 管理平面のナビの描画（docs/04 §3.3-2 の区別手段 #2 / 14 画面の割り当て表 / `F-053 AC-6`）。
//
// 🔴 固定するのは 4 つ:
//    ① **横並びタブ 5 グループ**であり、**主平面の左サイドバーとは別物**（平面の取り違え防止）
//    ② 実在する画面だけがリンクになる（未実装は `aria-disabled` + Phase の注記。404 を作らない）
//    ③ 🔴 `A-012`（デモ環境の合成データ管理）は `demo` / `development` でのみ**項目自体が存在する**
//    ④ アイコンを使わない（docs/04 §7.5）
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppEnvKind } from '@ses/config';
import { t } from '@ses/i18n';
import { AdminConsoleNav, ADMIN_NAV_TAB_IDS } from './console-nav';

function render(appEnv: AppEnvKind = 'development', current: 'tenants' | null = null): string {
  return renderToStaticMarkup(createElement(AdminConsoleNav, { appEnv, current }));
}

describe('🔴 ① 横並びタブ 5 グループ（主平面の左サイドバーと形式を変える）', () => {
  it('5 つのタブがすべて在る（監視 / テナント / 契約 / 記録 / 運用）', () => {
    const html = render();
    expect(ADMIN_NAV_TAB_IDS).toEqual(['monitoring', 'tenants', 'contracts', 'records', 'operations']);
    for (const id of ADMIN_NAV_TAB_IDS) {
      expect(html, id).toContain(`data-testid="admin-nav-tab-${id}"`);
    }
    for (const key of [
      'shell.admin.tab.monitoring',
      'shell.admin.tab.tenants',
      'shell.admin.tab.contracts',
      'shell.admin.tab.records',
      'shell.admin.tab.operations',
    ] as const) {
      expect(html, key).toContain(t(key));
    }
  });

  it('🔴 主平面のサイドバーの部品を 1 つも含まない（平面を取り違えない）', () => {
    const html = render();
    expect(html).toContain('data-testid="admin-console-nav"');
    expect(html).not.toContain('app-sidebar');
    expect(html).not.toContain('app-nav-');
    expect(html).not.toContain('app-bottom-tabs');
    // 横並び（上部の帯）であって、縦積みの左サイドバー（`border-r` + `w-56`）ではない。
    expect(html).toMatch(/<nav[^>]*class="[^"]*flex flex-wrap[^"]*border-b/);
    expect(html).not.toMatch(/<nav[^>]*class="[^"]*border-r/);
  });

  it('いま開いているタブが印されている（`data-current`）', () => {
    const html = render('development', 'tenants');
    expect(html).toMatch(/data-testid="admin-nav-tab-tenants" data-current="true"/);
    expect(html).toMatch(/data-testid="admin-nav-tab-records" data-current="false"/);
  });
});

describe('🔴 ② 実在する画面だけがリンクになる（404 を作らない）', () => {
  it('A-005 / A-002 / A-004 / A-006 はリンク', () => {
    const html = render();
    for (const [testId, href] of [
      ['admin-nav-monitoring', '/admin/monitoring'],
      ['admin-nav-tenants', '/admin/tenants'],
      ['admin-nav-usage', '/admin/usage'],
      ['admin-nav-audit-logs', '/admin/audit-logs'],
    ] as const) {
      expect(html, testId).toMatch(new RegExp(`<a[^>]*data-testid="${testId}"[^>]*href="${href}"`));
    }
  });

  it('未実装（A-011 / A-013 / A-007 / A-008 / A-009）はリンクにせず Phase の注記を添える', () => {
    const html = render();
    for (const testId of [
      'admin-nav-cost-dashboard',
      'admin-nav-sandbox-tenants',
      'admin-nav-impersonation-start',
      'admin-nav-impersonation-records',
      'admin-nav-announcements',
    ]) {
      expect(html, testId).toMatch(
        new RegExp(`<span[^>]*aria-disabled="true"[^>]*data-testid="${testId}"`),
      );
      expect(html, testId).not.toMatch(new RegExp(`<a[^>]*data-testid="${testId}"`));
    }
    expect(html).toContain(t('shell.nav.note.phase2'));
    expect(html).toContain(t('shell.nav.note.phase3'));
  });

  it('🔴 A-014（テナントの開設）をナビに置かない（導線は A-002 の中で `PLATFORM_OWNER` にだけ描かれる。BR-44）', () => {
    const html = render();
    expect(html).not.toContain('/admin/tenants/new');
  });
});

describe('🔴 ③ A-012 は `demo` / `development` でのみ項目が存在する（F-053 AC-6）', () => {
  it.each(['development', 'demo'] as const)('%s: 項目が在る', (appEnv) => {
    const html = render(appEnv);
    expect(html).toContain('data-testid="admin-nav-demo"');
    expect(html).toContain(t('admin.demo.title'));
  });

  it.each(['production', 'sandbox', 'staging'] as const)('🔴 %s: 項目自体が存在しない', (appEnv) => {
    const html = render(appEnv);
    expect(html).not.toContain('admin-nav-demo');
    expect(html).not.toContain('/admin/demo');
    // 「運用」タブ自体は残る（お知らせ・機能フラグが属する）。
    expect(html).toContain('data-testid="admin-nav-tab-operations"');
  });
});

describe('🔴 ④ アイコンを使わない（docs/04 §7.5）', () => {
  it('svg / img を 1 つも含まない', () => {
    const html = render();
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});
