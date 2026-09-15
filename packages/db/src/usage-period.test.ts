// packages/db/src/usage-period.test.ts
// 🔴 「期間キー（domain）」と「境界の時刻（ここ）」が同じ暦を指していることの対照。T-07-04。
//
// 定義が 2 パッケージに割れているのは domain の純粋性検査（`Date` を生成できない）による。
// 割れたまま静かにずれないよう、**キーが切り替わる瞬間**で突き合わせる。
import { usagePeriodKey } from '@ses/domain';
import { describe, expect, it } from 'vitest';
import { usagePeriodRange, usagePeriodResetAt } from './usage-period.js';

describe('usagePeriodResetAt（`F-027` の resetAt）', () => {
  it('DAY は JST の翌 0 時（UTC ではその日の 15:00）', () => {
    expect(usagePeriodResetAt('DAY', new Date('2026-09-07T16:00:00.000Z')).toISOString()).toBe(
      '2026-09-08T15:00:00.000Z',
    );
  });

  it('MONTH は JST の翌月 1 日 0 時', () => {
    expect(usagePeriodResetAt('MONTH', new Date('2026-09-07T16:00:00.000Z')).toISOString()).toBe(
      '2026-09-30T15:00:00.000Z',
    );
  });

  it('月またぎ・年またぎでも次の期間の開始になる', () => {
    expect(usagePeriodResetAt('DAY', new Date('2026-09-30T14:59:59.999Z')).toISOString()).toBe(
      '2026-09-30T15:00:00.000Z',
    );
    expect(usagePeriodResetAt('MONTH', new Date('2026-12-31T14:00:00.000Z')).toISOString()).toBe(
      '2026-12-31T15:00:00.000Z',
    );
  });

  it('🔴 キーの切り替わる瞬間と一致する（暦の出所が 1 つであることの対照）', () => {
    for (const kind of ['DAY', 'MONTH'] as const) {
      for (const iso of [
        '2026-09-07T16:00:00.000Z',
        '2026-09-30T14:59:59.999Z',
        '2026-12-31T15:00:00.000Z',
        '2027-02-28T15:00:00.000Z',
        '2028-02-28T16:00:00.000Z', // 閏年の 2 月 29 日
      ]) {
        const at = new Date(iso);
        const resetAt = usagePeriodResetAt(kind, at);
        expect(usagePeriodKey(kind, new Date(resetAt.getTime() - 1))).toBe(usagePeriodKey(kind, at));
        expect(usagePeriodKey(kind, resetAt)).not.toBe(usagePeriodKey(kind, at));
      }
    }
  });

  it('不正な日時は例外にする（暦の出所である usagePeriodKey が弾く）', () => {
    expect(() => usagePeriodResetAt('DAY', new Date('not-a-date'))).toThrow(RangeError);
  });
});

// 🔴 T-10-02: 期間キー → 時刻範囲（`usage.daily-rollup` / `cost.monthly-rollup` が `ai_usage.started_at` を切る）。
describe('usagePeriodRange（キー → [startAt, endAt)）', () => {
  it('DAY: JST の 0 時から翌 0 時（UTC では前日 15:00 から当日 15:00）', () => {
    const range = usagePeriodRange('DAY', '2026-09-16');
    expect(range.startAt.toISOString()).toBe('2026-09-15T15:00:00.000Z');
    expect(range.endAt.toISOString()).toBe('2026-09-16T15:00:00.000Z');
  });

  it('MONTH: 月初 0 時から翌月初 0 時（年またぎを含む）', () => {
    const range = usagePeriodRange('MONTH', '2026-12');
    expect(range.startAt.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(range.endAt.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('🔴 範囲の先頭はそのキー、末尾の 1 ms 前もそのキー、末尾は次のキー（`usagePeriodKey` と同じ暦）', () => {
    for (const [kind, key] of [
      ['DAY', '2026-09-16'],
      ['DAY', '2028-02-29'],
      ['MONTH', '2026-09'],
      ['MONTH', '2026-12'],
    ] as const) {
      const range = usagePeriodRange(kind, key);
      expect(usagePeriodKey(kind, range.startAt)).toBe(key);
      expect(usagePeriodKey(kind, new Date(range.endAt.getTime() - 1))).toBe(key);
      expect(usagePeriodKey(kind, range.endAt)).not.toBe(key);
      // 境界は `usagePeriodResetAt` と一致する（同じ暦の 2 つの入口）。
      expect(range.endAt.toISOString()).toBe(usagePeriodResetAt(kind, range.startAt).toISOString());
    }
  });

  it('不正なキーは例外にする', () => {
    expect(() => usagePeriodRange('DAY', '2026-02-30')).toThrow(RangeError);
    expect(() => usagePeriodRange('MONTH', '2026-13')).toThrow(RangeError);
  });
});
