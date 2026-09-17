// packages/domain/src/quota/override.test.ts
// T-11-02: テナント個別のクォータ上書き（docs/02 `F-057 AC-1` / `AC-3` / docs/05 §6.9 API-A6）の純粋部分。
import { describe, expect, it } from 'vitest';
import { USAGE_LIMIT_METRICS } from './limits.js';
import {
  classifyConsumptionBand,
  consumptionPercent,
  decideQuotaChange,
  isQuotaOverrideMetric,
  QUOTA_OVERRIDE_METRICS,
  QuotaChangeRejectedError,
  resolveQuotaLimit,
  selectEffectiveQuotaOverride,
  selectPendingQuotaOverride,
  type QuotaOverrideRow,
} from './override.js';

const at = (iso: string) => new Date(iso);

function row(over: Partial<QuotaOverrideRow> & { readonly id: string }): QuotaOverrideRow {
  return {
    metric: 'AI_UNIT_SHEET_PARSE',
    limit: 100n,
    effectiveFrom: '2026-09-16',
    createdAt: at('2026-09-15T00:00:00.000Z'),
    ...over,
  };
}

describe('QUOTA_OVERRIDE_METRICS', () => {
  it('🔴 AI の月次件数 4 単位（AI_UNIT_METRICS）と同一である。EMAIL_COUNT / STORAGE_BYTES は上書きの対象外（執行点の配線が無い）', () => {
    expect(QUOTA_OVERRIDE_METRICS).toEqual([
      'AI_UNIT_SHEET_PARSE',
      'AI_UNIT_MATCH_RATIONALE',
      'AI_UNIT_PROPOSAL_DRAFT',
      'AI_UNIT_RENEWAL_SUMMARY',
    ]);
    expect(USAGE_LIMIT_METRICS.filter((metric) => !isQuotaOverrideMetric(metric))).toEqual([
      'AI_COST_USD',
      'EMAIL_COUNT',
      'STORAGE_BYTES',
    ]);
  });
});

describe('selectEffectiveQuotaOverride / resolveQuotaLimit（適用日 ≤ その日の最新行）', () => {
  const rows = [
    row({ id: 'a', limit: 100n, effectiveFrom: '2026-09-01', createdAt: at('2026-08-20T00:00:00.000Z') }),
    row({ id: 'b', limit: 150n, effectiveFrom: '2026-09-10', createdAt: at('2026-09-01T00:00:00.000Z') }),
    row({ id: 'c', limit: 120n, effectiveFrom: '2026-10-01', createdAt: at('2026-09-05T00:00:00.000Z') }),
    row({ id: 'other', metric: 'AI_UNIT_MATCH_RATIONALE', limit: 900n, effectiveFrom: '2026-09-01' }),
  ];

  it('その日に効いているのは、適用日が最も遅い過去の行である（将来の行は効かない）', () => {
    expect(selectEffectiveQuotaOverride(rows, 'AI_UNIT_SHEET_PARSE', '2026-09-16')?.id).toBe('b');
    expect(selectEffectiveQuotaOverride(rows, 'AI_UNIT_SHEET_PARSE', '2026-09-05')?.id).toBe('a');
    expect(selectEffectiveQuotaOverride(rows, 'AI_UNIT_SHEET_PARSE', '2026-10-01')?.id).toBe('c');
    expect(selectEffectiveQuotaOverride(rows, 'AI_UNIT_SHEET_PARSE', '2026-08-31')).toBeNull();
  });

  it('適用日が同じなら後に作られた行が勝つ（同時刻なら ID の大きいほう）', () => {
    const sameDay = [
      row({ id: 'x', limit: 10n, effectiveFrom: '2026-09-16', createdAt: at('2026-09-15T01:00:00.000Z') }),
      row({ id: 'y', limit: 20n, effectiveFrom: '2026-09-16', createdAt: at('2026-09-15T02:00:00.000Z') }),
      row({ id: 'z', limit: 30n, effectiveFrom: '2026-09-16', createdAt: at('2026-09-15T02:00:00.000Z') }),
    ];
    expect(selectEffectiveQuotaOverride(sameDay, 'AI_UNIT_SHEET_PARSE', '2026-09-16')?.id).toBe('z');
    expect(selectEffectiveQuotaOverride(sameDay.slice(0, 2), 'AI_UNIT_SHEET_PARSE', '2026-09-16')?.id).toBe('y');
  });

  it('他の計測の行は混ざらない', () => {
    expect(selectEffectiveQuotaOverride(rows, 'AI_UNIT_MATCH_RATIONALE', '2026-09-16')?.limit).toBe(900n);
    expect(selectEffectiveQuotaOverride(rows, 'AI_UNIT_PROPOSAL_DRAFT', '2026-09-16')).toBeNull();
  });

  it('resolveQuotaLimit: 上書きが無ければ既定値（source=DEFAULT）、あればその値（source=OVERRIDE）', () => {
    expect(resolveQuotaLimit({ rows, metric: 'AI_UNIT_PROPOSAL_DRAFT', onDate: '2026-09-16', defaultLimit: 5n })).toEqual({
      limit: 5n,
      source: 'DEFAULT',
      override: null,
    });
    const resolved = resolveQuotaLimit({ rows, metric: 'AI_UNIT_SHEET_PARSE', onDate: '2026-09-16', defaultLimit: 180n });
    expect(resolved.limit).toBe(150n);
    expect(resolved.source).toBe('OVERRIDE');
    expect(resolved.override?.id).toBe('b');
  });

  it('既定値が 0 以下なら例外（0 割り・常時到達の上限を作らない）', () => {
    expect(() => resolveQuotaLimit({ rows: [], metric: 'AI_UNIT_RENEWAL_SUMMARY', onDate: '2026-09-16', defaultLimit: 0n })).toThrow(RangeError);
  });

  it('selectPendingQuotaOverride: 今日より後に効く最初の行（同日なら後に作られた行）。無ければ null', () => {
    expect(selectPendingQuotaOverride(rows, 'AI_UNIT_SHEET_PARSE', '2026-09-16')?.id).toBe('c');
    expect(selectPendingQuotaOverride(rows, 'AI_UNIT_SHEET_PARSE', '2026-10-01')).toBeNull();
    const twoPending = [
      ...rows,
      row({ id: 'c2', limit: 130n, effectiveFrom: '2026-10-01', createdAt: at('2026-09-06T00:00:00.000Z') }),
      row({ id: 'd', limit: 90n, effectiveFrom: '2026-11-01', createdAt: at('2026-09-07T00:00:00.000Z') }),
    ];
    expect(selectPendingQuotaOverride(twoPending, 'AI_UNIT_SHEET_PARSE', '2026-09-16')?.id).toBe('c2');
  });
});

describe('decideQuotaChange（F-057 AC-3: 引き下げは翌日以降 + 通知が必須）', () => {
  const base = { metric: 'AI_UNIT_SHEET_PARSE' as const, currentLimit: 180n, today: '2026-09-16' };

  it('引き上げは当日から適用できる。通知の確認は要らない', () => {
    const decision = decideQuotaChange({ ...base, nextLimit: 300n, effectiveFrom: '2026-09-16', notifyTenantAdmins: false });
    expect(decision).toEqual({
      kind: 'RAISE',
      metric: 'AI_UNIT_SHEET_PARSE',
      from: 180n,
      to: 300n,
      effectiveFrom: '2026-09-16',
      notifyTenantAdmins: false,
    });
  });

  it('🔴 引き下げ: 翌日以降 + 通知の確認があるときだけ LOWER が返る（notifyTenantAdmins は常に true）', () => {
    const decision = decideQuotaChange({ ...base, nextLimit: 100n, effectiveFrom: '2026-09-17', notifyTenantAdmins: true });
    expect(decision.kind).toBe('LOWER');
    expect(decision.notifyTenantAdmins).toBe(true);
    expect(decision.from).toBe(180n);
    expect(decision.to).toBe(100n);
  });

  it('🔴 引き下げを当日に適用しようとすると LOWERING_NOT_DEFERRED（即時反映のみの操作が存在しない）', () => {
    expect(() =>
      decideQuotaChange({ ...base, nextLimit: 100n, effectiveFrom: '2026-09-16', notifyTenantAdmins: true }),
    ).toThrow(expect.objectContaining({ name: 'QuotaChangeRejectedError', reason: 'LOWERING_NOT_DEFERRED' }));
  });

  it('🔴 引き下げに通知の確認が無いと LOWERING_NOTICE_REQUIRED（翌日以降でも）', () => {
    expect(() =>
      decideQuotaChange({ ...base, nextLimit: 100n, effectiveFrom: '2026-09-20', notifyTenantAdmins: false }),
    ).toThrow(expect.objectContaining({ reason: 'LOWERING_NOTICE_REQUIRED' }));
  });

  it('適用日が過去なら EFFECTIVE_FROM_PAST（引き上げでも遡らない）', () => {
    expect(() =>
      decideQuotaChange({ ...base, nextLimit: 300n, effectiveFrom: '2026-09-15', notifyTenantAdmins: true }),
    ).toThrow(expect.objectContaining({ reason: 'EFFECTIVE_FROM_PAST' }));
  });

  it('上限 0 以下は LIMIT_OUT_OF_RANGE（判定関数が成立しない値を保存しない）', () => {
    expect(() =>
      decideQuotaChange({ ...base, nextLimit: 0n, effectiveFrom: '2026-09-17', notifyTenantAdmins: true }),
    ).toThrow(QuotaChangeRejectedError);
  });

  it('同じ値は UNCHANGED（当日でも通知なしでも受け付ける。効いている上限は変わらない）', () => {
    expect(decideQuotaChange({ ...base, nextLimit: 180n, effectiveFrom: '2026-09-16', notifyTenantAdmins: false }).kind).toBe(
      'UNCHANGED',
    );
  });

  it('暦日キーとして不正な適用日は例外（黙って引き上げにしない）', () => {
    expect(() =>
      decideQuotaChange({ ...base, nextLimit: 300n, effectiveFrom: '2026-02-30', notifyTenantAdmins: false }),
    ).toThrow(RangeError);
  });
});

describe('consumptionPercent / classifyConsumptionBand（F-057 AC-1 の抽出）', () => {
  it('消化率は整数の切り捨て。limit 0 は例外', () => {
    expect(consumptionPercent(79n, 100n)).toBe(79);
    expect(consumptionPercent(799n, 1000n)).toBe(79);
    expect(consumptionPercent(150n, 100n)).toBe(150);
    expect(() => consumptionPercent(1n, 0n)).toThrow(RangeError);
  });

  it('いずれかが 80% 以上なら HIGH、すべて 20% 未満なら LOW、それ以外は MID', () => {
    const thresholds = { lowPercent: 20, highPercent: 80 };
    expect(classifyConsumptionBand({ percents: [5, 10, 19], ...thresholds })).toBe('LOW');
    expect(classifyConsumptionBand({ percents: [5, 20, 19], ...thresholds })).toBe('MID');
    expect(classifyConsumptionBand({ percents: [5, 79, 19], ...thresholds })).toBe('MID');
    expect(classifyConsumptionBand({ percents: [5, 80, 19], ...thresholds })).toBe('HIGH');
    expect(classifyConsumptionBand({ percents: [130], ...thresholds })).toBe('HIGH');
    expect(classifyConsumptionBand({ percents: [], ...thresholds })).toBe('LOW');
  });

  it('閾値の関係が壊れていれば例外（low ≥ high / high > 100）', () => {
    expect(() => classifyConsumptionBand({ percents: [1], lowPercent: 80, highPercent: 80 })).toThrow(RangeError);
    expect(() => classifyConsumptionBand({ percents: [1], lowPercent: 20, highPercent: 101 })).toThrow(RangeError);
  });
});
