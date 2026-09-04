// tests/isolation/usage-counters.test.ts
// `UsageCounter` の計測フック（`CLAUDE.md` §10.6 / `F-026` / docs/05 §7.6 / §9.8）。T-03-10。
//
// 🔴 ここで実証するのは 4 つである:
//   ① `usage.seat-snapshot` の**冪等性** —— 同じ日に 2 回実行しても 1 行のまま、値も二重に
//      積まれない（docs/05 §9.8「`UNIQUE` + `ON CONFLICT`」）
//   ② 🔴 **原子的加算** —— 同一カウンタへの並行加算が 1 件も失われない
//      （`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`。docs/05 §7.6 の `reserveAiCost` が
//       この性質に依存する。Prisma の `upsert`〔読んでから書く〕では失われる）
//   ③ `countPartnerSeats` が**引数どおりに効く**（docs/05 TBD-19 / Issue #12。決め打ちしない）
//   ④ テナント境界 —— 他テナントのカウンタに 1 も混ざらない
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  incrementUsageCounter,
  recordUsageCounterSnapshot,
  snapshotSeatCount,
  systemTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-05 01:00。 */
const NOW = new Date('2026-09-04T16:00:00.000Z');
const PERIOD_KEY = '2026-09-05';

const JOB = { queue: 'usage.seat-snapshot', jobId: 'usage.seat-snapshot:2026-09-05' } as const;

let database: IsolationDatabase;
/** 🔴 投入・検算だけに使う特権接続（検証の主体は app_tenant 経由の関数呼び出し）。 */
let admin: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;

async function readCounters(
  tenantId: string,
  metric: string,
): Promise<Array<{ periodKey: string; value: string }>> {
  const rows = await admin.usageCounter.findMany({
    where: { tenantId, metric },
    orderBy: { periodKey: 'asc' },
    select: { periodKey: true, value: true },
  });
  return rows.map((row) => ({ periodKey: row.periodKey, value: row.value.toString() }));
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, JOB);
  ctxB = systemTenantCtx(TENANT_B, JOB);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 usage.seat-snapshot の冪等性（docs/05 §9.8 / F-026）', () => {
  it('同じ日に 2 回実行しても行は 1 つで、値も二重にならない', async () => {
    const first = await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: NOW });
    const second = await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: NOW });

    expect(first.seatCount).toBe(second.seatCount);
    expect(first.value).toBe(second.value);

    const rows = await readCounters(TENANT_A, 'SEAT_COUNT');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.periodKey).toBe(PERIOD_KEY);
    expect(Number(rows[0]?.value)).toBe(first.seatCount);
  });

  it('🔴 期間キーは Asia/Tokyo の暦日である（UTC で切らない）', async () => {
    const result = await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: NOW });
    // UTC では 2026-09-04、JST では 2026-09-05。
    expect(result.periodKey).toBe(PERIOD_KEY);
  });

  it('別の日に実行すると別の行になる（日次の連続性が保てる）', async () => {
    const nextDay = new Date('2026-09-05T16:00:00.000Z');
    await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: nextDay });
    const rows = await readCounters(TENANT_A, 'SEAT_COUNT');
    expect(rows.map((row) => row.periodKey)).toEqual([PERIOD_KEY, '2026-09-06']);
  });
});

describe('🔴 countPartnerSeats（docs/05 TBD-19 / Issue #12。決め打ちしない）', () => {
  it('true のときは取引先所属の席も数える', async () => {
    const result = await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: NOW });
    const all = await admin.membership.count({ where: { tenantId: TENANT_A, revokedAt: null } });
    expect(result.seatCount).toBe(all);
    expect(result.seatCount).toBeGreaterThan(1); // 対照: 取引先の席が実在する母集団である
  });

  it('false のときはホスト所属の席だけを数える', async () => {
    const result = await snapshotSeatCount(ctxA, { countPartnerSeats: false, observedAt: NOW });
    const hostOnly = await admin.membership.count({
      where: { tenantId: TENANT_A, revokedAt: null, partnerCompanyId: null },
    });
    expect(result.seatCount).toBe(hostOnly);
  });

  it('🔴 2 つの値が実際に違う（引数が効いていることの対照）', async () => {
    const withPartners = await snapshotSeatCount(ctxA, {
      countPartnerSeats: true,
      observedAt: NOW,
    });
    const hostOnly = await snapshotSeatCount(ctxA, { countPartnerSeats: false, observedAt: NOW });
    expect(withPartners.seatCount).toBeGreaterThan(hostOnly.seatCount);
    // 上書き（SET）なので、最後の実行の値が残る。
    const rows = await readCounters(TENANT_A, 'SEAT_COUNT');
    const today = rows.find((row) => row.periodKey === PERIOD_KEY);
    expect(Number(today?.value)).toBe(hostOnly.seatCount);
  });
});

describe('🔴 原子的加算（docs/05 §7.6 / §14.2）', () => {
  it('並行して 20 回加算しても 1 件も失われない', async () => {
    const observedAt = new Date('2026-09-10T16:00:00.000Z');
    await Promise.all(
      Array.from({ length: 20 }, () =>
        incrementUsageCounter(ctxA, {
          periodKind: 'DAY',
          metric: 'EMAIL_COUNT',
          amount: '1',
          observedAt,
        }),
      ),
    );

    const rows = await readCounters(TENANT_A, 'EMAIL_COUNT');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.value)).toBe(20);
  });

  it('小数（AI コストの USD）も欠損なく積める', async () => {
    const observedAt = new Date('2026-09-11T16:00:00.000Z');
    await Promise.all([
      incrementUsageCounter(ctxA, {
        periodKind: 'DAY',
        metric: 'AI_COST_USD',
        amount: '0.000001',
        observedAt,
      }),
      incrementUsageCounter(ctxA, {
        periodKind: 'DAY',
        metric: 'AI_COST_USD',
        amount: '0.000002',
        observedAt,
      }),
    ]);
    const rows = await readCounters(TENANT_A, 'AI_COST_USD');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.value)).toBeCloseTo(0.000003, 9);
  });

  it('確定値の上書き（スナップショット）は加算しない', async () => {
    const observedAt = new Date('2026-09-12T16:00:00.000Z');
    await recordUsageCounterSnapshot(ctxA, {
      periodKind: 'MONTH',
      metric: 'STORAGE_BYTES',
      amount: '1000',
      observedAt,
    });
    const result = await recordUsageCounterSnapshot(ctxA, {
      periodKind: 'MONTH',
      metric: 'STORAGE_BYTES',
      amount: '2000',
      observedAt,
    });
    expect(Number(result.value)).toBe(2000);
  });

  it('🔴 十進数として不正な値は SQL に渡さず例外にする', async () => {
    await expect(
      incrementUsageCounter(ctxA, {
        periodKind: 'DAY',
        metric: 'EMAIL_COUNT',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 呼び出し側の型を破った場合の門番を確かめる
        amount: '1); DROP TABLE usage_counters; --' as any,
        observedAt: NOW,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('🔴 テナント境界（F-004 AC-1）', () => {
  it('他テナントのカウンタに混ざらない', async () => {
    const observedAt = new Date('2026-09-13T16:00:00.000Z');
    await incrementUsageCounter(ctxA, {
      periodKind: 'DAY',
      metric: 'ESIGN_REQUESTS',
      amount: '5',
      observedAt,
    });
    await incrementUsageCounter(ctxB, {
      periodKind: 'DAY',
      metric: 'ESIGN_REQUESTS',
      amount: '3',
      observedAt,
    });

    const a = await readCounters(TENANT_A, 'ESIGN_REQUESTS');
    const b = await readCounters(TENANT_B, 'ESIGN_REQUESTS');
    expect(Number(a[0]?.value)).toBe(5);
    expect(Number(b[0]?.value)).toBe(3);
  });

  it('席数スナップショットもテナントごとに独立している', async () => {
    const a = await snapshotSeatCount(ctxA, { countPartnerSeats: true, observedAt: NOW });
    const b = await snapshotSeatCount(ctxB, { countPartnerSeats: true, observedAt: NOW });
    expect(a.seatCount).not.toBe(b.seatCount);
  });
});
