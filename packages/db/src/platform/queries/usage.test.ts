// packages/db/src/platform/queries/usage.test.ts
// `summarizePlatformUsage`（API-A6 の純粋部分。`F-057 AC-1` / `AC-5` / `F-063 AC-5`）。T-11-02。DB に触れない。
import { describe, expect, it } from 'vitest';
import { summarizePlatformUsage, type PlatformUsageSummaryInput, type QuotaOverrideFact } from './usage.js';

const NOW = new Date('2026-09-16T09:00:00.000Z');
const GB = 1024n * 1024n * 1024n;
const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';

const DEFAULTS = {
  aiUnitQuotas: { AI_UNIT_SHEET_PARSE: 180, AI_UNIT_MATCH_RATIONALE: 6_200, AI_UNIT_PROPOSAL_DRAFT: 180, AI_UNIT_RENEWAL_SUMMARY: 20 },
  emailDailyLimit: 500,
  storageLimitBytes: 50n * GB,
};

function input(over: Partial<PlatformUsageSummaryInput> = {}): PlatformUsageSummaryInput {
  return {
    now: NOW,
    dayKey: '2026-09-16',
    monthKey: '2026-09',
    warnPercent: 80,
    defaults: DEFAULTS,
    aiDailyCostLimitUsd: 5,
    aiMonthlyCostCapUsd: 40,
    providerCapUsd: 500,
    tenants: [
      { id: TENANT_A, name: 'Alpha', lifecycleState: 'ACTIVE', environment: 'production' },
      { id: TENANT_B, name: 'Beta', lifecycleState: 'SANDBOX', environment: 'sandbox' },
    ],
    counters: [],
    states: [],
    overrides: [],
    aiCostGroups: [],
    ...over,
  };
}

function counter(tenantId: string, periodKind: 'DAY' | 'MONTH', metric: string, value: string, reservedValue = '0.000000') {
  return { tenantId, periodKind, periodKey: periodKind === 'DAY' ? '2026-09-16' : '2026-09', metric, value, reservedValue };
}

describe('件数と金額の両方 + 消費率 + 2 つの倍率（F-063 AC-5 / docs/03 §7.6.3-2）', () => {
  it('材料が無いテナントは 0 件 / $0 / 0% / 帯 LOW / 水準 null（未評価）', () => {
    const snapshot = summarizePlatformUsage(input());
    const alpha = snapshot.tenants.find((row) => row.tenantId === TENANT_A);
    expect(alpha).toBeDefined();
    expect(alpha?.aiUnits.AI_UNIT_SHEET_PARSE).toEqual({
      used: 0,
      limit: 180,
      consumptionPercent: 0,
      level: null,
      quota: { source: 'DEFAULT', effectiveFrom: null, pending: null },
      standardCostUsd: '0.033',
    });
    expect(alpha?.aiDaily).toEqual({ costUsd: '0.000000', limitUsd: '5.000000', consumptionPercent: 0, level: null });
    expect(alpha?.aiMonthly.costUsd).toBe('0.000000');
    expect(alpha?.aiMonthly.capUsd).toBe('40.000000');
    expect(alpha?.aiMonthly.unitCostRatio).toBeNull();
    expect(alpha?.aiMonthly.baselineRatio).toBe(0);
    expect(alpha?.band).toBe('LOW');
    expect(alpha?.storage.limitBytes).toBe((50n * GB).toString());
  });

  it('件数・金額・ロール別・倍率が同じテナントの 1 行に載る。当日 AI コストは used + reserved', () => {
    const snapshot = summarizePlatformUsage(
      input({
        counters: [
          counter(TENANT_A, 'MONTH', 'AI_UNIT_SHEET_PARSE', '60.000000'),
          counter(TENANT_A, 'MONTH', 'AI_UNIT_MATCH_RATIONALE', '2000.000000'),
          counter(TENANT_A, 'MONTH', 'AI_UNIT_PROPOSAL_DRAFT', '60.000000'),
          counter(TENANT_A, 'MONTH', 'AI_UNIT_RENEWAL_SUMMARY', '8.000000'),
          counter(TENANT_A, 'DAY', 'AI_COST_USD', '1.000000', '0.250000'),
          counter(TENANT_A, 'DAY', 'EMAIL_COUNT', '400.000000'),
          counter(TENANT_A, 'MONTH', 'STORAGE_BYTES', (10n * GB).toString()),
          counter(TENANT_A, 'DAY', 'SEAT_COUNT', '12.000000'),
        ],
        aiCostGroups: [
          { tenantId: TENANT_A, role: 'sheet-parser', costUsd: '1.620000' },
          { tenantId: TENANT_A, role: 'skill-normalizer', costUsd: '0.360000' },
          { tenantId: TENANT_A, role: 'match-explainer', costUsd: '8.000000' },
          { tenantId: TENANT_A, role: 'proposal-drafter', costUsd: '1.260000' },
          { tenantId: TENANT_A, role: 'renewal-advisor', costUsd: '0.136000' },
          { tenantId: TENANT_A, role: 'gate-inspector', costUsd: '1.440000' },
        ],
        states: [{ tenantId: TENANT_A, metric: 'EMAIL_COUNT', level: 'NEARING' }],
      }),
    );
    const alpha = snapshot.tenants.find((row) => row.tenantId === TENANT_A);
    expect(alpha?.seatsUsed).toBe(12);
    expect(alpha?.aiUnits.AI_UNIT_SHEET_PARSE.used).toBe(60);
    expect(alpha?.aiUnits.AI_UNIT_SHEET_PARSE.consumptionPercent).toBe(33);
    expect(alpha?.aiDaily).toEqual({ costUsd: '1.250000', limitUsd: '5.000000', consumptionPercent: 25, level: null });
    expect(alpha?.aiMonthly.costUsd).toBe('12.816000');
    expect(alpha?.aiMonthly.consumptionPercent).toBe(32);
    expect(alpha?.aiMonthly.byRole['gate-inspector']).toBe('1.440000');
    // 標準原価比: 単位を持つロールの実原価 11.376 ÷ Σ(件数 × 標準原価) 11.376 = 1.0（gate-inspector は入らない）。
    expect(alpha?.aiMonthly.standardCostUsd).toBe('11.376000');
    expect(alpha?.aiMonthly.unitCostRatio).toBe(1);
    // 基準ユニット比: 12.816 ÷ 12.82。
    expect(alpha?.aiMonthly.baselineRatio).toBeCloseTo(0.99969, 4);
    expect(alpha?.email).toMatchObject({ used: 400, limit: 500, consumptionPercent: 80, level: 'NEARING' });
    expect(alpha?.storage.consumptionPercent).toBe(20);
    expect(alpha?.peakPercent).toBe(80);
    expect(alpha?.band).toBe('HIGH');
  });

  it('🔴 環境全体の行はテナント行と別集計（全テナントの合計 / tier 上限 / byRole 6 ロール固定）', () => {
    const snapshot = summarizePlatformUsage(
      input({
        aiCostGroups: [
          { tenantId: TENANT_A, role: 'match-explainer', costUsd: '300.000000' },
          { tenantId: TENANT_B, role: 'gate-inspector', costUsd: '150.000000' },
        ],
      }),
    );
    expect(snapshot.environment.spentUsd).toBe('450.000000');
    expect(snapshot.environment.capUsd).toBe('500.000000');
    expect(snapshot.environment.level).toBe('NEARING');
    expect(snapshot.environment.tenantCount).toBe(2);
    expect(Object.keys(snapshot.environment.byRole)).toHaveLength(6);
    expect(snapshot.environment.byRole['skill-normalizer']).toBe('0.000000');
    // テナント行はそれぞれ自分の分だけ。
    expect(snapshot.tenants.find((row) => row.tenantId === TENANT_A)?.aiMonthly.costUsd).toBe('300.000000');
    expect(snapshot.tenants.find((row) => row.tenantId === TENANT_B)?.aiMonthly.costUsd).toBe('150.000000');
  });
});

describe('抽出の帯（F-057 AC-1）と並び', () => {
  it('いずれかが 80% 以上 → HIGH、すべて 20% 未満 → LOW、それ以外 → MID。並びは消化率の最大が高い順', () => {
    const snapshot = summarizePlatformUsage(
      input({
        counters: [
          counter(TENANT_A, 'DAY', 'EMAIL_COUNT', '100.000000'), // 20% → MID
          counter(TENANT_B, 'MONTH', 'AI_UNIT_RENEWAL_SUMMARY', '20.000000'), // 100% → HIGH
        ],
      }),
    );
    expect(snapshot.tenants.map((row) => [row.tenantId, row.band, row.peakPercent])).toEqual([
      [TENANT_B, 'HIGH', 100],
      [TENANT_A, 'MID', 20],
    ]);
    expect(snapshot.lowPercent).toBe(20);
    expect(snapshot.warnPercent).toBe(80);
  });
});

describe('クォータの上書き（tenant_quota_overrides）が上限と出所・予定に反映される', () => {
  const override = (over: Partial<QuotaOverrideFact> & { readonly id: string }): QuotaOverrideFact => ({
    tenantId: TENANT_A,
    metric: 'AI_UNIT_SHEET_PARSE',
    limit: 300n,
    previousLimit: 180n,
    effectiveFrom: '2026-09-01',
    createdAt: new Date('2026-08-31T00:00:00.000Z'),
    ...over,
  });

  it('効いている上書きは source=OVERRIDE + 適用日。将来の行は pending（引き下げなら lowering=true）', () => {
    const snapshot = summarizePlatformUsage(
      input({
        counters: [counter(TENANT_A, 'MONTH', 'AI_UNIT_SHEET_PARSE', '150.000000')],
        overrides: [
          override({ id: 'o1' }),
          override({ id: 'o2', limit: 100n, previousLimit: 300n, effectiveFrom: '2026-10-01', createdAt: new Date('2026-09-15T00:00:00.000Z') }),
        ],
      }),
    );
    const unit = snapshot.tenants.find((row) => row.tenantId === TENANT_A)?.aiUnits.AI_UNIT_SHEET_PARSE;
    expect(unit).toMatchObject({
      used: 150,
      limit: 300,
      consumptionPercent: 50,
      quota: { source: 'OVERRIDE', effectiveFrom: '2026-09-01', pending: { limit: '100', effectiveFrom: '2026-10-01', lowering: true } },
    });
    // 他のテナント・他の計測には影響しない。
    expect(snapshot.tenants.find((row) => row.tenantId === TENANT_B)?.aiUnits.AI_UNIT_SHEET_PARSE.limit).toBe(180);
    expect(snapshot.tenants.find((row) => row.tenantId === TENANT_A)?.aiUnits.AI_UNIT_PROPOSAL_DRAFT.quota.source).toBe('DEFAULT');
  });

  it('AI 単位の上書きだけならストレージ / メールは既定値のまま bigint で返り、source は DEFAULT（他の計測の上書きに引きずられない）', () => {
    const big = 200n * GB;
    const snapshot = summarizePlatformUsage(
      input({ defaults: { ...DEFAULTS, storageLimitBytes: big }, overrides: [override({ id: 'o3' })] }),
    );
    const row = snapshot.tenants.find((row) => row.tenantId === TENANT_A);
    expect(row?.storage.limitBytes).toBe(big.toString());
    expect(row?.storage.quota).toEqual({ source: 'DEFAULT', effectiveFrom: null, pending: null });
    expect(row?.email.quota).toEqual({ source: 'DEFAULT', effectiveFrom: null, pending: null });
  });

  it('🔴 T-12-12: EMAIL_COUNT / STORAGE_BYTES の上書きが上限・消費率・出所・予定に反映される（AI 単位と同じ 1 実装）', () => {
    const snapshot = summarizePlatformUsage(
      input({
        counters: [counter(TENANT_A, 'DAY', 'EMAIL_COUNT', '2.000000'), counter(TENANT_A, 'MONTH', 'STORAGE_BYTES', (3n * GB).toString())],
        overrides: [
          override({ id: 'e1', metric: 'EMAIL_COUNT', limit: 4n, previousLimit: 500n, effectiveFrom: '2026-09-10' }),
          override({ id: 'e2', metric: 'EMAIL_COUNT', limit: 2n, previousLimit: 4n, effectiveFrom: '2026-09-17', createdAt: new Date('2026-09-16T00:00:00.000Z') }),
          override({ id: 's1', metric: 'STORAGE_BYTES', limit: 4n * GB, previousLimit: 50n * GB, effectiveFrom: '2026-09-16' }),
        ],
      }),
    );
    const row = snapshot.tenants.find((row) => row.tenantId === TENANT_A);
    expect(row?.email).toMatchObject({
      used: 2,
      limit: 4,
      consumptionPercent: 50,
      quota: { source: 'OVERRIDE', effectiveFrom: '2026-09-10', pending: { limit: '2', effectiveFrom: '2026-09-17', lowering: true } },
    });
    expect(row?.storage).toMatchObject({
      usedBytes: (3n * GB).toString(),
      limitBytes: (4n * GB).toString(),
      consumptionPercent: 75,
      quota: { source: 'OVERRIDE', effectiveFrom: '2026-09-16', pending: null },
    });
    // 他テナントは既定値のまま。
    expect(snapshot.tenants.find((row) => row.tenantId === TENANT_B)?.email.limit).toBe(500);
  });
});

describe('不正な材料は握り潰さない', () => {
  it('未知の role / level は例外（CHECK と TS の値集合がずれている）', () => {
    expect(() => summarizePlatformUsage(input({ aiCostGroups: [{ tenantId: TENANT_A, role: 'unknown', costUsd: '1.000000' }] }))).toThrow();
    expect(() => summarizePlatformUsage(input({ states: [{ tenantId: TENANT_A, metric: 'EMAIL_COUNT', level: 'HIGH' }] }))).toThrow();
  });

  it('上限が 0 以下の設定は RangeError（監査行を残す前に落とす前提の検査）', () => {
    expect(() => summarizePlatformUsage(input({ aiDailyCostLimitUsd: 0 }))).toThrow(RangeError);
    expect(() => summarizePlatformUsage(input({ aiMonthlyCostCapUsd: -1 }))).toThrow(RangeError);
  });
});

describe('🔴 応答に無いもの（BR-40）', () => {
  it('行のキー集合は固定（利用者名・メール・業務データのキーが無い）', () => {
    const snapshot = summarizePlatformUsage(input());
    expect(Object.keys(snapshot.tenants[0] ?? {}).sort()).toEqual([
      'aiDaily',
      'aiMonthly',
      'aiUnits',
      'band',
      'email',
      'environment',
      'lifecycleState',
      'name',
      'peakPercent',
      'seatsUsed',
      'storage',
      'tenantId',
    ]);
    // `email` はメール通数のブロック名。宛先・氏名・本文のキーが無いことを見る。
    expect(JSON.stringify(snapshot, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))).not.toMatch(
      /displayName|recipientEmail|recipient_email|contactEmail|"subject"|"body"|objectKey|targetId/,
    );
  });
});
