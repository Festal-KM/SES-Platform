// packages/db/src/platform/queries/monitoring.test.ts
// `A-005` の材料の純粋部分（T-11-04。docs/05 §16.5 / `F-059 AC-2` / `AC-7` / `F-064 AC-10`）。
// 実 DB の読み取りは `tests/isolation/admin-monitoring.test.ts` が実測する。
import { SEND_HOLD_REASON_KEYS } from '@ses/domain';
import { describe, expect, it } from 'vitest';
import {
  classifyPurgeNotice,
  summarizeGateFailRates,
  summarizePurgeJobFailures,
  summarizeSendHolds,
} from './monitoring.js';

const T_A = '01930000-0000-7000-8000-0000000000a1';
const T_B = '01930000-0000-7000-8000-0000000000b1';
const at = (iso: string): Date => new Date(iso);

describe('summarizeSendHolds（項目 14。docs/05 §16.5 / F-059 AC-7）', () => {
  it('🔴 PROVIDER_QUOTA だけが ENVIRONMENT の 1 行に畳まれ tenantId を持たず、RATE_LIMIT を含む他 6 値は TENANT 行を持つ', () => {
    const result = summarizeSendHolds({
      proposals: [
        { reasonKey: 'PROVIDER_QUOTA', tenantId: T_A, count: 2, oldestSince: at('2026-09-16T08:00:00Z') },
        { reasonKey: 'PROVIDER_QUOTA', tenantId: T_B, count: 1, oldestSince: at('2026-09-16T07:30:00Z') },
        { reasonKey: 'RATE_LIMIT', tenantId: T_A, count: 3, oldestSince: at('2026-09-16T06:00:00Z') },
      ],
      contracts: [{ reasonKey: 'PROVIDER_QUOTA', tenantId: T_A, count: 1, oldestSince: at('2026-09-16T05:00:00Z') }],
    });
    expect(result.byReason.PROVIDER_QUOTA).toEqual({
      scope: 'ENVIRONMENT',
      proposals: 3,
      contracts: 1,
      oldestSince: at('2026-09-16T05:00:00Z'),
    });
    expect(JSON.stringify(result.byReason.PROVIDER_QUOTA)).not.toContain('tenantId');
    expect(result.byReason.RATE_LIMIT).toEqual({
      scope: 'TENANT',
      rows: [{ tenantId: T_A, proposals: 3, contracts: 0, oldestSince: at('2026-09-16T06:00:00Z') }],
    });
    expect(result.total).toBe(7);
  });

  it('7 値すべてのキーが常に存在する（0 件は空の TENANT 行 / 0 の ENVIRONMENT 行）', () => {
    const result = summarizeSendHolds({ proposals: [], contracts: [] });
    expect(Object.keys(result.byReason).sort()).toEqual([...SEND_HOLD_REASON_KEYS].sort());
    for (const reason of SEND_HOLD_REASON_KEYS) {
      const entry = result.byReason[reason];
      if (reason === 'PROVIDER_QUOTA') {
        expect(entry).toEqual({ scope: 'ENVIRONMENT', proposals: 0, contracts: 0, oldestSince: null });
      } else {
        expect(entry).toEqual({ scope: 'TENANT', rows: [] });
      }
    }
    expect(result.total).toBe(0);
  });

  it('同じテナント × 理由の提案と契約書は 1 行に合流し、oldestSince は両者の最小', () => {
    const result = summarizeSendHolds({
      proposals: [{ reasonKey: 'DOMAIN_UNVERIFIED', tenantId: T_A, count: 1, oldestSince: at('2026-09-16T09:00:00Z') }],
      contracts: [{ reasonKey: 'DOMAIN_UNVERIFIED', tenantId: T_A, count: 2, oldestSince: at('2026-09-16T01:00:00Z') }],
    });
    expect(result.byReason.DOMAIN_UNVERIFIED).toEqual({
      scope: 'TENANT',
      rows: [{ tenantId: T_A, proposals: 1, contracts: 2, oldestSince: at('2026-09-16T01:00:00Z') }],
    });
  });

  it('🔴 未知の理由は黙って捨てず落とす（CHECK と SEND_HOLD_REASON_KEYS のずれ）', () => {
    expect(() =>
      summarizeSendHolds({ proposals: [{ reasonKey: 'MYSTERY', tenantId: T_A, count: 1, oldestSince: null }], contracts: [] }),
    ).toThrow(/send_hold_reason_key/);
  });
});

describe('classifyPurgeNotice（項目 15。F-064 AC-10 / docs/05 §16.5）', () => {
  it('SENT / MOCKED があれば配送済み（載せない）', () => {
    expect(classifyPurgeNotice(['SENT'])).toBeNull();
    expect(classifyPurgeNotice(['FAILED', 'MOCKED'])).toBeNull();
  });

  it('QUEUED / HELD_* がある、または行が 1 件も無ければ NOTICE_PENDING', () => {
    expect(classifyPurgeNotice([])).toBe('NOTICE_PENDING');
    expect(classifyPurgeNotice(['HELD_PROVIDER_QUOTA'])).toBe('NOTICE_PENDING');
    expect(classifyPurgeNotice(['FAILED', 'QUEUED'])).toBe('NOTICE_PENDING');
  });

  it('FAILED（/ SUPPRESSED）だけなら NOTICE_UNDELIVERED', () => {
    expect(classifyPurgeNotice(['FAILED'])).toBe('NOTICE_UNDELIVERED');
    expect(classifyPurgeNotice(['FAILED', 'SUPPRESSED'])).toBe('NOTICE_UNDELIVERED');
  });
});

describe('summarizePurgeJobFailures（項目 7。docs/04 申し送り 15）', () => {
  it('失敗の後に同じテナント × 原因で完了していれば対応済みとして落とす。完了の事実そのものは返さない', () => {
    const result = summarizePurgeJobFailures({
      failed: [
        { tenantId: T_A, cause: 'TENANT_PURGED', count: 2, latestAt: at('2026-09-15T00:00:00Z') },
        { tenantId: T_B, cause: 'RETENTION', count: 1, latestAt: at('2026-09-16T00:00:00Z') },
      ],
      completed: [
        { tenantId: T_A, cause: 'TENANT_PURGED', count: 0, latestAt: at('2026-09-15T01:00:00Z') },
        { tenantId: T_B, cause: 'RETENTION', count: 0, latestAt: at('2026-09-14T00:00:00Z') },
      ],
      runningOverdue: [],
      now: at('2026-09-16T12:00:00Z'),
      stallThresholdMinutes: 30,
    });
    expect(result.rows).toEqual([{ tenantId: T_B, cause: 'RETENTION', failedCount: 1, lastFailedAt: at('2026-09-16T00:00:00Z') }]);
    expect(result.total).toBe(1);
    expect(result.runningOverdue).toEqual({ kind: 'RUNNING_OVERDUE', rows: [], total: 0, stallThresholdMinutes: 30 });
    expect(JSON.stringify(result)).not.toMatch(/completed|counts/i);
  });

  it('🔴 T-12-17 ⑱: RUNNING の滞留は別区分（runningOverdue）に出て、FAILED の件数（total）に加算されない。後に COMPLETED があっても落とさない', () => {
    const now = at('2026-09-16T12:00:00Z');
    const result = summarizePurgeJobFailures({
      failed: [{ tenantId: T_B, cause: 'RETENTION', count: 1, latestAt: at('2026-09-16T00:00:00Z') }],
      completed: [{ tenantId: T_A, cause: 'RETENTION', count: 0, latestAt: at('2026-09-16T11:00:00Z') }],
      runningOverdue: [
        { tenantId: T_A, cause: 'RETENTION', count: 2, latestAt: at('2026-09-16T10:00:00Z') },
        { tenantId: T_B, cause: 'TENANT_PURGED', count: 1, latestAt: at('2026-09-16T09:30:00Z') },
      ],
      now,
      stallThresholdMinutes: 30,
    });
    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.tenantId)).toEqual([T_B]);
    expect(result.runningOverdue.kind).toBe('RUNNING_OVERDUE');
    expect(result.runningOverdue.total).toBe(3);
    // 最も古い開始が先。
    expect(result.runningOverdue.rows).toEqual([
      { tenantId: T_B, cause: 'TENANT_PURGED', runningCount: 1, oldestStartedAt: at('2026-09-16T09:30:00Z'), longestRunningMinutes: 150 },
      { tenantId: T_A, cause: 'RETENTION', runningCount: 2, oldestStartedAt: at('2026-09-16T10:00:00Z'), longestRunningMinutes: 120 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/completed|counts|failureReason/i);
  });
});

describe('summarizeGateFailRates（項目 5。分母・分子とも DONE のみ）', () => {
  it('直近と基準を同じテナント集合で並べ、率の高い順に出す。done=0 の率は null（0 と区別）', () => {
    const result = summarizeGateFailRates({
      recent: [
        { tenantId: T_A, done: 4, failed: 3 },
        { tenantId: T_B, done: 10, failed: 1 },
      ],
      baseline: [{ tenantId: T_B, done: 20, failed: 2 }],
      windowHours: 24,
      baselineDays: 7,
    });
    expect(result.rows.map((row) => row.tenantId)).toEqual([T_A, T_B]);
    expect(result.rows[0]).toEqual({
      tenantId: T_A,
      recent: { done: 4, failed: 3, rate: 0.75 },
      baseline: { done: 0, failed: 0, rate: null },
    });
    expect(result.recent).toEqual({ done: 14, failed: 4, rate: 4 / 14 });
    expect(result.baseline).toEqual({ done: 20, failed: 2, rate: 0.1 });
    expect(result.windowHours).toBe(24);
    expect(result.baselineDays).toBe(7);
  });

  it('0 件のときも成立を示せる形（rows 空 / recent.done 0 / rate null）', () => {
    const result = summarizeGateFailRates({ recent: [], baseline: [], windowHours: 24, baselineDays: 7 });
    expect(result).toEqual({
      rows: [],
      recent: { done: 0, failed: 0, rate: null },
      baseline: { done: 0, failed: 0, rate: null },
      windowHours: 24,
      baselineDays: 7,
    });
  });
});
