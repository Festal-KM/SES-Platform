// apps/web/lib/proposal-requests/expiry.test.ts
// 返答期限の画面側の扱い（JST の暦日 → その日の終わり）。T-08-06。純粋関数。
import { describe, expect, it } from 'vitest';
import { toJstIsoDay } from '../format/datetime';
import {
  expiresAtIsoFromJstDate,
  PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS,
  PROPOSAL_REQUEST_EXPIRY_MAX_DAYS,
  proposalRequestExpiryBounds,
} from './expiry';

describe('expiresAtIsoFromJstDate', () => {
  it('JST の暦日 → その日の 23:59:59 JST（UTC では同日 14:59:59）', () => {
    expect(expiresAtIsoFromJstDate('2026-09-22')).toBe('2026-09-22T14:59:59.000Z');
  });

  it.each(['2026/09/22', '2026-9-22', '2026-09-22T00:00', '', 'tomorrow', '2026-13-01'])(
    '🔴 形が違えば RangeError（値を message に載せない）: %s',
    (value) => {
      expect(() => expiresAtIsoFromJstDate(value)).toThrow(RangeError);
      try {
        expiresAtIsoFromJstDate(value);
      } catch (error) {
        if (value !== '') expect((error as Error).message).not.toContain(value);
      }
    },
  );
});

describe('proposalRequestExpiryBounds', () => {
  // 2026-09-15 03:00 UTC = 12:00 JST。
  const NOW = new Date('2026-09-15T03:00:00.000Z');

  it('初期値は 7 日後、下限は当日、上限は 29 日後（30 日後の日末は API の上限を超えうるため）', () => {
    expect(PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS).toBe(7);
    expect(PROPOSAL_REQUEST_EXPIRY_MAX_DAYS).toBe(30);
    expect(proposalRequestExpiryBounds(NOW, toJstIsoDay)).toEqual({
      defaultDay: '2026-09-22',
      minDay: '2026-09-15',
      maxDay: '2026-10-14',
    });
  });

  it('🔴 上限の日末を送っても API の「30 日以内」に収まる（時刻まで比較しても超えない）', () => {
    const { maxDay } = proposalRequestExpiryBounds(NOW, toJstIsoDay);
    const expiresAt = Date.parse(expiresAtIsoFromJstDate(maxDay));
    expect(expiresAt).toBeLessThanOrEqual(NOW.getTime() + PROPOSAL_REQUEST_EXPIRY_MAX_DAYS * 86_400_000);
    expect(expiresAt).toBeGreaterThan(NOW.getTime());
  });

  it('JST の日付境界（UTC 15:00 = JST 翌日 0:00）で日付が繰り上がる', () => {
    const bounds = proposalRequestExpiryBounds(new Date('2026-09-15T15:30:00.000Z'), toJstIsoDay);
    expect(bounds.minDay).toBe('2026-09-16');
    expect(bounds.defaultDay).toBe('2026-09-23');
  });
});
