// apps/worker/src/jobs/email-dispatch.test.ts
// 🔴 docs/05 §9.4: `email.dispatch` に `attempts: 3` を許す前提は
//    「payload の型が宛先分類 1 / 分類外しか載せられないこと」である。
//    型だけでなく**実行時の門番**でも同じことを固定する（payload は Redis 経由で来るため、
//    型は「書く側」しか守れない）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSendInput } from '@ses/connectors';

const readEmailDispatch = vi.fn();

vi.mock('@ses/db', () => ({
  readEmailDispatch,
  readEmailDailyCount: vi.fn(async () => 0),
  reserveEmailDailyQuota: vi.fn(async () => ({ allowed: true, value: 1 })),
  markEmailDispatchSent: vi.fn(async () => true),
  markEmailDispatchMocked: vi.fn(async () => true),
  holdEmailDispatch: vi.fn(async () => true),
  suppressEmailDispatch: vi.fn(async () => true),
  failEmailDispatch: vi.fn(async () => true),
  systemTenantCtx: (tenantId: string, job: { queue: string; jobId: string }) => ({
    tenantId,
    partnerCompanyId: null,
    userId: '',
    role: 'SALES',
    lifecycleState: 'ACTIVE',
    deviceKind: 'api',
    job,
  }),
}));

const { InMemoryMinuteWindowCounter, InMemoryProviderSendCounter } = await import('@ses/connectors');

const NOW = new Date('2026-09-05T03:00:00.000Z');
const {
  createEmailDispatchHandler,
  parseEmailDispatchPayload,
  PlatformDispatchNotSupportedError,
} = await import('./email-dispatch.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const DISPATCH_ID = '01930000-0000-7000-8000-000000000901';

const VALID = { dispatchId: DISPATCH_ID, tenantId: TENANT_ID, recipientClass: 'HOST_MEMBER' };

function makeHandler(resolveTemplateParams = vi.fn(async () => ({}))) {
  const send = vi.fn(async (input: EmailSendInput) => {
    void input;
    return { externalId: 'ses-1' };
  });
  const handler = createEmailDispatchHandler({
    emailSender: {
      send,
      callCount: () => send.mock.calls.length,
      // 🔴 `getQuota()` の契約は「値か throw」（`undefined` を返さない。docs/05 §8.1）。
      getQuota: vi.fn(async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW })),
    },
    emailImplementationKind: 'real',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    // 🔴 T-04-04: 送信基盤（環境全体）の枠（docs/05 §8.3-Q）。枯渇の検証は email-send.test.ts。
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: vi.fn(async () => null),
    now: () => NOW,
    resolveTemplateParams,
  } as never);
  return { handler, send };
}

beforeEach(() => {
  readEmailDispatch.mockReset();
  readEmailDispatch.mockResolvedValue({
    dispatchId: DISPATCH_ID,
    status: 'QUEUED',
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.co.jp',
    templateKey: 'TENANT_CLOSING_NOTICE',
    dedupeKey: 'TENANT_CLOSING_NOTICE:t:abcdef0123456789',
  });
});

describe('🔴 parseEmailDispatchPayload（docs/05 §9.4）', () => {
  it('分類 1（HOST_MEMBER）と分類外（PLATFORM）は通る', () => {
    expect(parseEmailDispatchPayload(VALID).recipientClass).toBe('HOST_MEMBER');
    expect(
      parseEmailDispatchPayload({ ...VALID, tenantId: null, recipientClass: 'PLATFORM' }).tenantId,
    ).toBeNull();
  });

  it('🔴 T-05-08: 分類 2（PARTNER_MEMBER）も通る（F-011 処理④ の周知が片側だけにならない）', () => {
    // ⚠️ 「載せられる」と「`sandbox` で実送信される」は別物である ——
    //    後者は `isMockedDelivery`（`HOST_OR_PLATFORM_RECIPIENT_CLASSES`）が決め、分類 2 はモック。
    expect(parseEmailDispatchPayload({ ...VALID, recipientClass: 'PARTNER_MEMBER' }).recipientClass).toBe(
      'PARTNER_MEMBER',
    );
  });

  it.each(['CLIENT', 'ENGINEER', undefined, 'HOST', ''])(
    '🔴 分類 %s は受け付けない（業務上の外部送信が attempts:3 に載らない = BR-21）',
    (recipientClass) => {
      expect(() => parseEmailDispatchPayload({ ...VALID, recipientClass })).toThrow(
        InvalidJobPayloadError,
      );
    },
  );

  it.each([null, {}, { ...VALID, dispatchId: 'nope' }, { ...VALID, tenantId: 'nope' }])(
    '不正な payload を既定値で補完せず例外にする',
    (raw) => {
      expect(() => parseEmailDispatchPayload(raw)).toThrow(InvalidJobPayloadError);
    },
  );
});

describe('createEmailDispatchHandler', () => {
  it('DB の行から宛先を読んで送る（payload に宛先・本文を載せない）', async () => {
    const { handler, send } = makeHandler();
    const outcome = await handler(VALID, 'j-1');
    expect(outcome).toEqual({ kind: 'SENT', externalId: 'ses-1' });
    expect(send.mock.calls[0]?.[0].to).toBe('owner@example.co.jp');
  });

  it('🔴 運営者宛（tenantId=null）はまだ経路が無いので明示的に失敗させる', async () => {
    const { handler, send } = makeHandler();
    await expect(
      handler({ ...VALID, tenantId: null, recipientClass: 'PLATFORM' }, 'j-1'),
    ).rejects.toBeInstanceOf(PlatformDispatchNotSupportedError);
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 行が無ければ黙って成功させない', async () => {
    readEmailDispatch.mockResolvedValue(null);
    const { handler } = makeHandler();
    await expect(handler(VALID, 'j-1')).rejects.toThrow(InvalidJobPayloadError);
  });

  it('差し込み値は注入された解決関数から来る（空を既定にしない）', async () => {
    const resolveTemplateParams = vi.fn(async () => ({ tenantName: '架空商事' }));
    const { handler, send } = makeHandler(resolveTemplateParams);
    await handler(VALID, 'j-1');
    expect(resolveTemplateParams).toHaveBeenCalledWith({
      templateKey: 'TENANT_CLOSING_NOTICE',
      dispatchId: DISPATCH_ID,
    });
    expect(send.mock.calls[0]?.[0].params).toEqual({ tenantName: '架空商事' });
  });
});
