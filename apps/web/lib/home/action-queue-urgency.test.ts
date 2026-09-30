// apps/web/lib/home/action-queue-urgency.test.ts
// 🔴 要対応キューの色の条件（T-22-09 / `docs/04` §S-003 改訂 16）。
//
// 固定するもの:
//   ① 期限超過（`期限` が過去）で色が付く
//   ② 経過時間が閾値（3 日）を超えて色が付く。**ちょうどでは付かない**
//   ③ 🔴 **それ以外では付かない**（種別・状態で色を決めない ——
//      50 行のうち大半が色付きになると色が意味を失う）
import { describe, expect, it } from 'vitest';
import { ACTION_QUEUE_STALE_AFTER_MS, isActionQueueRowUrgent } from './action-queue-urgency';

const NOW = Date.parse('2026-09-16T03:00:00.000Z');

describe('🔴 ① 期限超過', () => {
  it('期限が過去なら色が付く', () => {
    expect(isActionQueueRowUrgent({ since: '2026-09-16T02:00:00.000Z', deadline: '2026-09-16T02:59:00.000Z' }, NOW)).toBe(true);
  });

  it('期限が未来なら付かない（放置が短ければ）', () => {
    expect(isActionQueueRowUrgent({ since: '2026-09-16T02:00:00.000Z', deadline: '2026-09-18T00:00:00.000Z' }, NOW)).toBe(false);
  });
});

describe('🔴 ② 経過時間の閾値（3 日）', () => {
  it('閾値は 3 日である（画面ごとに別の値を持たない）', () => {
    expect(ACTION_QUEUE_STALE_AFTER_MS).toBe(3 * 86_400_000);
  });

  it('超えたら付く / ちょうどでは付かない', () => {
    const exact = new Date(NOW - ACTION_QUEUE_STALE_AFTER_MS).toISOString();
    const over = new Date(NOW - ACTION_QUEUE_STALE_AFTER_MS - 1).toISOString();
    expect(isActionQueueRowUrgent({ since: exact, deadline: null }, NOW)).toBe(false);
    expect(isActionQueueRowUrgent({ since: over, deadline: null }, NOW)).toBe(true);
  });
});

describe('🔴 ③ それ以外では付かない', () => {
  it('期限内・放置が短い行は付かない', () => {
    expect(isActionQueueRowUrgent({ since: '2026-09-16T02:15:00.000Z', deadline: null }, NOW)).toBe(false);
  });

  it('壊れた時刻は「付けない」に倒す（表示だけの判定であり、判断には使わない）', () => {
    expect(isActionQueueRowUrgent({ since: 'x', deadline: null }, NOW)).toBe(false);
    expect(isActionQueueRowUrgent({ since: '2026-09-01T00:00:00.000Z', deadline: 'x' }, NOW)).toBe(true);
    expect(isActionQueueRowUrgent({ since: '2026-09-01T00:00:00.000Z', deadline: null }, Number.NaN)).toBe(false);
  });

  it('未来の `since`（時計のずれ）でも付かない', () => {
    expect(isActionQueueRowUrgent({ since: '2026-09-20T00:00:00.000Z', deadline: null }, NOW)).toBe(false);
  });
});
