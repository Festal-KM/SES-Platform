// packages/config/src/retention.test.ts
// T-09-12 / T-10-09: `PURGE_SPEC`（docs/05 §9.7）の形を固定する。削除ジョブ本体（`tenant.purge`）はここを読むだけである。
//    表の**網羅**（全業務テーブルが delete / retain のどちらかに現れる）は `tests/static/purge-spec-coverage.test.ts`。
import { describe, expect, it } from 'vitest';
import { isPurgeRowsSpec, PURGE_SPEC, purgeColumnErasure, purgeColumnName } from './retention.js';

describe('PURGE_SPEC（docs/05 §9.7 / F-064 AC-3）', () => {
  it('🔴 engineer_careers は「行の削除」として置かれ、暫定（Issue #48）の印を持つ', () => {
    const entry = PURGE_SPEC.delete.find((spec) => spec.table === 'engineer_careers');
    expect(entry).toEqual({ table: 'engineer_careers', rows: 'ALL', provisional: 'ISSUE-48' });
  });

  it('🔴 rows: ALL を持つのは engineer_careers だけである（行削除を安易に広げない）', () => {
    const rowDeletes = PURGE_SPEC.delete.filter(isPurgeRowsSpec).map((spec) => spec.table);
    expect(rowDeletes).toEqual(['engineer_careers']);
  });

  it('同じ表が delete と retain の両方に現れず、delete / retain の中でも重複しない', () => {
    const deleted = PURGE_SPEC.delete.map((spec) => spec.table);
    const retained = PURGE_SPEC.retain.map((spec) => spec.table);
    expect(new Set(deleted).size).toBe(deleted.length);
    expect(new Set(retained).size).toBe(retained.length);
    for (const table of retained) {
      expect(deleted.includes(table), `${table} が delete と retain の両方にある`).toBe(false);
    }
  });

  it('CLAUDE.md §3.5 / §4.2 の列挙（連絡先・スキルシート原本・チャット本文）が delete に含まれている', () => {
    const engineers = PURGE_SPEC.delete.find((spec) => spec.table === 'engineers');
    expect(engineers && !isPurgeRowsSpec(engineers) ? engineers.columns.map(purgeColumnName) : []).toEqual(
      expect.arrayContaining(['contact_email', 'contact_phone', 'birth_date']),
    );
    const sheets = PURGE_SPEC.delete.find((spec) => spec.table === 'skill_sheets');
    expect(sheets && !isPurgeRowsSpec(sheets) ? sheets.objectKeyColumns : null).toEqual(['object_key']);
    const messages = PURGE_SPEC.delete.find((spec) => spec.table === 'messages');
    expect(messages && !isPurgeRowsSpec(messages) ? messages.columns.map(purgeColumnName) : []).toEqual(
      expect.arrayContaining(['body', 'attachment_key']),
    );
  });

  it('🔴 S3 キー列（objectKeyColumns）は columns にも載っている（実体を消して列を残さない）', () => {
    for (const spec of PURGE_SPEC.delete) {
      if (isPurgeRowsSpec(spec) || spec.objectKeyColumns === undefined) continue;
      const names = spec.columns.map(purgeColumnName);
      for (const column of spec.objectKeyColumns) {
        expect(names, `${spec.table}.${column}`).toContain(column);
      }
    }
  });

  it('🔴 ROW_ID_TOKEN を使うのは users.email だけ（UNIQUE を保つ必要がある列に限る）', () => {
    const tokens: string[] = [];
    for (const spec of PURGE_SPEC.delete) {
      if (isPurgeRowsSpec(spec)) continue;
      for (const column of spec.columns) {
        if (purgeColumnErasure(column) === 'ROW_ID_TOKEN') tokens.push(`${spec.table}.${purgeColumnName(column)}`);
      }
    }
    expect(tokens).toEqual(['users.email']);
  });

  it('🔴 proposal_events.attachment_key は列の消去だけで、objectKeyColumns に載せない（Phase 1 の値は skill_sheets.id であり S3 キーではない）', () => {
    const events = PURGE_SPEC.delete.find((spec) => spec.table === 'proposal_events');
    expect(events && !isPurgeRowsSpec(events) ? events.columns.map(purgeColumnName) : []).toEqual(['note', 'attachment_key']);
    expect(events && !isPurgeRowsSpec(events) ? events.objectKeyColumns : 'missing').toBeUndefined();
  });

  it('🔴 objectKeyColumns を持つ表は、キーの実体が t/{tenantId}/… の列に限られる（列挙を固定する）', () => {
    const withObjectKeys = PURGE_SPEC.delete
      .filter((spec) => !isPurgeRowsSpec(spec) && spec.objectKeyColumns !== undefined)
      .map((spec) => spec.table)
      .sort();
    expect(withObjectKeys).toEqual(['contract_documents', 'contract_templates', 'data_export_requests', 'messages', 'skill_sheets']);
  });

  it('🔴 返却データ（data_export_requests.object_key）は PURGED で実体ごと消す', () => {
    const exports = PURGE_SPEC.delete.find((spec) => spec.table === 'data_export_requests');
    expect(exports && !isPurgeRowsSpec(exports) ? exports.objectKeyColumns : null).toEqual(['object_key']);
  });

  it('暫定の印（provisional）は Issue 番号か PENDING_ISSUE のどちらか', () => {
    for (const spec of PURGE_SPEC.delete) {
      if (spec.provisional === undefined) continue;
      expect(spec.provisional).toMatch(/^(ISSUE-\d+|PENDING_ISSUE)$/);
    }
  });
});
