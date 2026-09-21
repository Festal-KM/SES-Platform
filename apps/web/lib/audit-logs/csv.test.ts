// apps/web/lib/audit-logs/csv.test.ts
// `S-041` の CSV エクスポート（#10b）の CSV 生成（docs/05 §6.4「CSV エクスポート」行 ②③）。T-12-18 ⑪。
//
// 🔴 ①ヘッダ行を `toMatchInlineSnapshot` で固定する（列の増減は必ず差分になる。6 列 = 画面の既存 5 列 + `actorDisplayName`）
//    ②行の詳細の列が無い（`AuditLogListItem` の `detail` / `detailSuppressedReason` / `id` は CSV に現れない）
//    ③無害化は `packages/domain` の `encodeCsv`（`sanitizeCsvCellText`）を共用 —— 先頭 `=` / `+` / `-` / `@` の値に `'` が前置される
//    ④UTF-8 BOM + `\r\n`（返却 CSV と同じ）/ `SYSTEM` の表示名は空 / 対象・IP の合成は画面の列と同じ
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_CSV_COLUMNS, AUDIT_LOG_CSV_CONTENT_TYPE, auditLogsToCsv, auditLogToCsvRow } from './csv';
import type { AuditLogListItem } from './view';

const UUID_A = '01930000-0000-7000-8000-00000000000a';
const UUID_B = '01930000-0000-7000-8000-00000000000b';

function item(over: Partial<AuditLogListItem> = {}): AuditLogListItem {
  return {
    id: UUID_A,
    createdAt: '2026-09-18T01:02:03.000Z',
    actorKind: 'USER',
    actorId: UUID_B,
    actorDisplayName: '山田 太郎',
    action: 'skill_sheet.download',
    targetType: 'SkillSheet',
    targetId: UUID_A,
    ipAddress: '203.0.113.21',
    deviceKind: 'desktop',
    detail: { entries: [{ key: 'via', pair: null, value: { kind: 'ENUM', value: 'SKILL_SHEETS' } }] },
    detailSuppressedReason: null,
    ...over,
  };
}

describe('auditLogsToCsv（S-041 の CSV。6 列固定）', () => {
  it('🔴 ① ヘッダ行は 6 列固定（スナップショット。列の増減は差分になる）', () => {
    const header = auditLogsToCsv([]).replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toMatchInlineSnapshot(`"createdAt,actorKind,actorDisplayName,action,target,ipAndDevice"`);
    expect([...AUDIT_LOG_CSV_COLUMNS]).toEqual(['createdAt', 'actorKind', 'actorDisplayName', 'action', 'target', 'ipAndDevice']);
    expect(AUDIT_LOG_CSV_CONTENT_TYPE).toBe('text/csv; charset=utf-8');
  });

  it('② 行は 6 列（対象 = targetType:targetId / IP・デバイス = 空白 1 つで連結）。行の詳細・id は載らない', () => {
    const csv = auditLogsToCsv([item()]);
    expect(csv).toBe(
      '\uFEFFcreatedAt,actorKind,actorDisplayName,action,target,ipAndDevice\r\n' +
        `2026-09-18T01:02:03.000Z,USER,山田 太郎,skill_sheet.download,SkillSheet:${UUID_A},203.0.113.21 desktop\r\n`,
    );
    expect(csv).not.toContain('SKILL_SHEETS');
    expect(csv).not.toContain('"via"');
    expect(csv).not.toContain(UUID_B); // 主体は表示名で載り、ID は載らない
    expect(auditLogToCsvRow(item())).toHaveLength(AUDIT_LOG_CSV_COLUMNS.length);
  });

  it('SYSTEM / PLATFORM_USER の表示名は空。対象・IP・デバイスが無ければ空セル', () => {
    const csv = auditLogsToCsv([
      item({ actorKind: 'SYSTEM', actorId: null, actorDisplayName: null, action: 'tenant.purge', targetType: 'Tenant', targetId: UUID_A, ipAddress: null, deviceKind: null }),
      item({ actorKind: 'PLATFORM_USER', actorDisplayName: null, action: 'impersonation.start', targetType: null, targetId: null, ipAddress: '198.51.100.1', deviceKind: null }),
    ]);
    const rows = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(rows[1]).toBe(`2026-09-18T01:02:03.000Z,SYSTEM,,tenant.purge,Tenant:${UUID_A},`);
    expect(rows[2]).toBe('2026-09-18T01:02:03.000Z,PLATFORM_USER,,impersonation.start,,198.51.100.1');
  });

  it("🔴 ③ 先頭が = / + / - / @ の値は `'` が前置される（packages/domain の sanitizeCsvCellText を共用）。引用は RFC 4180", () => {
    const csv = auditLogsToCsv([
      item({ actorDisplayName: '=HYPERLINK("https://evil.example")', action: '+action', targetType: '-Type', targetId: '@id', ipAddress: '@ip', deviceKind: null }),
      item({ actorDisplayName: '山田, "太郎"' }),
    ]);
    const rows = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(rows[1]).toBe(`2026-09-18T01:02:03.000Z,USER,"'=HYPERLINK(""https://evil.example"")",'+action,'-Type:@id,'@ip`);
    expect(rows[2]).toContain('"山田, ""太郎"""');
  });

  it('④ UTF-8 BOM で始まり、行末は \\r\\n（返却 CSV と同じ 1 実装）', () => {
    const csv = auditLogsToCsv([item()]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3); // ヘッダ + 1 行 + 末尾の空
  });

  // 注: ファイル名（auditLogCsvFileName）は export-href.ts へ移した（レビュー指摘 NG-1。クライアントから
  //    csv.ts（encodeCsv を持つ）を import しないため）。テストは export-href.test.ts にある。
});
