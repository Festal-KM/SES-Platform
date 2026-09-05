// tests/isolation/sending-domain-hold.test.ts
// 🔴 SP-04 T-04-05 の完了判定を実データで実証する（`F-007 AC-5` / `F-022 AC-7` /
//    E2E #9 の前半。docs/05 §6.2 / §8.3 / §10.4）:
//
//   ① 🔴 送信ジョブは**外部 API を呼ぶ前に**独自ドメインの検証状態を確認する
//   ② 🔴 未検証のとき**共通ドメインへフォールバックしない**（`BR-51`）
//   ③ 🔴 未検証は `FAILED`（障害）ではなく**保留**であり、招待そのものは作成される
//      （`deliveryState='HELD_DOMAIN_UNVERIFIED'`。`F-007 AC-5`）
//   ④ 🔴 検証が完了すると `send.hold-release` が**トークンを再発行して自動で復帰**させる
//      （旧リンクは失効し、外部への発行は合計 1 通）
//   ⑤ 🔴 自社メンバー宛（分類 1）は検証状態に依存しない（`F-001 AC-5`）
//   ⑥ 🔴 `requireVerifiedSendingDomain` が未検証で 422 を返し、**設定すべき DNS レコード**を
//      添える（`F-022 AC-7`。`Proposal` / `Contract` の送信 API が SP-09 / SP-17 で使う判定）
//
// 🔴 **実 SES / 実 DNS に接続しない**（`SesIdentityApi` のスタブ + `packages/connectors/src/mock`）。
//    モックは `development` / `demo` / E2E と同一実装である（docs/05 §17.5）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createConnectors,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
  type SesIdentityApi,
} from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  registerSendingDomain,
  resolveTenantCtx,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { INVITATION_TTL_MS } from '../../packages/config/src/limits.js';
import { createAccountMailHandler } from '../../apps/worker/src/jobs/account-mail.js';
import { createAccountMailReissue } from '../../apps/worker/src/jobs/account-mail-reissue.js';
import { createDomainProvisionHandler } from '../../apps/worker/src/jobs/domain-provision.js';
import { createDomainVerifyHandler } from '../../apps/worker/src/jobs/domain-verify.js';
import { resolveSendingDomainFromDb } from '../../apps/worker/src/jobs/email-send.js';
import { createSendHoldReleaseHandler } from '../../apps/worker/src/jobs/send-hold-release.js';
import { applyGuards, requireVerifiedSendingDomain } from '../../apps/web/lib/api/guards.js';
import { SendingDomainNotVerifiedError } from '../../apps/web/lib/api/errors.js';
import {
  configureAccountMailQueue,
  PendingAccountMailQueue,
} from '../../apps/web/lib/jobs/account-mail.js';
import { issueInvitation, readInvitationByToken } from '../../apps/web/lib/invitations/service.js';
import {
  evaluateSendingDomain,
  type SendingDomainResolver,
} from '../../apps/web/lib/settings/sending-domains.js';
import { PARTNER_A1, TENANT_A, USER_A_HOST } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-05T03:00:00.000Z');
const DOMAIN = 'example.co.jp';
const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;

/** `production` / `staging` 相当（`docs/03` §3.2.7 規律 1・3）。 */
const REQUIRED_RUNTIME = { region: 'ap-northeast-1', verificationRequired: true } as const;
/** `sandbox` / `demo` / `development` 相当（同 規律 4・5）。 */
const NOT_REQUIRED_RUNTIME = { region: 'ap-northeast-1', verificationRequired: false } as const;

/**
 * 🔴 判定は**本番と同じ関数**（`evaluateSendingDomain`）を通す。ガードも #14 も同じものを使い、
 *    テスト側で「未検証を返すだけの関数」に差し替えない（差し替えると判定を検証していない）。
 */
const REQUIRED: SendingDomainResolver = (ctx) => evaluateSendingDomain(ctx, REQUIRED_RUNTIME);
const NOT_REQUIRED: SendingDomainResolver = (ctx) => evaluateSendingDomain(ctx, NOT_REQUIRED_RUNTIME);

const VERIFIED_IDENTITY = {
  VerifiedForSendingStatus: true,
  DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
  MailFromAttributes: { MailFromDomain: 'mail.example.co.jp', MailFromDomainStatus: 'SUCCESS' },
};

let database: IsolationDatabase;
let admin: UnextendedClient;
let ownerA: AuthenticatedTenantCtx;
let jobCtx: SystemTenantCtx;
let connectors: Connectors;
let mailQueue: PendingAccountMailQueue;
/** `account.mail` の再 enqueue 先（`send.hold-release` が積む先）。 */
let reissued: { tenantId: string; kind: string; targetId: string; recipientClass: string; token: string }[];

/** 🔴 実 SES の代わり。ネットワークに出ない。 */
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
 * 🔴 `account.mail` の deps。**`resolveSendingDomain` には本番の実体を渡す**
 *    （`resolveSendingDomainFromDb`）。ここをスタブにすると、検証しているのが
 *    「テストの都合で null を返す関数」になってしまい、`BR-51` の担保にならない。
 */
function accountMailDeps() {
  return {
    emailSender: connectors.email,
    emailImplementationKind: 'mock' as const,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: resolveSendingDomainFromDb,
    now: () => NOW,
    appUrl: 'https://app.example.test',
    // 🔴 SP-07 が配線する dep。ここでは特権接続で引く（本テストの対象は保留と復帰であり、
    //    宛先の引き当てではない）。
    resolveRecipientEmail: async (job: { targetId: string }) => {
      const row = await admin.invitation.findFirst({
        where: { id: job.targetId },
        select: { email: true },
      });
      return row?.email ?? null;
    },
  } as never;
}

async function runAccountMail(job: {
  tenantId: string;
  kind: string;
  targetId: string;
  recipientClass: string;
  token: string;
}) {
  return createAccountMailHandler(accountMailDeps())(job, 'job-account-mail');
}

/** `send.hold-release`（毎 10 分）。🔴 `reissueAccountMail` に**実体**を渡す。 */
async function runHoldRelease() {
  const handler = createSendHoldReleaseHandler({
    emailSender: connectors.email,
    providerDailyQuota: 200,
    providerQuotaWarnRatio: 0.8,
    providerSentCounter: new InMemoryProviderSendCounter(),
    enqueueEmailDispatch: async () => {
      throw new Error('本テストは account.mail 由来の保留しか作らない');
    },
    reissueAccountMail: createAccountMailReissue({
      enqueueAccountMail: async (job) => {
        reissued.push(job as never);
      },
      invitationTtlMs: INVITATION_TTL_MS,
      now: () => NOW,
    }),
    releaseSendHolds: async () => 0,
    now: () => NOW,
  } as never);
  return handler({ tenantId: TENANT_A }, 'job-hold-release');
}

/** 送信ドメインを **VERIFIED** にする（登録 → provision → verify の実経路を通す）。 */
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

async function invitePartner(email: string) {
  return issueInvitation(
    ownerA,
    { email, role: 'PARTNER_ADMIN', partnerCompanyId: PARTNER_A1 },
    META,
    REQUIRED,
    NOW,
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
      role: 'ADMIN',
      lifecycleState: 'ACTIVE',
      twoFactor: 'VERIFIED',
    },
    { deviceKind: 'api' },
  );
  jobCtx = systemTenantCtx(TENANT_A, { queue: 'account.mail', jobId: 'job-1' });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.emailDispatch.deleteMany({});
  await admin.tenantSendingDomain.deleteMany({});
  await admin.invitation.deleteMany({ where: { email: { contains: '@hold-test.example' } } });
  await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
  connectors = createConnectors({
    email: 'mock',
    objectStore: 'mock',
    malwareScanner: 'mock',
    esign: 'mock',
    billing: 'mock',
  });
  mailQueue = new PendingAccountMailQueue();
  configureAccountMailQueue(mailQueue);
  reissued = [];
});

describe('🔴 ③ F-007 AC-5: 未検証でも招待は作られ、送達だけが保留される', () => {
  it('#14 の応答が HELD_DOMAIN_UNVERIFIED になり、招待行は作成されている', async () => {
    const result = await invitePartner('partner-held@hold-test.example');

    expect(result.deliveryState).toBe('HELD_DOMAIN_UNVERIFIED');
    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.partnerCompanyId).toBe(PARTNER_A1);
    expect(row?.acceptedAt).toBeNull();
  });

  it('🔴 ①② 送信ジョブは外部を 1 度も呼ばずに保留する（共通ドメインへ落とさない）', async () => {
    await invitePartner('partner-held2@hold-test.example');
    const job = mailQueue.jobsOf('INVITATION')[0];

    const outcome = await runAccountMail(job as never);

    expect(outcome).toEqual({ kind: 'HELD_DOMAIN_UNVERIFIED' });
    // 🔴 外部への発行が 0 件（モックと実装で共通の `callCount()`）。
    expect(connectors.email.callCount()).toBe(0);
  });

  it('🔴 保留は障害ではない（FAILED でない / failureReason が無い / heldAt がある）', async () => {
    await invitePartner('partner-held3@hold-test.example');
    await runAccountMail(mailQueue.jobsOf('INVITATION')[0] as never);

    const dispatch = await admin.emailDispatch.findFirst({ where: { tenantId: TENANT_A } });
    expect(dispatch?.status).toBe('HELD_DOMAIN_UNVERIFIED');
    expect(dispatch?.heldAt).not.toBeNull();
    expect(dispatch?.failureReason).toBeNull();
    expect(dispatch?.sentAt).toBeNull();
    // 🔴 テナントの日次上限（`RATE_LIMIT`）とも区別される（枠を消費していない）。
    const counter = await admin.usageCounter.findFirst({ where: { metric: 'EMAIL_COUNT' } });
    expect(counter).toBeNull();
  });

  it('🔴 ⑤ 自社メンバー宛（分類 1）は同じ状況でも保留されない（F-001 AC-5）', async () => {
    await issueInvitation(
      ownerA,
      { email: 'host-member@hold-test.example', role: 'SALES' },
      META,
      REQUIRED,
      NOW,
    );
    const outcome = await runAccountMail(mailQueue.jobsOf('INVITATION')[0] as never);

    expect(outcome.kind).toBe('MOCKED');
    expect(connectors.email.callCount()).toBe(1);
  });

  it('🔴 sandbox 相当（検証を求めない環境）では応答が保留にならない', async () => {
    const result = await issueInvitation(
      ownerA,
      { email: 'partner-sandbox@hold-test.example', role: 'PARTNER_ADMIN', partnerCompanyId: PARTNER_A1 },
      META,
      NOT_REQUIRED,
      NOW,
    );
    expect(result.deliveryState).toBe('MOCKED');
  });
});

describe('🔴 ④ 検証完了で自動復帰する（E2E #9 の前半 / docs/05 §8.3 の復帰手順）', () => {
  it('ドメインが未検証のままなら 1 件も復帰しない（保留のまま次回へ）', async () => {
    await invitePartner('partner-stay@hold-test.example');
    await runAccountMail(mailQueue.jobsOf('INVITATION')[0] as never);

    const outcome = await runHoldRelease();

    expect(outcome.domainReleased).toBe(0);
    expect(reissued).toEqual([]);
    const dispatch = await admin.emailDispatch.findFirst({ where: { tenantId: TENANT_A } });
    expect(dispatch?.status).toBe('HELD_DOMAIN_UNVERIFIED');
  });

  it('🔴 検証後はトークンが再発行され、旧リンクが失効し、外部への発行は合計 1 通', async () => {
    const invitation = await invitePartner('partner-release@hold-test.example');
    const firstJob = mailQueue.jobsOf('INVITATION')[0];
    const oldToken = firstJob?.token as string;
    await runAccountMail(firstJob as never);
    expect(connectors.email.callCount()).toBe(0);

    // 顧客が DNS レコードを設定し、検証が完了した。
    await verifyDomain();

    const outcome = await runHoldRelease();
    expect(outcome.domainReleased).toBe(1);
    expect(reissued).toHaveLength(1);

    // 🔴 保留していた行は「置き換わった」印を持ち、二度と送られない。
    const superseded = await admin.emailDispatch.findFirst({
      where: { id: (await admin.emailDispatch.findFirst({ where: { heldAt: { not: null } } }))?.id },
    });
    expect(superseded?.status).toBe('SUPPRESSED');
    expect(superseded?.failureReason).toBe('REISSUED');

    // 🔴 新しいトークンは旧トークンと別物であり、旧リンクはもう引けない。
    const newToken = reissued[0]?.token as string;
    expect(newToken).not.toBe(oldToken);
    expect(await readInvitationByToken(oldToken, NOW)).toBeNull();
    expect(await readInvitationByToken(newToken, NOW)).toMatchObject({
      status: 'VALID',
      role: 'PARTNER_ADMIN',
    });

    // 🔴 再 enqueue されたジョブを実行すると、今度は送られる（合計 1 通）。
    const sent = await runAccountMail(reissued[0] as never);
    expect(sent.kind).toBe('MOCKED');
    expect(connectors.email.callCount()).toBe(1);
    expect(mailQueue.jobsOf('INVITATION')[0]?.targetId).toBe(invitation.id);
  });

  it('🔴 受諾期限は再発行時点から数え直す（保留期間を差し引かない）', async () => {
    const invitation = await invitePartner('partner-ttl@hold-test.example');
    await runAccountMail(mailQueue.jobsOf('INVITATION')[0] as never);
    await verifyDomain();
    await runHoldRelease();

    const row = await admin.invitation.findFirst({ where: { id: invitation.id } });
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + INVITATION_TTL_MS);
  });

  /**
   * 🔴 `reissueHeldInvitationToken` の WHERE 句
   *    （`accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now`）が唯一の防御線である。
   *    3 つの述語を**実 DB で 1 つずつ**踏む。ここが緩むと、
   *      - 期限切れ … 届いた時にはもう使えないリンクを送る
   *      - 受諾済み … すでに利用者が作られた招待に、新しい有効なリンクを配る
   *      - 取消済み … `ADMIN` が取り消した招待が、保留の復帰で**復活する**
   *    のいずれかが起きる（どれも `F-002`「1 回限りの受諾」と `F-007 AC-4` の規律を破る）。
   */
  const BLOCKED: readonly (readonly [
    string,
    { expiresAt?: Date; acceptedAt?: Date; revokedAt?: Date },
  ])[] = [
    ['期限切れ', { expiresAt: new Date(NOW.getTime() - 1_000) }],
    ['受諾済み', { acceptedAt: NOW }],
    ['取消済み', { revokedAt: NOW }],
  ];

  it.each(BLOCKED)('🔴 %s の招待は再発行されない（トークンも書き換わらない）', async (label, patch) => {
    const invitation = await invitePartner(
      `partner-${encodeURIComponent(label)}@hold-test.example`,
    );
    await runAccountMail(mailQueue.jobsOf('INVITATION')[0] as never);

    const before = await admin.invitation.findFirst({ where: { id: invitation.id } });
    await admin.invitation.update({ where: { id: invitation.id }, data: patch });
    await verifyDomain();

    const outcome = await runHoldRelease();

    expect(outcome.domainReleased).toBe(0);
    expect(reissued).toEqual([]);

    // 🔴 保留行は閉じる（閉じないと 10 分ごとに拾い続ける）。再招待は #14 の明示操作。
    const dispatch = await admin.emailDispatch.findFirst({ where: { tenantId: TENANT_A } });
    expect(dispatch?.status).toBe('SUPPRESSED');
    expect(dispatch?.failureReason).toBe('EXPIRED');

    // 🔴 招待行のトークンは 1 文字も変わっていない（＝ WHERE 句が UPDATE を弾いた）。
    const after = await admin.invitation.findFirst({ where: { id: invitation.id } });
    expect(after?.tokenHash).toBe(before?.tokenHash);
    expect(after?.expiresAt.getTime()).toBe(
      patch.expiresAt === undefined ? before?.expiresAt.getTime() : patch.expiresAt.getTime(),
    );
  });

  it('🔴 2 回続けて実行しても 2 通目は積まれない（CAS が「1 通」を担保する）', async () => {
    await invitePartner('partner-twice@hold-test.example');
    await runAccountMail(mailQueue.jobsOf('INVITATION')[0] as never);
    await verifyDomain();

    await runHoldRelease();
    await runHoldRelease();

    expect(reissued).toHaveLength(1);
  });
});

describe('🔴 ⑥ F-022 AC-7: requireVerifiedSendingDomain（422 + DNS レコード）', () => {
  it('未検証なら 422 になり、設定すべき DNS レコードが応答に載る', async () => {
    const error = await applyGuards(ownerA, [
      requireVerifiedSendingDomain({ resolve: REQUIRED }),
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendingDomainNotVerifiedError);
    const params = (error as SendingDomainNotVerifiedError).params as {
      state: string | null;
      dkimRecords: unknown[];
      mailFromRecords: unknown[];
    };
    // 🔴 まだ 1 件も登録していない状態（`S-036` の「未設定」）。
    expect(params.state).toBeNull();
    expect(params.mailFromRecords).toEqual([]);
  });

  it('🔴 登録済み・未検証なら DKIM の CNAME と MAIL FROM の MX / TXT が返る', async () => {
    const { row } = await registerSendingDomain(ownerA, { domain: DOMAIN, observedAt: NOW });
    await createDomainProvisionHandler({
      identityApi: stubIdentityApi(),
      configurationSet: 'ses-platform-test',
      commonSendingDomain: 'ses-platform.example',
      now: () => NOW,
    } as never)({ tenantId: TENANT_A, sendingDomainId: row.id }, 'job-provision');

    const error = (await applyGuards(ownerA, [
      requireVerifiedSendingDomain({ resolve: REQUIRED }),
    ]).catch((caught: unknown) => caught)) as SendingDomainNotVerifiedError;

    const params = error.params as {
      domain: string;
      state: string;
      dkimRecords: { name: string }[];
      mailFromRecords: { type: string }[];
    };
    expect(params.domain).toBe(DOMAIN);
    expect(params.state).toBe('PENDING');
    expect(params.dkimRecords.map((record) => record.name)).toEqual([
      't1._domainkey.example.co.jp',
      't2._domainkey.example.co.jp',
      't3._domainkey.example.co.jp',
    ]);
    expect(params.mailFromRecords.map((record) => record.type).sort()).toEqual(['MX', 'TXT']);
  });

  it('検証済みなら通る', async () => {
    await verifyDomain();
    await expect(
      applyGuards(ownerA, [
        requireVerifiedSendingDomain({ resolve: REQUIRED }),
      ]),
    ).resolves.toBeUndefined();
  });

  it('🔴 検証を求めない環境では、行が 1 件も無くても通る（docs/03 §3.2.7-4 / -5）', async () => {
    await expect(
      applyGuards(ownerA, [
        requireVerifiedSendingDomain({ resolve: NOT_REQUIRED }),
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('🔴 ジョブ文脈でも判定は同じ経路を通る（2 つの実装にしない）', () => {
  it('未検証なら送信元が引けない（`resolveSendingDomainFromDb` が null）', async () => {
    expect(await resolveSendingDomainFromDb(jobCtx)).toBeNull();
  });

  it('検証済みなら独自ドメインが引ける（共通ドメインではない）', async () => {
    await verifyDomain();
    expect(await resolveSendingDomainFromDb(jobCtx)).toEqual({
      domain: DOMAIN,
      mailFromDomain: 'mail.example.co.jp',
      verifiedAt: NOW,
    });
  });
});
