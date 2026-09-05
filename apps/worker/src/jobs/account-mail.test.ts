// apps/worker/src/jobs/account-mail.test.ts
// 🔴 docs/05 §9.4 / §16.2: **平文トークンの扱い**と、`dedupeKey` による「再試行しても 1 通」。
//
//   ① 🔴 payload の門番が分類 3 / 4 を受け付けない（分類が未指定の送信を成立させない）
//   ② 🔴 `dedupeKey` に**トークンのハッシュ**が入る（平文が DB に渡らない）
//   ③ 🔴 同じトークンなら同じ `dedupeKey`（再試行 = 1 通）、再発行なら別のキー（復帰できる）
//   ④ 平文トークンはテンプレートの差し込み値（メール本文のリンク）にだけ現れる
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSendInput } from '@ses/connectors';

const reserveEmailDispatch = vi.fn();
const readEmailDailyCount = vi.fn();
const reserveEmailDailyQuota = vi.fn();
const markEmailDispatchSent = vi.fn();

vi.mock('@ses/db', () => ({
  reserveEmailDispatch,
  readEmailDailyCount,
  reserveEmailDailyQuota,
  markEmailDispatchSent,
  markEmailDispatchMocked: vi.fn(async () => true),
  holdEmailDispatch: vi.fn(async () => true),
  suppressEmailDispatch: vi.fn(async () => true),
  failEmailDispatch: vi.fn(async () => true),
  // 実装（`packages/db/src/email-dispatch.ts`）と同じ規約でハッシュする。
  dispatchTokenHashPrefix: (token: string) =>
    createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16),
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

const { createHash } = await import('node:crypto');
const { InMemoryMinuteWindowCounter, InMemoryProviderSendCounter } = await import('@ses/connectors');
const { buildAccountMailLink, createAccountMailHandler, parseAccountMailPayload } = await import(
  './account-mail.js'
);
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const TARGET_ID = '01930000-0000-7000-8000-0000000000b2';
const TOKEN = 'invite-token-0001';
const NOW = new Date('2026-09-05T03:00:00.000Z');

const VALID = {
  tenantId: TENANT_ID,
  kind: 'INVITATION',
  targetId: TARGET_ID,
  recipientClass: 'HOST_MEMBER',
  token: TOKEN,
};

function makeHandler(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(async (input: EmailSendInput) => {
    void input;
    return { externalId: 'ses-1' };
  });
  const handler = createAccountMailHandler({
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
    appUrl: 'https://app.example.co.jp',
    resolveRecipientEmail: vi.fn(async () => 'owner@example.co.jp'),
    ...overrides,
  } as never);
  return { handler, send };
}

beforeEach(() => {
  for (const fn of [
    reserveEmailDispatch,
    readEmailDailyCount,
    reserveEmailDailyQuota,
    markEmailDispatchSent,
  ]) {
    fn.mockReset();
  }
  readEmailDailyCount.mockResolvedValue(0);
  reserveEmailDailyQuota.mockResolvedValue({ allowed: true, value: 1 });
  markEmailDispatchSent.mockResolvedValue(true);
  reserveEmailDispatch.mockImplementation(async (_ctx: unknown, input: Record<string, unknown>) => ({
    dispatchId: '01930000-0000-7000-8000-000000000901',
    dedupeKey: input.dedupeKey,
    created: true,
    status: 'QUEUED',
    recipientClass: input.recipientClass,
    recipientEmail: input.recipientEmail,
    templateKey: input.templateKey,
  }));
});

describe('🔴 ① payload の門番（docs/05 §8.2 / §9.4）', () => {
  it('分類 1 / 2 は通る', () => {
    expect(parseAccountMailPayload(VALID).recipientClass).toBe('HOST_MEMBER');
    expect(parseAccountMailPayload({ ...VALID, recipientClass: 'PARTNER_MEMBER' }).recipientClass).toBe(
      'PARTNER_MEMBER',
    );
  });

  it.each(['CLIENT', 'ENGINEER', 'PLATFORM', undefined, ''])(
    '🔴 分類 %s は受け付けない（業務上の外部送信を account.mail に載せない）',
    (recipientClass) => {
      expect(() => parseAccountMailPayload({ ...VALID, recipientClass })).toThrow(
        InvalidJobPayloadError,
      );
    },
  );

  it.each([
    { ...VALID, kind: 'SOMETHING' },
    { ...VALID, tenantId: 'nope' },
    { ...VALID, targetId: 'nope' },
    { ...VALID, token: '' },
    null,
  ])('不正な payload を既定値で補完せず例外にする', (raw) => {
    expect(() => parseAccountMailPayload(raw)).toThrow(InvalidJobPayloadError);
  });

  it('🔴 例外メッセージにトークンの値を載せない', () => {
    try {
      parseAccountMailPayload({ ...VALID, token: 123 });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('123');
      expect((error as Error).message).toContain('token');
    }
  });
});

describe('🔴 ② ③ dedupeKey（docs/05 §9.4）', () => {
  it('平文トークンではなくハッシュの先頭 16 桁が入る', async () => {
    const { handler } = makeHandler();
    await handler(VALID, 'j-1');
    const dedupeKey = reserveEmailDispatch.mock.calls[0]?.[1].dedupeKey as string;
    expect(dedupeKey).not.toContain(TOKEN);
    expect(dedupeKey).toBe(
      `INVITATION:${TARGET_ID}:${createHash('sha256').update(TOKEN, 'utf8').digest('hex').slice(0, 16)}`,
    );
  });

  it('🔴 同じトークンでの再試行は同じキー（= UNIQUE により 1 通に収束する）', async () => {
    const { handler } = makeHandler();
    await handler(VALID, 'j-1');
    await handler(VALID, 'j-1');
    const [first, second] = reserveEmailDispatch.mock.calls.map((call) => call[1].dedupeKey);
    expect(first).toBe(second);
  });

  it('🔴 トークンを再発行したら別のキーになる（保留からの復帰が重複扱いで消えない）', async () => {
    const { handler } = makeHandler();
    await handler(VALID, 'j-1');
    await handler({ ...VALID, token: 'reissued-token-0002' }, 'j-2');
    const [first, second] = reserveEmailDispatch.mock.calls.map((call) => call[1].dedupeKey);
    expect(first).not.toBe(second);
  });

  it('🔴 DB に渡る引数のどこにも平文トークンが現れない', async () => {
    const { handler } = makeHandler();
    await handler(VALID, 'j-1');
    expect(JSON.stringify(reserveEmailDispatch.mock.calls[0])).not.toContain(TOKEN);
    expect(JSON.stringify(markEmailDispatchSent.mock.calls[0])).not.toContain(TOKEN);
  });
});

describe('🔴 ④ 平文トークンの唯一の出口（メール本文のリンク）', () => {
  it('差し込み値にリンクとして現れる', async () => {
    const { handler, send } = makeHandler();
    await handler(VALID, 'j-1');
    expect(send.mock.calls[0]?.[0].params).toEqual({
      link: `https://app.example.co.jp/invitations/${TOKEN}`,
    });
  });

  it('パスワード再設定は別のパスになる', () => {
    expect(buildAccountMailLink('https://app.example.co.jp', 'PASSWORD_RESET', 'tok')).toBe(
      'https://app.example.co.jp/password-reset/confirm/tok',
    );
  });

  it('トークンは URL エンコードされる（パス区切りに化けない）', () => {
    expect(buildAccountMailLink('https://app.example.co.jp', 'INVITATION', 'a/b?c')).toBe(
      'https://app.example.co.jp/invitations/a%2Fb%3Fc',
    );
  });
});

describe('宛先が引き当てられない場合', () => {
  it('🔴 送らずに正常終了する（再試行しても直らない）', async () => {
    const { handler, send } = makeHandler({ resolveRecipientEmail: vi.fn(async () => null) });
    expect(await handler(VALID, 'j-1')).toEqual({ kind: 'ALREADY_SETTLED', status: 'NO_RECIPIENT' });
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
