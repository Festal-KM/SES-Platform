// tests/isolation/send-proposal-unknown.test.ts
// 🔴 T-09-07（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-07）: **応答不明の隔離と `SUBMIT_FAILED` の確定**を
//    **実 DB（RLS 付き）+ 実 Redis（BullMQ）+ 実 Route Handler（#36 / #39 / #41 / #43 / #44 / #45）+ 実 `gate.run`（モック AI）+
//    実 `send.proposal` / `send.hold-release` / `send.settle-unknown`** で証明する。docs/05 §10.6 / §10.2 ⑥ / §17.3 #8、
//    `docs/02` `F-022 AC-2` / `AC-3` / `AC-6`、`BR-22` / `BR-23`、`CLAUDE.md` §3.4 / §4.2「`SUBMITTING` は片道」。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 応答不明（モックの台本 `unknown` = 受け付けた後に応答が返らない）→ `SendAttempt.UNKNOWN` + `SUBMIT_FAILED(UNKNOWN:TimeoutError)`
//      + `ProposalEvent(system)` + `AuditLog(proposal.submit, SYSTEM, result UNKNOWN)`。`callCount()` は **1**（外部には届いた可能性がある）。
//      対照: ネットワーク断（`unreachable` = 送る前に失敗）は `FAILED` + `SUBMIT_FAILED(TRANSIENT:ECONNREFUSED)` で `callCount()` は **0**
//   ② 🔴 **自動再送されない**: 同じジョブの再実行 / `send.hold-release` / BullMQ の再配送（実 Worker が同じ `jobId` を消費）/
//      `send.settle-unknown` / 時間を 1 日進める —— いずれも外部呼出が増えず、状態は `SUBMIT_FAILED` のまま。#43 は 422
//   ③ 🔴 **`SUBMITTING` は片道**: ⑤ の後・⑥ の前にプロセスが落ちた状況（`settleProposalSubmission` を throw させる注入）で
//      `SUBMITTING` + `RESERVED` のまま留まり、再実行しても `APPROVED` に戻らず外部呼出も増えない。`A-005` 項目 2 の材料
//      （`readSubmittingStalls`。T-11-04 の `monitoring.ts` を**読むだけ**）に現れる → `send.settle-unknown` が閾値超過で
//      `UNKNOWN(UNKNOWN:SETTLE_TIMEOUT)` + `SUBMIT_FAILED` に**確定させるだけ**（外部 0・`APPROVED` に戻さない・試行を作らない）→ `A-005` から
//      消え、`S-022` に「届いた可能性」として現れる。閾値未満では触らない。③ の後・④ の前に落ちた滞留（予約なし）は
//      `SETTLE_TIMEOUT:UNSENT`（外部を呼んでいない = 届いた可能性を出さない）
//   ④ 人手再送（実 #44）で seq 2 が採番され **1 回だけ**送信され、`SendAttempt` は 2 行（seq 1 UNKNOWN / seq 2 SUCCEEDED）
//   ⑤ 🔴 `SUBMIT_FAILED` は `LOST` / `GATE_FAILED` / `DECLINED` と別の状態として保持される（#45 の `byState`。`F-022 AC-6` / `BR-23`）
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）/ `sendingDomainRuntime`（起動時 DI の値）/ `MockAnthropicClient` / メール
//    （`packages/connectors/src/mock` = `development` / `demo` / E2E と**同一実装**。台本は `createEmailSender` の `mockEmail` から渡す）
//    / `@ses/db` の 2 関数の**一時的な throw**（プロセス消失の再現。実装は本物をそのまま呼ぶ）だけ。実 API に接続しない。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import {
  createEmailSender,
  gateRunJobId,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  MOCK_EMAIL_PROVIDER_CODES,
  sendProposalJobId,
  type EmailSender,
  type MockEmailStep,
  type SendProposalJob,
  type SesIdentityApi,
} from '@ses/connectors';
import {
  createBullMqGateRunQueue,
  createBullMqSendProposalQueue,
  createBullMqWorker,
  type BullMqGateRunQueue,
  type BullMqSendProposalQueue,
  type BullMqWorker,
} from '@ses/connectors/bullmq';
import {
  configurePlatformReadDb,
  configureTenantDb,
  disconnectPlatformReadDb,
  disconnectTenantDb,
  PROPOSAL_SEND_SETTLE_TIMEOUT,
  PROPOSAL_SEND_SETTLE_TIMEOUT_UNSENT,
  registerSendingDomain,
  resolvePlatformCtx,
  resolveTenantCtx,
  type AuthenticatedPlatformCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { readSubmittingStalls } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { createDomainProvisionHandler } from '../../apps/worker/src/jobs/domain-provision.js';
import { createDomainVerifyHandler } from '../../apps/worker/src/jobs/domain-verify.js';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import { createSendHoldReleaseHandler } from '../../apps/worker/src/jobs/send-hold-release.js';
import {
  createSendProposalHandler,
  resolveProposalSendingDomainFromDb,
  type SendProposalDeps,
} from '../../apps/worker/src/jobs/send-proposal.js';
import { createSendSettleUnknownHandler } from '../../apps/worker/src/jobs/send-settle-unknown.js';
import {
  ENGINEER_A_PARTNER,
  PARTNER_A1,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P1_PRIVATE,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.97' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const DOMAIN = 'example.co.jp';
const STALL_MINUTES = 30;
const PLATFORM_OWNER_ID = '01930000-0000-7000-8000-0000000009c7';
const REASON = 'T0907 先方に電話で未着を確認した';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const sendingDomainRuntime = { region: 'ap-northeast-1', verificationRequired: true };
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  sendingDomainRuntime: () => sendingDomainRuntime,
}));

/**
 * 🔴 プロセス消失の再現（③）。`@ses/db` の実装はそのまま呼び、**次の 1 回だけ** throw する印を立てる。
 *    - `settleProposalSubmission` … ⑤ の後・⑥ の前に落ちた（`SUBMITTING` + `RESERVED` の滞留）
 *    - `reserveSendAttempt` … ③ の後・④ の前に落ちた（`SUBMITTING` で予約が無い滞留 = 外部は呼ばれていない）
 */
const crash = vi.hoisted(() => ({ settleOnce: false, reserveOnce: false }));
vi.mock('@ses/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ses/db')>();
  return {
    ...actual,
    settleProposalSubmission: async (...args: Parameters<typeof actual.settleProposalSubmission>) => {
      if (crash.settleOnce) {
        crash.settleOnce = false;
        throw new Error('T0907: ⑤ の後・⑥ の前でプロセスが消えた（注入）');
      }
      return actual.settleProposalSubmission(...args);
    },
    reserveSendAttempt: async (...args: Parameters<typeof actual.reserveSendAttempt>) => {
      if (crash.reserveOnce) {
        crash.reserveOnce = false;
        throw new Error('T0907: ③ の後・④ の前でプロセスが消えた（注入）');
      }
      return actual.reserveSendAttempt(...args);
    },
  };
});

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const submitRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/submit/route');
const resendRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/resend/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');
const { configureSendProposalJobQueue, resetSendProposalJobQueue } = await import('../../apps/web/lib/jobs/send-proposal-queue');
const { listProposalSendFailures } = await import('../../apps/web/lib/proposals/send-failures');
const { sendFailureRows } = await import('../../apps/web/lib/proposals/send-failure-rows');

const P1_NAME = 'T0907 佐藤 花子';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009d7';
const SKILL_NAME = 'Gleam(t0907)';
const RECIPIENT = { recipientCompanyName: 'T0907 架空エンド株式会社', recipientEmail: 't0907-recipient@example.test' };
const CLEAN_BODY = `ご提案します。${SKILL_NAME} の経験が 6 年あります。`;
const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;
const PII_FAIL_OUTPUT = {
  pii: {
    verdict: 'FAIL',
    findings: [{ kind: 'FULL_NAME', field: 'body', offsetStart: 0, offsetEnd: 4, excerpt: '氏名らしき記載', severity: 'BLOCK' }],
  },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;
const AUDIT_ACTIONS = ['proposal.create', 'proposal.update', 'proposal.approve', 'proposal.submit', 'proposal.resend', 'state.invalid_transition'];

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
      return {
        VerifiedForSendingStatus: true,
        DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
        MailFromAttributes: { MailFromDomain: `mail.${DOMAIN}`, MailFromDomainStatus: 'SUCCESS' },
      } as never;
    },
  };
}

/** 🔴 `development` / `demo` / E2E と同一のモック実装を、起動時 DI と同じ口（`mockEmail`）から台本付きで組み立てる。 */
function scriptedMock(script: readonly MockEmailStep[]): EmailSender {
  return createEmailSender('mock', { mockEmail: { script } });
}

let database: IsolationDatabase;
let redis: IsolationRedis;
let admin: UnextendedClient;
let gateQueue: BullMqGateRunQueue;
let sendQueue: BullMqSendProposalQueue;
let hostSales: AuthenticatedTenantCtx;
let hostOwner: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let platformOwner: AuthenticatedPlatformCtx;
let clock: Date;

type SubmitBody = {
  readonly outcome: 'ENQUEUED' | 'HELD';
  readonly attemptSeq: number;
  readonly jobId: string | null;
  readonly state: string;
  readonly sendHoldReasonKey: string | null;
};

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function createProposal(ctx: AuthenticatedTenantCtx, body: Record<string, unknown>): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.POST(
    new Request('https://app.test/api/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function requestGate(ctx: AuthenticatedTenantCtx, id: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
  expect(response.status).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  return jobId.split('.').at(-1) ?? '';
}

async function runGate(targetId: string, contentHash: string, output: unknown = CLEAN_OUTPUT) {
  const handler = createGateRunHandler({
    now: () => NOW,
    aiClient: createAiClient('mock', { mock: { script: [{ kind: 'output', output: output as never }] } }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
    aiDailyCostLimitUsd: '5.000000',
  });
  const key = { targetType: 'PROPOSAL', targetId, contentHash } as const;
  return handler({ tenantId: TENANT_A, ...key }, gateRunJobId(key));
}

async function submit(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return submitRoute.POST(new Request(`https://app.test/api/proposals/${id}/submit`, { method: 'POST' }), segment(id));
}

async function submitAccepted(ctx: AuthenticatedTenantCtx, id: string): Promise<SubmitBody> {
  const response = await submit(ctx, id);
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as SubmitBody;
}

/** 実 #44（`acknowledged: true` + 理由）。 */
async function resendAccepted(ctx: AuthenticatedTenantCtx, id: string): Promise<SubmitBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await resendRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acknowledged: true, reason: REASON }),
    }),
    segment(id),
  );
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as SubmitBody;
}

async function listByState(ctx: AuthenticatedTenantCtx): Promise<Record<string, number>> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.GET(new Request('https://app.test/api/proposals'));
  expect(response.status).toBe(200);
  return ((await response.json()) as { byState: Record<string, number> }).byState;
}

async function proposalRow(id: string) {
  return admin.proposal.findUniqueOrThrow({
    where: { id },
    select: { state: true, sendHoldReasonKey: true, sendHoldSince: true, submittedAt: true, lastFailureReason: true, updatedAt: true },
  });
}

async function events(id: string) {
  return admin.proposalEvent.findMany({
    where: { proposalId: id },
    orderBy: [{ id: 'asc' }],
    select: { kind: true, fromState: true, toState: true, actorUserId: true, note: true },
  });
}

async function attempts(id: string) {
  return admin.sendAttempt.findMany({
    where: { entityType: 'PROPOSAL', entityId: id },
    orderBy: [{ attemptSeq: 'asc' }],
    select: { attemptSeq: true, idempotencyKey: true, status: true, externalId: true, failureKind: true, failureDetail: true, requestedBy: true, settledAt: true },
  });
}

async function submitAudits(id: string) {
  return admin.auditLog.findMany({
    where: { targetId: id, action: 'proposal.submit' },
    orderBy: [{ id: 'asc' }],
    select: { actorKind: true, actorId: true, summary: true },
  });
}

/** 取引先 A1 が自社エンジニアで提案を作り、レビュー依頼 → `gate.run` → `APPROVAL_PENDING`（PASS）/ `GATE_FAILED`（FAIL）。 */
async function partnerProposalToPending(output: unknown = CLEAN_OUTPUT): Promise<{ readonly id: string; readonly contentHash: string }> {
  const id = await createProposal(partnerA1, {
    projectId: PROJECT_A_PUBLISHED,
    engineerId: ENGINEER_A_PARTNER,
    ...RECIPIENT,
    subject: 'ご提案',
    body: CLEAN_BODY,
    offeredUnitPrice: 650000,
    offeredStartDate: '2026-11-01',
  });
  const contentHash = await requestGate(partnerA1, id);
  await runGate(id, contentHash, output);
  return { id, contentHash };
}

async function approvedProposal(): Promise<string> {
  const pending = await partnerProposalToPending();
  requireTenantCtxMock.mockResolvedValue(hostSales);
  const response = await approveRoute.POST(new Request(`https://app.test/api/proposals/${pending.id}/approve`, { method: 'POST' }), segment(pending.id));
  expect(response.status).toBe(200);
  expect((await proposalRow(pending.id)).state).toBe('APPROVED');
  return pending.id;
}

async function verifyDomain(): Promise<void> {
  const { row } = await registerSendingDomain(hostOwner, { domain: DOMAIN, observedAt: NOW });
  const identityApi = stubIdentityApi();
  await createDomainProvisionHandler({
    identityApi,
    configurationSet: 'ses-platform-test',
    commonSendingDomain: 'ses-platform.example',
    now: () => NOW,
  } as never)({ tenantId: TENANT_A, sendingDomainId: row.id }, 'job-provision');
  await createDomainVerifyHandler({ identityApi, now: () => NOW } as never)({ tenantId: TENANT_A, sendingDomainId: row.id }, 'job-verify');
}

function sendDeps(emailSender: EmailSender, overrides: Partial<SendProposalDeps> = {}): SendProposalDeps {
  return {
    emailSender,
    emailImplementationKind: 'mock',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: resolveProposalSendingDomainFromDb,
    staleThresholdMinutes: 30,
    now: () => clock,
    ...overrides,
  };
}

function payloadOf(body: SubmitBody, proposalId: string, requestedBy: string | null = null): SendProposalJob {
  return { tenantId: TENANT_A, proposalId, attemptSeq: body.attemptSeq, requestedBy, enqueuedAt: clock.toISOString() };
}

function runJob(payload: SendProposalJob, deps: SendProposalDeps) {
  return createSendProposalHandler(deps)(payload, sendProposalJobId(payload));
}

/** `send.hold-release`（`Proposal` 側の再 enqueue を捕まえる）。 */
function holdRelease(emailSender: EmailSender) {
  const enqueued: SendProposalJob[] = [];
  const handler = createSendHoldReleaseHandler({
    emailSender,
    providerDailyQuota: 200,
    providerQuotaWarnRatio: 0.8,
    providerSentCounter: new InMemoryProviderSendCounter(),
    emailDailyLimit: 500,
    enqueueEmailDispatch: async () => {
      throw new Error('本テストは運用メールの保留を作らない');
    },
    reissueAccountMail: async () => {
      throw new Error('本テストは account.mail 由来の保留を作らない');
    },
    enqueueSendProposal: async (job: SendProposalJob) => {
      enqueued.push(job);
      return 'ENQUEUED' as const;
    },
    now: () => clock,
  } as never);
  return { run: () => handler({ tenantId: TENANT_A }, 'job-hold-release'), enqueued };
}

/** `send.settle-unknown`（本番と同じハンドラ。閾値は `SUBMITTING_STALL_ALERT_MINUTES` 相当の 30）。 */
function settleUnknown(now: Date) {
  return createSendSettleUnknownHandler({ now: () => now, submittingStallMinutes: STALL_MINUTES })({ tenantId: TENANT_A }, 'repeat:send.settle-unknown:1');
}

/** `A-005` 項目 2 の材料（T-11-04 の `readSubmittingStalls` を読むだけ）。 */
async function stalledCountOfTenantA(now: Date): Promise<number> {
  const stalls = await readSubmittingStalls(platformOwner, { now, stallThresholdMinutes: STALL_MINUTES, ipAddress: META.ipAddress });
  return stalls.rows.find((row) => row.tenantId === TENANT_A)?.count ?? 0;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  gateQueue = createBullMqGateRunQueue({ url: redis.url });
  sendQueue = createBullMqSendProposalQueue({ url: redis.url });
  clock = NOW;

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostOwner = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'OWNER', twoFactor: 'VERIFIED' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  platformOwner = await resolvePlatformCtx(
    { platformUserId: PLATFORM_OWNER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  await admin.skill.upsert({
    where: { id: SKILL_BACKED },
    create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 917 },
    update: {},
  });
  await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerSkill.create({
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED, yearsOfExperience: 6, level: 4, source: 'MANUAL' },
  });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { displayName: P1_NAME, contactEmail: null, contactPhone: null } });
  await admin.skillSheet.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.create({
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2025-01', periodTo: null, role: 'PG', description: 'T0907 架空の基幹刷新（合成データ）', technologies: 'Gleam / BEAM', source: 'MANUAL' },
  });
  await admin.tenant.update({ where: { id: TENANT_A }, data: { autoApproveEnabled: false, lifecycleState: 'ACTIVE' } });
  await admin.tenantSendingDomain.deleteMany({ where: { tenantId: TENANT_A } });
  // 🔴 送信元ドメインを検証済みにしておく（未検証だと #43 は `DOMAIN_UNVERIFIED` の保留になり ⑤ に到達しない。T-09-06 ④）。
  configureGateRunJobQueue(gateQueue);
  configureSendProposalJobQueue(sendQueue);
  await verifyDomain();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER, description: { startsWith: 'T0907' } } });
  resetGateRunJobQueue();
  resetSendProposalJobQueue();
  await gateQueue?.close();
  await sendQueue?.close();
  await disconnectTenantDb();
  await disconnectPlatformReadDb();
  await admin?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  configureGateRunJobQueue(gateQueue);
  configureSendProposalJobQueue(sendQueue);
  clock = NOW;
  crash.settleOnce = false;
  crash.reserveOnce = false;
});

afterEach(async () => {
  const fixtureIds = [PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2, PROPOSAL_A_P1_PRIVATE];
  const created = await admin.proposal.findMany({ where: { tenantId: TENANT_A, id: { notIn: fixtureIds } }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await admin.sendAttempt.deleteMany({ where: { entityId: { in: ids } } });
  await admin.reviewGate.deleteMany({ where: { targetId: { in: ids } } });
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { in: ['AI_COST_USD', 'AI_UNIT_SHEET_PARSE', 'EMAIL_COUNT'] } } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ① 応答不明 → UNKNOWN + SUBMIT_FAILED（隔離）。ネットワーク断は FAILED（呼出 0）と区別される
// ---------------------------------------------------------------------------

describe('🔴 ① 応答不明（台本 unknown）は UNKNOWN + SUBMIT_FAILED に確定し、外部呼出は 1（届いた可能性）。ネットワーク断は FAILED で呼出 0', () => {
  it('unknown: SendAttempt.UNKNOWN(UNKNOWN:TimeoutError) + SUBMIT_FAILED + ProposalEvent(system) + AuditLog(SYSTEM, result UNKNOWN)。callCount = 1', async () => {
    const id = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    expect(body).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1, state: 'APPROVED' });
    const mock = scriptedMock([{ kind: 'unknown' }]);

    const outcome = await runJob(payloadOf(body, id), sendDeps(mock));
    expect(outcome).toEqual({ kind: 'FAILED', attemptSeq: 1, settlement: 'UNKNOWN', failureKind: `UNKNOWN:${MOCK_EMAIL_PROVIDER_CODES.unknown}` });
    // 🔴 外部には届いた可能性がある = 呼び出し 1 回（モックの記録 = 分類 3）。
    expect(mock.callCount()).toBe(1);

    const row = await proposalRow(id);
    expect(row.state).toBe('SUBMIT_FAILED');
    expect(row.lastFailureReason).toBe('UNKNOWN:TimeoutError');
    expect(row.sendHoldReasonKey).toBeNull();
    expect(row.submittedAt).toBeNull();

    const rows = await attempts(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attemptSeq: 1, idempotencyKey: `proposal:${id}:1`, status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', externalId: null, requestedBy: null });
    expect(rows[0]?.settledAt).not.toBeNull();
    // 🔴 `failure_detail` に宛先・本文を載せない。
    expect(rows[0]?.failureDetail ?? '').not.toContain(RECIPIENT.recipientEmail);
    expect(rows[0]?.failureDetail ?? '').not.toContain(CLEAN_BODY);

    const history = await events(id);
    expect(history.slice(-2)).toEqual([
      expect.objectContaining({ kind: 'STATE', fromState: 'APPROVED', toState: 'SUBMITTING', actorUserId: null }),
      expect.objectContaining({ kind: 'STATE', fromState: 'SUBMITTING', toState: 'SUBMIT_FAILED', actorUserId: null, note: 'SEND_FAILURE:UNKNOWN:TimeoutError' }),
    ]);
    const audits = await submitAudits(id);
    expect(audits.map((a) => a.actorKind)).toEqual(['USER', 'SYSTEM']);
    expect(audits[1]).toMatchObject({ actorKind: 'SYSTEM', actorId: null });
    expect(audits[1]?.summary).toMatchObject({
      operation: 'SUBMIT_SETTLE',
      attemptSeq: 1,
      idempotencyKey: `proposal:${id}:1`,
      result: 'UNKNOWN',
      toState: 'SUBMIT_FAILED',
      failureKind: 'UNKNOWN:TimeoutError',
      jobQueue: 'send.proposal',
    });
    // 🔴 監査の summary に宛先・本文・氏名が無い。
    const summaryText = JSON.stringify(audits[1]?.summary);
    for (const secret of [RECIPIENT.recipientEmail, RECIPIENT.recipientCompanyName, P1_NAME, CLEAN_BODY]) expect(summaryText).not.toContain(secret);

    // S-022: 応答不明は「失敗」と別の区分（届いた可能性）。
    const listed = await listProposalSendFailures(hostSales);
    expect(listed.items.map((item) => item.id)).toEqual([id]);
    const [view] = sendFailureRows(listed.items, clock);
    expect(view).toMatchObject({ failureCategory: 'UNKNOWN', deliveryUnknown: true, attemptCount: 1 });
  });

  it('対照 unreachable（送る前に失敗）: FAILED(TRANSIENT:ECONNREFUSED) + SUBMIT_FAILED。callCount = 0（届いていない）。S-022 は「届いた可能性」を出さない', async () => {
    const id = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const mock = scriptedMock([{ kind: 'unreachable' }]);

    const outcome = await runJob(payloadOf(body, id), sendDeps(mock));
    expect(outcome).toEqual({ kind: 'FAILED', attemptSeq: 1, settlement: 'FAILED', failureKind: `TRANSIENT:${MOCK_EMAIL_PROVIDER_CODES.unreachable}` });
    expect(mock.callCount()).toBe(0);
    expect((await proposalRow(id)).state).toBe('SUBMIT_FAILED');
    expect((await attempts(id))[0]).toMatchObject({ status: 'FAILED', failureKind: 'TRANSIENT:ECONNREFUSED' });
    // 🔴 送信系に再試行は無い（TRANSIENT でも FAILED に確定。attempts: 1）。再実行しても外部を呼ばない。
    expect(await runJob(payloadOf(body, id), sendDeps(mock))).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    expect(mock.callCount()).toBe(0);
    const [view] = sendFailureRows((await listProposalSendFailures(hostSales)).items, clock);
    expect(view).toMatchObject({ failureCategory: 'PROVIDER', deliveryUnknown: false });
  });
});

// ---------------------------------------------------------------------------
// ② 自動再送されない
// ---------------------------------------------------------------------------

describe('🔴 ② 自動再送されない（F-022 AC-3 / F-023 AC-1 / BR-22）: 再実行・hold-release・BullMQ の再配送・settle-unknown・時間経過のいずれでも外部 0 / SUBMIT_FAILED のまま', () => {
  let worker: BullMqWorker | null = null;

  afterAll(async () => {
    await worker?.close();
  });

  it('同じジョブの再実行 / send.hold-release / 実 Worker による同じ jobId の消費 / send.settle-unknown / 1 日後 —— 全部で callCount は 1 のまま', async () => {
    const id = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const mock = scriptedMock([{ kind: 'unknown' }, { kind: 'deliver' }]); // 2 回目以降が呼ばれたら deliver になる = 呼ばれていない証明が callCount で取れる
    const deps = sendDeps(mock);
    expect(await runJob(payloadOf(body, id), deps)).toMatchObject({ kind: 'FAILED', settlement: 'UNKNOWN' });
    expect(mock.callCount()).toBe(1);
    const before = await proposalRow(id);
    expect(before.state).toBe('SUBMIT_FAILED');
    const eventsBefore = (await events(id)).length;

    // (a) 同じジョブの再実行 → ①-b で止まる（外部を呼ばない）。
    expect(await runJob(payloadOf(body, id), deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    // (b) send.hold-release → 保留ではないので触らない。
    const release = holdRelease(mock);
    expect((await release.run()).sendHoldsReleased).toBe(0);
    expect(release.enqueued).toEqual([]);
    // (c) send.settle-unknown → SUBMITTING ではないので触らない（1 日後でも）。
    expect(await settleUnknown(new Date(clock.getTime() + DAY_MS))).toEqual({ scanned: 0, settled: [] });
    // (d) 時間を 1 日進めて再実行 → 同じ。
    clock = new Date(NOW.getTime() + DAY_MS);
    expect(await runJob({ ...payloadOf(body, id), enqueuedAt: clock.toISOString() }, deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    clock = NOW;
    // (e) BullMQ の再配送相当: #43 が積んだ同じ jobId のジョブを実 Worker が消費する（本番と同じ配線）。外部を呼ばず完了する。
    worker = createBullMqWorker({ queueName: 'send.proposal', connection: { url: redis.url }, handler: createSendProposalHandler(deps) });
    let jobState = await sendQueue.jobState({ proposalId: id, attemptSeq: 1 });
    for (let i = 0; i < 100 && jobState !== null; i += 1) {
      await delay(100);
      jobState = await sendQueue.jobState({ proposalId: id, attemptSeq: 1 });
    }
    expect(jobState, 'Worker が send.proposal を消費していない').toBeNull();
    // 同じ payload をもう一度積んでも（removeOnComplete で積める）、消費されて外部を呼ばない。
    expect(await sendQueue.enqueue(payloadOf(body, id))).toBe('ENQUEUED');
    jobState = await sendQueue.jobState({ proposalId: id, attemptSeq: 1 });
    for (let i = 0; i < 100 && jobState !== null; i += 1) {
      await delay(100);
      jobState = await sendQueue.jobState({ proposalId: id, attemptSeq: 1 });
    }
    expect(jobState).toBeNull();

    // 🔴 総括: 外部呼出は最初の 1 回だけ。状態・試行・履歴は増えていない。#43 は 422（SUBMIT_FAILED → APPROVED は #44 の専有）。
    expect(mock.callCount()).toBe(1);
    const after = await proposalRow(id);
    expect(after).toMatchObject({ state: 'SUBMIT_FAILED', lastFailureReason: 'UNKNOWN:TimeoutError', sendHoldReasonKey: null });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await attempts(id)).toHaveLength(1);
    expect((await events(id)).length).toBe(eventsBefore);
    expect((await submit(hostSales, id)).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// ③ SUBMITTING は片道: 滞留 → A-005 に現れる → send.settle-unknown が確定させるだけ
// ---------------------------------------------------------------------------

describe('🔴 ③ SUBMITTING は片道（F-022 AC-2）: ⑤ の後に落ちた滞留は APPROVED に戻らず、A-005 に現れ、send.settle-unknown が UNKNOWN + SUBMIT_FAILED に確定させるだけ', () => {
  it('⑤ の後・⑥ の前に落ちる → SUBMITTING + RESERVED のまま。再実行は外部 0。閾値超過で確定（外部 0 / 試行を作らない / APPROVED に戻さない）→ S-022 に「届いた可能性」', async () => {
    const id = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const mock = scriptedMock([{ kind: 'deliver' }]);
    const deps = sendDeps(mock);

    // ⑤ は成功（届いた）が ⑥ が落ちる = プロセス消失の再現。例外は握り潰されず外へ出る（attempts: 1 なので再試行にならない）。
    crash.settleOnce = true;
    await expect(runJob(payloadOf(body, id), deps)).rejects.toThrow('T0907: ⑤ の後・⑥ の前');
    expect(mock.callCount()).toBe(1);
    let row = await proposalRow(id);
    expect(row.state).toBe('SUBMITTING');
    expect(row.sendHoldReasonKey).toBeNull();
    let rows = await attempts(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attemptSeq: 1, status: 'RESERVED', settledAt: null });

    // 🔴 再実行しても APPROVED に戻らない・外部を呼ばない・試行が増えない（①-b で止まる。片道）。
    expect(await runJob(payloadOf(body, id), deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMITTING' });
    const release = holdRelease(mock);
    expect((await release.run()).sendHoldsReleased).toBe(0);
    expect(release.enqueued).toEqual([]);
    expect(mock.callCount()).toBe(1);
    expect((await proposalRow(id)).state).toBe('SUBMITTING');
    expect(await attempts(id)).toHaveLength(1);
    // #43 / #44 も通らない（SUBMITTING からの遷移は送信ジョブの専有）。
    expect((await submit(hostSales, id)).status).toBe(422);

    // 🔴 閾値未満: A-005 項目 2 に出ず、send.settle-unknown も触らない。
    const fresh = new Date(clock.getTime() + 10 * MINUTE_MS);
    expect(await stalledCountOfTenantA(fresh)).toBe(0);
    expect(await settleUnknown(fresh)).toEqual({ scanned: 0, settled: [] });
    expect((await proposalRow(id)).state).toBe('SUBMITTING');

    // 🔴 閾値超過: A-005 項目 2（readSubmittingStalls。読むだけ）に 1 件現れる。
    const stale = new Date(clock.getTime() + (STALL_MINUTES + 1) * MINUTE_MS);
    expect(await stalledCountOfTenantA(stale)).toBe(1);

    // 🔴 send.settle-unknown が確定させる: RESERVED → UNKNOWN、SUBMITTING → SUBMIT_FAILED。外部 0・APPROVED に戻さない・試行を作らない。
    const settled = await settleUnknown(stale);
    expect(settled).toEqual({ scanned: 1, settled: [{ proposalId: id, settledAttemptSeqs: [1], failureKind: PROPOSAL_SEND_SETTLE_TIMEOUT }] });
    expect(mock.callCount()).toBe(1);
    row = await proposalRow(id);
    expect(row).toMatchObject({ state: 'SUBMIT_FAILED', lastFailureReason: 'UNKNOWN:SETTLE_TIMEOUT', sendHoldReasonKey: null, submittedAt: null });
    rows = await attempts(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attemptSeq: 1, status: 'UNKNOWN', failureKind: 'UNKNOWN:SETTLE_TIMEOUT', externalId: null });
    expect(rows[0]?.settledAt).toEqual(stale);
    expect((await events(id)).at(-1)).toMatchObject({ kind: 'STATE', fromState: 'SUBMITTING', toState: 'SUBMIT_FAILED', actorUserId: null, note: 'SEND_FAILURE:UNKNOWN:SETTLE_TIMEOUT' });
    const audit = (await submitAudits(id)).at(-1);
    expect(audit).toMatchObject({ actorKind: 'SYSTEM', actorId: null });
    expect(audit?.summary).toMatchObject({
      operation: 'SUBMIT_SETTLE',
      attemptSeq: 1,
      result: 'UNKNOWN',
      toState: 'SUBMIT_FAILED',
      failureKind: 'UNKNOWN:SETTLE_TIMEOUT',
      externalCallMade: null,
      stallThresholdMinutes: STALL_MINUTES,
      jobQueue: 'send.settle-unknown',
    });
    // A-005 から消える。再実行は 0 件（冪等）。
    expect(await stalledCountOfTenantA(stale)).toBe(0);
    expect(await settleUnknown(stale)).toEqual({ scanned: 0, settled: [] });
    // S-022: 応答不明（届いた可能性）として現れる。
    const listed = await listProposalSendFailures(hostSales);
    expect(listed.items.map((item) => item.id)).toEqual([id]);
    const [view] = sendFailureRows(listed.items, stale);
    expect(view).toMatchObject({ failureCategory: 'UNKNOWN', deliveryUnknown: true, attemptCount: 1 });
    expect(view?.attempts[0]).toMatchObject({ seq: 1, status: 'UNKNOWN' });
    // 🔴 その後も SUBMIT_FAILED から APPROVED へ戻す経路は人間の #44 だけ（settle-unknown / 送信ジョブでは戻らない）。
    expect(await runJob(payloadOf(body, id), deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    expect(mock.callCount()).toBe(1);
  });

  it('③ の後・④ の前に落ちる（予約なし）→ 外部は呼ばれていない。確定は SETTLE_TIMEOUT:UNSENT（届いた可能性を出さない）で、試行は 0 行のまま', async () => {
    const id = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const mock = scriptedMock([{ kind: 'deliver' }]);
    const deps = sendDeps(mock);

    crash.reserveOnce = true;
    await expect(runJob(payloadOf(body, id), deps)).rejects.toThrow('T0907: ③ の後・④ の前');
    expect(mock.callCount()).toBe(0);
    expect((await proposalRow(id)).state).toBe('SUBMITTING');
    expect(await attempts(id)).toHaveLength(0);

    const stale = new Date(clock.getTime() + (STALL_MINUTES + 1) * MINUTE_MS);
    expect(await stalledCountOfTenantA(stale)).toBe(1);
    expect(await settleUnknown(stale)).toEqual({ scanned: 1, settled: [{ proposalId: id, settledAttemptSeqs: [], failureKind: PROPOSAL_SEND_SETTLE_TIMEOUT_UNSENT }] });
    expect(mock.callCount()).toBe(0);
    const row = await proposalRow(id);
    expect(row).toMatchObject({ state: 'SUBMIT_FAILED', lastFailureReason: 'SETTLE_TIMEOUT:UNSENT' });
    // 🔴 試行を作らない（attempt_seq を採番するのは人間の操作だけ）。
    expect(await attempts(id)).toHaveLength(0);
    const audit = (await submitAudits(id)).at(-1);
    expect(audit?.summary).toMatchObject({ operation: 'SUBMIT_SETTLE', attemptSeq: null, result: 'FAILED', failureKind: 'SETTLE_TIMEOUT:UNSENT', externalCallMade: false });
    // S-022: 「送信に失敗した」（届いた可能性は出さない = 人間の確認作業を増やさない）。
    const [view] = sendFailureRows((await listProposalSendFailures(hostSales)).items, stale);
    expect(view).toMatchObject({ failureCategory: 'OTHER', deliveryUnknown: false, attemptCount: 0 });
    // #44 で復帰でき、seq 1 が採番される（試行が無かったので INITIAL）。
    const resent = await resendAccepted(hostSales, id);
    expect(resent).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1, state: 'APPROVED' });
    expect(await runJob(payloadOf(resent, id), deps)).toMatchObject({ kind: 'SENT', attemptSeq: 1 });
    expect(mock.callCount()).toBe(1);
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
  });

  it('滞留の確定は他テナントの SUBMITTING に触れない（ジョブ文脈の RLS が母集団を決める）', async () => {
    // テナント B 相当の行は作らない（seed に SUBMITTING は無い）。代わりに、A の ctx で走らせた settle が A の滞留だけを返すこと、
    // B の ctx で走らせた settle が A の滞留を 0 件と見ることを確かめる。
    const id = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const mock = scriptedMock([{ kind: 'deliver' }]);
    crash.settleOnce = true;
    await expect(runJob(payloadOf(body, id), sendDeps(mock))).rejects.toThrow('T0907');
    const stale = new Date(clock.getTime() + (STALL_MINUTES + 1) * MINUTE_MS);
    const fromB = await createSendSettleUnknownHandler({ now: () => stale, submittingStallMinutes: STALL_MINUTES })({ tenantId: TENANT_B }, 'repeat:send.settle-unknown:b');
    expect(fromB).toEqual({ scanned: 0, settled: [] });
    expect((await proposalRow(id)).state).toBe('SUBMITTING');
    expect(await settleUnknown(stale)).toMatchObject({ scanned: 1 });
    expect((await proposalRow(id)).state).toBe('SUBMIT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// ④ 人手再送で 1 回だけ送信
// ---------------------------------------------------------------------------

describe('🔴 ④ 人手再送（実 #44）: seq 2 が採番され 1 回だけ送信。SendAttempt は 2 行（seq 1 UNKNOWN / seq 2 SUCCEEDED）', () => {
  it('応答不明 → #44（acknowledged + 理由）→ seq 2 のジョブ → SUBMITTED。外部合計 2（応答不明の 1 + 再送の 1）', async () => {
    const id = await approvedProposal();
    const first = await submitAccepted(hostSales, id);
    const mock = scriptedMock([{ kind: 'unknown' }, { kind: 'deliver' }]);
    const deps = sendDeps(mock);
    expect(await runJob(payloadOf(first, id), deps)).toMatchObject({ kind: 'FAILED', settlement: 'UNKNOWN' });
    expect(mock.callCount()).toBe(1);

    const second = await resendAccepted(hostSales, id);
    expect(second).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, state: 'APPROVED', sendHoldReasonKey: null });
    expect(second.jobId).toBe(sendProposalJobId({ proposalId: id, attemptSeq: 2 }));
    expect((await events(id)).at(-1)).toMatchObject({ fromState: 'SUBMIT_FAILED', toState: 'APPROVED', actorUserId: USER_A_HOST, note: `RESEND:${REASON}` });

    // 🔴 再送ジョブは §10.2 を最初から通り、seq 2 = RESEND（requestedBy = 人間）で 1 回だけ送る。
    expect(await runJob(payloadOf(second, id, USER_A_HOST), deps)).toMatchObject({ kind: 'SENT', attemptSeq: 2, mocked: true });
    expect(mock.callCount()).toBe(2);
    const row = await proposalRow(id);
    expect(row.state).toBe('SUBMITTED');
    expect(row.submittedAt).not.toBeNull();
    expect(row.lastFailureReason).toBeNull();
    const rows = await attempts(id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attemptSeq: 1, status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', requestedBy: null });
    expect(rows[1]).toMatchObject({ attemptSeq: 2, idempotencyKey: `proposal:${id}:2`, status: 'SUCCEEDED', requestedBy: USER_A_HOST });
    expect(rows[1]?.externalId).toMatch(/^mock-/);
    // seq 2 を再実行しても外部を呼ばない（SUBMITTED = APPROVED ではない）。seq 1 のジョブも同じ。
    expect(await runJob(payloadOf(second, id, USER_A_HOST), deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMITTED' });
    expect(await runJob(payloadOf(first, id), deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMITTED' });
    expect(mock.callCount()).toBe(2);
    // S-022 からは消えている（SUBMIT_FAILED 専用）。
    expect((await listProposalSendFailures(hostSales)).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ SUBMIT_FAILED は LOST / GATE_FAILED / DECLINED と別
// ---------------------------------------------------------------------------

describe('🔴 ⑤ F-022 AC-6 / BR-23: SUBMIT_FAILED は LOST / GATE_FAILED / DECLINED と別の状態として保持される（#45 の byState）', () => {
  it('応答不明で SUBMIT_FAILED になった提案と GATE_FAILED の提案が別のキーで数えられ、DECLINED は byState に存在しない', async () => {
    const failed = await approvedProposal();
    const body = await submitAccepted(hostSales, failed);
    await runJob(payloadOf(body, failed), sendDeps(scriptedMock([{ kind: 'unknown' }])));
    expect((await proposalRow(failed)).state).toBe('SUBMIT_FAILED');
    const gateFailed = await partnerProposalToPending(PII_FAIL_OUTPUT);
    expect((await proposalRow(gateFailed.id)).state).toBe('GATE_FAILED');

    const byState = await listByState(hostSales);
    expect(byState['SUBMIT_FAILED']).toBe(1);
    expect(byState['GATE_FAILED']).toBe(1);
    expect(byState).toHaveProperty('LOST');
    expect(byState).not.toHaveProperty('DECLINED');
    // 4 つの「うまくいかなかった」が別のキー（S-019 のフィルタ・集計の前提。DECLINED は提案依頼の側）。
    expect(Object.keys(byState)).toEqual(expect.arrayContaining(['SUBMIT_FAILED', 'GATE_FAILED', 'LOST', 'WITHDRAWN']));
    // 不存在の ID の再送は 404、GATE_FAILED への #44 は 422（SUBMIT_FAILED からしか戻せない）。
    requireTenantCtxMock.mockResolvedValue(hostSales);
    const gateFailedResend = await resendRoute.POST(
      new Request(`https://app.test/api/proposals/${gateFailed.id}/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acknowledged: true, reason: REASON }),
      }),
      segment(gateFailed.id),
    );
    expect(gateFailedResend.status).toBe(422);
    const missingId = randomUUID();
    const missing = await resendRoute.POST(
      new Request(`https://app.test/api/proposals/${missingId}/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acknowledged: true, reason: REASON }),
      }),
      segment(missingId),
    );
    expect(missing.status).toBe(404);
  });
});
