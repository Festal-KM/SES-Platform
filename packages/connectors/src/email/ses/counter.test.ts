// packages/connectors/src/email/ses/counter.test.ts
// 🔴 送信基盤（SES アカウント）の 24h ローリングカウンタ（docs/05 §8.3-Q ③）。T-04-04。
//
// 🔴 **実 Redis に接続しない。** `ProviderCounterRedis` はメソッド名・引数を ioredis と
//    構造的に一致させたポートであり、ここでは ZSET のセマンティクスを再現した偽実装を注入する
//    （CI が Redis を要求しないため。既存の分離テストと同じ方針）。
import { describe, expect, it } from 'vitest';
import {
  InMemoryProviderSendCounter,
  PROVIDER_SENT_24H_KEY,
  RedisProviderSendCounter,
  type ProviderCounterRedis,
} from './counter.js';

const NOW = new Date('2026-09-05T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** ZSET の最小実装（`ZADD` / `ZREMRANGEBYSCORE` / `ZCOUNT` / `PEXPIRE`）。 */
function fakeRedis(): ProviderCounterRedis & { readonly entries: Map<string, number> } {
  const entries = new Map<string, number>();
  let expireCalls = 0;
  return {
    entries,
    async zadd(_key, score, member) {
      entries.set(member, score);
      return 1;
    },
    async zremrangebyscore(_key, min, max) {
      const lower = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
      for (const [member, score] of entries) {
        if (score >= lower && score <= max) entries.delete(member);
      }
      return 0;
    },
    async zcount(_key, min, max) {
      const upper = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
      return [...entries.values()].filter((score) => score >= min && score <= upper).length;
    },
    async pexpire() {
      expireCalls += 1;
      return expireCalls;
    },
  };
}

describe('InMemoryProviderSendCounter（単一プロセス用）', () => {
  it('24 時間以内の件数を数える', async () => {
    const counter = new InMemoryProviderSendCounter();
    await counter.record(NOW);
    await counter.record(NOW);
    expect(await counter.countLast24h(NOW)).toBe(2);
  });

  it('🔴 24 時間より古い記録は落ちる（ローリング窓）', async () => {
    const counter = new InMemoryProviderSendCounter();
    await counter.record(NOW);
    expect(await counter.countLast24h(new Date(NOW.getTime() + DAY_MS + 1))).toBe(0);
  });
});

describe('RedisProviderSendCounter（プロセス横断。docs/05 §8.3-Q ③）', () => {
  it('既定のキーは環境全体で 1 本（テナントごとに分けない）', () => {
    expect(PROVIDER_SENT_24H_KEY).toBe('mail:provider:sent24h');
  });

  it('実送信のたびに 1 件増える', async () => {
    const redis = fakeRedis();
    const counter = new RedisProviderSendCounter(redis);
    await counter.record(NOW);
    await counter.record(NOW);
    expect(await counter.countLast24h(NOW)).toBe(2);
  });

  it('🔴 同一ミリ秒の 2 通が 1 件に潰れない（メンバーが衝突しない）', async () => {
    const redis = fakeRedis();
    const counter = new RedisProviderSendCounter(redis);
    await counter.record(NOW);
    await counter.record(NOW);
    // 潰れると枠を過大評価し、上限を超えて送る側へ倒れる。
    expect(redis.entries.size).toBe(2);
  });

  it('🔴 24 時間より古い記録は削除され、数えられない', async () => {
    const redis = fakeRedis();
    const counter = new RedisProviderSendCounter(redis);
    await counter.record(NOW);
    const later = new Date(NOW.getTime() + DAY_MS + 1);
    expect(await counter.countLast24h(later)).toBe(0);
    expect(redis.entries.size).toBe(0);
  });

  it('窓の内側に入っている記録は残る', async () => {
    const redis = fakeRedis();
    const counter = new RedisProviderSendCounter(redis);
    await counter.record(NOW);
    const later = new Date(NOW.getTime() + DAY_MS - 1_000);
    expect(await counter.countLast24h(later)).toBe(1);
  });

  it('キーは差し替えられる（テストと環境分離のため）', async () => {
    const redis = fakeRedis();
    const counter = new RedisProviderSendCounter(redis, 'mail:provider:sent24h:test');
    await counter.record(NOW);
    expect(await counter.countLast24h(NOW)).toBe(1);
  });
});
