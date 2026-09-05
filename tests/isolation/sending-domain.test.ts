// tests/isolation/sending-domain.test.ts
// 🔴 SP-04 T-04-04 の完了判定のうち、DB を要するものを実データで実証する:
//   ① `F-001 AC-4` —— 送信ドメインの登録 → DNS レコードの提示 → 検証 → **検証済みになるまで
//      取引先へ届く送信の送信元が引けない**（`resolveVerifiedSendingDomain` が `null`）
//   ② `domain.provision` の**冪等性**（既存なら取得。DKIM トークンを作り直さない）
//   ③ `domain.recheck` で失効すると **`A-005` 項目 11 の対象**に載る
//      （= `lifecycle_state='ACTIVE'` のテナントに `state='VERIFIED'` の行が無い）
//   ④ テナント境界（他テナントのドメインは読めない / 書けない）
//   ⑤ 「1 テナント 1 検証済みドメイン」（部分 UNIQUE）
//
// 🔴 実 SES / 実 DNS に接続しない（`SesIdentityApi` のスタブを注入する）。
// 🔴 `state` は**状態であってエラーではない**（`docs/04` 申し送り 8）。未検証で例外にならないこと
//    そのものを検証する。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SesIdentityApi } from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  listSendingDomains,
  registerSendingDomain,
  resolveTenantCtx,
  resolveVerifiedSendingDomain,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { createDomainProvisionHandler } from '../../apps/worker/src/jobs/domain-provision.js';
import {
  createDomainRecheckHandler,
  createDomainVerifyHandler,
} from '../../apps/worker/src/jobs/domain-verify.js';
import {
  readSendingDomainSettings,
  registerSendingDomainSettings,
  requestSendingDomainVerification,
} from '../../apps/web/lib/settings/sending-domains.js';
import { PendingDomainJobQueue } from '../../apps/web/lib/jobs/domain-jobs.js';
import { TENANT_A, TENANT_B, USER_A_HOST, USER_B_HOST } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-05T03:00:00.000Z');
const DOMAIN = 'example.co.jp';

let database: IsolationDatabase;
let admin: UnextendedClient;
let ownerA: AuthenticatedTenantCtx;
let ownerB: AuthenticatedTenantCtx;
let jobA: SystemTenantCtx;

/** 検証が「まだ」の応答（DNS の反映待ち）。🔴 これは状態であってエラーではない。 */
const PENDING_IDENTITY = {
  VerifiedForSendingStatus: false,
  DkimAttributes: { Status: 'PENDING', Tokens: ['t1', 't2', 't3'] },
  MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'PENDING' },
};

const VERIFIED_IDENTITY = {
  VerifiedForSendingStatus: true,
  DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
  MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'SUCCESS' },
};

/**
 * 🔴 実 SES の代わり。**呼ばれた回数と、返す DKIM トークン**だけを持つ。
 *    トークンは「一度発行したら変えない」（利用者が DNS へ入れた CNAME を無効にしない）ことを
 *    再現するため、内部で固定する。
 */
function stubIdentityApi(identity: unknown = PENDING_IDENTITY) {
  const calls = { createTenant: 0, createEmailIdentity: 0, mailFrom: 0, association: 0, get: 0 };
  let current = identity;
  const api: SesIdentityApi = {
    identityArn: (name) => `arn:aws:ses:ap-northeast-1:100000000001:identity/${name}`,
    async createTenant() {
      calls.createTenant += 1;
    },
    async createEmailIdentity() {
      calls.createEmailIdentity += 1;
      return { DkimAttributes: { Tokens: ['t1', 't2', 't3'] } };
    },
    async putEmailIdentityMailFromAttributes() {
      calls.mailFrom += 1;
    },
    async createTenantResourceAssociation() {
      calls.association += 1;
    },
    async getEmailIdentity() {
      calls.get += 1;
      return current as never;
    },
  };
  return { api, calls, setIdentity: (next: unknown) => (current = next) };
}

async function provision(api: SesIdentityApi, sendingDomainId: string) {
  return createDomainProvisionHandler({
    identityApi: api,
    configurationSet: 'ses-platform-test',
    commonSendingDomain: 'ses-platform.example',
    now: () => NOW,
  })({ tenantId: TENANT_A, sendingDomainId }, 'job-provision');
}

async function verify(api: SesIdentityApi, sendingDomainId: string) {
  return createDomainVerifyHandler({ identityApi: api, now: () => NOW })(
    { tenantId: TENANT_A, sendingDomainId },
    'job-verify',
  );
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  ownerA = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'OWNER',
      lifecycleState: 'ACTIVE',
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  ownerB = await resolveTenantCtx(
    {
      tenantId: TENANT_B,
      partnerCompanyId: null,
      userId: USER_B_HOST,
      role: 'OWNER',
      lifecycleState: 'ACTIVE',
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  jobA = systemTenantCtx(TENANT_A, { queue: 'domain.provision', jobId: 'job-1' });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.tenantSendingDomain.deleteMany({});
});

describe('🔴 ① F-001 AC-4（検証済みになるまで取引先へ届く送信の送信元が引けない）', () => {
  it('登録直後は REGISTERED で、送信元は引けない', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });

    expect(row.state).toBe('REGISTERED');
    expect(row.verifiedAt).toBeNull();
    // 🔴 未検証は `null`。**共通ドメインを代わりに返さない**（`BR-51`）。
    expect(await resolveVerifiedSendingDomain(ownerA)).toBeNull();
  });

  it('provision で DKIM トークンと MAIL FROM が入り PENDING になる（まだ送信元は引けない）', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api } = stubIdentityApi();

    await provision(api, row.id);

    const stored = await admin.tenantSendingDomain.findFirst({ where: { id: row.id } });
    expect(stored?.state).toBe('PENDING');
    expect(stored?.dkimTokens).toEqual(['t1', 't2', 't3']);
    expect(stored?.mailFromDomain).toBe('mail.example.co.jp');
    expect(stored?.sesTenantName).toBe(`t-${TENANT_A}`);
    expect(await resolveVerifiedSendingDomain(ownerA)).toBeNull();
  });

  it('🔴 DNS 未反映（PENDING）の検証は FAILED になるが、例外にはならない（状態であってエラーではない）', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api } = stubIdentityApi();
    await provision(api, row.id);

    const outcome = await verify(api, row.id);

    expect(outcome).toEqual({ state: 'FAILED', failureReason: 'DKIM_NOT_VERIFIED' });
    expect(await resolveVerifiedSendingDomain(ownerA)).toBeNull();
  });

  it('🔴 検証が通ると VERIFIED になり、送信元が引ける（ここではじめて取引先へ送れる）', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api, setIdentity } = stubIdentityApi();
    await provision(api, row.id);
    setIdentity(VERIFIED_IDENTITY);

    expect(await verify(api, row.id)).toEqual({ state: 'VERIFIED', failureReason: null });

    expect(await resolveVerifiedSendingDomain(ownerA)).toEqual({
      domain: DOMAIN,
      mailFromDomain: 'mail.example.co.jp',
      verifiedAt: NOW,
    });
    const stored = await admin.tenantSendingDomain.findFirst({ where: { id: row.id } });
    expect(stored?.verifiedAt).not.toBeNull();
    expect(stored?.lastFailureReason).toBeNull();
  });
});

describe('🔴 ② domain.provision の冪等性', () => {
  it('同じドメインを 2 回登録しても行は 1 つ（既存を返す）', async () => {
    const first = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const second = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(await admin.tenantSendingDomain.count({ where: { tenantId: TENANT_A } })).toBe(1);
  });

  it('🔴 provision を 2 回走らせても DKIM トークンが変わらない', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api } = stubIdentityApi();

    await provision(api, row.id);
    const after1 = await admin.tenantSendingDomain.findFirst({ where: { id: row.id } });
    await provision(api, row.id);
    const after2 = await admin.tenantSendingDomain.findFirst({ where: { id: row.id } });

    expect(after2?.dkimTokens).toEqual(after1?.dkimTokens);
  });

  it('🔴 検証済みの行に provision を再実行しても降格しない（SES も呼ばない）', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api, setIdentity, calls } = stubIdentityApi();
    await provision(api, row.id);
    setIdentity(VERIFIED_IDENTITY);
    await verify(api, row.id);

    const before = calls.createEmailIdentity;
    const outcome = await provision(api, row.id);

    expect(outcome).toEqual({ kind: 'ALREADY_VERIFIED' });
    expect(calls.createEmailIdentity).toBe(before);
    const stored = await admin.tenantSendingDomain.findFirst({ where: { id: row.id } });
    expect(stored?.state).toBe('VERIFIED');
    expect(stored?.verifiedAt).not.toBeNull();
  });
});

describe('🔴 ③ domain.recheck の失効（A-005 項目 11 の対象になる）', () => {
  it('DNS レコードが消えたら失効し、検証済みの行が無くなる', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api, setIdentity } = stubIdentityApi();
    await provision(api, row.id);
    setIdentity(VERIFIED_IDENTITY);
    await verify(api, row.id);
    expect(await resolveVerifiedSendingDomain(ownerA)).not.toBeNull();

    // DNS から CNAME が消えた状態を再現する。
    setIdentity({ ...VERIFIED_IDENTITY, DkimAttributes: { Status: 'FAILED', Tokens: [] } });
    const outcome = await createDomainRecheckHandler({ identityApi: api, now: () => NOW })(
      { tenantId: TENANT_A },
      'job-recheck',
    );

    expect(outcome.checked).toBe(1);
    expect(outcome.expired).toEqual([
      { id: row.id, domain: DOMAIN, failureReason: 'DKIM_NOT_VERIFIED' },
    ]);

    // 🔴 失効の効果: 以後の送信は送信元を引けない（保留に落ちる）。
    expect(await resolveVerifiedSendingDomain(ownerA)).toBeNull();
    const stored = await admin.tenantSendingDomain.findFirst({ where: { id: row.id } });
    expect(stored?.state).toBe('FAILED');
    expect(stored?.verifiedAt).toBeNull();
  });

  it('🔴 A-005 項目 11 の母集団（ACTIVE かつ検証済みが無いテナント）に載る', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const { api, setIdentity } = stubIdentityApi();
    await provision(api, row.id);
    setIdentity(VERIFIED_IDENTITY);
    await verify(api, row.id);

    // 検証済みのうちは母集団に入らない。
    const beforeExpiry = await admin.tenant.findMany({
      where: { lifecycleState: 'ACTIVE', sendingDomains: { none: { state: 'VERIFIED' } } },
      select: { id: true },
    });
    expect(beforeExpiry.map((tenant) => tenant.id)).not.toContain(TENANT_A);

    setIdentity({ ...VERIFIED_IDENTITY, VerifiedForSendingStatus: false });
    await createDomainRecheckHandler({ identityApi: api, now: () => NOW })(
      { tenantId: TENANT_A },
      'job-recheck',
    );

    const afterExpiry = await admin.tenant.findMany({
      where: { lifecycleState: 'ACTIVE', sendingDomains: { none: { state: 'VERIFIED' } } },
      select: { id: true },
    });
    expect(afterExpiry.map((tenant) => tenant.id)).toContain(TENANT_A);
  });
});

describe('🔴 ④ テナント境界（F-004 AC-1）', () => {
  it('他テナントのドメインは一覧にも現れない', async () => {
    await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });

    expect((await listSendingDomains(ownerA)).map((row) => row.domain)).toEqual([DOMAIN]);
    expect(await listSendingDomains(ownerB)).toEqual([]);
    expect(await resolveVerifiedSendingDomain(ownerB)).toBeNull();
  });

  it('同じドメイン名を別テナントが登録できる（UNIQUE は (tenant_id, domain)）', async () => {
    await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const other = await registerSendingDomain(ownerB, { domain: DOMAIN, observedAt: NOW });
    expect(other.created).toBe(true);
  });
});

describe('🔴 ⑤ 送信元は 1 テナント 1 ドメイン（部分 UNIQUE）', () => {
  it('2 本目を検証済みにしようとすると DB が拒否する（黙って 2 本目にしない）', async () => {
    const first = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    const second = await registerSendingDomain(ownerA, { domain: 'other.co.jp', observedAt: NOW });
    const { api, setIdentity } = stubIdentityApi(VERIFIED_IDENTITY);
    await provision(api, first.row.id);
    await verify(api, first.row.id);

    await provision(api, second.row.id);
    setIdentity({ ...VERIFIED_IDENTITY, MailFromAttributes: { MailFromDomain: 'mail.other.co.jp', MailFromDomainStatus: 'SUCCESS' } });

    await expect(verify(api, second.row.id)).rejects.toThrow();
  });
});

describe('🔴 #71 / #72（docs/05 §6.3。DNS レコードの提示と再確認）', () => {
  const runtime = { region: 'ap-northeast-1', verificationRequired: true };

  it('POST は行を作り、`domain.provision` を enqueue する（レコードは provision 後に埋まる）', async () => {
    const queue = new PendingDomainJobQueue();
    const view = await registerSendingDomainSettings(
      ownerA,
      { domain: DOMAIN, observedAt: NOW },
      { ...runtime, queue },
    );

    expect(view.state).toBe('REGISTERED');
    // 🔴 MAIL FROM のレコードはドメインから決まるので、provision 前でも提示できる。
    expect(view.mailFromRecords.map((record) => record.type)).toEqual(['MX', 'TXT']);
    expect(queue.jobsOf('provision')).toEqual([{ tenantId: TENANT_A, sendingDomainId: view.id }]);
  });

  it('🔴 provision 後の GET が CNAME 3 本 + MX / TXT を提示する', async () => {
    const queue = new PendingDomainJobQueue();
    const view = await registerSendingDomainSettings(
      ownerA,
      { domain: DOMAIN, observedAt: NOW },
      { ...runtime, queue },
    );
    const { api } = stubIdentityApi();
    await provision(api, view.id);

    const list = await readSendingDomainSettings(ownerA, runtime);
    const domain = list.domains[0];

    expect(list.required).toBe(true);
    expect(domain?.state).toBe('PENDING');
    expect(domain?.dkimRecords).toHaveLength(3);
    expect(domain?.dkimRecords.map((record) => record.name)).toEqual([
      't1._domainkey.example.co.jp',
      't2._domainkey.example.co.jp',
      't3._domainkey.example.co.jp',
    ]);
    expect(domain?.mailFromRecords).toHaveLength(2);
    expect(domain?.affects).toContain('S-014');
  });

  it('#72 は `domain.verify` を enqueue し、現在の状態を返す（回数制限なし）', async () => {
    const queue = new PendingDomainJobQueue();
    const view = await registerSendingDomainSettings(
      ownerA,
      { domain: DOMAIN, observedAt: NOW },
      { ...runtime, queue },
    );

    expect(await requestSendingDomainVerification(ownerA, { sendingDomainId: view.id }, { ...runtime, queue })).toEqual(
      { state: 'REGISTERED' },
    );
    await requestSendingDomainVerification(ownerA, { sendingDomainId: view.id }, { ...runtime, queue });
    expect(queue.jobsOf('verify')).toHaveLength(2);
  });

  it('🔴 sandbox（検証が不要な環境）では NOT_REQUIRED を返し、ジョブを起動しない', async () => {
    const queue = new PendingDomainJobQueue();
    const view = await registerSendingDomainSettings(
      ownerA,
      { domain: DOMAIN, observedAt: NOW },
      { ...runtime, queue },
    );

    const outcome = await requestSendingDomainVerification(
      ownerA,
      { sendingDomainId: view.id },
      { region: runtime.region, verificationRequired: false, queue },
    );

    expect(outcome).toEqual({ state: 'NOT_REQUIRED' });
    expect(queue.jobsOf('verify')).toEqual([]);
  });

  it('🔴 他テナントの id を渡しても 404（見えない = 存在しない）', async () => {
    const queue = new PendingDomainJobQueue();
    const view = await registerSendingDomainSettings(
      ownerA,
      { domain: DOMAIN, observedAt: NOW },
      { ...runtime, queue },
    );

    await expect(
      requestSendingDomainVerification(ownerB, { sendingDomainId: view.id }, { ...runtime, queue }),
    ).rejects.toThrow();
  });

  it('失敗理由は i18n キーとして返る（コードを画面へ素通ししない）', async () => {
    const queue = new PendingDomainJobQueue();
    const view = await registerSendingDomainSettings(
      ownerA,
      { domain: DOMAIN, observedAt: NOW },
      { ...runtime, queue },
    );
    const { api } = stubIdentityApi();
    await provision(api, view.id);
    await verify(api, view.id);

    const list = await readSendingDomainSettings(ownerA, runtime);
    expect(list.domains[0]?.failureReasonKey).toBe(
      'settings.sendingDomain.failure.DKIM_NOT_VERIFIED',
    );
  });
});

describe('ジョブ文脈（systemTenantCtx）でも同じ経路を通る', () => {
  it('ワーカーの ctx から一覧を読める（RLS は同じ）', async () => {
    await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    expect((await listSendingDomains(jobA)).map((row) => row.domain)).toEqual([DOMAIN]);
  });
});
