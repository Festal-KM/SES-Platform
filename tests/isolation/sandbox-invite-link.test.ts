// tests/isolation/sandbox-invite-link.test.ts
// 🔴 SP-04 T-04-08 の完了判定を実データで実証する（`F-007 AC-4` / docs/05 §6.4 #14 / §8.2）:
//
//   ① 🔴 `sandbox` で取引先招待メールが**外部へ 0 通**（SES のポートが 1 度も呼ばれない）
//   ② 🔴 代わりに `#14` の応答へ招待リンクが載る（`SandboxInvitationView`）
//   ③ 🔴 そのリンクから `PARTNER_ADMIN` が**受諾でき、ログインできる**
//   ④ 🔴 **2 回目の受諾は失敗する**（`production` の招待と同一の規律。1 回限り）
//   ⑤ 🔴 `production` 相当では `inviteUrl` が**フィールドごと存在しない**（型が違う）
//   ⑥ 🔴 `sandbox` でも分類 1（自社メンバー）には出さない（メールが本人に実送信されるため）
//
// 🔴 `APP_ENV='sandbox'` は **`buildValidEnv('sandbox')` → `loadAppEnv` → `resolveInviteUrlRuntime`**
//    で表現する（テスト専用のフックを作らず、判定式もテスト側に書き写さない。docs/05 §13.1）。
// 🔴 実 SES / 実 DNS に接続しない。`SesApi` / `SesIdentityApi` のスタブと
//    `packages/connectors/src/mock/**`（`development` / `demo` / E2E と同一実装）だけを使う。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConnectors,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
  type SesApi,
  type SesIdentityApi,
  type SesSendEmailRequest,
} from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  registerSendingDomain,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import { createAccountMailHandler } from '../../apps/worker/src/jobs/account-mail.js';
import { createDomainProvisionHandler } from '../../apps/worker/src/jobs/domain-provision.js';
import { createDomainVerifyHandler } from '../../apps/worker/src/jobs/domain-verify.js';
import { resolveSendingDomainFromDb } from '../../apps/worker/src/jobs/email-send.js';
import { authenticateCredentials } from '../../apps/web/lib/auth/credentials.js';
import { InvitationNotAcceptableError } from '../../apps/web/lib/api/errors.js';
import {
  configureAccountMailQueue,
  PendingAccountMailQueue,
} from '../../apps/web/lib/jobs/account-mail.js';
import { resolveInviteUrlRuntime } from '../../apps/web/lib/invitations/invite-link.js';
import {
  acceptInvitation,
  issueInvitation,
  readInvitationByToken,
} from '../../apps/web/lib/invitations/service.js';
import {
  evaluateSendingDomain,
  type SendingDomainResolver,
} from '../../apps/web/lib/settings/sending-domains.js';
import { PARTNER_A1, TENANT_A, USER_A_HOST } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-06T03:00:00.000Z');
const DOMAIN = 'sandbox-invite.example';
const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;
const PASSWORD = 'correct horse battery staple';

/**
 * 🔴 `sandbox` の runtime は**本番と同じ経路**で作る（`packages/config` のスキーマ →
 *    `resolveInviteUrlRuntime`）。ここで `{ kind: 'SANDBOX_LINK_HANDOVER', … }` を手書きすると、
 *    「開示するのは `sandbox` だけ」という判定そのものを検証していないことになる。
 */
const SANDBOX_ENV = loadAppEnv(buildValidEnv('sandbox'));
const SANDBOX_INVITE_URL = resolveInviteUrlRuntime(SANDBOX_ENV);
/** `production` 相当（同じ関数から得る）。 */
const PRODUCTION_INVITE_URL = resolveInviteUrlRuntime(loadAppEnv(buildValidEnv('production')));

/** 🔴 `sandbox` は共通ドメインで動く（`docs/03` §3.2.7-4）ため #14 は検証を求めない。 */
const NOT_REQUIRED: SendingDomainResolver = (ctx) =>
  evaluateSendingDomain(ctx, { region: 'ap-northeast-1', verificationRequired: false });

const VERIFIED_IDENTITY = {
  VerifiedForSendingStatus: true,
  DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
  MailFromAttributes: { MailFromDomain: `mail.${DOMAIN}`, MailFromDomainStatus: 'SUCCESS' },
};

let database: IsolationDatabase;
let admin: UnextendedClient;
let ownerA: AuthenticatedTenantCtx;
let connectors: Connectors;
let mailQueue: PendingAccountMailQueue;
/**
 * 🔴 **外部（SES）へ出た通数**。`SandboxRecipientScopedEmailSender` の `real` 側だけが
 *    ここを増やす。`connectors.email.callCount()` は実送信 + モックの**合計**なので、
 *    「外部へ 0 通」を言うにはこちらを見る必要がある。
 */
let sesSent: SesSendEmailRequest[];

/** 🔴 実 SES の代わり。`sendEmail` が 1 度でも呼ばれたら記録が残る。 */
function stubSesApi(): SesApi {
  return {
    async sendEmail(request) {
      sesSent.push(request);
      return { MessageId: `ses-${sesSent.length}` };
    },
    async getAccount() {
      return { SendQuota: { Max24HourSend: 200, SentLast24Hours: 0 } };
    },
  };
}

function stubIdentityApi(): SesIdentityApi {
  return {
    identityArn: (name) => `arn:aws:ses:ap-northeast-1:100000000001:identity/${name}`,
    async createTenant() {},
    async createEmailIdentity() {
      return { DkimAttributes: { Tokens: ['t1', 't2', 't3'] } };
    },
    async putEmailIdentityMailFromAttributes() {},
    async createTenantResourceAssociation() {},
    async getEmailIdentity() {
      return VERIFIED_IDENTITY as never;
    },
  };
}

/**
 * `account.mail` を `sandbox` の配線で実行する。
 * 🔴 `emailImplementationKind` は起動時に確定した実装種別であり、`sandbox` は
 *    `'sandboxRecipientScoped'` である（`isMockedDelivery` がこれを見て `MOCKED` を記録する）。
 */
async function runAccountMail(job: unknown) {
  const handler = createAccountMailHandler({
    emailSender: connectors.email,
    emailImplementationKind: 'sandboxRecipientScoped',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: resolveSendingDomainFromDb,
    now: () => NOW,
    appUrl: SANDBOX_ENV.APP_URL,
    resolveRecipientEmail: async (mailJob: { targetId: string }) => {
      const row = await admin.invitation.findFirst({
        where: { id: mailJob.targetId },
        select: { email: true },
      });
      return row?.email ?? null;
    },
  } as never);
  return handler(job, 'job-account-mail');
}

/**
 * 送信ドメインを **VERIFIED** にする（登録 → provision → verify の実経路）。
 *
 * 🔴 なぜ検証済みにするか: 未検証だと `account.mail` は分類 2 をドメイン判定の段階で保留し
 *    （`HELD_DOMAIN_UNVERIFIED`）、**そもそも送信の振り分けまで到達しない**。それでは
 *    「`sandbox` だから外部に出なかった」ことを示せない（保留で止まっただけ）。
 *    ドメインが検証済みで、他に止める理由が 1 つも無い状態にしてなお外部へ 0 通であることが、
 *    宛先分類による振り分け（Issue #9 / #10）が効いていることの証明になる。
 */
async function verifyDomain(): Promise<void> {
  const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
  const identityApi = stubIdentityApi();
  await createDomainProvisionHandler({
    identityApi,
    configurationSet: 'ses-platform-test',
    commonSendingDomain: 'ses-platform.example',
    now: () => NOW,
  } as never)({ tenantId: TENANT_A, sendingDomainId: row.id }, 'job-provision');
  await createDomainVerifyHandler({ identityApi, now: () => NOW })(
    { tenantId: TENANT_A, sendingDomainId: row.id },
    'job-verify',
  );
}

/** 🔴 `#14` を `sandbox` の runtime で呼ぶ（取引先の担当者宛 = 分類 2）。 */
async function invitePartner(email: string) {
  return issueInvitation(
    ownerA,
    { email, role: 'PARTNER_ADMIN', targetPartnerCompanyId: PARTNER_A1 },
    META,
    NOT_REQUIRED,
    () => SANDBOX_INVITE_URL,
    NOW,
  );
}

/** 招待リンクから平文トークンを取り出す（受諾する取引先の担当者と同じことをする）。 */
function tokenOf(inviteUrl: string): string {
  const segments = new URL(inviteUrl).pathname.split('/');
  return decodeURIComponent(segments[segments.length - 1] ?? '');
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
      role: 'ADMIN',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.emailDispatch.deleteMany({});
  await admin.tenantSendingDomain.deleteMany({});
  await admin.invitation.deleteMany({ where: { email: { contains: '@sandbox-invite.example' } } });
  await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
  sesSent = [];
  // 🔴 `sandbox` の実配線（`resolveConnectorSelection('sandbox').email`）と同じ選択で組み立てる。
  connectors = createConnectors(
    {
      email: 'sandboxRecipientScoped',
      objectStore: 'mock',
      malwareScanner: 'mock',
      esign: 'mock',
      billing: 'mock',
    },
    {
      ses: {
        api: stubSesApi(),
        defaultFromAddress: 'noreply@ses-platform.example',
        configurationSet: 'ses-platform-test',
        now: () => NOW,
      },
    },
  );
  mailQueue = new PendingAccountMailQueue();
  configureAccountMailQueue(mailQueue);
});

describe('🔴 F-007 AC-4: sandbox の取引先招待は外部へ 0 通、リンクを画面で手渡す', () => {
  it('① #14 の応答が SandboxInvitationView になり、リンクは受諾画面（`/invite/{token}`）を指す', async () => {
    const result = await invitePartner('partner-link@sandbox-invite.example');

    expect(result.disclosure).toBe('SANDBOX_INVITE_URL');
    if (result.disclosure !== 'SANDBOX_INVITE_URL') throw new Error('unreachable');
    expect(result.inviteUrl.startsWith(`${SANDBOX_ENV.APP_URL}/invite/`)).toBe(true);

    // 🔴 リンクのトークンは `account.mail` に積まれた平文トークンと**同一**である
    //    （専用の別トークンを作っていない = `production` の招待と同じものが渡る）。
    expect(tokenOf(result.inviteUrl)).toBe(mailQueue.jobsOf('INVITATION')[0]?.token);
  });

  it('🔴 ① 送信ジョブを実行しても SES は 1 度も呼ばれない（外部発信 0 通）', async () => {
    await verifyDomain();
    const result = await invitePartner('partner-zero@sandbox-invite.example');

    const outcome = await runAccountMail(mailQueue.jobsOf('INVITATION')[0]);

    // 🔴 外部（SES）への発行が 0 件。ドメインは検証済みで、止める理由は他に無い。
    expect(sesSent).toEqual([]);
    // モック側には 1 通流れている（＝「送信経路には乗ったが外部には出ていない」）。
    expect(connectors.email.callCount()).toBe(1);
    expect(outcome).toEqual({ kind: 'MOCKED' });

    const dispatch = await admin.emailDispatch.findFirst({ where: { tenantId: TENANT_A } });
    expect(dispatch?.status).toBe('MOCKED');
    expect(dispatch?.recipientClass).toBe('PARTNER_MEMBER');
    // 🔴 実送信ではないので SES のメッセージ ID は残らない（`SENT` と取り違えない）。
    expect(dispatch?.sesMessageId).toBeNull();
    expect(result.disclosure).toBe('SANDBOX_INVITE_URL');
  });

  it('🔴 ③ リンクから PARTNER_ADMIN が受諾でき、そのままログインできる', async () => {
    const email = 'partner-accept@sandbox-invite.example';
    const result = await invitePartner(email);
    if (result.disclosure !== 'SANDBOX_INVITE_URL') throw new Error('unreachable');
    const token = tokenOf(result.inviteUrl);

    // 受諾画面（`S-002`）が最初に引く内容。所属が取引先企業として見えている。
    const view = await readInvitationByToken(token, NOW);
    expect(view).toMatchObject({ status: 'VALID', role: 'PARTNER_ADMIN', email });

    const accepted = await acceptInvitation(
      token,
      { displayName: '架空 取引先管理者', password: PASSWORD },
      META,
      NOW,
    );

    const user = await admin.user.findFirst({ where: { id: accepted.userId } });
    expect(user?.tenantId).toBe(TENANT_A);
    // 🔴 第二境界（パートナースコープ）が招待行から決まる（入力に持たない）。
    expect(user?.ownerPartnerCompanyId).toBe(PARTNER_A1);
    const membership = await admin.membership.findFirst({ where: { userId: accepted.userId } });
    expect(membership?.role).toBe('PARTNER_ADMIN');
    expect(membership?.partnerCompanyId).toBe(PARTNER_A1);

    // 🔴 「受諾・ログインできる」まで見る（受諾だけでは `F-007 AC-4` の完了判定に足りない）。
    const auth = await authenticateCredentials({ email, password: PASSWORD }, META);
    expect(auth).toMatchObject({
      outcome: 'AUTHENTICATED',
      claims: { tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: accepted.userId },
    });
  });

  it('🔴 ④ 2 回目の受諾は失敗する（1 回限り。利用者も増えない）', async () => {
    const result = await invitePartner('partner-once@sandbox-invite.example');
    if (result.disclosure !== 'SANDBOX_INVITE_URL') throw new Error('unreachable');
    const token = tokenOf(result.inviteUrl);

    await acceptInvitation(token, { displayName: '一度目', password: PASSWORD }, META, NOW);
    const afterFirst = await admin.user.count();

    await expect(
      acceptInvitation(token, { displayName: '二度目', password: PASSWORD }, META, NOW),
    ).rejects.toBeInstanceOf(InvitationNotAcceptableError);

    expect(await admin.user.count()).toBe(afterFirst);
    expect(await admin.user.count({ where: { displayName: '二度目' } })).toBe(0);
    // 🔴 受諾後は失効している（リンクを渡した相手以外が後から開いても入れない）。
    expect(await readInvitationByToken(token, NOW)).toMatchObject({ status: 'ACCEPTED' });
  });

  it('🔴 有効期限は production の招待と同一の規律（期限切れのリンクでは受諾できない）', async () => {
    const result = await invitePartner('partner-expired@sandbox-invite.example');
    if (result.disclosure !== 'SANDBOX_INVITE_URL') throw new Error('unreachable');
    const token = tokenOf(result.inviteUrl);

    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    const afterExpiry = new Date(row!.expiresAt.getTime() + 1000);

    await expect(
      acceptInvitation(token, { displayName: '期限切れ', password: PASSWORD }, META, afterExpiry),
    ).rejects.toBeInstanceOf(InvitationNotAcceptableError);
    expect(await admin.user.count({ where: { displayName: '期限切れ' } })).toBe(0);
  });
});

describe('🔴 開示の境界（docs/05 §6.4 #14 の 🔴）', () => {
  it('⑤ production 相当では inviteUrl がフィールドごと存在しない', async () => {
    const result = await issueInvitation(
      ownerA,
      {
        email: 'partner-production@sandbox-invite.example',
        role: 'PARTNER_ADMIN',
        targetPartnerCompanyId: PARTNER_A1,
      },
      META,
      NOT_REQUIRED,
      () => PRODUCTION_INVITE_URL,
      NOW,
    );

    expect(result.disclosure).toBe('NONE');
    expect('inviteUrl' in result).toBe(false);
    // 🔴 応答（JSON）に平文トークンが 1 文字も現れない。
    const token = mailQueue.jobsOf('INVITATION')[0]?.token as string;
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('⑥ sandbox でも自社メンバー宛（分類 1）には出さない（本人にメールが実送信されるため）', async () => {
    const result = await issueInvitation(
      ownerA,
      { email: 'host-member@sandbox-invite.example', role: 'SALES' },
      META,
      NOT_REQUIRED,
      () => SANDBOX_INVITE_URL,
      NOW,
    );

    expect(result.disclosure).toBe('NONE');
    expect('inviteUrl' in result).toBe(false);
    expect(mailQueue.jobsOf('INVITATION')[0]?.recipientClass).toBe('HOST_MEMBER');
  });
});

describe('🔴 平文トークンの残り方（CLAUDE.md §3.4）', () => {
  it('DB にも監査ログにも平文が残らない（応答だけが出口である）', async () => {
    const result = await invitePartner('partner-secret@sandbox-invite.example');
    if (result.disclosure !== 'SANDBOX_INVITE_URL') throw new Error('unreachable');
    const token = tokenOf(result.inviteUrl);

    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).not.toContain(token);

    const audits = await admin.auditLog.findMany({
      where: { action: 'invitation.create' },
      select: { summary: true },
    });
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      expect(JSON.stringify(audit.summary)).not.toContain(token);
    }

    // 🔴 送信の記録（`EmailDispatch`）にも残らない（`dedupeKey` はハッシュの先頭だけ）。
    await verifyDomain();
    await runAccountMail(mailQueue.jobsOf('INVITATION')[0]);
    const dispatch = await admin.emailDispatch.findFirst({ where: { tenantId: TENANT_A } });
    expect(JSON.stringify(dispatch)).not.toContain(token);
  });
});
