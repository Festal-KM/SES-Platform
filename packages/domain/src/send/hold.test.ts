// packages/domain/src/send/hold.test.ts
// 保留の値集合と遅延判定（docs/05 §10.4 / §10.5）。T-09-06。
import { describe, expect, it } from 'vitest';
import {
  AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS,
  isAutoReleasableSendHoldReason,
  isSendHoldReasonKey,
  isSendStale,
  isTenantResolvableSendHoldReason,
  SEND_HOLD_REASON_KEYS,
} from './hold.js';

const T0 = new Date('2026-09-16T00:00:00.000Z');

function plusMinutes(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

describe('SEND_HOLD_REASON_KEYS（docs/05 §10.4 の 7 値）', () => {
  it('7 値ちょうどで、RATE_LIMIT と PROVIDER_QUOTA が別の値である', () => {
    expect(SEND_HOLD_REASON_KEYS).toHaveLength(7);
    expect(new Set(SEND_HOLD_REASON_KEYS).size).toBe(7);
    expect(SEND_HOLD_REASON_KEYS).toContain('RATE_LIMIT');
    expect(SEND_HOLD_REASON_KEYS).toContain('PROVIDER_QUOTA');
    expect(isSendHoldReasonKey('PROVIDER_QUOTA')).toBe(true);
    expect(isSendHoldReasonKey('HELD_PROVIDER_QUOTA')).toBe(false);
  });

  it('🔴 GATE_STALE だけが自動復帰の対象外である（§10.5）', () => {
    expect(isAutoReleasableSendHoldReason('GATE_STALE')).toBe(false);
    for (const key of SEND_HOLD_REASON_KEYS.filter((value) => value !== 'GATE_STALE')) {
      expect(isAutoReleasableSendHoldReason(key), key).toBe(true);
    }
    expect([...AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS].sort()).toEqual(
      SEND_HOLD_REASON_KEYS.filter((value) => value !== 'GATE_STALE').sort(),
    );
  });

  it('🔴 PROVIDER_QUOTA はテナント側で解消できない（S-038 への導線を出さない。F-059 AC-7）', () => {
    expect(isTenantResolvableSendHoldReason('PROVIDER_QUOTA')).toBe(false);
    expect(isTenantResolvableSendHoldReason('RATE_LIMIT')).toBe(true);
    expect(isTenantResolvableSendHoldReason('DOMAIN_UNVERIFIED')).toBe(true);
    expect(isTenantResolvableSendHoldReason('GATE_STALE')).toBe(false);
    expect(isTenantResolvableSendHoldReason('TENANT_SUSPENDED')).toBe(false);
  });
});

describe('isSendStale（docs/05 §10.2 ②-a / §10.5。既定 30 分）', () => {
  it('閾値ちょうどは送る（stale ではない）', () => {
    expect(isSendStale({ enqueuedAt: T0, now: plusMinutes(30), thresholdMinutes: 30 })).toBe(false);
  });

  it('閾値を超えたら見送る', () => {
    expect(isSendStale({ enqueuedAt: T0, now: new Date(plusMinutes(30).getTime() + 1), thresholdMinutes: 30 })).toBe(
      true,
    );
    expect(isSendStale({ enqueuedAt: T0, now: plusMinutes(31), thresholdMinutes: 30 })).toBe(true);
  });

  it('直後の実行は送る', () => {
    expect(isSendStale({ enqueuedAt: T0, now: plusMinutes(1), thresholdMinutes: 30 })).toBe(false);
  });

  it('🔴 閾値 0 / 負数 / 非整数は例外（全件保留・全件送信のどちらにも倒さない）', () => {
    expect(() => isSendStale({ enqueuedAt: T0, now: T0, thresholdMinutes: 0 })).toThrow(RangeError);
    expect(() => isSendStale({ enqueuedAt: T0, now: T0, thresholdMinutes: -1 })).toThrow(RangeError);
    expect(() => isSendStale({ enqueuedAt: T0, now: T0, thresholdMinutes: 1.5 })).toThrow(RangeError);
  });

  it('不正な日時は例外', () => {
    expect(() => isSendStale({ enqueuedAt: new Date('invalid'), now: T0, thresholdMinutes: 30 })).toThrow(RangeError);
  });
});
