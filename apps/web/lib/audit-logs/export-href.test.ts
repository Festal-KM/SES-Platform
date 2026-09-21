// apps/web/lib/audit-logs/export-href.test.ts
// `S-041` セクション 4 のエクスポート導線の URL・ファイル名・応答分類（#10b。T-12-18 ⑪。レビュー指摘 NG-1 で
// `csv.ts` のファイル名生成をここへ移し、400 応答の分類を新設した）。
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_EXPORT_PATH, auditLogCsvFileName, auditLogExportHref, classifyAuditLogExportError } from './export-href';

describe('auditLogExportHref', () => {
  it('期間だけのとき from / to だけを渡す（cursor / limit は渡さない）', () => {
    const href = auditLogExportHref({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-18T23:59:59.999Z' });
    expect(href).toBe(`${AUDIT_LOG_EXPORT_PATH}?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-18T23%3A59%3A59.999Z`);
    expect(href).not.toContain('cursor');
    expect(href).not.toContain('limit');
  });

  it('操作種別・主体 ID は指定されたときだけ付く（空文字の主体 ID は付けない）', () => {
    const href = auditLogExportHref({ from: 'f', to: 't', action: 'ENGINEER_SKILL_SHEET_ACCESS', actorId: '01930000-0000-7000-8000-00000000000b' });
    expect(href).toBe(`${AUDIT_LOG_EXPORT_PATH}?from=f&to=t&action=ENGINEER_SKILL_SHEET_ACCESS&actorId=01930000-0000-7000-8000-00000000000b`);
    expect(auditLogExportHref({ from: 'f', to: 't', action: undefined, actorId: '' })).toBe(`${AUDIT_LOG_EXPORT_PATH}?from=f&to=t`);
  });
});

describe('auditLogCsvFileName（csv.ts から移設。レビュー指摘 NG-1）', () => {
  it('ファイル名は ASCII だけ（audit-logs-{from}-{to}.csv。`:` `.` は落とす）', () => {
    expect(auditLogCsvFileName({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-18T23:59:59.999Z' })).toBe(
      'audit-logs-20260901T000000000Z-20260918T235959999Z.csv',
    );
    expect(auditLogCsvFileName({ from: '2026-09-01T00:00:00+09:00', to: '2026-09-02T00:00:00+09:00' })).toMatch(/^[A-Za-z0-9.-]+\.csv$/);
  });
});

describe('classifyAuditLogExportError（400 応答の分類。レビュー指摘 NG-1。fetch の返り値をそのまま渡せる）', () => {
  it('AUDIT_LOG_EXPORT_TOO_LARGE は TOO_LARGE', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'AUDIT_LOG_EXPORT_TOO_LARGE', messageKey: 'error.auditLogs.exportTooLarge', retryable: false } }),
      { status: 400 },
    );
    await expect(classifyAuditLogExportError(response)).resolves.toBe('TOO_LARGE');
  });

  it('それ以外の code / 本文なしは FAILED（messageKey は解釈しない）', async () => {
    await expect(classifyAuditLogExportError(new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }))).resolves.toBe(
      'FAILED',
    );
    await expect(classifyAuditLogExportError(new Response('not json', { status: 500 }))).resolves.toBe('FAILED');
  });
});
