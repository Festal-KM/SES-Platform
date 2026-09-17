// packages/connectors/src/mock/email.test.ts
// docs/05 §13.2 / §8.3 / §8.3-Q。🔴 これは E2E と共用する実装であり、ここでの振る舞いが
// そのまま `development` / `demo` の振る舞いになる。
import { describe, expect, it } from 'vitest';

import { MOCK_EMAIL_PROVIDER_CODES } from '../email/mock-script.js';
import { ExternalSendError } from '../email/ses/errors.js';
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

  // ✅ T-09-07: 応答不明 / ネットワーク断 / 明示的拒否の再現（docs/05 §13.2 / §10.6 / §15.4）。
  describe('script（T-09-07。応答不明とネットワーク断を区別して再現する）', () => {
    async function sendExpectingError(sender: MockEmailSender, overrides: Partial<EmailSendInput> = {}): Promise<unknown> {
      try {
        await sender.send(input(overrides));
      } catch (error) {
        return error;
      }
      throw new Error('送信が成功してしまった');
    }

    it('🔴 unknown: 受け付けた後に応答が返らない。記録と sink に**残る**（届いた可能性がある）うえで ExternalSendError(UNKNOWN) を投げる', async () => {
      const written: EmailSendInput[] = [];
      const sink: MockEmailSink = {
        async write(value) {
          written.push(value);
        },
      };
      const sender = new MockEmailSender({ sink, script: [{ kind: 'unknown' }] });
      const error = await sendExpectingError(sender, { recipientClass: 'CLIENT', fromDomain: verifiedDomain });
      expect(error).toBeInstanceOf(ExternalSendError);
      expect((error as ExternalSendError).kind).toBe('UNKNOWN');
      expect((error as ExternalSendError).providerCode).toBe(MOCK_EMAIL_PROVIDER_CODES.unknown);
      // 🔴 外部には届いた可能性がある = 呼び出しとして数える。sink にも 1 通（MailHog に「届いている」を再現する）。
      expect(sender.callCount()).toBe(1);
      expect(sender.callsOf('CLIENT')).toHaveLength(1);
      expect(written).toHaveLength(1);
      // 🔴 例外のメッセージに宛先を載せない。
      expect((error as Error).message).not.toContain('sales@');
    });

    it('🔴 unreachable: 送る前に失敗。記録も sink も**残らない**（届いていない）。ExternalSendError(TRANSIENT) = 受理されなかったことが確定', async () => {
      const written: EmailSendInput[] = [];
      const sink: MockEmailSink = {
        async write(value) {
          written.push(value);
        },
      };
      const sender = new MockEmailSender({ sink, script: [{ kind: 'unreachable' }] });
      const error = await sendExpectingError(sender);
      expect(error).toBeInstanceOf(ExternalSendError);
      expect((error as ExternalSendError).kind).toBe('TRANSIENT');
      expect((error as ExternalSendError).providerCode).toBe(MOCK_EMAIL_PROVIDER_CODES.unreachable);
      expect(sender.callCount()).toBe(0);
      expect(written).toHaveLength(0);
    });

    it('reject: 要求は届いた（callCount に数える）がメールは出ていない（sink に書かない）。ExternalSendError(PERMANENT)', async () => {
      const written: EmailSendInput[] = [];
      const sink: MockEmailSink = {
        async write(value) {
          written.push(value);
        },
      };
      const sender = new MockEmailSender({ sink, script: [{ kind: 'reject', providerCode: 'AccountSuspendedException' }] });
      const error = await sendExpectingError(sender);
      expect((error as ExternalSendError).kind).toBe('PERMANENT');
      expect((error as ExternalSendError).providerCode).toBe('AccountSuspendedException');
      expect(sender.callCount()).toBe(1);
      expect(written).toHaveLength(0);
    });

    it('台本は呼び出し順に消費され、尽きたら最後の 1 つを繰り返す（MockAnthropicClient と同じ規律）', async () => {
      const sender = new MockEmailSender({ script: [{ kind: 'unreachable' }, { kind: 'deliver' }, { kind: 'unknown' }] });
      await expect(sender.send(input())).rejects.toBeInstanceOf(ExternalSendError);
      expect(sender.callCount()).toBe(0);
      await expect(sender.send(input())).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
      expect(sender.callCount()).toBe(1);
      for (let i = 0; i < 3; i += 1) {
        const error = await sendExpectingError(sender);
        expect((error as ExternalSendError).kind).toBe('UNKNOWN');
      }
      expect(sender.callCount()).toBe(4);
    });

    it('台本が空 / 省略なら常に deliver（development / demo の常用の形。未設定を例外にしない）', async () => {
      const empty = new MockEmailSender({ script: [] });
      await expect(empty.send(input())).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
      const omitted = new MockEmailSender();
      await expect(omitted.send(input())).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
    });

    it('🔴 台本があっても送信元ドメインの判定（BR-51）は先に通る（分類 3 に fromDomain 無しは台本に関係なく throw、記録 0）', async () => {
      const sender = new MockEmailSender({ script: [{ kind: 'unknown' }] });
      await expect(sender.send(input({ recipientClass: 'CLIENT', fromDomain: null }))).rejects.toBeInstanceOf(
        SendingDomainRequiredError,
      );
      expect(sender.callCount()).toBe(0);
    });
  });

  // ✅ T-09-11: 宛先ドメイン別・試行番号で引く台本（E2E ハーネスが 1 プロセスの worker を全 spec で共有するため、
  //    呼び出し順で消費する台本では「何番目が応答不明か」が実行順に依存する。docs/05 §13.2 / §17.5）。
  describe('scriptByRecipientDomain（T-09-11。宛先ドメイン × 試行番号。無状態）', () => {
    const attempt = (attemptSeq: number) => ({ attemptSeq, idempotencyKey: `proposal:p:${String(attemptSeq)}` }) as unknown as EmailSendInput['token'];
    const toUnknownDomain = (attemptSeq: number, overrides: Partial<EmailSendInput> = {}) =>
      input({ recipientClass: 'CLIENT', fromDomain: verifiedDomain, to: `someone@Unknown-Once.example.test`, token: attempt(attemptSeq), ...overrides });
    const scripts = { 'unknown-once.example.test': [{ kind: 'unknown' as const }, { kind: 'deliver' as const }] };

    it('🔴 そのドメインへの試行 1 は unknown、試行 2 以降は deliver。何度呼んでも・どの順序でも同じ（順序消費しない）', async () => {
      const sender = new MockEmailSender({ scriptByRecipientDomain: scripts });
      // 試行 2 を先に送っても届く（順序ではなく試行番号で引いている）。ドメインの大小文字は無視する。
      await expect(sender.send(toUnknownDomain(2))).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
      for (let i = 0; i < 2; i += 1) {
        const error = await sender.send(toUnknownDomain(1)).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ExternalSendError);
        expect((error as ExternalSendError).kind).toBe('UNKNOWN');
      }
      await expect(sender.send(toUnknownDomain(3))).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
      // unknown は「届いた可能性がある」ので記録に数える（順序消費の台本と同じ規律）。
      expect(sender.callCount()).toBe(4);
    });

    it('該当しないドメインは script（順序消費）に戻り、ドメイン別の送信は script のカーソルを進めない', async () => {
      const sender = new MockEmailSender({ script: [{ kind: 'unreachable' }, { kind: 'deliver' }], scriptByRecipientDomain: scripts });
      // ドメイン別の台本で決まった送信（試行 2 = deliver）は script を消費しない。
      await expect(sender.send(toUnknownDomain(2))).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
      // script の 1 手目（unreachable）はまだ残っている。
      const error = await sender.send(input()).catch((caught: unknown) => caught);
      expect((error as ExternalSendError).kind).toBe('TRANSIENT');
      await expect(sender.send(input())).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
    });

    it('DispatchToken（試行番号を持たない運用メール）は試行 1 として引く', async () => {
      const sender = new MockEmailSender({ scriptByRecipientDomain: scripts });
      const error = await sender
        .send(input({ to: 'owner@unknown-once.example.test', token: dispatchToken }))
        .catch((caught: unknown) => caught);
      expect((error as ExternalSendError).kind).toBe('UNKNOWN');
    });
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
