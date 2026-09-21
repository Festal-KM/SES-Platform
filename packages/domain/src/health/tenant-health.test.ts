// packages/domain/src/health/tenant-health.test.ts
// docs/02 `F-056 AC-2`（一覧の既定の並び順が異常度の高い順）/ docs/05 §5.7 / §6.9 API-A2。T-11-01。
//
// ここで固定するのは:
//   ① 4 つの異常（停滞 / 席の未利用 / パートナー 0 / 期限切れ）+ 接近が、それぞれ閾値ちょうどで成立する
//   ② 決定性（同じ入力 → 同じ出力。`now` は引数）と、出力順が `TENANT_HEALTH_SIGNALS` の順であること
//   ③ 重みの不変条件（上位 1 つ > 下位の合計）と、同点の順序（`createdAt` 昇順 → `id` 昇順）
//   ④ `CLOSING` が最下位、`PURGED` がさらに下（対象外）
//   ⑤ 閾値は引数で受ける（既定を決め打ちしない）/ 不正な入力は例外
import { describe, expect, it } from 'vitest';
import {
  compareTenantHealthOrder,
  countTenantHealthSignals,
  DEFAULT_TENANT_HEALTH_THRESHOLDS,
  scoreTenantHealth,
  TENANT_HEALTH_SIGNAL_WEIGHTS,
  TENANT_HEALTH_SIGNALS,
  TENANT_LIST_SORT_KEYS,
  tenantListComparator,
  type TenantHealthInput,
  type TenantListSortable,
} from './tenant-health.js';

const DAY = 86_400_000;
const NOW = new Date('2026-09-16T09:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const daysAhead = (days: number) => new Date(NOW.getTime() + days * DAY);

/** 健全なテナント（異常 0 件）。各テストはここから 1 項目だけ崩す。 */
const HEALTHY: TenantHealthInput = {
  lifecycleState: 'ACTIVE',
  createdAt: daysAgo(100),
  lastActivityAt: daysAgo(1),
  seatCount: 10,
  activeMemberCount: 8,
  partnerCompanyCount: 3,
  sandboxExpiresAt: null,
  now: NOW,
};

const T = DEFAULT_TENANT_HEALTH_THRESHOLDS;

describe('scoreTenantHealth — 4 つの異常 + 接近（F-056 AC-2）', () => {
  it('健全なテナントは score 0・signals 空', () => {
    expect(scoreTenantHealth(HEALTHY, T)).toEqual({ score: 0, signals: [] });
  });

  it('INACTIVE: 最終アクティビティが閾値日数ちょうどで成立し、1ms 手前では成立しない', () => {
    expect(scoreTenantHealth({ ...HEALTHY, lastActivityAt: daysAgo(14) }, T).signals).toEqual(['INACTIVE']);
    expect(
      scoreTenantHealth({ ...HEALTHY, lastActivityAt: new Date(daysAgo(14).getTime() + 1) }, T).signals,
    ).toEqual([]);
  });

  it('INACTIVE: 一度もログインが無い（null）ときは開設日時から数える', () => {
    expect(
      scoreTenantHealth({ ...HEALTHY, lastActivityAt: null, createdAt: daysAgo(14) }, T).signals,
    ).toContain('INACTIVE');
    expect(
      scoreTenantHealth({ ...HEALTHY, lastActivityAt: null, createdAt: daysAgo(13) }, T).signals,
    ).not.toContain('INACTIVE');
  });

  it('SEATS_UNUSED: 利用率が閾値未満で成立（30% ちょうどは成立しない。整数演算）', () => {
    expect(scoreTenantHealth({ ...HEALTHY, seatCount: 10, activeMemberCount: 3 }, T).signals).toEqual([]);
    expect(scoreTenantHealth({ ...HEALTHY, seatCount: 10, activeMemberCount: 2 }, T).signals).toEqual([
      'SEATS_UNUSED',
    ]);
    // 7 / 24 = 29.16…% → 成立。8 / 24 = 33.3% → 不成立（浮動小数点の丸めに依存しない）。
    expect(scoreTenantHealth({ ...HEALTHY, seatCount: 24, activeMemberCount: 7 }, T).signals).toEqual([
      'SEATS_UNUSED',
    ]);
    expect(scoreTenantHealth({ ...HEALTHY, seatCount: 24, activeMemberCount: 8 }, T).signals).toEqual([]);
  });

  it('SEATS_UNUSED: 席 0 のテナントは対象外（0 / 0 を異常にしない）', () => {
    expect(scoreTenantHealth({ ...HEALTHY, seatCount: 0, activeMemberCount: 0 }, T).signals).toEqual([]);
  });

  it('NO_PARTNERS: 開設から猶予日数ちょうどで成立し、猶予中は成立しない', () => {
    expect(
      scoreTenantHealth({ ...HEALTHY, partnerCompanyCount: 0, createdAt: daysAgo(7) }, T).signals,
    ).toEqual(['NO_PARTNERS']);
    expect(
      scoreTenantHealth(
        { ...HEALTHY, partnerCompanyCount: 0, createdAt: new Date(daysAgo(7).getTime() + 1) },
        T,
      ).signals,
    ).toEqual([]);
  });

  it('TRIAL_EXPIRED: SANDBOX で期限を過ぎた（ちょうども含む）', () => {
    expect(
      scoreTenantHealth({ ...HEALTHY, lifecycleState: 'SANDBOX', sandboxExpiresAt: NOW }, T).signals,
    ).toEqual(['TRIAL_EXPIRED']);
    expect(
      scoreTenantHealth({ ...HEALTHY, lifecycleState: 'SANDBOX', sandboxExpiresAt: daysAgo(3) }, T).signals,
    ).toEqual(['TRIAL_EXPIRED']);
  });

  it('TRIAL_EXPIRING: 期限が 7 日以内（ちょうども含む）。8 日先は成立しない。EXPIRED と排他', () => {
    expect(
      scoreTenantHealth({ ...HEALTHY, lifecycleState: 'SANDBOX', sandboxExpiresAt: daysAhead(7) }, T).signals,
    ).toEqual(['TRIAL_EXPIRING']);
    expect(
      scoreTenantHealth({ ...HEALTHY, lifecycleState: 'SANDBOX', sandboxExpiresAt: daysAhead(8) }, T).signals,
    ).toEqual([]);
    const expired = scoreTenantHealth(
      { ...HEALTHY, lifecycleState: 'SANDBOX', sandboxExpiresAt: daysAgo(1) },
      T,
    ).signals;
    expect(expired).toContain('TRIAL_EXPIRED');
    expect(expired).not.toContain('TRIAL_EXPIRING');
  });

  it('🔴 期限の判定は SANDBOX 以外では行わない（ACTIVE に sandboxExpiresAt が残っていても無視）', () => {
    expect(
      scoreTenantHealth({ ...HEALTHY, lifecycleState: 'ACTIVE', sandboxExpiresAt: daysAgo(30) }, T).signals,
    ).toEqual([]);
  });

  it('SANDBOX でも停滞・席・パートナーの判定は同じ基準で行う', () => {
    const result = scoreTenantHealth(
      {
        ...HEALTHY,
        lifecycleState: 'SANDBOX',
        sandboxExpiresAt: daysAhead(20),
        lastActivityAt: daysAgo(20),
        partnerCompanyCount: 0,
      },
      T,
    );
    expect(result.signals).toEqual(['INACTIVE', 'NO_PARTNERS']);
  });
});

describe('scoreTenantHealth — 決定性と出力順', () => {
  const ALL_FOUR: TenantHealthInput = {
    lifecycleState: 'SANDBOX',
    createdAt: daysAgo(40),
    lastActivityAt: daysAgo(20),
    seatCount: 10,
    activeMemberCount: 1,
    partnerCompanyCount: 0,
    sandboxExpiresAt: daysAgo(2),
    now: NOW,
  };

  it('同じ入力には同じ出力（now を含めて引数で完結する）', () => {
    const a = scoreTenantHealth(ALL_FOUR, T);
    const b = scoreTenantHealth({ ...ALL_FOUR }, T);
    expect(a).toEqual(b);
  });

  it('🔴 4 つ同時に成立したときの signals は TENANT_HEALTH_SIGNALS の順で、score は重みの合計', () => {
    const result = scoreTenantHealth(ALL_FOUR, T);
    expect(result.signals).toEqual(['TRIAL_EXPIRED', 'INACTIVE', 'SEATS_UNUSED', 'NO_PARTNERS']);
    expect(result.score).toBe(40 + 20 + 10 + 6);
  });

  it('🔴 重みの不変条件: どのシグナルも、それより下位の全部の合計より大きい', () => {
    for (let index = 0; index < TENANT_HEALTH_SIGNALS.length; index += 1) {
      const signal = TENANT_HEALTH_SIGNALS[index] as (typeof TENANT_HEALTH_SIGNALS)[number];
      const lowerSum = TENANT_HEALTH_SIGNALS.slice(index + 1).reduce(
        (sum, lower) => sum + TENANT_HEALTH_SIGNAL_WEIGHTS[lower],
        0,
      );
      expect(TENANT_HEALTH_SIGNAL_WEIGHTS[signal]).toBeGreaterThan(lowerSum);
    }
  });

  it('CLOSING / PURGED はシグナルを持たない（正常な終了 / 対象外）', () => {
    expect(scoreTenantHealth({ ...ALL_FOUR, lifecycleState: 'CLOSING' }, T)).toEqual({ score: 0, signals: [] });
    expect(scoreTenantHealth({ ...ALL_FOUR, lifecycleState: 'PURGED' }, T)).toEqual({ score: 0, signals: [] });
  });

  it('閾値は引数で受ける（既定を決め打ちしない）', () => {
    const strict = { ...T, inactiveDays: 3, noPartnersGraceDays: 1, seatUtilizationMinPercent: 90, trialExpiringDays: 30 };
    const result = scoreTenantHealth(
      {
        ...HEALTHY,
        lifecycleState: 'SANDBOX',
        sandboxExpiresAt: daysAhead(20),
        lastActivityAt: daysAgo(3),
        partnerCompanyCount: 0,
        seatCount: 10,
        activeMemberCount: 8,
      },
      strict,
    );
    expect(result.signals).toEqual(['INACTIVE', 'SEATS_UNUSED', 'NO_PARTNERS', 'TRIAL_EXPIRING']);
  });

  it('不正な閾値・件数は例外にする（黙って 0 にしない）', () => {
    expect(() => scoreTenantHealth(HEALTHY, { ...T, inactiveDays: 0 })).toThrow(RangeError);
    expect(() => scoreTenantHealth(HEALTHY, { ...T, seatUtilizationMinPercent: 101 })).toThrow(RangeError);
    expect(() => scoreTenantHealth(HEALTHY, { ...T, trialExpiringDays: 1.5 })).toThrow(RangeError);
    expect(() => scoreTenantHealth({ ...HEALTHY, seatCount: -1 }, T)).toThrow(RangeError);
    expect(() => scoreTenantHealth({ ...HEALTHY, seatCount: 2, activeMemberCount: 3 }, T)).toThrow(RangeError);
  });
});

describe('tenantListComparator — 並び順', () => {
  const row = (
    id: string,
    over: Partial<Omit<TenantListSortable, 'id'>> = {},
  ): TenantListSortable => ({
    id,
    name: `Tenant ${id}`,
    lifecycleState: 'ACTIVE',
    createdAt: daysAgo(50),
    health: { score: 0, signals: [] },
    ...over,
  });

  it('🔴 health: スコアの高い順', () => {
    const rows = [
      row('a', { health: { score: 6, signals: ['NO_PARTNERS'] } }),
      row('b', { health: { score: 60, signals: ['TRIAL_EXPIRED', 'INACTIVE'] } }),
      row('c', { health: { score: 20, signals: ['INACTIVE'] } }),
    ];
    expect([...rows].sort(compareTenantHealthOrder).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('🔴 health の同点は createdAt 昇順（古いテナントが先）→ id 昇順', () => {
    const rows = [
      row('c', { createdAt: daysAgo(10) }),
      row('b', { createdAt: daysAgo(30) }),
      row('a', { createdAt: daysAgo(10) }),
      row('d', { createdAt: daysAgo(30) }),
    ];
    expect([...rows].sort(compareTenantHealthOrder).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('🔴 CLOSING はスコアの対象より常に下、PURGED はさらに下（同点でも層で分かれる）', () => {
    const rows = [
      row('purged', { lifecycleState: 'PURGED', createdAt: daysAgo(999) }),
      row('closing', { lifecycleState: 'CLOSING', createdAt: daysAgo(999) }),
      row('healthy', { createdAt: daysAgo(1) }),
      row('suspended', { lifecycleState: 'SUSPENDED', createdAt: daysAgo(2) }),
    ];
    expect([...rows].sort(compareTenantHealthOrder).map((r) => r.id)).toEqual([
      'suspended',
      'healthy',
      'closing',
      'purged',
    ]);
  });

  it('決定性: 入力の順序を変えても同じ並びになる', () => {
    const rows = [
      row('x', { health: { score: 10, signals: ['SEATS_UNUSED'] }, createdAt: daysAgo(5) }),
      row('y', { health: { score: 10, signals: ['SEATS_UNUSED'] }, createdAt: daysAgo(5) }),
      row('z', { health: { score: 30, signals: ['INACTIVE', 'SEATS_UNUSED'] } }),
      row('w', { lifecycleState: 'CLOSING' }),
    ];
    const forward = [...rows].sort(compareTenantHealthOrder).map((r) => r.id);
    const backward = [...rows].reverse().sort(compareTenantHealthOrder).map((r) => r.id);
    expect(forward).toEqual(['z', 'x', 'y', 'w']);
    expect(backward).toEqual(forward);
  });

  it('name: 名前昇順 → id 昇順（ロケール非依存）', () => {
    const rows = [row('2', { name: 'Beta' }), row('1', { name: 'alpha' }), row('3', { name: 'Alpha' }), row('0', { name: 'Alpha' })];
    expect([...rows].sort(tenantListComparator('name')).map((r) => r.id)).toEqual(['0', '3', '2', '1']);
  });

  it('createdAt: 新しい順 → id 降順（SP-03 の既定と同じ）', () => {
    const rows = [row('a', { createdAt: daysAgo(3) }), row('b', { createdAt: daysAgo(1) }), row('c', { createdAt: daysAgo(3) })];
    expect([...rows].sort(tenantListComparator('createdAt')).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('sort の値集合は 3 つ（health が既定）', () => {
    expect(TENANT_LIST_SORT_KEYS).toEqual(['health', 'name', 'createdAt']);
  });
});

describe('countTenantHealthSignals — 要約（A-002 セクション 1 / API-A2 summary。T-12-18 ③）', () => {
  it('🔴 5 キーを必ず全部持ち、0 件も 0 で出る（空の母集団）', () => {
    expect(countTenantHealthSignals([])).toEqual({ TRIAL_EXPIRED: 0, INACTIVE: 0, SEATS_UNUSED: 0, NO_PARTNERS: 0, TRIAL_EXPIRING: 0 });
    expect(Object.keys(countTenantHealthSignals([]))).toEqual([...TENANT_HEALTH_SIGNALS]);
  });

  it('1 テナントが 2 種別を持てば両方に数える。CLOSING / PURGED（signals: []）はどこにも数えない', () => {
    const summary = countTenantHealthSignals([
      { health: { signals: ['TRIAL_EXPIRED', 'INACTIVE'] } },
      { health: { signals: ['INACTIVE'] } },
      { health: { signals: ['NO_PARTNERS'] } },
      { health: { signals: [] } },
      { health: { signals: [] } },
    ]);
    expect(summary).toEqual({ TRIAL_EXPIRED: 1, INACTIVE: 2, SEATS_UNUSED: 0, NO_PARTNERS: 1, TRIAL_EXPIRING: 0 });
  });

  it('同じシグナルが重複していても 1 テナント 1 回。決定性（同じ入力に同じ出力、入力を変異させない）', () => {
    const items = [{ health: { signals: ['SEATS_UNUSED', 'SEATS_UNUSED'] as const } }];
    const first = countTenantHealthSignals(items);
    const second = countTenantHealthSignals([...items]);
    expect(first.SEATS_UNUSED).toBe(1);
    expect(second).toEqual(first);
    expect(items[0]?.health.signals).toEqual(['SEATS_UNUSED', 'SEATS_UNUSED']);
  });
});
