// apps/web/app/(main)/audit-logs/audit-logs-view.render.test.tsx
// `AuditLogsView` / `AuditLogsExportSection`（`S-041` セクション 4。CSV エクスポート）の描画テスト。
// レビュー指摘 NG-2（2026-09-21。`docs/05` §6.4「CSV エクスポート」行 ⑥の検証が要求している分）。
//
// 🔴 固定するもの:
//   ① 検索前はエクスポート節（`audit-logs-export`）が無い
//   ② 検索後: `audit-logs-export` / `audit-logs-export-link` が出て、`href` が `auditLogExportHref` の値と一致する
//   ③ 400（`AUDIT_LOG_EXPORT_TOO_LARGE`）応答でエラー文言が出る（応答をモック）
//
// 🔴 `AuditLogsView` は `'use client'` の `useState` で検索後の状態を持つため、`react-dom/server` の
//    `renderToStaticMarkup`（他の `*.render.test.tsx` と同じ。`@testing-library/react` は使わない）では
//    クリック後の再描画を確かめられない（`useEffect` 同様）。そのため②③は、`AuditLogsView` が実際に描画へ
//    使う**状態を持たない部品** `AuditLogsExportSection` を直接描いて固定する（`AdminAuditLogsResults` と同じ分離）。
//    ③の「応答をモック」は `classifyAuditLogExportError`（`fetch` の返り値である `Response` をそのまま受け取る
//    純粋関数）に、実際に組み立てた `Response` を渡して確かめる —— `fetch` 自体を差し替える必要が無い。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_EXPORT_MAX_ROWS } from '@ses/config';
import { t } from '@ses/i18n';
import { AUDIT_LOG_CATEGORY_KEYS, type AuditLogCategoryKey } from '../../../lib/audit-logs/categories';
import { auditLogDetailMessages } from '../../../lib/audit-logs/detail-labels';
import { auditLogExportHref, classifyAuditLogExportError } from '../../../lib/audit-logs/export-href';
import { AuditLogsExportSection, AuditLogsView, type AuditLogsViewMessages } from './audit-logs-view';

function categoryNames(): Readonly<Record<AuditLogCategoryKey, string>> {
  const entries = AUDIT_LOG_CATEGORY_KEYS.map((key) => [key, t(`auditLogs.category.${key}`)] as const);
  return Object.fromEntries(entries) as Record<AuditLogCategoryKey, string>;
}

/** `page.tsx` と同じ組み立て（実物の辞書を使う。`AuditLogsView` の描画は文言のハードコードを持たない前提を確かめる）。 */
const messages: AuditLogsViewMessages = {
  fromLabel: t('auditLogs.filter.from.label'),
  toLabel: t('auditLogs.filter.to.label'),
  categoryLabel: t('auditLogs.filter.category.label'),
  categoryAll: t('auditLogs.filter.category.all'),
  categoryNames: categoryNames(),
  actorIdLabel: t('auditLogs.filter.actorId.label'),
  search: t('auditLogs.search'),
  searching: t('auditLogs.searching'),
  loadMore: t('auditLogs.loadMore'),
  loadingMore: t('auditLogs.loadingMore'),
  periodRequired: t('auditLogs.error.periodRequired'),
  searchFailed: t('auditLogs.error.searchFailed'),
  emptyBeforeSearch: t('auditLogs.empty.beforeSearch'),
  emptyNoMatch: t('auditLogs.empty.noMatch'),
  columnDate: t('auditLogs.column.date'),
  columnActor: t('auditLogs.column.actor'),
  columnAction: t('auditLogs.column.action'),
  columnTarget: t('auditLogs.column.target'),
  columnMeta: t('auditLogs.column.meta'),
  columnDetail: t('auditLogs.column.detail'),
  actorSystem: t('auditLogs.actor.system'),
  actorPlatform: t('auditLogs.actor.platform'),
  detail: auditLogDetailMessages(),
  exportButton: t('auditLogs.export.button'),
  exportNote: t('auditLogs.export.note'),
  exportNoteLimit: t('auditLogs.export.note.limit').replace('{maxRows}', String(AUDIT_LOG_EXPORT_MAX_ROWS)),
  exportTooLarge: t('error.auditLogs.exportTooLarge'),
  exportFailed: t('auditLogs.export.error.failed'),
};

describe('AuditLogsView（S-041。① 検索前はエクスポート節が無い）', () => {
  it('① 初回描画（検索前）に audit-logs-export が現れない', () => {
    const html = renderToStaticMarkup(createElement(AuditLogsView, { messages }));
    expect(html).not.toContain('data-testid="audit-logs-export"');
    expect(html).not.toContain('data-testid="audit-logs-export-link"');
  });
});

describe('AuditLogsExportSection（S-041 セクション 4 の純粋な描画部品。② ③）', () => {
  const exportMessages = {
    exportButton: messages.exportButton,
    exportNote: messages.exportNote,
    exportNoteLimit: messages.exportNoteLimit,
    exportTooLarge: messages.exportTooLarge,
    exportFailed: messages.exportFailed,
  };

  it('② href が auditLogExportHref の値と一致する導線が出る（エラー無し）', () => {
    const href = auditLogExportHref({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-18T23:59:59.999Z',
      action: 'ENGINEER_SKILL_SHEET_ACCESS',
      actorId: '01930000-0000-7000-8000-00000000000b',
    });
    const html = renderToStaticMarkup(
      createElement(AuditLogsExportSection, {
        href,
        exporting: false,
        error: null,
        messages: exportMessages,
        onExport: () => {},
      }),
    );
    expect(html).toContain('data-testid="audit-logs-export"');
    expect(html).toContain('data-testid="audit-logs-export-link"');
    expect(html).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
    expect(html).toContain(messages.exportButton);
    expect(html).toContain(messages.exportNoteLimit);
    expect(html).not.toContain('data-testid="audit-logs-export-error"');
  });

  it('③ 400（AUDIT_LOG_EXPORT_TOO_LARGE）応答でエラー文言が出る（応答をモック）', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'AUDIT_LOG_EXPORT_TOO_LARGE', messageKey: 'error.auditLogs.exportTooLarge', retryable: false } }),
      { status: 400 },
    );
    const reason = await classifyAuditLogExportError(response);
    expect(reason).toBe('TOO_LARGE');

    const html = renderToStaticMarkup(
      createElement(AuditLogsExportSection, {
        href: '/api/audit-logs/export?from=f&to=t',
        exporting: false,
        error: reason,
        messages: exportMessages,
        onExport: () => {},
      }),
    );
    expect(html).toContain('data-testid="audit-logs-export-error"');
    expect(html).toContain(messages.exportTooLarge);
    expect(html).not.toContain(messages.exportFailed);
  });

  it('🔴 400 でも AUDIT_LOG_EXPORT_TOO_LARGE 以外は FAILED（汎用の失敗文言）', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 });
    const reason = await classifyAuditLogExportError(response);
    expect(reason).toBe('FAILED');

    const html = renderToStaticMarkup(
      createElement(AuditLogsExportSection, {
        href: '/api/audit-logs/export?from=f&to=t',
        exporting: false,
        error: reason,
        messages: exportMessages,
        onExport: () => {},
      }),
    );
    expect(html).toContain('data-testid="audit-logs-export-error"');
    expect(html).toContain(messages.exportFailed);
    expect(html).not.toContain(messages.exportTooLarge);
  });
});
