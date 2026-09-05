// apps/worker/src/jobs/domain-provision.test.ts
// 🔴 SP-04 T-04-04 の完了判定「`domain.provision` の冪等性（既存なら取得）」のジョブ側の検証。
//    DB を要する部分（`ON CONFLICT` / `WHERE state <> 'VERIFIED'`）は
//    `tests/isolation/sending-domain.test.ts` が実データで実証する。
//
// 🔴 実 SES / 実 DNS に接続しない（`SesIdentityApi` のスタブを注入する）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readSendingDomain = vi.fn();
const applySendingDomainProvision = vi.fn();

vi.mock('@ses/db', () => ({
  readSendingDomain,
  applySendingDomainProvision,
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

const { createDomainProvisionHandler, parseDomainProvisionPayload } = await import(
  './domain-provision.js'
);
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const DOMAIN_ID = '01930000-0000-7000-8000-000000000b01';
const NOW = new Date('2026-09-05T03:00:00.000Z');

function identityApi(overrides: Record<string, unknown> = {}) {
  return {
    identityArn: (identity: string) => `arn:aws:ses:ap-northeast-1:000000000000:identity/${identity}`,
    createTenant: vi.fn(async (tenantName: string) => void tenantName),
    createEmailIdentity: vi.fn(async (input: { domain: string; configurationSetName: string }) => {
      void input;
      return { DkimAttributes: { Tokens: ['t1', 't2', 't3'] } } as const;
    }),
    putEmailIdentityMailFromAttributes: vi.fn(
      async (input: { domain: string; mailFromDomain: string }) => void input,
    ),
    createTenantResourceAssociation: vi.fn(
      async (input: { tenantName: string; identity: string }) => void input,
    ),
    getEmailIdentity: vi.fn(),
    ...overrides,
  };
}

function makeHandler(api = identityApi()) {
  const handler = createDomainProvisionHandler({
    identityApi: api as never,
    configurationSet: 'ses-platform-test',
    commonSendingDomain: 'ses-platform.example',
    now: () => NOW,
  });
  return { handler, api };
}

beforeEach(() => {
  readSendingDomain.mockReset();
  applySendingDomainProvision.mockReset();
  applySendingDomainProvision.mockResolvedValue(true);
  readSendingDomain.mockResolvedValue({
    id: DOMAIN_ID,
    domain: 'example.co.jp',
    state: 'REGISTERED',
    sesIdentityArn: null,
    sesTenantName: null,
    dkimTokens: [],
    mailFromDomain: null,
    verifiedAt: null,
    lastCheckedAt: null,
    lastFailureReason: null,
    createdAt: NOW,
  });
});

describe('payload の門番', () => {
  it('tenantId / sendingDomainId が UUID でなければ拒否する（既定値で補完しない）', () => {
    expect(() => parseDomainProvisionPayload({ tenantId: TENANT_ID })).toThrow(InvalidJobPayloadError);
    expect(() => parseDomainProvisionPayload(null)).toThrow(InvalidJobPayloadError);
  });

  it('対応する行が無ければ黙って成功させない', async () => {
    readSendingDomain.mockResolvedValue(null);
    const { handler } = makeHandler();
    await expect(handler({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1')).rejects.toThrow(
      InvalidJobPayloadError,
    );
  });
});

describe('🔴 SES の呼び出し順（docs/05 §8.3「SES Tenants と identity」）', () => {
  it('CreateTenant → CreateEmailIdentity → MAIL FROM → 関連付け（独自 + 共通の 2 本）', async () => {
    const { handler, api } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1');

    expect(api.createTenant).toHaveBeenCalledWith(`t-${TENANT_ID}`);
    expect(api.createEmailIdentity).toHaveBeenCalledWith({
      domain: 'example.co.jp',
      configurationSetName: 'ses-platform-test',
    });
    expect(api.putEmailIdentityMailFromAttributes).toHaveBeenCalledWith({
      domain: 'example.co.jp',
      mailFromDomain: 'mail.example.co.jp',
    });
    // 🔴 共通ドメインの identity も関連付ける（分類 1 / 分類外の送信も TenantName に乗せる）。
    expect(api.createTenantResourceAssociation.mock.calls.map((call) => call[0].identity)).toEqual([
      'example.co.jp',
      'ses-platform.example',
    ]);
    expect(outcome).toEqual({
      kind: 'PROVISIONED',
      dkimTokens: ['t1', 't2', 't3'],
      mailFromDomain: 'mail.example.co.jp',
    });
  });

  it('DKIM トークンと MAIL FROM を DB へ保存する（state は PENDING へ）', async () => {
    const { handler } = makeHandler();
    await handler({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1');

    expect(applySendingDomainProvision.mock.calls[0]?.[1]).toEqual({
      id: DOMAIN_ID,
      sesIdentityArn: 'arn:aws:ses:ap-northeast-1:000000000000:identity/example.co.jp',
      sesTenantName: `t-${TENANT_ID}`,
      dkimTokens: ['t1', 't2', 't3'],
      mailFromDomain: 'mail.example.co.jp',
      observedAt: NOW,
    });
  });
});

describe('🔴 冪等性（SP-04 T-04-04 の完了判定）', () => {
  it('2 回走らせても同じ結果になり、DKIM トークンが作り直されない', async () => {
    const { handler, api } = makeHandler();

    const first = await handler({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1');
    const second = await handler({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1');

    expect(second).toEqual(first);
    // 🔴 「既存なら取得」はアダプタ（`AlreadyExistsException` → `GetEmailIdentity`）の責務であり、
    //    ジョブは同じ呼び出しを繰り返してよい。ここで固定するのは「トークンが変わらない」こと。
    expect(api.createEmailIdentity).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
  });

  it('🔴 既に VERIFIED の行は SES も DB も触らない（検証済みを検証待ちへ降格させない）', async () => {
    readSendingDomain.mockResolvedValue({
      id: DOMAIN_ID,
      domain: 'example.co.jp',
      state: 'VERIFIED',
      sesIdentityArn: 'arn:aws:ses:ap-northeast-1:000000000000:identity/example.co.jp',
      sesTenantName: `t-${TENANT_ID}`,
      dkimTokens: ['t1', 't2', 't3'],
      mailFromDomain: 'mail.example.co.jp',
      verifiedAt: NOW,
      lastCheckedAt: NOW,
      lastFailureReason: null,
      createdAt: NOW,
    });
    const { handler, api } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID, sendingDomainId: DOMAIN_ID }, 'j-1');

    expect(outcome).toEqual({ kind: 'ALREADY_VERIFIED' });
    expect(api.createTenant).not.toHaveBeenCalled();
    expect(api.createEmailIdentity).not.toHaveBeenCalled();
    expect(applySendingDomainProvision).not.toHaveBeenCalled();
  });
});
