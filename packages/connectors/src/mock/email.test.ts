// packages/connectors/src/mock/email.test.ts
// docs/05 §13.2 / §8.3 / §8.3-Q。🔴 これは E2E と共用する実装であり、ここでの振る舞いが
// そのまま `development` / `demo` の振る舞いになる。
import { describe, expect, it } from 'vitest';

import { SendingDomainRequiredError } from '../errors.js';
import type { EmailSendInput } from '../interfaces.js';
import type { DispatchToken, RecipientClass, VerifiedSendingDomain } from '../types.js';
import { MockEmailSender, redactEmailAddress, type MockEmailSink } from './email.js';

// 🔴 実際のトークンは packages/db の CAS + UNIQUE でしか作れない（docs/05 §10.2）。
//    テストでは型の穴を通さずに「予約済みである」という前提だけを再現する。
const dispatchToken = { dispatchId: 'd1', dedupeKey: 'k1' } as unknown as DispatchToken;

const verifiedDomain: VerifiedSendingDomain = {
  domain: 'example.co.jp',
  mailFromDomain: 'mail.example.co.jp',
  verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
};

function input(overrides: Partial<EmailSendInput> = {}): EmailSendInput {
  return {
    recipientClass: 'HOST_MEMBER',
    to: 'sales@example.co.jp',
    templateKey: 'INVITATION',
    params: {},
    tenantId: 't1',
    fromDomain: null,
    token: dispatchToken,
    ...overrides,
  };
}

describe('MockEmailSender', () => {
  it('送信を記録し callCount() / callsOf() で数えられる（docs/05 §17.4 の外部発信 0 件の検証）', async () => {
    const sender = new MockEmailSender();
    await sender.send(input({ recipientClass: 'HOST_MEMBER' }));
    await sender.send(input({ recipientClass: 'PLATFORM', to: 'ops@ses-platform.example' }));

    expect(sender.callCount()).toBe(2);
    expect(sender.callsOf('HOST_MEMBER')).toHaveLength(1);
    expect(sender.callsOf('PLATFORM')).toHaveLength(1);
    expect(sender.callsOf('CLIENT')).toHaveLength(0);
  });

  it('🔴 記録に平文の宛先を残さない（CLAUDE.md §3.5 / docs/05 §8.6 の denylist）', async () => {
    const sender = new MockEmailSender();
    await sender.send(input({ to: 'taro.yamada@example.co.jp' }));

    const [call] = sender.callsOf('HOST_MEMBER');
    expect(call?.to).toBe('***@example.co.jp');
    expect(JSON.stringify(sender.callsOf('HOST_MEMBER'))).not.toContain('taro.yamada');
  });

  it.each<RecipientClass>(['PARTNER_MEMBER', 'CLIENT', 'ENGINEER'])(
    '🔴 分類 %s に検証済みドメインなしで送ろうとすると throw する（共通ドメインへフォールバックしない。BR-51）',
    async (recipientClass) => {
      const sender = new MockEmailSender();
      await expect(sender.send(input({ recipientClass, fromDomain: null }))).rejects.toBeInstanceOf(
        SendingDomainRequiredError,
      );
      // 🔴 外部呼び出しに相当する記録も残らない（送っていないのに送ったことにしない）。
      expect(sender.callCount()).toBe(0);
    },
  );

  it.each<RecipientClass>(['PARTNER_MEMBER', 'CLIENT', 'ENGINEER'])(
    '分類 %s は検証済みドメインがあれば送れる',
    async (recipientClass) => {
      const sender = new MockEmailSender();
      await sender.send(input({ recipientClass, fromDomain: verifiedDomain }));
      expect(sender.callCount()).toBe(1);
    },
  );

  it.each<RecipientClass>(['HOST_MEMBER', 'PLATFORM'])(
    '分類 %s（共通ドメインでよい宛先）は fromDomain が null でも送れる（F-001 AC-5）',
    async (recipientClass) => {
      const sender = new MockEmailSender();
      await sender.send(input({ recipientClass, fromDomain: null }));
      expect(sender.callCount()).toBe(1);
    },
  );

  it('sink に元の入力を渡す（MailHog / EmailDispatch(MOCKED) の記録先）', async () => {
    const written: EmailSendInput[] = [];
    const sink: MockEmailSink = {
      async write(value) {
        written.push(value);
      },
    };
    const sender = new MockEmailSender({ sink });
    await sender.send(input({ to: 'owner@example.co.jp' }));

    expect(written).toHaveLength(1);
    expect(written[0]?.to).toBe('owner@example.co.jp');
  });

  it('externalId を返し、同じ値を返し続けない（送信ごとに 1 つ）', async () => {
    const sender = new MockEmailSender();
    const first = await sender.send(input());
    const second = await sender.send(input());
    expect(first.externalId).not.toBe(second.externalId);
    expect(first.externalId.startsWith('mock-')).toBe(true);
  });

  describe('getQuota（docs/05 §8.3-Q ③）', () => {
    it('🔴 既定では自身に枠が無い（実効上限は MAIL_PROVIDER_DAILY_QUOTA 側で決まる）', async () => {
      const sender = new MockEmailSender();
      const quota = await sender.getQuota();
      expect(quota.max24h).toBe(Number.MAX_SAFE_INTEGER);
      expect(quota.sentLast24h).toBe(0);
    });

    it('24 時間以内の送信だけを sentLast24h に数える', async () => {
      let now = new Date('2026-09-01T00:00:00.000Z');
      const sender = new MockEmailSender({ now: () => now, max24h: 200 });

      await sender.send(input());
      now = new Date('2026-09-01T12:00:00.000Z');
      await sender.send(input());
      expect((await sender.getQuota()).sentLast24h).toBe(2);

      // 1 通目が 24 時間より前になる時点まで進める。
      now = new Date('2026-09-02T06:00:00.000Z');
      const quota = await sender.getQuota();
      expect(quota.sentLast24h).toBe(1);
      expect(quota.max24h).toBe(200);
      expect(quota.observedAt).toEqual(now);
    });
  });
});

describe('redactEmailAddress', () => {
  it.each([
    ['taro@example.co.jp', '***@example.co.jp'],
    ['a.b+c@sub.example.com', '***@sub.example.com'],
    ['not-an-address', '***'],
  ])('%s → %s', (input_, expected) => {
    expect(redactEmailAddress(input_)).toBe(expected);
  });
});
