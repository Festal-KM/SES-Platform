// packages/db/src/platform/queries/provider-spend.test.ts
// T-11-08: 組織全体の月間 Anthropic 支出（docs/03 §8.2 / docs/05 §16.5 項目 17）のうち **DB を要らない部分**。
//
// 🔴 `withPlatformRead` を通る側（監査行・GRANT・全テナント横断の GROUP BY）は
//    `tests/isolation/admin-provider-spend.test.ts`（Testcontainers）が実証する。
//    ここで見るのは集計行 → DTO の純粋関数 `summarizeProviderSpend` である:
//      ① 合計・ロール別・テナント数が micro-USD の整数で積まれる（浮動小数点を経ない）
//      ② 水準は `decideLimitLevel` と同じ境界（80% ちょうどで NEARING / 100% ちょうどで REACHED）
//      ③ `capUsd` が不正なら落ちる（0 や NaN で「常に BELOW」にならない）
//      ④ 未知のロールは黙って捨てない（`AI_ROLES` と CHECK のずれを露出させる）
//      ⑤ 🔴 本モジュールは件数（`AI_UNIT_*` / `usage_counters`）を数え直さない（ソース走査）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { summarizeProviderSpend, type ProviderSpendGroup } from './provider-spend.js';

const OBSERVED_AT = new Date('2026-09-16T09:00:00.000Z');
const PERIOD = '2026-09';
const TENANT_1 = '01930000-0000-7000-8000-0000000000a1';
const TENANT_2 = '01930000-0000-7000-8000-0000000000b1';

const GROUPS: readonly ProviderSpendGroup[] = [
  { tenantId: TENANT_1, role: 'sheet-parser', costUsd: '120.000000' },
  { tenantId: TENANT_1, role: 'gate-inspector', costUsd: '50.250000' },
  { tenantId: TENANT_1, role: 'skill-normalizer', costUsd: '0.000001' },
  { tenantId: TENANT_2, role: 'proposal-drafter', costUsd: '229.750000' },
  { tenantId: TENANT_2, role: 'gate-inspector', costUsd: '9.999999' },
];
// 合計 = 410.000000

function summarize(capUsd: number, groups: readonly ProviderSpendGroup[] = GROUPS, warnPercent = 80) {
  return summarizeProviderSpend({ periodKey: PERIOD, groups, capUsd, warnPercent, observedAt: OBSERVED_AT });
}

describe('summarizeProviderSpend ①: 合計・ロール別・テナント数', () => {
  it('合計とロール別内訳が 6 桁固定の十進文字列で、6 ロールすべてがキーに現れる', () => {
    const result = summarize(1000);
    expect(result.spentUsd).toBe('410.000000');
    expect(result.byRole).toEqual({
      'sheet-parser': '120.000000',
      'skill-normalizer': '0.000001',
      'match-explainer': '0.000000',
      'gate-inspector': '60.249999',
      'proposal-drafter': '229.750000',
      'renewal-advisor': '0.000000',
    });
    expect(result.tenantCount).toBe(2);
    expect(result.periodKey).toBe(PERIOD);
    expect(result.observedAt).toBe(OBSERVED_AT);
    expect(result.capUsd).toBe('1000.000000');
  });

  it('行が 0 件なら合計 0・テナント数 0・BELOW（エラーにしない = 「使っていない」は正常）', () => {
    const result = summarize(500, []);
    expect(result.spentUsd).toBe('0.000000');
    expect(result.tenantCount).toBe(0);
    expect(result.consumptionRate).toBe(0);
    expect(result.level).toBe('BELOW');
  });

  it('🔴 DTO のキー集合が固定（tenantId / 対象 / 件数のキーが無い）', () => {
    expect(Object.keys(summarize(500)).sort()).toEqual([
      'byRole',
      'capUsd',
      'consumptionRate',
      'level',
      'observedAt',
      'periodKey',
      'spentUsd',
      'tenantCount',
    ]);
  });
});

describe('summarizeProviderSpend ②: 水準の境界は decideLimitLevel と同じ', () => {
  it('80% ちょうど（410 / 512.5）は NEARING、その直上の上限（513）では BELOW', () => {
    const nearing = summarize(512.5);
    expect(nearing.level).toBe('NEARING');
    expect(nearing.consumptionRate).toBeCloseTo(0.8, 12);
    expect(summarize(513).level).toBe('BELOW');
  });

  it('100% ちょうど（410 / 410）は REACHED。上限を超えていても REACHED で、消費率は 1 を超える', () => {
    const reached = summarize(410);
    expect(reached.level).toBe('REACHED');
    expect(reached.consumptionRate).toBe(1);
    const over = summarize(409.999999);
    expect(over.level).toBe('REACHED');
    expect(over.consumptionRate).toBeGreaterThan(1);
  });

  it('十分な余裕（410 / 1000 = 41%）は BELOW', () => {
    const result = summarize(1000);
    expect(result.level).toBe('BELOW');
    expect(result.consumptionRate).toBeCloseTo(0.41, 12);
  });

  it('閾値は引数（warnPercent）で決まり、ここにハードコードされていない', () => {
    expect(summarize(1000, GROUPS, 40).level).toBe('NEARING');
    expect(summarize(1000, GROUPS, 42).level).toBe('BELOW');
  });
});

describe('summarizeProviderSpend ③ / ④: 不正な入力を黙って通さない', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('capUsd = %s は RangeError', (capUsd) => {
    expect(() => summarize(capUsd)).toThrow(RangeError);
  });

  it('未知のロールは捨てずに落ちる（ai_usage_role_check と AI_ROLES のずれを露出させる）', () => {
    expect(() =>
      summarize(500, [{ tenantId: TENANT_1, role: 'gpt-inspector', costUsd: '1.000000' }]),
    ).toThrow(/gpt-inspector/);
  });

  it('金額の書式が不正な集計行は RangeError（0 として扱わない）', () => {
    expect(() => summarize(500, [{ tenantId: TENANT_1, role: 'sheet-parser', costUsd: '1e3' }])).toThrow(
      RangeError,
    );
  });
});

describe('⑤ 🔴 件数（AI_UNIT_* / usage_counters）を数え直していない', () => {
  it('provider-spend.ts は usageCounter / AI_UNIT / count を参照しない（金額の集計だけ）', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'provider-spend.ts'), 'utf8');
    // コメント行を除いたコードだけを見る（コメントには「数え直さない」と書いてある）。
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/usageCounter/);
    expect(code).not.toMatch(/AI_UNIT/);
    expect(code).not.toMatch(/_count/);
    expect(code).not.toMatch(/\.count\(/);
  });
});
