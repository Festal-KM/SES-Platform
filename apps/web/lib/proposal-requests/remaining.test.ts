// apps/web/lib/proposal-requests/remaining.test.ts
// 返答期限までの残り時間の表示（`docs/04` §S-017「期限までの残り」）。T-08-06。純粋関数。
import { describe, expect, it } from 'vitest';
import { formatRemaining, type RemainingLabels } from './remaining';

const LABELS: RemainingLabels = {
  prefix: '残り ',
  days: ' 日',
  hours: ' 時間',
  minutes: ' 分',
  lessThanMinute: '1 分未満',
  expired: '期限を過ぎました',
};

const NOW = Date.parse('2026-09-15T03:00:00.000Z');
const HOUR = 3_600_000;

describe('formatRemaining', () => {
  it.each([
    ['7 日と少し', '2026-09-22T14:59:59.000Z', '残り 7 日'],
    ['ちょうど 1 日', '2026-09-16T03:00:00.000Z', '残り 1 日'],
    ['23 時間 59 分', '2026-09-16T02:59:00.000Z', '残り 23 時間'],
    ['1 時間', '2026-09-15T04:00:00.000Z', '残り 1 時間'],
    ['59 分', '2026-09-15T03:59:00.000Z', '残り 59 分'],
    ['1 分', '2026-09-15T03:01:00.000Z', '残り 1 分'],
    ['30 秒', '2026-09-15T03:00:30.000Z', '残り 1 分未満'],
  ])('%s → %s', (_label, iso, expected) => {
    expect(formatRemaining(iso, NOW, LABELS)).toBe(expected);
  });

  it('期限と同時刻・過去は「期限を過ぎました」', () => {
    expect(formatRemaining('2026-09-15T03:00:00.000Z', NOW, LABELS)).toBe('期限を過ぎました');
    expect(formatRemaining('2026-09-14T03:00:00.000Z', NOW, LABELS)).toBe('期限を過ぎました');
  });

  it('決定的である（同じ入力で同じ出力。現在時刻を内部で読まない）', () => {
    const results = new Set(
      Array.from({ length: 10 }, () => formatRemaining('2026-09-20T03:00:00.000Z', NOW + HOUR, LABELS)),
    );
    expect([...results]).toEqual(['残り 4 日']);
  });

  it('解析できない値はそのまま返す（握り潰さない）', () => {
    expect(formatRemaining('not-a-date', NOW, LABELS)).toBe('not-a-date');
  });
});
