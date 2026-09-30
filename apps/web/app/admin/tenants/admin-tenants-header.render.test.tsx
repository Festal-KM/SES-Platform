// apps/web/app/admin/tenants/admin-tenants-header.render.test.tsx
// `AdminTenantsHeader`（`A-002` のヘッダ）の描画テスト。SP-22 `T-22-08`。
//
// 🔴 固定するのは `BR-44` のロール差分である:
//   ① `PLATFORM_OWNER` には `A-014`（テナントの開設）への導線が在る
//   ② 🔴 **`PLATFORM_SUPPORT` には導線が DOM から無い** —— グレーアウト（`aria-disabled` /
//      `opacity` / `disabled`）で見せない（`docs/04` §3.3 の 🔴 / §8.1 / `F-001` の `PP` = `−`）
//   ③ 🔴 **`閲覧のみ` は両ロールで常時出る**（`BR-37` / `docs/04` §3.3-4）
//   ④ 🔴 **アイコンを付けない**（`docs/04` §3.3 の改訂 16 ② / §7.5）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （他の `*.render.test.tsx` と同じ）。文言は `packages/i18n` の実物を `_lib/messages.ts` 経由で使う。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformRole } from '@ses/db';
import { t } from '@ses/i18n';
import { adminTenantsHeaderMessages } from './_lib/messages';
import { AdminTenantsHeader } from './admin-tenants-header';

function render(platformRole: PlatformRole): string {
  return renderToStaticMarkup(
    createElement(AdminTenantsHeader, { platformRole, messages: adminTenantsHeaderMessages() }),
  );
}

describe('AdminTenantsHeader（A-002 / BR-44 / BR-37）', () => {
  it('① PLATFORM_OWNER には A-014（テナントの開設）への導線が在る', () => {
    const html = render('PLATFORM_OWNER');
    expect(html).toContain('data-testid="admin-tenants-provision-link"');
    expect(html).toContain('href="/admin/tenants/new"');
    expect(html).toContain(t('admin.provisioning.link'));
  });

  it('🔴 ② PLATFORM_SUPPORT には導線が DOM から無い（グレーアウトで見せない）', () => {
    const html = render('PLATFORM_SUPPORT');
    expect(html).not.toContain('admin-tenants-provision-link');
    expect(html).not.toContain('/admin/tenants/new');
    expect(html).not.toContain(t('admin.provisioning.link'));
    // 🔴 「押せないだけ」の形で残っていない（`BR-44`「グレーアウトでは見せない」）。
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('opacity');
    // 🔴 リンクが 1 本も無い（ヘッダから遷移できる先はロール差分のこの 1 本だけである）。
    expect(html).not.toContain('<a ');
  });

  it('🔴 ③ `閲覧のみ` とタイトルは両ロールで常時出る（BR-37 / docs/04 §3.3-4）', () => {
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_SUPPORT'] as const) {
      const html = render(role);
      expect(html).toContain('data-testid="admin-tenants-read-only-badge"');
      expect(html).toContain(t('admin.readOnly.badge'));
      expect(html).toContain('data-testid="admin-tenants-title"');
      expect(html).toContain(t('admin.tenants.title'));
    }
  });

  it('🔴 ④ アイコン（svg）を付けない。書き込みの導線（button / form）も無い', () => {
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_SUPPORT'] as const) {
      const html = render(role);
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('<form');
    }
  });
});
