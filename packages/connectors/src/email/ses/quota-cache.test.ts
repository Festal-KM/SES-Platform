// packages/connectors/src/email/ses/quota-cache.test.ts
// 🔴 `GetAccount` の 60 秒キャッシュ（docs/05 §8.3-Q ③）。T-04-04。
// 🔴 実 Redis に接続しない（ポートの偽実装を注入する）。
import { describe, expect, it } from 'vitest';
import type { ProviderQuota } from '../../types.js';
import {
  InMemoryProviderQuotaCache,
  PROVIDER_QUOTA_CACHE_KEY,
  RedisProviderQuotaCache,
  SES_QUOTA_CACHE_TTL_MS,
  type ProviderQuotaCacheRedis,
} from './quota-cache.js';

const NOW = new Date('2026-09-05T03:00:00.000Z');
const QUOTA: ProviderQuota = { max24h: 200, sentLast24h: 12, observedAt: NOW };

function fakeRedis(): ProviderQuotaCacheRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
  };
}

describe('TTL は 60 秒（GetAccount は 1 req/s の上限がある）', () => {
  it('SES_QUOTA_CACHE_TTL_MS = 60_000', () => {
    expect(SES_QUOTA_CACHE_TTL_MS).toBe(60_000);
  });
});

describe('InMemoryProviderQuotaCache', () => {
  it('TTL 内は保持し、超えたら null（= 取り直す）', async () => {
    const cache = new InMemoryProviderQuotaCache(1_000);
    await cache.write(QUOTA, NOW);
    expect(await cache.read(new Date(NOW.getTime() + 999))).toEqual(QUOTA);
    expect(await cache.read(new Date(NOW.getTime() + 1_000))).toBeNull();
  });

  it('🔴 未設定は `null`（「枠が無限」ではない）', async () => {
    expect(await new InMemoryProviderQuotaCache().read(NOW)).toBeNull();
  });
});

describe('RedisProviderQuotaCache（プロセス横断）', () => {
  it('キーは環境全体で 1 本', () => {
    expect(PROVIDER_QUOTA_CACHE_KEY).toBe('mail:provider:quota');
  });

  it('書いた値を読み戻せる（Date は ISO 文字列を経由して復元する）', async () => {
    const cache = new RedisProviderQuotaCache(fakeRedis());
    await cache.write(QUOTA, NOW);
    expect(await cache.read(NOW)).toEqual(QUOTA);
  });

  it('🔴 壊れたキャッシュは `null` として扱う（例外にして送信を止めない）', async () => {
    const redis = fakeRedis();
    redis.store.set(PROVIDER_QUOTA_CACHE_KEY, 'not-json');
    expect(await new RedisProviderQuotaCache(redis).read(NOW)).toBeNull();

    redis.store.set(PROVIDER_QUOTA_CACHE_KEY, JSON.stringify({ max24h: 'x' }));
    expect(await new RedisProviderQuotaCache(redis).read(NOW)).toBeNull();

    redis.store.set(
      PROVIDER_QUOTA_CACHE_KEY,
      JSON.stringify({ max24h: 1, sentLast24h: 0, observedAt: 'bad-date' }),
    );
    expect(await new RedisProviderQuotaCache(redis).read(NOW)).toBeNull();
  });

  it('未設定は null', async () => {
    expect(await new RedisProviderQuotaCache(fakeRedis()).read(NOW)).toBeNull();
  });
});
