// apps/worker/src/jobs/domain-verify.test.ts
// 🔴 `domain.verify`（#72）と `domain.recheck`（毎日 05:30 JST）の検証（docs/05 §8.3 / §9.9）。
//
// 固定するのは 3 点である:
//   ① 「すべて `SUCCESS`」でのみ検証済みにする（部分成立で送信を許さない）
//   ② 未検証は **`FAILED` + `verified_at=NULL`**（＝ 失効。以後の送信は保留になる）であり、
//      ジョブは throw しない（状態であってエラーではない。`docs/04` 申し送り 8）
//   ③ `domain.recheck` が `state='VERIFIED'` の行だけを対象にする
//
// 🔴 実 SES / 実 DNS に接続しない（`SesIdentityApi` のスタブを注入する）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readSendingDomain = vi.fn();
const listVerifiedSendingDomains = vi.fn();
const markSendingDomainVerified = vi.fn();
const expireSendingDomain = vi.fn();

vi.mock('@ses/db', () => ({
  readSendingDomain,
  listVerifiedSendingDomains,
  markSendingDomainVerified,
  expireSendingDomain,
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

const {
  createDomainRecheckHandler,
  createDomainVerifyHandler,
  DOMAIN_RECHECK_SCHEDULE,
  parseDomainRecheckPayload,
  parseDomainVerifyPayload,
} = await import('./domain-verify.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const DOMAIN_ID = '01930000-0000-7000-8000-000000000b01';
const NOW = new Date('2026-09-05T03:00:00.000Z');

const ROW = {
  id: DOMAIN_ID,
  domain: 'example.co.jp',
  state: 'PENDING' as const,
  sesIdentityArn: null,
  sesTenantName: null,
  dkimTokens: ['t1', 't2', 't3'],
  mailFromDomain: 'mail.example.co.jp',
  verifiedAt: null,
  lastCheckedAt: null,
  lastFailureReason: null,
  createdAt: NOW,
};

const SUCCESS_RESPONSE = {
  VerifiedForSendingStatus: true,
  DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
  MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'SUCCESS' },
};

function makeDeps(response: unknown = SUCCESS_RESPONSE) {
  const getEmailIdentity = vi.fn(async () => response);
  return {
    deps: {
      identityApi: { getEmailIdentity } as never,
      now: () => NOW,
    },
    getEmailIdentity,
  };
}

beforeEach(() => {
  readSendingDomain.mockReset();
  listVerifiedSendingDomains.mockReset();
  markSendingDomainVerified.mockReset();
  expireSendingDomain.mockReset();
  markSendingDomainVerified.mockResolvedValue(true);
  expireSendingDomain.mockResolvedValue(true);
  readSendingDomain.mockResolvedValue(ROW);
  listVerifiedSendingDomains.mockResolvedValue([]);
});

describe('payload の門番', () => {
  it('domain.verify は tenantId / sendingDomainId を要求する', () => {
    expect(() => parseDomainVerifyPayload({ tenantId: TENANT_ID })).toThrow(InvalidJobPayloadError);
  });

  it('domain.recheck は tenantId を要求する', () => {
    expect(() => parseDomainRecheckPayload({})).toThrow(InvalidJobPayloadError);
    expect(parseDomainRecheckPayload({ tenantId: TENANT_ID })).toEqual({ tenantId: TENANT_ID });
  });

  it('対応する行が無ければ黙って成功させない', async () => {
    readSendingDomain.mockResolvedValue(null);
    const { deps } = makeDeps();
    await expect(
      createDomainVerifyHandler(deps)({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1'),
    ).rejects.toThrow(InvalidJobPayloadError);
  });
});

describe('🔴 ① すべて SUCCESS のときだけ検証済みにする', () => {
  it('DKIM / MAIL FROM / identity がすべて SUCCESS なら VERIFIED', async () => {
    const { deps } = makeDeps();
    const outcome = await createDomainVerifyHandler(deps)(
      { tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID },
      'j-1',
    );

    expect(outcome).toEqual({ state: 'VERIFIED', failureReason: null });
    expect(markSendingDomainVerified.mock.calls[0]?.[1]).toEqual({
      id: DOMAIN_ID,
      verifiedAt: NOW,
      dkimTokens: ['t1', 't2', 't3'],
      mailFromDomain: 'mail.example.co.jp',
    });
    expect(expireSendingDomain).not.toHaveBeenCalled();
  });

  it.each([
    [
      'DKIM が未検証',
      { ...SUCCESS_RESPONSE, DkimAttributes: { Status: 'PENDING', Tokens: ['t1'] } },
      'DKIM_NOT_VERIFIED',
    ],
    [
      'MAIL FROM が未設定',
      { ...SUCCESS_RESPONSE, MailFromAttributes: null },
      'MAIL_FROM_NOT_CONFIGURED',
    ],
    [
      'MAIL FROM が未検証',
      {
        ...SUCCESS_RESPONSE,
        MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'PENDING' },
      },
      'MAIL_FROM_NOT_VERIFIED',
    ],
    [
      'identity 全体が未検証',
      { ...SUCCESS_RESPONSE, VerifiedForSendingStatus: false },
      'IDENTITY_NOT_VERIFIED',
    ],
  ])('🔴 %s なら検証済みにしない（部分成立で送信を許さない）', async (_label, response, reason) => {
    const { deps } = makeDeps(response);
    const outcome = await createDomainVerifyHandler(deps)(
      { tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID },
      'j-1',
    );

    expect(outcome).toEqual({ state: 'FAILED', failureReason: reason });
    expect(markSendingDomainVerified).not.toHaveBeenCalled();
    expect(expireSendingDomain.mock.calls[0]?.[1]).toEqual({
      id: DOMAIN_ID,
      failureReason: reason,
      checkedAt: NOW,
    });
  });

  it('🔴 未検証でも throw しない（状態であってエラーではない。docs/04 申し送り 8）', async () => {
    const { deps } = makeDeps({ ...SUCCESS_RESPONSE, VerifiedForSendingStatus: false });
    await expect(
      createDomainVerifyHandler(deps)({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1'),
    ).resolves.toBeDefined();
  });
});

describe('🔴 ③ domain.recheck（毎日 05:30 JST。docs/05 §9.9）', () => {
  it('スケジュールは 05:30 JST である', () => {
    expect(DOMAIN_RECHECK_SCHEDULE).toEqual({ cron: '30 5 * * *', timeZone: 'Asia/Tokyo' });
  });

  it('対象が無ければ何もしない', async () => {
    const { deps, getEmailIdentity } = makeDeps();
    const outcome = await createDomainRecheckHandler(deps)({ tenantId: TENANT_ID }, 'j-1');
    expect(outcome).toEqual({ checked: 0, expired: [] });
    expect(getEmailIdentity).not.toHaveBeenCalled();
  });

  it('検証が外れていれば失効させ、失効したドメインを返す（A-005 項目 11 の対象）', async () => {
    listVerifiedSendingDomains.mockResolvedValue([{ ...ROW, state: 'VERIFIED', verifiedAt: NOW }]);
    const { deps } = makeDeps({ ...SUCCESS_RESPONSE, DkimAttributes: { Status: 'FAILED', Tokens: [] } });

    const outcome = await createDomainRecheckHandler(deps)({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome).toEqual({
      checked: 1,
      expired: [{ id: DOMAIN_ID, domain: 'example.co.jp', failureReason: 'DKIM_NOT_VERIFIED' }],
    });
    expect(expireSendingDomain).toHaveBeenCalledTimes(1);
  });

  it('外れていなければ失効させない', async () => {
    listVerifiedSendingDomains.mockResolvedValue([{ ...ROW, state: 'VERIFIED', verifiedAt: NOW }]);
    const { deps } = makeDeps();

    const outcome = await createDomainRecheckHandler(deps)({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome).toEqual({ checked: 1, expired: [] });
    expect(expireSendingDomain).not.toHaveBeenCalled();
  });

  it('🔴 GetEmailIdentity の失敗を「失効」に読み替えない（そのまま throw する）', async () => {
    listVerifiedSendingDomains.mockResolvedValue([{ ...ROW, state: 'VERIFIED', verifiedAt: NOW }]);
    const deps = {
      identityApi: {
        getEmailIdentity: vi.fn(async () => {
          throw new Error('ServiceUnavailable');
        }),
      } as never,
      now: () => NOW,
    };

    await expect(createDomainRecheckHandler(deps)({ tenantId: TENANT_ID }, 'j-1')).rejects.toThrow(
      'ServiceUnavailable',
    );
    expect(expireSendingDomain).not.toHaveBeenCalled();
  });
});
