// apps/web/app/admin/tenants/admin-tenants-list.render.test.tsx
// `AdminTenantsList`（`A-002` テナント一覧）の描画テスト。T-11-01。
//
// 🔴 `docs/04` §A-002 の状態表と「異常の種別」列を固定する:
//   ① 異常のシグナルが行にバッジで出る（列挙値の文言。理由の自由文・閾値の数字は文言に無い）。順序は API の順のまま
//   ② 🔴 異常 0 件（先頭ページ・異常度順）→ 「異常が検知されているテナントはありません」+ **一覧は引き続き表示**（画面を空にしない）
//   ③ テナント 0 件 → 「テナントがまだありません」
//   ④ `CLOSING` / `PURGED` は「対象外」（空欄にしない）、シグナル無しの対象テナントは「異常なし」
//   ⑤ 並び替えの切替: 現在の並びは `aria-current`、他はリンク。`health` 以外に切り替えると `?sort=`、カーソルは付かない
//   ⑥ 席の列は「利用中 / 有効」、集計日時と閾値が明示される
//   ⑦ 🔴 表示は件数・状態・日時・シグナル名だけ（利用者名・メール・業務データの値が HTML に現れない。`BR-40`）
//   ⑧ 操作導線（承認 / 送信 / 削除 / 停止）が 1 つも無い（`BR-37`）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（他の `*.render.test.tsx` と同じ）。
// 🔴 文言は `packages/i18n` の実物を `_lib/messages.ts` 経由で使う。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformTenantListItemView, PlatformTenantListPage } from '@ses/db/platform';
import { countTenantHealthSignals, DEFAULT_TENANT_HEALTH_THRESHOLDS, TENANT_HEALTH_SIGNALS } from '@ses/domain';
import { t } from '@ses/i18n';
import { adminTenantsMessages } from './_lib/messages';
import { AdminTenantsList, tenantListHref, type AdminTenantsListProps } from './admin-tenants-list';

/** API-A2 の応答の形（`summary` は絞り込み前の母集団から数える。ここでは渡した行から数える）。 */
function pageOf(items: readonly PlatformTenantListItemView[], nextCursor: string | null): PlatformTenantListPage {
  return { items, nextCursor, observedAt: NOW, summary: countTenantHealthSignals(items) };
}

const NOW = '2026-09-16T09:00:00.000Z';
const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';
const TENANT_C = '01930000-0000-7000-8000-0000000000c1';
const TENANT_P = '01930000-0000-7000-8000-0000000000c9';

function item(over: Partial<PlatformTenantListItemView> & { readonly id: string }): PlatformTenantListItemView {
  return {
    name: `Tenant ${over.id.slice(-2)}`,
    environment: 'production',
    lifecycleState: 'ACTIVE',
    lifecycleChangedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastActivityAt: '2026-09-15T00:00:00.000Z',
    seatCount: 10,
    activeMemberCount: 8,
    partnerCompanyCount: 3,
    engineerCount: 12,
    projectCount: 4,
    health: { score: 0, signals: [] },
    ...over,
  };
}

function render(over: Partial<AdminTenantsListProps> & { readonly page: PlatformTenantListPage }): string {
  const props: AdminTenantsListProps = {
    sort: 'health',
    signal: null,
    isFirstPage: true,
    thresholds: DEFAULT_TENANT_HEALTH_THRESHOLDS,
    messages: adminTenantsMessages(),
    ...over,
  };
  return renderToStaticMarkup(createElement(AdminTenantsList, props));
}

const ABNORMAL = item({
  id: TENANT_A,
  lifecycleState: 'SANDBOX',
  environment: 'sandbox',
  lastActivityAt: '2026-08-20T00:00:00.000Z',
  seatCount: 10,
  activeMemberCount: 1,
  partnerCompanyCount: 0,
  health: { score: 76, signals: ['TRIAL_EXPIRED', 'INACTIVE', 'SEATS_UNUSED', 'NO_PARTNERS'] },
});
const HEALTHY = item({ id: TENANT_B });
const CLOSING = item({ id: TENANT_C, lifecycleState: 'CLOSING' });
const PURGED = item({ id: TENANT_P, lifecycleState: 'PURGED', seatCount: 0, activeMemberCount: 0, partnerCompanyCount: 0, engineerCount: 0, projectCount: 0, lastActivityAt: null });

describe('AdminTenantsList（A-002 / F-056 AC-2）', () => {
  it('① 異常のシグナルが行にバッジで出る（列挙値の文言。API の順）', () => {
    const html = render({ page: pageOf([ABNORMAL, HEALTHY], null) });
    expect(html).toContain('data-testid="admin-tenants-health-signals"');
    for (const signal of ['TRIAL_EXPIRED', 'INACTIVE', 'SEATS_UNUSED', 'NO_PARTNERS'] as const) {
      expect(html).toContain(`data-testid="admin-tenants-health-signal-${signal}"`);
      expect(html).toContain(t(`admin.tenants.health.signal.${signal}`));
    }
    const order = ['TRIAL_EXPIRED', 'INACTIVE', 'SEATS_UNUSED', 'NO_PARTNERS'].map((signal) =>
      html.indexOf(`admin-tenants-health-signal-${signal}`),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 期限接近は成立していないので出ない。
    expect(html).not.toContain('admin-tenants-health-signal-TRIAL_EXPIRING');
    // 異常があるので「異常なし」の帯は出ない。
    expect(html).not.toContain('data-testid="admin-tenants-all-clear"');
  });

  it('🔴 ② 異常 0 件（先頭ページ・異常度順）→ 全体の帯 + 一覧は引き続き表示（画面を空にしない）', () => {
    const html = render({ page: pageOf([HEALTHY, CLOSING], null) });
    expect(html).toContain('data-testid="admin-tenants-all-clear"');
    expect(html).toContain(t('admin.tenants.health.allClear'));
    expect(html).toContain('data-testid="admin-tenants-table"');
    expect(html).toContain(`admin-tenants-row-${TENANT_B}`);
    expect(html).toContain(`admin-tenants-row-${TENANT_C}`);
  });

  it('② 異常 0 件でも、2 ページ目や別の並びでは帯を出さない（先頭が最上位である保証が無い）', () => {
    const page: PlatformTenantListPage = pageOf([HEALTHY], null);
    expect(render({ page, isFirstPage: false })).not.toContain('admin-tenants-all-clear');
    expect(render({ page, sort: 'name' })).not.toContain('admin-tenants-all-clear');
  });

  it('③ テナント 0 件 → 「テナントがまだありません」', () => {
    const html = render({ page: pageOf([], null) });
    expect(html).toContain('data-testid="admin-tenants-empty"');
    expect(html).toContain(t('admin.tenants.empty'));
    expect(html).not.toContain('admin-tenants-table');
  });

  it('🔴 低-3: 絞り込み無しの範囲外カーソル（0 件・先頭ページでない）は空文言 + 表なし（画面を空にしない）', () => {
    const html = render({ page: pageOf([], null), isFirstPage: false, signal: null });
    expect(html).not.toContain('data-testid="admin-tenants-empty"');
    expect(html).not.toContain('data-testid="admin-tenants-summary-filtered-empty"');
    expect(html).toContain('data-testid="admin-tenants-out-of-range"');
    expect(html).toContain(t('admin.tenants.summary.outOfRange'));
    expect(html).not.toContain('data-testid="admin-tenants-table"');
  });

  it('④ CLOSING / PURGED は「対象外」、シグナル無しの対象テナントは「異常なし」', () => {
    const html = render({ page: pageOf([HEALTHY, CLOSING, PURGED], null) });
    expect(html.match(/data-testid="admin-tenants-health-not-scored"/g)).toHaveLength(2);
    expect(html.match(/data-testid="admin-tenants-health-none"/g)).toHaveLength(1);
    expect(html).toContain(t('admin.tenants.health.notScored'));
    expect(html).toContain(t('admin.tenants.health.none'));
  });

  it('⑤ 並び替え: 現在の並びは aria-current、他はリンク。health 以外は ?sort=、カーソルは付かない', () => {
    const html = render({
      page: pageOf([HEALTHY], TENANT_B),
      sort: 'name',
      isFirstPage: false,
    });
    expect(html).toMatch(/data-testid="admin-tenants-sort-name"[^>]*aria-current="true"|aria-current="true"[^>]*data-testid="admin-tenants-sort-name"/);
    expect(html).toContain('href="/admin/tenants"'); // health（既定）はクエリ無し
    expect(html).toContain('href="/admin/tenants?sort=createdAt"');
    // 「さらに読み込む」は現在の並びを保ってカーソルを付ける。
    expect(html).toContain(`href="/admin/tenants?sort=name&amp;cursor=${TENANT_B}"`);
    expect(tenantListHref('health', null)).toBe('/admin/tenants');
    expect(tenantListHref('health', TENANT_B)).toBe(`/admin/tenants?cursor=${TENANT_B}`);
    expect(tenantListHref('createdAt', null)).toBe('/admin/tenants?sort=createdAt');
  });

  it('⑥ 席の列は「利用中 / 有効」、集計日時（JST）と閾値が明示される', () => {
    const html = render({ page: pageOf([ABNORMAL], null) });
    expect(html).toContain(t('admin.tenants.column.seats.detail'));
    expect(html).toMatch(new RegExp(`data-testid="admin-tenants-seats-${TENANT_A}"[^>]*>1 / 10<`));
    expect(html).toContain('data-testid="admin-tenants-observed-at"');
    expect(html).toContain('2026-09-16 18:00 JST');
    expect(html).toContain('data-testid="admin-tenants-thresholds"');
    expect(html).toContain(`${t('admin.tenants.health.thresholds.inactive')} 14${t('admin.tenants.health.unit.daysOrMore')}`);
    expect(html).toContain(`${t('admin.tenants.health.thresholds.seats')} 30${t('admin.tenants.health.unit.percentBelow')}`);
  });

  it('🔴 ⑦ 件数・状態・日時・シグナル名だけ（スコアの数値も HTML に出さない。BR-40）', () => {
    const html = render({ page: pageOf([ABNORMAL, HEALTHY], null) });
    // 応答型に無い値が描かれないことは型が保証するが、スコアの生値（76）は型にあっても出さない
    // （運営者が読むのは種別であり、内部の重みの合計ではない）。
    expect(html).not.toMatch(/>76</);
  });

  it('⑧ 操作導線（承認 / 送信 / 削除 / 停止 / フォーム）が 1 つも無い。行の遷移先は A-003 だけ', () => {
    const html = render({ page: pageOf([ABNORMAL, HEALTHY, CLOSING], null), signal: 'INACTIVE' });
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/admin\/tenants(\/[0-9a-f-]+|\?[^"]*)?$/);
    }
  });
});

describe('T-12-18 ③ セクション 1「異常の要約」（docs/04 §A-002 / docs/05 §6.9 API-A2 summary）', () => {
  it('🔴 要約は一覧の最上部（集計日時・並び替え・表より前）にあり、0 件の種別も描く。値は API の summary そのもの', () => {
    const page = pageOf([ABNORMAL, HEALTHY, CLOSING], null);
    const html = render({ page });
    const summaryAt = html.indexOf('data-testid="admin-tenants-summary"');
    expect(summaryAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(html.indexOf('data-testid="admin-tenants-observed-at"'));
    expect(summaryAt).toBeLessThan(html.indexOf('data-testid="admin-tenants-sort"'));
    expect(summaryAt).toBeLessThan(html.indexOf('data-testid="admin-tenants-table"'));
    expect(html).toContain(t('admin.tenants.summary.label'));
    for (const signal of TENANT_HEALTH_SIGNALS) {
      expect(html).toContain(`data-testid="admin-tenants-summary-${signal}"`);
      expect(html).toContain(`data-count="${page.summary[signal]}"`);
      expect(html).toContain(`${t(`admin.tenants.health.signal.${signal}`)} ${page.summary[signal]}${t('admin.tenants.summary.unit')}`);
    }
    // 4 種が 1 件ずつ、期限接近は 0 件（0 件でもチップが在る）。
    expect(page.summary).toEqual({ TRIAL_EXPIRED: 1, INACTIVE: 1, SEATS_UNUSED: 1, NO_PARTNERS: 1, TRIAL_EXPIRING: 0 });
    expect(html).toMatch(/data-testid="admin-tenants-summary-TRIAL_EXPIRING"[^>]*data-count="0"/);
  });

  it('チップは ?signal= への導線（カーソルは付かない）。絞り込み中は aria-current + 解除の導線、並び替え・さらに読み込むも signal を保つ', () => {
    const html = render({ page: pageOf([ABNORMAL], TENANT_A), signal: 'INACTIVE', sort: 'name', isFirstPage: false });
    expect(html).toMatch(/data-testid="admin-tenants-summary-INACTIVE"[^>]*aria-current="true"|aria-current="true"[^>]*data-testid="admin-tenants-summary-INACTIVE"/);
    expect(html).toContain('href="/admin/tenants?sort=name&amp;signal=TRIAL_EXPIRED"');
    expect(html).toContain('data-testid="admin-tenants-summary-clear"');
    expect(html).toContain(t('admin.tenants.summary.clear'));
    expect(html).toContain('href="/admin/tenants?sort=name"'); // 解除 = 同じ並びで絞り込み無し
    expect(html).toContain('href="/admin/tenants?signal=INACTIVE"'); // 並び替え health は既定なのでクエリ無し + signal を保つ
    expect(html).toContain(`href="/admin/tenants?sort=name&amp;signal=INACTIVE&amp;cursor=${TENANT_A}"`);
    expect(tenantListHref('health', null, 'NO_PARTNERS')).toBe('/admin/tenants?signal=NO_PARTNERS');
    expect(tenantListHref('createdAt', TENANT_B, 'NO_PARTNERS')).toBe(`/admin/tenants?sort=createdAt&signal=NO_PARTNERS&cursor=${TENANT_B}`);
    // 絞り込み無しのチップは aria-current を持たず、解除の導線も無い。
    const plain = render({ page: pageOf([ABNORMAL], null) });
    expect(plain).not.toContain('admin-tenants-summary-clear');
    expect(plain).not.toMatch(/data-testid="admin-tenants-summary-[A-Z_]+"[^>]*aria-current/);
  });

  it('🔴 絞り込み 0 件は「テナントがまだありません」ではなく、要約 + 種別の空文言 + 解除の導線（画面を空にしない）', () => {
    const html = render({ page: pageOf([], null), signal: 'TRIAL_EXPIRING' });
    expect(html).not.toContain('data-testid="admin-tenants-empty"');
    expect(html).toContain('data-testid="admin-tenants-summary"');
    expect(html).toContain('data-testid="admin-tenants-summary-filtered-empty"');
    expect(html).toContain(t('admin.tenants.summary.filteredEmpty'));
    expect(html).toContain('data-testid="admin-tenants-summary-clear"');
    expect(html).not.toContain('data-testid="admin-tenants-table"');
    // 絞り込み中は「異常なし」の帯を出さない（先頭が最上位である保証が無い）。
    expect(html).not.toContain('admin-tenants-all-clear');
  });

  it('🔴 要約に載るのは種別（列挙値）と件数だけ（テナント名・ID が要約に混ざらない。BR-40）', () => {
    const html = render({ page: pageOf([ABNORMAL], null) });
    const summaryHtml = html.slice(html.indexOf('data-testid="admin-tenants-summary"'), html.indexOf('data-testid="admin-tenants-observed-at"'));
    expect(summaryHtml).not.toContain(ABNORMAL.name);
    expect(summaryHtml).not.toContain(TENANT_A);
  });
});
