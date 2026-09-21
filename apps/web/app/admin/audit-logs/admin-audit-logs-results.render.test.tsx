// apps/web/app/admin/audit-logs/admin-audit-logs-results.render.test.tsx
// `AdminAuditLogsResults`（`A-006` セクション 2）の描画テスト。T-11-03。
//
// 🔴 `docs/04` §A-006 の状態表を固定する:
//   ① 該当なし → 「条件に一致する記録はありません」
//   ② エラー → 「検索を実行できませんでした」+ 期間短縮の提案（上限超過は理由を分ける）
//   ③ 3 秒超 → 「検索しています」+ 期間の短縮を促す（3 秒以内は通常の「検索しています…」）
//   ④ 結果あり → 列は日時 / テナント / 主体（種別 + ID）/ 操作 / 対象種別 / 記録 / IP・デバイスだけ。
//      🔴 **氏名・本文に相当する列が無い**。行から辿れるのは `A-003` だけで、`targetId` を引く導線が無い
//      （`F-058 AC-1` / `AC-2`）。モバイルで残るのは日時 + テナント + 操作の 3 要素。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。他の `*.render.test.tsx` と同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformAuditLogView } from '@ses/db/platform';
import {
  AdminAuditLogsResults,
  type AdminAuditLogsResultsMessages,
  type AdminAuditLogsResultsState,
} from './admin-audit-logs-results';

const messages: AdminAuditLogsResultsMessages = {
  searching: '検索しています…',
  searchingSlow: '検索しています。時間がかかる場合は期間を短くしてください。',
  loadMore: 'さらに読み込む',
  loadingMore: '読み込んでいます…',
  errorPeriodTooLong: '期間が長すぎます。期間を短くして再実行してください。',
  errorSearchFailed: '検索を実行できませんでした。期間を短くして再実行してください。',
  emptyBeforeSearch: '条件を確認して検索を実行してください。',
  emptyNoMatch: '条件に一致する記録はありません。',
  columnDate: '日時',
  columnTenant: 'テナント',
  columnActor: '主体（マスキング済み）',
  columnAction: '操作',
  columnTargetType: '対象種別',
  columnSummary: '記録（マスキング済み）',
  columnMeta: 'IP・デバイス',
  actorKinds: { USER: '利用者', PLATFORM_USER: '運営者', SYSTEM: 'システム' },
  tenantCrossTenant: '（横断）',
  tenantUnresolved: '—',
  tenantOpenDetail: 'テナント詳細',
};

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const ENGINEER_ID = '01930000-0000-7000-8000-0000000000e1';

const ROW: PlatformAuditLogView = {
  id: '01930000-0000-7000-8000-000000000f01',
  createdAt: '2026-09-16T01:02:03.000Z',
  tenantId: TENANT_ID,
  tenantName: 'Tenant A',
  actorKind: 'USER',
  actorId: '01930000-0000-7000-8000-0000000000d1',
  action: 'engineer.view',
  targetType: 'Engineer',
  targetId: ENGINEER_ID,
  summary: { displayName: '[masked]', via: 'S-006' },
  impersonationSessionId: null,
  ipAddress: '203.0.113.10',
  deviceKind: 'mobile',
};

const CROSS_ROW: PlatformAuditLogView = {
  ...ROW,
  id: '01930000-0000-7000-8000-000000000f02',
  tenantId: null,
  tenantName: null,
  actorKind: 'PLATFORM_USER',
  action: 'admin.tenant.list',
  targetType: null,
  targetId: null,
  summary: {},
};

function render(state: AdminAuditLogsResultsState): string {
  return renderToStaticMarkup(createElement(AdminAuditLogsResults, { state, messages }));
}

describe('① 該当なし', () => {
  it('「条件に一致する記録はありません」を出し、表を描かない', () => {
    const html = render({ kind: 'results', items: [], nextCursor: null, loadingMore: false });
    expect(html).toContain('data-testid="admin-audit-logs-empty"');
    expect(html).toContain('条件に一致する記録はありません。');
    expect(html).not.toContain('data-testid="admin-audit-logs-table"');
  });

  it('検索前は別の空状態（条件の確認を促す）', () => {
    const html = render({ kind: 'idle' });
    expect(html).toContain('data-testid="admin-audit-logs-empty-before-search"');
    expect(html).not.toContain('data-testid="admin-audit-logs-empty"');
  });
});

describe('② エラー = 「検索を実行できませんでした」+ 期間短縮の提案', () => {
  it('失敗は role="alert" の箱で、期間短縮を促す', () => {
    const html = render({ kind: 'error', reason: 'FAILED' });
    expect(html).toContain('data-testid="admin-audit-logs-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('検索を実行できませんでした。期間を短くして再実行してください。');
  });

  it('期間上限超過（400）は理由を分けて出す（次の行動は同じ = 期間を短くする）', () => {
    const html = render({ kind: 'error', reason: 'PERIOD_TOO_LONG' });
    expect(html).toContain('期間が長すぎます。期間を短くして再実行してください。');
    expect(html).not.toContain('検索を実行できませんでした');
  });
});

describe('③ 3 秒超で「検索しています」+ 期間の短縮を促す', () => {
  it('3 秒以内は通常の検索中表示（aria-busy）', () => {
    const html = render({ kind: 'searching', slow: false });
    expect(html).toContain('data-testid="admin-audit-logs-searching"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('検索しています…');
    expect(html).not.toContain('期間を短くしてください');
  });

  it('🔴 3 秒を超えたら期間の短縮を促す文言に切り替わる', () => {
    const html = render({ kind: 'searching', slow: true });
    expect(html).toContain('検索しています。時間がかかる場合は期間を短くしてください。');
  });
});

describe('④ 結果テーブル（F-058 AC-1 / AC-2）', () => {
  const html = render({
    kind: 'results',
    items: [ROW, CROSS_ROW],
    nextCursor: '01930000-0000-7000-8000-000000000f02',
    loadingMore: false,
  });

  it('列は 7 つ（日時 / テナント / 主体 / 操作 / 対象種別 / 記録 / IP・デバイス）', () => {
    for (const column of [
      '日時',
      'テナント',
      '主体（マスキング済み）',
      '操作',
      '対象種別',
      '記録（マスキング済み）',
      'IP・デバイス',
    ]) {
      expect(html).toContain(`>${column}<`);
    }
    expect(html).toContain('data-testid="admin-audit-logs-table"');
    expect(html).toContain(`data-testid="admin-audit-logs-row-${ROW.id}"`);
  });

  it('🔴 主体は種別 + 不透明な ID であり、氏名の列・値が無い', () => {
    expect(html).toContain(`利用者 / ${ROW.actorId}`);
    expect(html).not.toContain('氏名');
    expect(html).not.toContain('displayName":"山田');
  });

  it('🔴 記録はマスク済みの固定形をそのまま出す（`[masked]` が見え、生の値は無い）', () => {
    expect(html).toContain(`data-testid="admin-audit-logs-summary-${ROW.id}"`);
    expect(html).toContain('[masked]');
    expect(html).toContain('S-006');
  });

  it('🔴 行から辿れる導線は A-003（テナント詳細）だけ。targetId を引くリンクが無い', () => {
    expect(html).toContain(`href="/admin/tenants/${TENANT_ID}"`);
    expect(html).toContain(`data-testid="admin-audit-logs-tenant-link-${ROW.id}"`);
    // targetId（エンジニア ID）を含む href が 1 つも無い（本文・氏名・経歴への到達導線を作らない）。
    expect(html).not.toContain(`href="/admin/engineers`);
    expect(html).not.toContain(`href="/engineers/${ENGINEER_ID}`);
    expect(html.match(/href="[^"]*/g) ?? []).toEqual([`href="/admin/tenants/${TENANT_ID}`]);
  });

  it('横断操作（tenantId = null）は「（横断）」で、A-003 への導線を持たない', () => {
    expect(html).toContain('（横断）');
    expect(html).not.toContain(`data-testid="admin-audit-logs-tenant-link-${CROSS_ROW.id}"`);
  });

  it('モバイルで残るのは日時 + テナント + 操作（他の列は hidden sm:table-cell）', () => {
    const hiddenHeads = html.match(/<th[^>]*hidden sm:table-cell[^>]*>/g) ?? [];
    expect(hiddenHeads).toHaveLength(4);
    for (const column of ['主体（マスキング済み）', '対象種別', '記録（マスキング済み）', 'IP・デバイス']) {
      expect(hiddenHeads.some((head) => html.includes(`${head}${column}`))).toBe(true);
    }
  });

  it('次ページがあれば「さらに読み込む」を描き、無ければ描かない', () => {
    expect(html).toContain('data-testid="admin-audit-logs-load-more"');
    const last = render({ kind: 'results', items: [ROW], nextCursor: null, loadingMore: false });
    expect(last).not.toContain('data-testid="admin-audit-logs-load-more"');
  });
});
