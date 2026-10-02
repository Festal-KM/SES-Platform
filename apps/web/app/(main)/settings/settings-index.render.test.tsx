// apps/web/app/(main)/settings/settings-index.render.test.tsx
// `設定` の索引（`/settings`）の描画。2026-10-03（サイドバーを 6 項目のフラットに畳んだぶんの到達手段）。
//
// 🔴 **なぜ描画のテストが要るか**: この索引は `S-035` / `S-014` / `S-036` / `S-038` / `S-042` /
//    `S-041` / `S-009` の**唯一の入口**になった。データ（`buildSettingsIndex`）が正しくても
//    **行が `<a>` として出ていなければ到達性は 0** であり、それは DOM に出たかどうかでしか
//    確かめられない（`tests/static/nav-reach.test.ts` はデータと配線を見るが、描画は見ない）。
//
// 🔴 `page.tsx` そのもの（async サーバコンポーネント + ctx の解決）はユニットテストの対象外
//    （`vitest.config.ts` の注記）。したがって**ページと同じ組み立て**（`buildSettingsIndex` →
//    `resolveNavIndexItems` → `NavIndex`）を通して描画する。配線が同じであることは
//    `tests/static/nav-reach.test.ts` ④ がソースで固定する。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`main-shell.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@ses/db';
import { t } from '@ses/i18n';
import { NavIndex } from '@ses/ui';
import { buildSettingsIndex, type NavAudience } from '../../../lib/shell/nav';
import { resolveNavIndexItems } from '../../../lib/shell/nav-view';

function render(audience: NavAudience, role: TenantRole): string {
  return renderToStaticMarkup(
    createElement(NavIndex, {
      items: resolveNavIndexItems(buildSettingsIndex({ audience, role })),
      label: t('settings.index.label'),
    }),
  );
}

/** `data-testid="x"` の付いた開始タグを 1 つ取り出す（属性の並び順に依存しない照合のため）。 */
function tagOf(html: string, testId: string): string {
  return new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
}

describe('🔴 `設定` の索引（7 画面の唯一の入口）', () => {
  it('ホストの `OWNER` には 7 項目がすべてリンクとして出る', () => {
    const html = render('HOST', 'OWNER');
    for (const [id, href] of [
      ['settings-organization', '/settings/organization'],
      ['settings-partner-companies', '/settings/partner-companies'],
      ['settings-sending-domains', '/settings/sending-domains'],
      ['settings-usage', '/settings/usage'],
      ['settings-retention', '/settings/retention'],
      ['settings-audit-logs', '/audit-logs'],
      ['settings-skills', '/skills'],
    ] as const) {
      // ⚠️ 属性の並び順に依存しない照合にする（`href` が先に出る）。
      const row = tagOf(html, `app-nav-index-${id}`);
      expect(row.startsWith('<a'), id).toBe(true);
      expect(row, id).toContain(`href="${href}"`);
    }
    // 🔴 語は `packages/i18n` から来る（画面にベタ書きしない）。
    for (const key of [
      'orgSettings.title',
      'partnerCompanies.title',
      'settings.sendingDomain.title',
      'usage.title',
      'retention.summary.heading',
      'auditLogs.title',
      'skillDictionary.title',
    ] as const) {
      expect(html, key).toContain(t(key));
    }
    // 索引そのものに読み上げ名が付く。
    expect(html).toContain(`aria-label="${t('settings.index.label')}"`);
    expect(html).toContain('data-testid="app-nav-index"');
  });

  it('🔴 到達できない項目は DOM から取り除かれる（グレーアウトで見せない。BR-44）', () => {
    const sales = render('HOST', 'SALES');
    for (const id of [
      'settings-organization',
      'settings-sending-domains',
      'settings-retention',
      'settings-audit-logs',
    ]) {
      expect(sales, id).not.toContain(`data-testid="app-nav-index-${id}"`);
    }
    // 🔴 「押せない形で残す」ことをしていない（`aria-disabled` / `opacity` が 1 つも無い）。
    expect(sales).not.toContain('aria-disabled');
    expect(sales).not.toContain('opacity-');
    // 到達できるものは出す（空の索引にしない）。
    expect(sales).toContain('data-testid="app-nav-index-settings-partner-companies"');
    expect(sales).toContain('data-testid="app-nav-index-settings-usage"');
    expect(sales).toContain('data-testid="app-nav-index-settings-skills"');
  });

  it('🔴 取引先には 2 項目だけ（組織設定 / 送信ドメイン / 監査ログ / 利用量 / 返却が無い）', () => {
    const partner = render('PARTNER', 'PARTNER_SALES');
    expect((partner.match(/data-testid="app-nav-index-/g) ?? []).length).toBe(2);
    expect(partner).toContain('data-testid="app-nav-index-settings-partner-companies"');
    expect(partner).toContain('data-testid="app-nav-index-settings-skills"');
    for (const key of ['orgSettings.title', 'settings.sendingDomain.title', 'auditLogs.title', 'usage.title'] as const) {
      expect(partner, key).not.toContain(t(key));
    }
  });

  it('🔴 行そのものがリンクである（押す的を語の周りだけにしない）', () => {
    const html = render('HOST', 'OWNER');
    const row = tagOf(html, 'app-nav-index-settings-skills');
    expect(row.startsWith('<a')).toBe(true);
    // 行の高さと余白は部品が持つ（画面側に `rounded-md border …` を書かせない）。
    expect(row).toContain('px-4');
    expect(row).toContain('py-3');
  });

  it('🔴 `Phase N` の項目を索引に並べない（未実装の画面への行を作らない）', () => {
    const html = render('HOST', 'OWNER');
    expect(html).not.toContain('app-nav-index-phase-');
    expect(html).not.toContain(t('shell.nav.note.phase2'));
    expect(html).not.toContain(t('shell.nav.note.phase3'));
  });

  it('🔴 項目ごとにアイコンが 1 つ付く（縦に並ぶ 7 項目の走査性。§7.5 ③）', () => {
    const html = render('HOST', 'OWNER');
    expect((html.match(/<svg/g) ?? []).length).toBe(7);
    // 🔴 `<img>` は使わない（セットは `lucide-react` の 1 つに固定。写像が閉じている）。
    expect(html).not.toContain('<img');
  });

  it('🔴 影を足さない / 独自ブレークポイントを使わない（§7.9 / CLAUDE.md §13.3）', () => {
    const html = render('HOST', 'OWNER');
    expect(html).not.toMatch(/\bshadow-/);
    expect(html).not.toMatch(/(?:min|max)-\[/);
  });
});
