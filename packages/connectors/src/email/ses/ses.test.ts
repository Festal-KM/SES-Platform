// packages/connectors/src/email/ses/ses.test.ts
// 🔴 実 SES を叩かない（モックの `SesApi` を注入する）。固定するのは次の 5 点である:
//   ① `BR-51`: 取引先へ届く分類で `fromDomain` が無いと**送信要求そのものが起きない**
//   ② docs/05 §8.3: `SendEmail` に `TenantName` と `FromEmailAddress` を必ず渡す
//   ③ docs/05 §8.3-Q ③: 実送信成功のたびに手元の 24h カウンタが増える（失敗では増えない）
//   ④ docs/05 §15.4: SES の例外が内部型へ正規化される（日次枠だけが保留になる）
//   ⑤ `GetAccount` の 60 秒キャッシュ（送信のたびに叩かない）
import { describe, expect, it, vi } from 'vitest';
import { SendingDomainRequiredError, ProviderQuotaExceededError } from '../../errors.js';
import type { EmailSendInput } from '../../interfaces.js';
import type { DispatchToken, VerifiedSendingDomain } from '../../types.js';
import { dispatchTokenFor } from '../../types.js';
import type { SesApi, SesSendEmailRequest } from './api.js';
import { InMemoryProviderSendCounter } from './counter.js';
import { ExternalSendError } from './errors.js';
import { SES_QUOTA_CACHE_TTL_MS, SesEmailSender, resolveFromAddress } from './ses.js';

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-05T03:00:00.000Z');

const TOKEN: DispatchToken = dispatchTokenFor({
  dispatchId: '01930000-0000-7000-8000-000000000901',
  dedupeKey: 'ACCOUNT_INVITATION:target:abc0123456789def',
});

const VERIFIED: VerifiedSendingDomain = {
  domain: 'example.co.jp',
  mailFromDomain: 'mail.example.co.jp',
  verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
};

function makeApi(overrides: Partial<SesApi> = {}) {
  const sendEmail = vi.fn(async (request: SesSendEmailRequest) => {
    void request;
    return { MessageId: 'ses-msg-1' };
  });
  const getAccount = vi.fn(async () => ({
    SendQuota: { Max24HourSend: 200, SentLast24Hours: 12 },
  }));
  return { sendEmail, getAccount, ...overrides } as SesApi & {
    sendEmail: typeof sendEmail;
    getAccount: typeof getAccount;
  };
}

function makeSender(api: SesApi, now: () => Date = () => NOW) {
  const sentCounter = new InMemoryProviderSendCounter();
  const sender = new SesEmailSender({
    api,
    defaultFromAddress: 'no-reply@ses-platform.example',
    configurationSet: 'ses-platform-test',
    sentCounter,
    now,
  });
  return { sender, sentCounter };
}

function input(overrides: Partial<EmailSendInput> = {}): EmailSendInput {
  return {
    recipientClass: 'HOST_MEMBER',
    to: 'owner@example.co.jp',
    templateKey: 'ACCOUNT_INVITATION',
    params: { link: 'https://app.example/invitations/tok' },
    tenantId: TENANT_ID,
    fromDomain: null,
    token: TOKEN,
    ...overrides,
  };
}

describe('🔴 送信元ドメインのガード（BR-51 / docs/05 §8.3）', () => {
  it.each(['PARTNER_MEMBER', 'CLIENT', 'ENGINEER'] as const)(
    '分類 %s に fromDomain=null で送ろうとすると、SES を 1 回も呼ばずに throw する',
    async (recipientClass) => {
      const api = makeApi();
      const { sender } = makeSender(api);
      await expect(sender.send(input({ recipientClass, fromDomain: null }))).rejects.toBeInstanceOf(
        SendingDomainRequiredError,
      );
      expect(api.sendEmail).not.toHaveBeenCalled();
      expect(sender.callCount()).toBe(0);
    },
  );

  it('分類 1 / 分類外は共通ドメインで送れる（docs/03 §3.2.7 規律 2）', async () => {
    const api = makeApi();
    const { sender } = makeSender(api);
    await sender.send(input({ recipientClass: 'HOST_MEMBER' }));
    expect(api.sendEmail.mock.calls[0]?.[0].FromEmailAddress).toBe('no-reply@ses-platform.example');
  });

  it('🔴 検証済みの独自ドメインが渡されたら、ローカル部を保ったままそのドメインで送る', () => {
    expect(resolveFromAddress('no-reply@ses-platform.example', VERIFIED)).toBe(
      'no-reply@example.co.jp',
    );
  });
});

describe('SendEmail のリクエスト（docs/05 §8.3）', () => {
  it('🔴 TenantName（t-{tenantId}）と ConfigurationSet を必ず渡す', async () => {
    const api = makeApi();
    const { sender } = makeSender(api);
    await sender.send(input({ recipientClass: 'PARTNER_MEMBER', fromDomain: VERIFIED }));

    const request = api.sendEmail.mock.calls[0]?.[0];
    expect(request?.TenantName).toBe(`t-${TENANT_ID}`);
    expect(request?.ConfigurationSetName).toBe('ses-platform-test');
    expect(request?.Destination.ToAddresses).toEqual(['owner@example.co.jp']);
    expect(request?.Content.Template.TemplateName).toBe('ACCOUNT_INVITATION');
  });

  it('運営者宛（tenantId=null）は TenantName を**付けない**（空文字を渡さない）', async () => {
    const api = makeApi();
    const { sender } = makeSender(api);
    await sender.send(input({ recipientClass: 'PLATFORM', tenantId: null }));
    expect(api.sendEmail.mock.calls[0]?.[0]).not.toHaveProperty('TenantName');
  });
});

describe('🔴 送信基盤の 24h カウンタ（docs/05 §8.3-Q ③）', () => {
  it('実送信が成功したときだけ加算される', async () => {
    const api = makeApi();
    const { sender, sentCounter } = makeSender(api);
    await sender.send(input());
    await sender.send(input());
    expect(await sentCounter.countLast24h(NOW)).toBe(2);
    expect(sender.callCount()).toBe(2);
  });

  it('🔴 送信に失敗したら加算しない（枠を消費していないため）', async () => {
    const api = makeApi({
      sendEmail: vi.fn(async () => {
        throw { name: 'MessageRejected', message: 'rejected', $metadata: { httpStatusCode: 400 } };
      }),
    });
    const { sender, sentCounter } = makeSender(api);
    await expect(sender.send(input())).rejects.toBeInstanceOf(ExternalSendError);
    expect(await sentCounter.countLast24h(NOW)).toBe(0);
    expect(sender.callCount()).toBe(0);
  });

  it('24 時間より古い記録は窓から外れる', async () => {
    const api = makeApi();
    const { sender, sentCounter } = makeSender(api);
    await sender.send(input());
    const nextDay = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    expect(await sentCounter.countLast24h(nextDay)).toBe(0);
  });

  /**
   * 🔴 T-04-04 の申し送り 1（T-04-05 で修正）。
   *
   * ここへ来た時点で `SendEmail` は成功しており `MessageId` を受け取っている。
   * カウンタ（Redis）の一時障害で throw すると、`performEmailSend` の⑦が `UNKNOWN` として
   * `EmailDispatch` を `FAILED` に確定させ、**実際には届いている 1 通が「失敗」として記録される**。
   * その記録は人間の再送（`F-023`）を誘発し、**二重送信**（`CLAUDE.md` §7 の 0 件）につながる。
   * 取りこぼしは `consumed = max(local, provider)` が吸収する（docs/05 §8.3-Q ②）。
   */
  it('🔴 カウンタの加算が失敗しても送信は成功のままである（届いた 1 通を失敗にしない）', async () => {
    const api = makeApi();
    const failing = new InMemoryProviderSendCounter();
    vi.spyOn(failing, 'record').mockRejectedValue(new Error('redis unavailable'));
    const sender = new SesEmailSender({
      api,
      defaultFromAddress: 'no-reply@ses-platform.example',
      configurationSet: 'ses-platform-test',
      sentCounter: failing,
      now: () => NOW,
    });

    await expect(sender.send(input())).resolves.toEqual({ externalId: 'ses-msg-1' });
    // 🔴 外部への到達は 1 回として数えられている（`callCount()` は送信の事実であり、
    //    カウンタの記録可否とは別物である）。
    expect(sender.callCount()).toBe(1);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('例外の正規化（docs/05 §8.3-Q ⑤ / §15.4）', () => {
  it('🔴 日次枠超過は ProviderQuotaExceededError として外に出る（保留の入口）', async () => {
    const api = makeApi({
      sendEmail: vi.fn(async () => {
        throw { name: 'TooManyRequestsException', message: 'Daily message quota exceeded' };
      }),
    });
    const { sender } = makeSender(api);
    await expect(sender.send(input())).rejects.toBeInstanceOf(ProviderQuotaExceededError);
  });

  it('🔴 送信での 5xx は UNKNOWN として出る（`send` として分類させている証跡）', async () => {
    const api = makeApi({
      sendEmail: vi.fn(async () => {
        throw { name: 'ServiceUnavailableException', message: 'oops', $metadata: { httpStatusCode: 503 } };
      }),
    });
    const { sender } = makeSender(api);
    // 🔴 `TRANSIENT` だと `email.dispatch` の attempts: 3 に乗り、実は送信済みのケースで 2 通目が出る。
    await expect(sender.send(input())).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });

  it('読み取り（getQuota）での 5xx は TRANSIENT のまま（副作用が無いので再試行してよい）', async () => {
    const api = makeApi({
      getAccount: vi.fn(async () => {
        throw { name: 'ServiceUnavailableException', message: 'oops', $metadata: { httpStatusCode: 503 } };
      }),
    });
    const { sender } = makeSender(api);
    await expect(sender.getQuota()).rejects.toMatchObject({ kind: 'TRANSIENT' });
  });
});

describe('getQuota（docs/05 §8.1 / §8.3-Q ③）', () => {
  it('SES の SendQuota を内部型に正規化して返す', async () => {
    const api = makeApi();
    const { sender } = makeSender(api);
    expect(await sender.getQuota()).toEqual({
      max24h: 200,
      sentLast24h: 12,
      observedAt: NOW,
    });
  });

  it('🔴 60 秒はキャッシュする（GetAccount は 1 リクエスト / 秒の上限がある）', async () => {
    const api = makeApi();
    let current = NOW;
    const { sender } = makeSender(api, () => current);

    await sender.getQuota();
    current = new Date(NOW.getTime() + SES_QUOTA_CACHE_TTL_MS - 1);
    await sender.getQuota();
    expect(api.getAccount).toHaveBeenCalledTimes(1);

    current = new Date(NOW.getTime() + SES_QUOTA_CACHE_TTL_MS + 1);
    await sender.getQuota();
    expect(api.getAccount).toHaveBeenCalledTimes(2);
  });

  it('🔴 取得に失敗したら throw する（0 を返さない）', async () => {
    const api = makeApi({
      getAccount: vi.fn(async () => {
        throw { name: 'ThrottlingException', message: 'slow down' };
      }),
    });
    const { sender } = makeSender(api);
    await expect(sender.getQuota()).rejects.toBeInstanceOf(ExternalSendError);
  });
});
