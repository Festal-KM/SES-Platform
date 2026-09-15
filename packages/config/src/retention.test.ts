// packages/config/src/retention.test.ts
// T-09-12: `PURGE_SPEC`（docs/05 §9.7）の形を固定する。削除ジョブ本体（SP-16）はここを読むだけである。
import { describe, expect, it } from 'vitest';
import { PURGE_SPEC } from './retention.js';

describe('PURGE_SPEC（docs/05 §9.7 / F-064 AC-3）', () => {
  it('🔴 engineer_careers は「行の削除」として置かれ、暫定（Issue #48）の印を持つ', () => {
    const entry = PURGE_SPEC.delete.find((spec) => spec.table === 'engineer_careers');
    expect(entry).toEqual({ table: 'engineer_careers', rows: 'ALL', provisional: 'ISSUE-48' });
  });

  it('🔴 rows: ALL を持つのは engineer_careers だけである（行削除を安易に広げない）', () => {
    const rowDeletes = PURGE_SPEC.delete.filter((spec) => 'rows' in spec).map((spec) => spec.table);
    expect(rowDeletes).toEqual(['engineer_careers']);
  });

  it('同じ表が delete と retain の両方に現れない', () => {
    const deleted = new Set(PURGE_SPEC.delete.map((spec) => spec.table));
    for (const spec of PURGE_SPEC.retain) {
      expect(deleted.has(spec.table), `${spec.table} が delete と retain の両方にある`).toBe(false);
    }
  });

  it('CLAUDE.md §3.5 の列挙（連絡先・スキルシート原本）が delete に含まれている', () => {
    const engineers = PURGE_SPEC.delete.find((spec) => spec.table === 'engineers');
    expect(engineers && 'columns' in engineers ? [...engineers.columns] : []).toEqual(
      expect.arrayContaining(['contact_email', 'contact_phone']),
    );
    const sheets = PURGE_SPEC.delete.find((spec) => spec.table === 'skill_sheets');
    expect(sheets && 'objects' in sheets ? sheets.objects : null).toBe('s3');
  });
});
