// packages/connectors/src/rate/minute-window.test.ts
// 分次のスライディングウィンドウ（docs/05 §8.7）。
// 🔴 `peek` が枠を消費しないことが要点である —— 消費すると、保留（DEFER）のたびに窓が詰まり、
//    復帰できなくなる。
import { describe, expect, it } from 'vitest';
import { InMemoryMinuteWindowCounter } from './minute-window.js';

const TENANT = 'tenant-a';
const T0 = new Date('2026-09-05T03:00:00.000Z');

function plus(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

describe('InMemoryMinuteWindowCounter（docs/05 §8.7）', () => {
  it('🔴 peek は枠を消費しない（何回呼んでも件数が増えない）', async () => {
    const counter = new InMemoryMinuteWindowCounter();
    await counter.record(TENANT, T0);
    expect((await counter.peek(TENANT, T0)).count).toBe(1);
    expect((await counter.peek(TENANT, T0)).count).toBe(1);
  });

  it('60 秒を過ぎた記録は窓から外れる', async () => {
    const counter = new InMemoryMinuteWindowCounter();
    await counter.record(TENANT, T0);
    await counter.record(TENANT, plus(30_000));
    expect((await counter.peek(TENANT, plus(61_000))).count).toBe(1);
    expect((await counter.peek(TENANT, plus(91_000))).count).toBe(0);
  });

  it('最も古い記録の時刻を返す（retryAfterSec の根拠になる）', async () => {
    const counter = new InMemoryMinuteWindowCounter();
    await counter.record(TENANT, T0);
    await counter.record(TENANT, plus(10_000));
    expect((await counter.peek(TENANT, plus(20_000))).oldestAt).toEqual(T0);
  });

  it('窓が空なら oldestAt は null', async () => {
    const counter = new InMemoryMinuteWindowCounter();
    expect(await counter.peek(TENANT, T0)).toEqual({ count: 0, oldestAt: null });
  });

  it('🔴 テナントごとに独立している（他テナントの送信で待たされない）', async () => {
    const counter = new InMemoryMinuteWindowCounter();
    await counter.record('tenant-a', T0);
    await counter.record('tenant-a', T0);
    expect((await counter.peek('tenant-b', T0)).count).toBe(0);
  });
});
