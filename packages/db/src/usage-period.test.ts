// packages/db/src/usage-period.test.ts
// 🔴 「期間キー（domain）」と「境界の時刻（ここ）」が同じ暦を指していることの対照。T-07-04。
//
// 定義が 2 パッケージに割れているのは domain の純粋性検査（`Date` を生成できない）による。
// 割れたまま静かにずれないよう、**キーが切り替わる瞬間**で突き合わせる。
import { usagePeriodKey } from '@ses/domain';
import { describe, expect, it } from 'vitest';
import { usagePeriodResetAt } from './usage-period.js';

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
