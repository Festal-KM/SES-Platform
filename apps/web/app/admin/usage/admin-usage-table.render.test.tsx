// apps/web/app/admin/usage/admin-usage-table.render.test.tsx
// `AdminUsageTable`（`A-004` 利用量・クォータ管理）の描画テスト。T-11-02。
//
// 🔴 `docs/04` §A-004 と `F-057 AC-1` / `AC-2` / `F-063 AC-5` を固定する:
//   ① 件数と金額（USD）が**同一画面**に出る（4 単位の件数 + 1 件あたり標準原価 / 当日 AI コスト / 当月 AI 原価 / 標準原価比 / 基準ユニット比）
//   ② 🔴 環境全体の帯がテナント表の外に別行として出る（`byRole` 6 ロール）。`REACHED` は `danger` の帯
//   ③ 🔴 `canEditQuota=false`（`PLATFORM_SUPPORT`）では「クォータを変更」が 1 つも描かれない。`true`（`PLATFORM_OWNER`）では行ごとに描かれる
//   ④ 抽出 0 件 → 「抽出条件に一致するテナントはありません」/ テナント 0 件 → 「テナントがまだありません」
//   ⑤ `?targetTenantId=` の行が先頭に来る
//   ⑥ 表示に利用者名・メール・業務データが無い（`BR-40`）。金額の注記（テナント側には出ない）が明示される
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（他の `*.render.test.tsx` と同じ）。
// 🔴 文言は `packages/i18n` の実物を `_lib/messages.ts` 経由で使う。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import type { AdminUsageTenantRow, AdminUsageView } from '../../../lib/admin-usage/view';
import { adminUsageMessages } from './_lib/messages';
import { AdminUsageTable, formatGib, formatUsd, type AdminUsageTableProps } from './admin-usage-table';

const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';

const quota = { source: 'DEFAULT' as const, effectiveFrom: null, pending: null };

function count(used: number, limit: number, level: 'BELOW' | 'NEARING' | 'REACHED' | null = 'BELOW') {
  return { used, limit, consumptionPercent: Math.floor((used * 100) / limit), level, quota };
}

function row(over: Partial<AdminUsageTenantRow> & { readonly tenantId: string }): AdminUsageTenantRow {
  return {
    name: `Tenant ${over.tenantId.slice(-2)}`,
    lifecycleState: 'ACTIVE',
    environment: 'production',
    seatsUsed: 8,
    aiUnits: {
      AI_UNIT_SHEET_PARSE: { ...count(18, 180), standardCostUsd: '0.033' },
      AI_UNIT_MATCH_RATIONALE: { ...count(620, 6200), standardCostUsd: '0.004' },
      AI_UNIT_PROPOSAL_DRAFT: { ...count(9, 180), standardCostUsd: '0.021' },
      AI_UNIT_RENEWAL_SUMMARY: { ...count(1, 20), standardCostUsd: '0.017' },
    },
    email: count(12, 500),
    storage: { usedBytes: '2147483648', limitBytes: '53687091200', consumptionPercent: 4, level: 'BELOW', quota },
    aiDaily: { costUsd: '1.234567', limitUsd: '5.000000', consumptionPercent: 24, level: 'BELOW' },
    aiMonthly: {
      costUsd: '3.456789',
      capUsd: '40.000000',
      consumptionPercent: 8,
      byRole: {
        'sheet-parser': '0.600000',
        'skill-normalizer': '0.100000',
        'match-explainer': '2.480000',
        'gate-inspector': '0.200000',
        'proposal-drafter': '0.060000',
        'renewal-advisor': '0.016789',
      },
      standardCostUsd: '3.288000',
      unitCostRatio: 0.99,
      baselineRatio: 0.27,
    },
    peakPercent: 24,
    band: 'MID',
    ...over,
  };
}

function view(over: Partial<AdminUsageView> = {}): AdminUsageView {
  return {
    observedAt: '2026-09-16T09:00:00.000Z',
    dayKey: '2026-09-16',
    monthKey: '2026-09',
    warnPercent: 80,
    lowPercent: 20,
    environment: {
      periodKey: '2026-09',
      spentUsd: '123.456789',
      capUsd: '500.000000',
      consumptionRate: 0.2469,
      level: 'BELOW',
      byRole: {
        'sheet-parser': '10.000000',
        'skill-normalizer': '1.000000',
        'match-explainer': '80.000000',
        'gate-inspector': '30.000000',
        'proposal-drafter': '2.000000',
        'renewal-advisor': '0.456789',
      },
      tenantCount: 7,
      observedAt: '2026-09-16T09:00:00.000Z',
    },
    filter: 'all',
    totalTenants: 2,
    items: [row({ tenantId: TENANT_A, name: 'Alpha Corp' }), row({ tenantId: TENANT_B, name: 'Beta Inc', band: 'HIGH', peakPercent: 95 })],
    ...over,
  };
}

function render(over: Partial<AdminUsageTableProps> & { readonly view: AdminUsageView }): string {
  const props: AdminUsageTableProps = { messages: adminUsageMessages(), canEditQuota: false, ...over };
  return renderToStaticMarkup(createElement(AdminUsageTable, props));
}

describe('① 件数と金額（USD）が同一画面に出る（F-063 AC-5 / docs/03 §7.6.3-2）', () => {
  it('4 単位の件数と 1 件あたり標準原価、当日 AI コスト / 上限、当月 AI 原価 / 上限、標準原価比・基準ユニット比が 1 行に出る', () => {
    const html = render({ view: view() });
    expect(html).toContain(t('admin.usage.metric.AI_UNIT_SHEET_PARSE'));
    expect(html).toContain('18 / 180 件（10%）');
    expect(html).toContain(`${t('admin.usage.standardCost')} $0.033`);
    expect(html).toContain('$1.234 / $5.000（24%）');
    expect(html).toContain('$3.456 / $40.000（8%）');
    expect(html).toContain(t('admin.usage.ratio.unitCost'));
    expect(html).toContain('×0.99');
    expect(html).toContain(t('admin.usage.ratio.baseline'));
    expect(html).toContain('×0.27');
    expect(html).toContain('12 / 500 通（2%）');
    expect(html).toContain(`${formatGib('2147483648')} / ${formatGib('53687091200')}（4%）`);
  });

  it('🔴 T-12-12: メール / ストレージの出所も AI 単位と同じ通常表示（既定 / 個別 + 適用日 / 予定）。「変更不可」の専用文言は無い', () => {
    const html = render({ view: view() });
    expect(html).toContain(t('admin.usage.quota.default'));
    expect(html).not.toContain('変更不可');
    const base = row({ tenantId: TENANT_A });
    const overridden = render({
      view: view({
        items: [
          row({
            tenantId: TENANT_A,
            email: {
              used: 12,
              limit: 4,
              consumptionPercent: 300,
              level: 'REACHED',
              quota: { source: 'OVERRIDE', effectiveFrom: '2026-09-10', pending: { limit: '2', effectiveFrom: '2026-09-17', lowering: true } },
            },
            storage: { ...base.storage, limitBytes: '4294967296', quota: { source: 'OVERRIDE', effectiveFrom: '2026-09-16', pending: null } },
          }),
        ],
      }),
    });
    expect(overridden).toContain(`${t('admin.usage.quota.override')} 2026-09-10`);
    expect(overridden).toContain(`${t('admin.usage.quota.pendingLowering')} 2026-09-17 → 2`);
    expect(overridden).toContain(`${t('admin.usage.quota.override')} 2026-09-16`);
    expect(overridden).toContain('12 / 4 通（300%）');
  });

  it('金額はテナント側には出ないという注記が明示される', () => {
    const html = render({ view: view() });
    expect(html).toContain('data-testid="admin-usage-money-note"');
    expect(html).toContain(t('admin.usage.moneyNote'));
  });

  it('formatUsd / formatGib は表示用の丸め（請求根拠ではない）', () => {
    expect(formatUsd('1234.567891')).toBe('$1,234.567');
    expect(formatUsd('0.000000')).toBe('$0.000');
    expect(formatGib('53687091200')).toBe('50.00 GiB');
  });
});

describe('② 環境全体の帯はテナント表の外に別行として出る（T-11-08 の申し送り ①）', () => {
  it('当月支出 / tier 上限 / 消費率 / 対象テナント数 / ロール別 6 件が出る（BELOW = info）', () => {
    const html = render({ view: view() });
    expect(html).toContain('data-testid="admin-usage-environment"');
    expect(html).toContain('data-level="BELOW"');
    expect(html).toContain('$123.456');
    expect(html).toContain('$500.000');
    expect(html).toContain('24%');
    expect(html).toContain(t('admin.usage.env.title'));
    expect(html).toContain(t('admin.usage.env.note'));
    const byRole = html.slice(html.indexOf('admin-usage-environment-by-role'));
    for (const role of ['sheet-parser', 'skill-normalizer', 'match-explainer', 'gate-inspector', 'proposal-drafter', 'renewal-advisor']) {
      expect(byRole).toContain(`${role}: `);
    }
  });

  it('🔴 REACHED / 上限超過は専用の帯（danger）で、テナント行の到達バッジとは別に出る', () => {
    const html = render({
      view: view({
        environment: { ...view().environment, level: 'REACHED', consumptionRate: 1.2, spentUsd: '600.000000' },
      }),
    });
    expect(html).toContain('data-level="REACHED"');
    expect(html).toContain(`120% ${t('admin.usage.env.over')}`);
  });
});

describe('③ クォータの変更は PLATFORM_OWNER にだけ描かれる（F-057 AC-2 / BR-44）', () => {
  it('🔴 canEditQuota=false（SUPPORT）では「クォータを変更」が 1 つも無い', () => {
    const html = render({ view: view(), canEditQuota: false });
    expect(html).not.toContain(t('admin.usage.row.openQuota'));
    expect(html).not.toContain('admin-usage-quota-open-');
  });

  it('canEditQuota=true（OWNER）では行ごとに描かれる', () => {
    const html = render({ view: view(), canEditQuota: true });
    expect(html).toContain(`admin-usage-quota-open-${TENANT_A}`);
    expect(html).toContain(`admin-usage-quota-open-${TENANT_B}`);
    expect(html.split(t('admin.usage.row.openQuota')).length - 1).toBe(2);
  });
});

describe('④ 空状態', () => {
  it('抽出 0 件（全体は 2 件）→「抽出条件に一致するテナントはありません」。表は出さない', () => {
    const html = render({ view: view({ items: [], totalTenants: 2, filter: 'low' }) });
    expect(html).toContain(t('admin.usage.empty.filtered'));
    expect(html).not.toContain('admin-usage-table');
    // 環境全体の帯は抽出と無関係に出る。
    expect(html).toContain('data-testid="admin-usage-environment"');
  });

  it('テナント 0 件 →「テナントがまだありません」', () => {
    const html = render({ view: view({ items: [], totalTenants: 0 }) });
    expect(html).toContain(t('admin.usage.empty.none'));
  });
});

describe('⑤ targetTenantId の行が先頭に来る（A-005 からの導線）', () => {
  it('B を指定すると B → A の順で描かれ、B の行が強調される', () => {
    const html = render({ view: view(), highlightedTenantId: TENANT_B });
    expect(html.indexOf(`admin-usage-row-${TENANT_B}`)).toBeLessThan(html.indexOf(`admin-usage-row-${TENANT_A}`));
    // `TableRow` は `class` を `data-testid` より前に描く。強調クラスが B の行に付き、A の行には付かない。
    expect(html).toMatch(new RegExp(`class="[^"]*bg-amber-50[^"]*" data-testid="admin-usage-row-${TENANT_B}"`));
    expect(html).not.toMatch(new RegExp(`class="[^"]*bg-amber-50[^"]*" data-testid="admin-usage-row-${TENANT_A}"`));
  });
});

describe('⑥ 表示は件数・金額・比率・水準・日付だけ（BR-40）', () => {
  it('帯（LOW / HIGH）と水準（NEARING / REACHED / 未評価）は列挙値の文言で出る', () => {
    const html = render({
      view: view({
        items: [
          row({ tenantId: TENANT_A, band: 'LOW', email: count(0, 500, null) }),
          row({ tenantId: TENANT_B, band: 'HIGH', aiDaily: { costUsd: '5.000000', limitUsd: '5.000000', consumptionPercent: 100, level: 'REACHED' } }),
        ],
      }),
    });
    expect(html).toContain(t('admin.usage.band.LOW'));
    expect(html).toContain(t('admin.usage.band.HIGH'));
    expect(html).toContain(t('admin.usage.level.REACHED'));
    expect(html).toContain(t('admin.usage.level.unknown'));
  });

  it('予定されている引き下げは適用日と値付きで出る', () => {
    const html = render({
      view: view({
        items: [
          row({
            tenantId: TENANT_A,
            email: {
              ...count(12, 500),
              quota: { source: 'OVERRIDE', effectiveFrom: '2026-09-01', pending: { limit: '300', effectiveFrom: '2026-10-01', lowering: true } },
            },
          }),
        ],
      }),
    });
    expect(html).toContain(`${t('admin.usage.quota.override')} 2026-09-01`);
    expect(html).toContain(`${t('admin.usage.quota.pendingLowering')} 2026-10-01 → 300`);
  });

  it('操作導線は「クォータを変更」と「テナント詳細」だけ（承認 / 送信 / 削除 / 停止は無い）', () => {
    const html = render({ view: view(), canEditQuota: true });
    for (const forbidden of ['承認', '送信', '削除', '停止する', '再送']) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).toContain(`/admin/tenants/${TENANT_A}`);
  });
});
