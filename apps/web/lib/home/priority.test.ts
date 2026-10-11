// apps/web/lib/home/priority.test.ts
// 🔴 優先度の**導出規則**を固定する（`./priority.ts`）。人間の仕様 2026-10-11。
//
// なぜ要るか: 優先度は `CLAUDE.md` §4.1 のモデルに無く、**期限と放置時間から導出している**。
// 導出規則が変わると画面の並びの読み方（「高いほど上」）が静かに変わるため、境界値を固定する。
// 🔴 **時刻を引数で受ける**（`Date.now()` を呼ばない）ので、時限爆弾にならない。
import { describe, expect, it } from 'vitest';
import { ACTION_QUEUE_STALE_AFTER_MS } from './action-queue-urgency';
import {
  HOME_PRIORITIES,
  PRIORITY_BADGE_VARIANTS,
  PRIORITY_DEADLINE_HIGH_MS,
  PRIORITY_DEADLINE_MEDIUM_MS,
  PRIORITY_ELAPSED_HIGH_MS,
  PRIORITY_ELAPSED_MEDIUM_MS,
  homeRowPriority,
} from './priority';

const NOW = Date.parse('2026-10-11T09:00:00+09:00');
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

describe('🔴 期限を持つ行（提案依頼）は期限までの残りで決まる', () => {
  it('期限超過は HIGH（残りが負）', () => {
    expect(homeRowPriority({ since: iso(-10 * 86_400_000), deadline: iso(-1) }, NOW)).toBe('HIGH');
  });

  it('残り 24 時間未満は HIGH（今日のうちに動かないと失う）', () => {
    expect(homeRowPriority({ since: iso(0), deadline: iso(PRIORITY_DEADLINE_HIGH_MS - 1) }, NOW)).toBe('HIGH');
  });

  it('残りちょうど 24 時間は MEDIUM（境界は「未満」で高くなる）', () => {
    expect(homeRowPriority({ since: iso(0), deadline: iso(PRIORITY_DEADLINE_HIGH_MS) }, NOW)).toBe('MEDIUM');
  });

  it('残り 3 日未満は MEDIUM / ちょうど 3 日以上は LOW', () => {
    expect(homeRowPriority({ since: iso(0), deadline: iso(PRIORITY_DEADLINE_MEDIUM_MS - 1) }, NOW)).toBe('MEDIUM');
    expect(homeRowPriority({ since: iso(0), deadline: iso(PRIORITY_DEADLINE_MEDIUM_MS) }, NOW)).toBe('LOW');
  });

  it('🔴 期限がある行では放置時間を見ない（期限が主たる尺度である）', () => {
    // 放置 30 日でも、期限が 5 日先なら LOW のままである。
    expect(
      homeRowPriority({ since: iso(-30 * 86_400_000), deadline: iso(5 * 86_400_000) }, NOW),
    ).toBe('LOW');
  });
});

describe('🔴 期限を持たない行（承認待ち / 差し戻し / 送信失敗 / 返信待ち）は放置時間で決まる', () => {
  it('放置 7 日超は HIGH / ちょうど 7 日は MEDIUM', () => {
    expect(homeRowPriority({ since: iso(-(PRIORITY_ELAPSED_HIGH_MS + 1)), deadline: null }, NOW)).toBe('HIGH');
    expect(homeRowPriority({ since: iso(-PRIORITY_ELAPSED_HIGH_MS), deadline: null }, NOW)).toBe('MEDIUM');
  });

  it('放置 3 日超は MEDIUM / ちょうど 3 日は LOW', () => {
    expect(homeRowPriority({ since: iso(-(PRIORITY_ELAPSED_MEDIUM_MS + 1)), deadline: null }, NOW)).toBe('MEDIUM');
    expect(homeRowPriority({ since: iso(-PRIORITY_ELAPSED_MEDIUM_MS), deadline: null }, NOW)).toBe('LOW');
  });

  it('今日の行は LOW', () => {
    expect(homeRowPriority({ since: iso(-3_600_000), deadline: null }, NOW)).toBe('LOW');
  });
});

describe('🔴 閾値は「色が付く閾値」と同じ 1 定数から来る（印とバッジが食い違わない）', () => {
  it('中の境界は `ACTION_QUEUE_STALE_AFTER_MS` と同一である', () => {
    expect(PRIORITY_DEADLINE_MEDIUM_MS).toBe(ACTION_QUEUE_STALE_AFTER_MS);
    expect(PRIORITY_ELAPSED_MEDIUM_MS).toBe(ACTION_QUEUE_STALE_AFTER_MS);
  });
});

describe('⚠️ 壊れた時刻で落ちない（表示の印であり、判断そのものには使わない）', () => {
  it('解析できない値・NaN の基準時刻は LOW に倒す', () => {
    expect(homeRowPriority({ since: 'not-a-date', deadline: null }, NOW)).toBe('LOW');
    expect(homeRowPriority({ since: iso(0), deadline: 'not-a-date' }, NOW)).toBe('LOW');
    expect(homeRowPriority({ since: iso(-10 * 86_400_000), deadline: null }, Number.NaN)).toBe('LOW');
  });

  it('🔴 `deadline` が解析できないときは `since` に落ちる（黙って HIGH にしない）', () => {
    expect(homeRowPriority({ since: iso(-(PRIORITY_ELAPSED_HIGH_MS + 1)), deadline: 'x' }, NOW)).toBe('HIGH');
  });
});

describe('🔴 色の写像（状態ではなく優先度である）', () => {
  it('3 段すべてに variant が在り、`StatusBadge` の状態名を 1 つも使っていない', () => {
    expect(Object.keys(PRIORITY_BADGE_VARIANTS).sort()).toEqual([...HOME_PRIORITIES].sort());
    expect(PRIORITY_BADGE_VARIANTS.HIGH).toBe('danger');
    expect(PRIORITY_BADGE_VARIANTS.MEDIUM).toBe('warning');
    expect(PRIORITY_BADGE_VARIANTS.LOW).toBe('neutral');
  });

  it('🔴 段は 3 つだけ（4 段目を作らない）', () => {
    expect(HOME_PRIORITIES).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });
});
