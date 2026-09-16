// packages/connectors/src/email/ses/nearing-marker.test.ts
// `mail:provider:nearingSince` の目印（docs/05 §16.5 項目 13 ③）。T-11-04。
import { describe, expect, it } from 'vitest';
import {
  InMemoryProviderQuotaNearingMarker,
  PROVIDER_NEARING_SINCE_KEY,
  PROVIDER_NEARING_SINCE_TTL_MS,
  RedisProviderQuotaNearingMarker,
  type ProviderNearingRedis,
} from './nearing-marker.js';

const T0 = new Date('2026-09-16T09:00:00.000Z');
const later = (ms: number): Date => new Date(T0.getTime() + ms);

/** ioredis の `SET ... PX ... NX` / `GET` / `DEL` を最小限に再現する。 */
class FakeRedis implements ProviderNearingRedis {
  readonly store = new Map<string, { value: string; expiresAt: number }>();
  readonly calls: string[] = [];
  clock = T0.getTime();

  async get(key: string): Promise<string | null> {
    this.calls.push(`get ${key}`);
    const entry = this.store.get(key);
    if (entry === undefined || entry.expiresAt <= this.clock) return null;
    return entry.value;
  }

  async set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<unknown> {
    this.calls.push(`set ${key} ${mode} ${ttlMs} ${condition}`);
    const existing = this.store.get(key);
    if (existing !== undefined && existing.expiresAt > this.clock) return null;
    this.store.set(key, { value, expiresAt: this.clock + ttlMs });
    return 'OK';
  }

  async del(key: string): Promise<unknown> {
    this.calls.push(`del ${key}`);
    return this.store.delete(key) ? 1 : 0;
  }
}

describe('InMemoryProviderQuotaNearingMarker', () => {
  it('接近していなければ null（目印を消す）', async () => {
    const marker = new InMemoryProviderQuotaNearingMarker();
    expect(await marker.observe(true, T0)).toEqual(T0);
    expect(await marker.observe(false, later(1_000))).toBeNull();
    // 消えた後に再び接近したら、その時刻から数え直す。
    expect(await marker.observe(true, later(2_000))).toEqual(later(2_000));
  });

  it('🔴 最初の観測時刻を守る（後の観測で上書きしない）', async () => {
    const marker = new InMemoryProviderQuotaNearingMarker();
    expect(await marker.observe(true, T0)).toEqual(T0);
    expect(await marker.observe(true, later(60_000))).toEqual(T0);
  });

  it('24 時間を超えて古い目印は捨てる（ローリング枠に合わせる）', async () => {
    const marker = new InMemoryProviderQuotaNearingMarker();
    await marker.observe(true, T0);
    const afterTtl = later(PROVIDER_NEARING_SINCE_TTL_MS + 1);
    expect(await marker.observe(true, afterTtl)).toEqual(afterTtl);
  });
});

describe('RedisProviderQuotaNearingMarker', () => {
  it('🔴 SET NX + PX(24h) で書き、既存の値があればそれを返す（最初の観測時刻を守る）', async () => {
    const redis = new FakeRedis();
    const marker = new RedisProviderQuotaNearingMarker(redis);
    expect(await marker.observe(true, T0)).toEqual(T0);
    expect(await marker.observe(true, later(5 * 60_000))).toEqual(T0);
    expect(redis.calls[0]).toBe(`set ${PROVIDER_NEARING_SINCE_KEY} PX ${PROVIDER_NEARING_SINCE_TTL_MS} NX`);
    expect(redis.store.get(PROVIDER_NEARING_SINCE_KEY)?.value).toBe(T0.toISOString());
  });

  it('接近していなければ DEL して null', async () => {
    const redis = new FakeRedis();
    const marker = new RedisProviderQuotaNearingMarker(redis);
    await marker.observe(true, T0);
    expect(await marker.observe(false, later(1_000))).toBeNull();
    expect(redis.store.has(PROVIDER_NEARING_SINCE_KEY)).toBe(false);
    expect(redis.calls.at(-1)).toBe(`del ${PROVIDER_NEARING_SINCE_KEY}`);
  });

  it('壊れた値は無かったこととして扱い、今回の観測時刻を返す（例外にしない）', async () => {
    const redis = new FakeRedis();
    redis.store.set(PROVIDER_NEARING_SINCE_KEY, { value: 'not-a-date', expiresAt: Number.MAX_SAFE_INTEGER });
    const marker = new RedisProviderQuotaNearingMarker(redis);
    expect(await marker.observe(true, T0)).toEqual(T0);
  });

  it('TTL が切れていれば新しい観測時刻で書き直す', async () => {
    const redis = new FakeRedis();
    const marker = new RedisProviderQuotaNearingMarker(redis);
    await marker.observe(true, T0);
    redis.clock = T0.getTime() + PROVIDER_NEARING_SINCE_TTL_MS + 1;
    const now = new Date(redis.clock);
    expect(await marker.observe(true, now)).toEqual(now);
  });
});
