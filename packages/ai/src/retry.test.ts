// packages/ai/src/retry.test.ts
// 🔴 「LLM の再試行は runRole の内部で最大 2 回」（docs/05 §7.4）を、判定そのものの単位で固定する。
import { describe, expect, it } from 'vitest';
import { decideRetry, MAX_LLM_ATTEMPTS, RETRY_BACKOFF_MS } from './retry.js';

describe('decideRetry（docs/05 §7.4 / docs/03 §3.3.4-3）', () => {
  it('合計 3 回（初回 + 2 回）で打ち切る', () => {
    expect(MAX_LLM_ATTEMPTS).toBe(3);
    expect(decideRetry({ kind: 'TIMEOUT', attemptNo: 3, random: 0.5 })).toEqual({ retry: false });
  });

  it('SCHEMA / TIMEOUT / RATE は再試行する', () => {
    for (const kind of ['SCHEMA', 'TIMEOUT', 'RATE'] as const) {
      expect(decideRetry({ kind, attemptNo: 1, random: 0.5 }).retry).toBe(true);
    }
  });

  it('🔴 SPEND_CAP と API は再試行しない', () => {
    expect(decideRetry({ kind: 'SPEND_CAP', attemptNo: 1, random: 0.5 })).toEqual({ retry: false });
    expect(decideRetry({ kind: 'API', attemptNo: 1, random: 0.5 })).toEqual({ retry: false });
  });

  it('SCHEMA は待たない（サーバの混雑ではないため）', () => {
    expect(decideRetry({ kind: 'SCHEMA', attemptNo: 1, random: 0.99 })).toEqual({ retry: true, delayMs: 0 });
  });

  it('バックオフは 1s → 4s（ジッタ ±20%）', () => {
    expect(decideRetry({ kind: 'TIMEOUT', attemptNo: 1, random: 0.5 })).toEqual({ retry: true, delayMs: 1000 });
    expect(decideRetry({ kind: 'TIMEOUT', attemptNo: 2, random: 0.5 })).toEqual({ retry: true, delayMs: 4000 });
    expect(decideRetry({ kind: 'TIMEOUT', attemptNo: 1, random: 0 })).toEqual({ retry: true, delayMs: 800 });
    expect(decideRetry({ kind: 'TIMEOUT', attemptNo: 1, random: 0.999 })).toEqual({ retry: true, delayMs: 1200 });
    expect(RETRY_BACKOFF_MS).toEqual([1000, 4000]);
  });

  it('retry-after が長ければそちらを尊重する（短ければバックオフを使う）', () => {
    expect(decideRetry({ kind: 'RATE', attemptNo: 1, retryAfterMs: 9000, random: 0.5 })).toEqual({
      retry: true,
      delayMs: 9000,
    });
    expect(decideRetry({ kind: 'RATE', attemptNo: 2, retryAfterMs: 100, random: 0.5 })).toEqual({
      retry: true,
      delayMs: 4000,
    });
  });
});
