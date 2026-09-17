// packages/db/src/platform/queries/deletion-status.test.ts
// API-A12 の純粋部分（T-10-10。docs/05 §6.9 / `F-062 AC-7`）。実 DB の読み取り・監査・404・`failureReason` 不在は
// `tests/isolation/admin-deletion-status.test.ts` が実測する。
import { describe, expect, it } from 'vitest';
import { DELETION_STATUS_CAUSES, normalizePurgeCounts } from './deletion-status.js';

describe('normalizePurgeCounts（TenantPurgeRun.counts → Record<table, number>）', () => {
  it('T-10-09 が書く形（表名 → 非負整数）をキー昇順でそのまま返す', () => {
    expect(normalizePurgeCounts({ skill_sheets: 7, engineers: 12, messages: 0 })).toEqual({
      engineers: 12,
      messages: 0,
      skill_sheets: 7,
    });
  });

  it('🔴 数値でない値・負の値・非整数・入れ子は落とす（NaN や自由文を件数として画面に出さない）', () => {
    expect(
      normalizePurgeCounts({
        engineers: 3,
        note: 'T1010-should-not-pass',
        negative: -1,
        fraction: 1.5,
        nested: { engineers: 9 },
        missing: null,
      }),
    ).toEqual({ engineers: 3 });
  });

  it('オブジェクト以外（null / 配列 / 文字列 / 数値）は {}（RUNNING の行は counts が {} で書かれる）', () => {
    expect(normalizePurgeCounts(null)).toEqual({});
    expect(normalizePurgeCounts([1, 2])).toEqual({});
    expect(normalizePurgeCounts('engineers')).toEqual({});
    expect(normalizePurgeCounts(42)).toEqual({});
    expect(normalizePurgeCounts({})).toEqual({});
  });
});

describe('DELETION_STATUS_CAUSES', () => {
  it('🔴 Phase 1 は TENANT_PURGED だけ（RETENTION = F-046 は Phase 2 で加える）', () => {
    expect([...DELETION_STATUS_CAUSES]).toEqual(['TENANT_PURGED']);
  });
});
