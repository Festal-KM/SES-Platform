// apps/web/lib/admin-monitoring/mail-provider-quota.test.ts
// `A-005` 項目 13（`F-059 AC-7` / docs/05 §8.3-Q / §16.5 / API-A8）の組み立て。T-11-04。
//   ① 80% / 100% で consumptionRate / nearingSince / reachedAt / heldCount が出る
//   ② `getQuota()` の失敗は `available: false` で、`max24h` / `consumptionRate` を 0 で埋めない
//   ③ `tenantId` を持たない（環境全体）
//   ④ 目印（`observeNearing`）の失敗は `nearingSince: null` に落ちて項目は成立する
import { describe, expect, it } from 'vitest';
import {
  isMailProviderNearing,
  readMailProviderQuota,
  summarizeMailProviderQuota,
  type MailProviderQuotaReader,
} from './mail-provider-quota';

const NOW = new Date('2026-09-16T09:00:00.000Z');
const HELD_AT = new Date('2026-09-16T08:30:00.000Z');
const NEARING_AT = new Date('2026-09-16T07:00:00.000Z');

function reader(overrides: Partial<MailProviderQuotaReader> = {}): MailProviderQuotaReader {
  return {
    envLimit: 10,
    warnRatio: 0.8,
    readQuota: async () => ({ max24h: 50_000, sentLast24h: 8, observedAt: NOW }),
    readLocalSent24h: async () => 6,
    observeNearing: async (nearing) => (nearing ? NEARING_AT : null),
    ...overrides,
  };
}

describe('summarizeMailProviderQuota / isMailProviderNearing（純粋）', () => {
  it('① 80%: limit = min(envLimit, max24h)、consumed = max(local, provider)、接近', () => {
    const payload = summarizeMailProviderQuota({
      envLimit: 10,
      warnRatio: 0.8,
      provider: { max24h: 50_000, sentLast24h: 8, observedAt: NOW },
      localSent24h: 6,
      lastObservedAt: NOW,
      held: { heldCount: 0, oldestHeldAt: null },
      nearingSince: NEARING_AT,
      now: NOW,
    });
    expect(payload).toEqual({
      scope: 'ENVIRONMENT',
      providerReading: { available: true, max24h: 50_000, sentLast24h: 8, consumptionRate: 0.8, observedAt: NOW.toISOString() },
      envLimit: 10,
      warnRatio: 0.8,
      reachedAt: null,
      nearingSince: NEARING_AT.toISOString(),
      heldCount: 0,
    });
    expect(isMailProviderNearing({ envLimit: 10, warnRatio: 0.8, provider: { max24h: 50_000, sentLast24h: 8, observedAt: NOW }, localSent24h: 6, now: NOW })).toBe(true);
    expect(isMailProviderNearing({ envLimit: 10, warnRatio: 0.8, provider: { max24h: 50_000, sentLast24h: 7, observedAt: NOW }, localSent24h: 6, now: NOW })).toBe(false);
  });

  it('① 100%: consumptionRate 1.0 / reachedAt = MIN(held_at) / heldCount', () => {
    const payload = summarizeMailProviderQuota({
      envLimit: 10,
      warnRatio: 0.8,
      provider: { max24h: 50_000, sentLast24h: 10, observedAt: NOW },
      localSent24h: 10,
      lastObservedAt: NOW,
      held: { heldCount: 3, oldestHeldAt: HELD_AT },
      nearingSince: NEARING_AT,
      now: NOW,
    });
    expect(payload.providerReading).toMatchObject({ available: true, consumptionRate: 1 });
    expect(payload.reachedAt).toBe(HELD_AT.toISOString());
    expect(payload.heldCount).toBe(3);
  });

  it('🔴 ② getQuota() が無いときは available: false で、max24h / consumptionRate を持たない（0 で埋めない）', () => {
    const payload = summarizeMailProviderQuota({
      envLimit: 10,
      warnRatio: 0.8,
      provider: null,
      localSent24h: 4,
      lastObservedAt: NEARING_AT,
      held: { heldCount: 0, oldestHeldAt: null },
      nearingSince: null,
      now: NOW,
    });
    expect(payload.providerReading).toEqual({ available: false, localSentLast24h: 4, lastObservedAt: NEARING_AT.toISOString() });
    expect(Object.keys(payload.providerReading)).not.toContain('max24h');
    expect(Object.keys(payload.providerReading)).not.toContain('consumptionRate');
    expect(JSON.stringify(payload)).not.toMatch(/"max24h":0|"consumptionRate":0/);
  });

  it('🔴 ③ tenantId を持たない（環境全体）', () => {
    const payload = summarizeMailProviderQuota({
      envLimit: 10,
      warnRatio: 0.8,
      provider: { max24h: 50_000, sentLast24h: 1, observedAt: NOW },
      localSent24h: 1,
      lastObservedAt: NOW,
      held: { heldCount: 0, oldestHeldAt: null },
      nearingSince: null,
      now: NOW,
    });
    expect(JSON.stringify(payload)).not.toContain('tenantId');
    expect(payload.scope).toBe('ENVIRONMENT');
  });
});

describe('readMailProviderQuota（口からの読み取りと失敗の扱い）', () => {
  it('成功: 接近を観測して目印の時刻を載せ、lastObservedAt を記憶する', async () => {
    const memory = { lastObservedAt: null as Date | null };
    const payload = await readMailProviderQuota(reader(), { heldCount: 0, oldestHeldAt: null }, NOW, memory);
    expect(payload.providerReading).toMatchObject({ available: true, consumptionRate: 0.8 });
    expect(payload.nearingSince).toBe(NEARING_AT.toISOString());
    expect(memory.lastObservedAt).toEqual(NOW);
  });

  it('🔴 ② getQuota() が throw → available: false + 手元のカウンタ + 最後に成功した時刻。throw しない', async () => {
    const memory = { lastObservedAt: NEARING_AT };
    const payload = await readMailProviderQuota(
      reader({
        readQuota: async () => {
          throw new Error('GetAccount failed');
        },
        readLocalSent24h: async () => 9,
      }),
      { heldCount: 2, oldestHeldAt: HELD_AT },
      NOW,
      memory,
    );
    expect(payload.providerReading).toEqual({ available: false, localSentLast24h: 9, lastObservedAt: NEARING_AT.toISOString() });
    expect(payload.heldCount).toBe(2);
    expect(payload.reachedAt).toBe(HELD_AT.toISOString());
    // 手元のカウンタだけでも接近（9 / 10）は判定される（`decideProviderQuota` と同じ向き）。
    expect(payload.nearingSince).toBe(NEARING_AT.toISOString());
  });

  it('④ 目印（observeNearing）の失敗は nearingSince: null に落ち、項目は成立する', async () => {
    const payload = await readMailProviderQuota(
      reader({
        observeNearing: async () => {
          throw new Error('redis down');
        },
      }),
      { heldCount: 0, oldestHeldAt: null },
      NOW,
      { lastObservedAt: null },
    );
    expect(payload.nearingSince).toBeNull();
    expect(payload.providerReading.available).toBe(true);
  });

  it('接近していなければ目印は消され nearingSince は null', async () => {
    const observed: boolean[] = [];
    const payload = await readMailProviderQuota(
      reader({
        readQuota: async () => ({ max24h: 50_000, sentLast24h: 1, observedAt: NOW }),
        readLocalSent24h: async () => 1,
        observeNearing: async (nearing) => {
          observed.push(nearing);
          return null;
        },
      }),
      { heldCount: 0, oldestHeldAt: null },
      NOW,
      { lastObservedAt: null },
    );
    expect(observed).toEqual([false]);
    expect(payload.nearingSince).toBeNull();
  });

  it('手元のカウンタも読めなければ throw する（呼び出し側が PROVIDER_READ_FAILED に落とす）', async () => {
    await expect(
      readMailProviderQuota(
        reader({
          readLocalSent24h: async () => {
            throw new Error('redis down');
          },
        }),
        { heldCount: 0, oldestHeldAt: null },
        NOW,
        { lastObservedAt: null },
      ),
    ).rejects.toThrow('redis down');
  });
});
