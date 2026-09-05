// packages/connectors/src/email/ses/events.test.ts
// 🔴 `CLAUDE.md` §3.4 / docs/05 §16.2: SES の通知を**正規化してから**保存する。
//    ここで固定するのは 3 点である:
//      ① 生アドレスが正規化結果に残らない（ハッシュだけ）
//      ② `dedupeKey` が「同じメール・同じ種別・同じ時刻」でだけ一致する（重複配信 = 1 行）
//      ③ 解釈できない通知を握り潰さない
import { describe, expect, it } from 'vitest';
import {
  hashRecipient,
  normalizeSesEvent,
  parseNormalizedEmailEvent,
  serializeNormalizedEmailEvent,
  SesEventParseError,
  sesWebhookDedupeKey,
} from './events.js';

const BOUNCE = {
  eventType: 'Bounce',
  mail: {
    messageId: '0100018f-aaaa-bbbb-cccc-000000000001',
    timestamp: '2026-09-05T02:59:00.000Z',
    destination: ['partner@example.co.jp'],
  },
  bounce: {
    bounceType: 'Permanent',
    bounceSubType: 'General',
    timestamp: '2026-09-05T03:00:00.000Z',
    bouncedRecipients: [{ emailAddress: 'partner@example.co.jp', diagnosticCode: 'smtp; 550' }],
  },
};

const COMPLAINT = {
  notificationType: 'Complaint',
  mail: {
    messageId: '0100018f-aaaa-bbbb-cccc-000000000002',
    timestamp: '2026-09-05T02:00:00.000Z',
    destination: ['someone@example.com'],
  },
  complaint: {
    complaintFeedbackType: 'abuse',
    timestamp: '2026-09-05T02:05:00.000Z',
    complainedRecipients: [{ emailAddress: 'someone@example.com' }],
  },
};

describe('normalizeSesEvent（CLAUDE.md §3.4 / docs/05 §16.2）', () => {
  it('🔴 宛先はハッシュだけになり、生アドレスが残らない', () => {
    const event = normalizeSesEvent(BOUNCE);
    expect(event.recipientHashes).toEqual([hashRecipient('partner@example.co.jp')]);
    expect(JSON.stringify(event)).not.toContain('partner@example.co.jp');
  });

  it('種別ごとの詳細から発生時刻を取る（mail.timestamp ではなく bounce.timestamp）', () => {
    expect(normalizeSesEvent(BOUNCE).occurredAt.toISOString()).toBe('2026-09-05T03:00:00.000Z');
  });

  it('eventType でも notificationType でも同じ内部型になる（表記差を下流に持ち込まない）', () => {
    const event = normalizeSesEvent(COMPLAINT);
    expect(event.eventType).toBe('Complaint');
    expect(event.diagnostics).toEqual({ complaintFeedbackType: 'abuse' });
  });

  it('🔴 診断情報に PII を含めない（diagnosticCode のような自由文を拾わない）', () => {
    expect(normalizeSesEvent(BOUNCE).diagnostics).toEqual({
      bounceType: 'Permanent',
      bounceSubType: 'General',
    });
  });

  it('詳細が宛先を持たない種別は mail.destination に落ちる', () => {
    const event = normalizeSesEvent({
      eventType: 'Delivery',
      mail: {
        messageId: 'm-1',
        timestamp: '2026-09-05T01:00:00.000Z',
        destination: ['host@example.co.jp'],
      },
      delivery: { timestamp: '2026-09-05T01:00:05.000Z' },
    });
    expect(event.recipientHashes).toEqual([hashRecipient('host@example.co.jp')]);
  });

  it.each<{ readonly label: string; readonly raw: unknown }>([
    { label: 'オブジェクトではない', raw: null },
    { label: 'eventType が無い', raw: { mail: {} } },
    {
      label: '未知の種別',
      raw: { eventType: 'Whatever', mail: { messageId: 'm', timestamp: '2026-09-05T00:00:00Z' } },
    },
    { label: 'mail が無い', raw: { eventType: 'Bounce' } },
    { label: 'messageId が無い', raw: { eventType: 'Bounce', mail: { timestamp: '2026-09-05T00:00:00Z' } } },
    { label: 'timestamp が無い', raw: { eventType: 'Bounce', mail: { messageId: 'm' } } },
  ])('🔴 解釈できない通知（$label）を握り潰さず例外にする', ({ raw }) => {
    expect(() => normalizeSesEvent(raw)).toThrow(SesEventParseError);
  });
});

describe('sesWebhookDedupeKey（docs/05 §8.5）', () => {
  it('🔴 同じ通知の再送は同じキー（重複配信で 1 行に収束する）', () => {
    expect(sesWebhookDedupeKey(normalizeSesEvent(BOUNCE))).toBe(
      sesWebhookDedupeKey(normalizeSesEvent({ ...BOUNCE })),
    );
  });

  it('🔴 同じメールでも種別が違えば別のキー（バウンスと苦情を潰し合わない）', () => {
    const bounce = sesWebhookDedupeKey(normalizeSesEvent(BOUNCE));
    const asComplaint = sesWebhookDedupeKey(
      normalizeSesEvent({
        ...BOUNCE,
        eventType: 'Complaint',
        complaint: { timestamp: '2026-09-05T03:00:00.000Z', complainedRecipients: [] },
      }),
    );
    expect(bounce).not.toBe(asComplaint);
  });

  it('同じメール・同じ種別でも時刻が違えば別のキー（2 回目のバウンスは別の事象）', () => {
    const later = sesWebhookDedupeKey(
      normalizeSesEvent({
        ...BOUNCE,
        bounce: { ...BOUNCE.bounce, timestamp: '2026-09-05T04:00:00.000Z' },
      }),
    );
    expect(later).not.toBe(sesWebhookDedupeKey(normalizeSesEvent(BOUNCE)));
  });
});

describe('保存形との往復（docs/05 §3.9）', () => {
  it('serialize → parse で同じ内部型に戻る', () => {
    const event = normalizeSesEvent(BOUNCE);
    const restored = parseNormalizedEmailEvent(
      JSON.parse(JSON.stringify(serializeNormalizedEmailEvent(event))),
    );
    expect(restored).toEqual(event);
  });

  it('🔴 保存形にも生アドレスが現れない', () => {
    const serialized = serializeNormalizedEmailEvent(normalizeSesEvent(BOUNCE));
    expect(JSON.stringify(serialized)).not.toContain('partner@example.co.jp');
  });

  it('壊れた保存形を握り潰さない', () => {
    expect(() => parseNormalizedEmailEvent({ sesMessageId: 'm' })).toThrow(SesEventParseError);
    expect(() =>
      parseNormalizedEmailEvent({ sesMessageId: 'm', eventType: 'Bounce', occurredAt: 'nope' }),
    ).toThrow(SesEventParseError);
  });
});
