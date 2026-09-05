// packages/domain/src/quota/email-rate.test.ts
// 🔴 `F-027 AC-2` / docs/05 §8.7: 日次超過（停止）と分次超過（待機）が**別の結論**になること。
import { describe, expect, it } from 'vitest';
import { decideEmailRate, EMAIL_MINUTE_WINDOW_MS } from './email-rate.js';

const NOW = new Date('2026-09-05T03:00:00.000Z');

const base = {
  dailyLimit: 500,
  dailySent: 0,
  minuteLimit: 30,
  minuteSent: 0,
  minuteWindowOldestAt: null,
  now: NOW,
} as const;

describe('decideEmailRate（docs/05 §8.7 / F-027 AC-2）', () => {
  it('上限に達していなければ ALLOW（残量を返す）', () => {
    expect(decideEmailRate({ ...base, dailySent: 10 })).toEqual({
      kind: 'ALLOW',
      dailyRemaining: 490,
    });
  });

  it('🔴 日次上限のちょうど 1 通手前までは ALLOW（500 通目は送れる）', () => {
    expect(decideEmailRate({ ...base, dailySent: 499 })).toEqual({
      kind: 'ALLOW',
      dailyRemaining: 1,
    });
  });

  it('🔴 日次上限に達したら BLOCK（501 通目は送らない）', () => {
    expect(decideEmailRate({ ...base, dailySent: 500 })).toEqual({ kind: 'BLOCK', dailyLimit: 500 });
  });

  it('🔴 日次超過は DEFER にならない（待っても解消しないため）', () => {
    const decision = decideEmailRate({
      ...base,
      dailySent: 500,
      minuteSent: 30,
      minuteWindowOldestAt: new Date(NOW.getTime() - 10_000),
    });
    expect(decision.kind).toBe('BLOCK');
  });

  it('🔴 分次上限に達したら DEFER（停止ではなく待機）', () => {
    const decision = decideEmailRate({
      ...base,
      minuteSent: 30,
      minuteWindowOldestAt: new Date(NOW.getTime() - 20_000),
    });
    // 最も古い 1 件がウィンドウを抜けるまで 40 秒。
    expect(decision).toEqual({ kind: 'DEFER', retryAfterSec: 40 });
  });

  it('分次上限で、最も古い送信がほぼウィンドウ端でも retryAfterSec は 0 にならない', () => {
    const decision = decideEmailRate({
      ...base,
      minuteSent: 30,
      minuteWindowOldestAt: new Date(NOW.getTime() - (EMAIL_MINUTE_WINDOW_MS - 1)),
    });
    expect(decision).toEqual({ kind: 'DEFER', retryAfterSec: 1 });
  });

  it('分次上限でウィンドウの最古が不明なら、ウィンドウ幅ぶん待つ', () => {
    const decision = decideEmailRate({ ...base, minuteSent: 30, minuteWindowOldestAt: null });
    expect(decision).toEqual({ kind: 'DEFER', retryAfterSec: 60 });
  });

  it('分次上限で、既にウィンドウを抜けているはずの時刻でも上限（60 秒）を超えない', () => {
    const decision = decideEmailRate({
      ...base,
      minuteSent: 30,
      minuteWindowOldestAt: new Date(NOW.getTime() + 120_000),
    });
    expect(decision).toEqual({ kind: 'DEFER', retryAfterSec: 60 });
  });

  it('上限値が不正なら例外（黙って既定値に倒さない）', () => {
    expect(() => decideEmailRate({ ...base, dailyLimit: 0 })).toThrow(RangeError);
    expect(() => decideEmailRate({ ...base, minuteLimit: 1.5 })).toThrow(RangeError);
    expect(() => decideEmailRate({ ...base, dailySent: -1 })).toThrow(RangeError);
  });
});
