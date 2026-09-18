// tests/isolation/send-proposal.test.ts
// 🔴 T-09-06（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-06）: **提案の送信（`F-022 AC-1`〜`AC-7`）**を
//    **実 DB（RLS 付き）+ 実 Redis（BullMQ）+ 実 Route Handler（#36 / #39 / #41 / #43）+ 実 `gate.run`（モック AI）+
//    実 `send.proposal` / `send.hold-release`** で証明する。docs/05 §10.2 / §10.4 / §10.5 / §10.6 / §9.4 / §17.3 #7 #9 #10 #23。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 **同一提案に対して送信を 2 回起動しても、外部への送信は 1 回**（`F-022 AC-1`。`callCount() = 1` / `SendAttempt` 1 行 / `SUBMITTED`）
//   ② `GATE_FAILED` / `APPROVAL_PENDING` の提案は #43 が 422 で、ジョブも外部を呼ばず `SUBMITTING` に入らない（`F-020 AC-2` の送信側）
//   ③ 🔴 承認後に `content_hash` をずらした提案は `GATE_STALE` の保留（外部 0。E2E #10 の送信側）。`send.hold-release` は触らない
//   ④ 🔴 ドメイン未検証は `DOMAIN_UNVERIFIED` の保留（`SUBMIT_FAILED` ではない。`F-022 AC-7`）→ 検証後に自動復帰して送信（E2E #9）
//   ⑤ 🔴 `SUSPENDED` は `TENANT_SUSPENDED` の保留で、`castProposalToSubmitting` が呼ばれない（履歴が増えない）
//   ⑥ 🔴 `MAIL_PROVIDER_DAILY_QUOTA=1` で 2 件目が `PROVIDER_QUOTA`（`RATE_LIMIT` ではない）→ 24h 後の `send.hold-release` で `SUBMITTED`、
//      外部合計 2、`SendAttempt` は提案ごとに 1 行（§17.3 #23 の `send.*` 経路）。表示に `S-038` 導線が無い
//   ⑦ `SUBMIT_FAILED` → #44 相当 → seq 2 のジョブを `GATE_STALE` 保留 → #43 が 202 で `attemptSeq: 2`、`send_attempts` は増えない（T-09-05 の指摘）
//   ⑧ 取引先 / `VIEWER` の #43 は 403
//   ⑨ 明示的失敗は `SUBMIT_FAILED` + `SendAttempt.FAILED`、応答不明は `UNKNOWN`。同じ試行の再実行は外部を呼ばない（自動再試行なし）
//   ⑩ 実 BullMQ の Worker が #43 の enqueue を消費して `SUBMITTED` にし、`removeOnComplete` で記録が消える。分次上限は delayed（待機）
//   ⑪ `F-022 AC-4` / `AC-5`: 非本番の選択はモックで、提案先（分類 3）はモック sink で終わる
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）/ `sendingDomainRuntime`（起動時 DI の値）/ `MockAnthropicClient` / メール
//    （`packages/connectors/src/mock` = `development` / `demo` / E2E と同一実装、または SES API のスタブ）だけ。実 API に接続しない。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import {
  createConnectors,
  ExternalSendError,
  gateRunJobId,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  isMockedDelivery,
  sendProposalJobId,
  type Connectors,
  type EmailSender,
  type SendProposalJob,
  type SesApi,
  type SesIdentityApi,
  type SesSendEmailRequest,
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
  configureTenantDb,
  disconnectTenantDb,
  listSendAttempts,
  registerSendingDomain,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { resolveConnectorSelection } from '../../packages/config/src/connector-selection.js';
import { loadAppEnv } from '../../packages/config/src/load-env.js';
import { buildValidEnv } from '../../packages/config/src/testing/fixtures.js';
import { createDomainProvisionHandler } from '../../apps/worker/src/jobs/domain-provision.js';
import { createDomainVerifyHandler } from '../../apps/worker/src/jobs/domain-verify.js';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import { createSendHoldReleaseHandler } from '../../apps/worker/src/jobs/send-hold-release.js';
import {
  createSendProposalHandler,
  resolveProposalSendingDomainFromDb,
  type SendProposalDeps,
} from '../../apps/worker/src/jobs/send-proposal.js';
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
// 🔴 T-12-12: 執行点の deps は固定の上限ではなく既定値（`quotaDefaults`）を受け、`resolveTenantQuotas` が実 DB の上書きと合わせて解く。
import { quotaDefaultsWith } from './support/quota-defaults.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.96' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const DOMAIN = 'example.co.jp';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

/**
 * 🔴 起動時 DI の値（`production` / `staging` 相当 = 検証必須）。#43 の判定は本番と同じ `evaluateSendingDomain` を通す
 *    （テスト側で「未検証を返すだけの関数」に差し替えない）。
 */
const sendingDomainRuntime = { region: 'ap-northeast-1', verificationRequired: true };
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  sendingDomainRuntime: () => sendingDomainRuntime,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const submitRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/submit/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');
const { configureSendProposalJobQueue, resetSendProposalJobQueue } = await import('../../apps/web/lib/jobs/send-proposal-queue');
const { readProposalApproval } = await import('../../apps/web/lib/proposals/approval');
const { proposalApprovalRows } = await import('../../apps/web/lib/proposals/approval-rows');

const P1_NAME = 'T0906 佐藤 花子';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009d6';
const SKILL_NAME = 'Gleam(t0906)';
const RECIPIENT = { recipientCompanyName: 'T0906 架空エンド株式会社', recipientEmail: 't0906-recipient@example.test' };
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

const AUDIT_ACTIONS = ['proposal.create', 'proposal.update', 'proposal.approve', 'proposal.submit', 'state.invalid_transition'];

/** 🔴 実 SES の代わり（`production` 相当の構成で「実 `EmailSender` をモックした」もの。§17.3 #23）。ネットワークに出ない。 */
function stubSesApi(): SesApi & { sent: number; readonly requests: SesSendEmailRequest[] } {
  const api = {
    sent: 0,
    requests: [] as SesSendEmailRequest[],
    async sendEmail(request: SesSendEmailRequest) {
      api.sent += 1;
      api.requests.push(request);
      return { MessageId: `ses-msg-${api.sent}` };
    },
    async getAccount() {
      return { SendQuota: { Max24HourSend: 50_000, SentLast24Hours: 0 } };
    },
  };
  return api;
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
      return {
        VerifiedForSendingStatus: true,
        DkimAttributes: { Status: 'SUCCESS', Tokens: ['t1', 't2', 't3'] },
        MailFromAttributes: { MailFromDomain: `mail.${DOMAIN}`, MailFromDomainStatus: 'SUCCESS' },
      } as never;
    },
  };
}

/** 明示的失敗 / 応答不明を再現する `EmailSender`（外部へは出ない。`callCount` は呼ばれた回数）。 */
function throwingSender(error: () => Error): EmailSender & { calls: number } {
  const sender = {
    calls: 0,
    async send() {
      sender.calls += 1;
      throw error();
    },
    callCount: () => sender.calls,
    async getQuota() {
      return { max24h: 200, sentLast24h: 0, observedAt: clock };
    },
  };
  return sender;
}

let database: IsolationDatabase;
let redis: IsolationRedis;
let admin: UnextendedClient;
let gateQueue: BullMqGateRunQueue;
let sendQueue: BullMqSendProposalQueue;
let mockConnectors: Connectors;
let hostSales: AuthenticatedTenantCtx;
let hostOwner: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let clock: Date;

type ErrorBody = { readonly error: { readonly code: string; readonly params?: Record<string, unknown> } };
type CreatedBody = { readonly id: string };
type SubmitBody = {
  readonly outcome: 'ENQUEUED' | 'HELD';
  readonly attemptSeq: number;
  readonly jobId: string | null;
  readonly state: string;
  readonly sendHoldReasonKey: string | null;
  readonly sendingDomain?: { readonly dkimRecords: unknown[]; readonly mailFromRecords: unknown[] };
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
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function requestGate(ctx: AuthenticatedTenantCtx, id: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
  expect(response.status).toBe(202);
  const { jobId } = (await response.json()) as { jobId: string };
  const parts = jobId.split('.');
  return parts[parts.length - 1] ?? '';
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

async function approve(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return approveRoute.POST(new Request(`https://app.test/api/proposals/${id}/approve`, { method: 'POST' }), segment(id));
}

/** #43。🔴 body を送らない（送っても読まれない）。 */
async function submit(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return submitRoute.POST(new Request(`https://app.test/api/proposals/${id}/submit`, { method: 'POST' }), segment(id));
}

async function submitAccepted(ctx: AuthenticatedTenantCtx, id: string): Promise<SubmitBody> {
  const response = await submit(ctx, id);
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as SubmitBody;
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

async function proposalRow(id: string) {
  return admin.proposal.findUniqueOrThrow({
    where: { id },
    select: {
      state: true,
      sendHoldReasonKey: true,
      sendHoldSince: true,
      submittedAt: true,
      lastFailureReason: true,
      contentHash: true,
    },
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
    select: { attemptSeq: true, idempotencyKey: true, status: true, externalId: true, failureKind: true, requestedBy: true },
  });
}

async function submitAudits(id: string) {
  return admin.auditLog.findMany({
    where: { targetId: id, action: 'proposal.submit' },
    orderBy: [{ id: 'asc' }],
    select: { actorKind: true, actorId: true, summary: true },
  });
}

async function emailCount(): Promise<number> {
  const row = await admin.usageCounter.findFirst({ where: { tenantId: TENANT_A, metric: 'EMAIL_COUNT', periodKind: 'DAY' }, select: { value: true } });
  return row === null ? 0 : Number(row.value.toString());
}

/** 取引先 A1 が自社エンジニアで提案を作り、レビュー依頼 → `gate.run`（全層 PASS）→ `APPROVAL_PENDING` まで進める。 */
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

/** さらにホストが #41 で承認して `APPROVED` にする。 */
async function approvedProposal(): Promise<{ readonly id: string; readonly contentHash: string }> {
  const pending = await partnerProposalToPending();
  const response = await approve(hostSales, pending.id);
  expect(response.status).toBe(200);
  expect((await proposalRow(pending.id)).state).toBe('APPROVED');
  return pending;
}

/** 送信ドメインを **VERIFIED** にする（登録 → provision → verify の実経路を通す）。 */
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

/** `send.proposal` の deps（既定はモックのメール = `development` / `demo` / E2E と同一実装）。 */
function sendDeps(overrides: Partial<SendProposalDeps> = {}): SendProposalDeps {
  return {
    emailSender: mockConnectors.email,
    emailImplementationKind: 'mock',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    quotaDefaults: quotaDefaultsWith({ emailDailyLimit: 500 }),
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    // 🔴 本番の実体（未検証なら null。共通ドメインへ倒さない）。
    resolveSendingDomain: resolveProposalSendingDomainFromDb,
    staleThresholdMinutes: 30,
    now: () => clock,
    ...overrides,
  };
}

function payloadOf(body: SubmitBody, proposalId: string, requestedBy: string | null = null): SendProposalJob {
  return { tenantId: TENANT_A, proposalId, attemptSeq: body.attemptSeq, requestedBy, enqueuedAt: clock.toISOString() };
}

function runJob(payload: SendProposalJob, deps: SendProposalDeps = sendDeps()) {
  return createSendProposalHandler(deps)(payload, sendProposalJobId(payload));
}

/** `send.hold-release`（`Proposal` 側の再 enqueue を捕まえる）。 */
function holdRelease(overrides: Record<string, unknown> = {}) {
  const enqueued: SendProposalJob[] = [];
  const handler = createSendHoldReleaseHandler({
    emailSender: mockConnectors.email,
    providerDailyQuota: 200,
    providerQuotaWarnRatio: 0.8,
    providerSentCounter: new InMemoryProviderSendCounter(),
    quotaDefaults: quotaDefaultsWith({ emailDailyLimit: 500 }),
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
    ...overrides,
  } as never);
  return { run: () => handler({ tenantId: TENANT_A }, 'job-hold-release'), enqueued };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  gateQueue = createBullMqGateRunQueue({ url: redis.url });
  sendQueue = createBullMqSendProposalQueue({ url: redis.url });
  mockConnectors = createConnectors({ email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });
  clock = NOW;

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostOwner = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'OWNER', twoFactor: 'VERIFIED' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);

  await admin.skill.upsert({
    where: { id: SKILL_BACKED },
    create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 916 },
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
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2025-01', periodTo: null, role: 'PG', description: 'T0906 架空の基幹刷新（合成データ）', technologies: 'Gleam / BEAM', source: 'MANUAL' },
  });
  await admin.tenant.update({ where: { id: TENANT_A }, data: { autoApproveEnabled: false, lifecycleState: 'ACTIVE' } });
  await admin.tenantSendingDomain.deleteMany({ where: { tenantId: TENANT_A } });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER, description: { startsWith: 'T0906' } } });
  resetGateRunJobQueue();
  resetSendProposalJobQueue();
  await gateQueue?.close();
  await sendQueue?.close();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  configureGateRunJobQueue(gateQueue);
  configureSendProposalJobQueue(sendQueue);
  clock = NOW;
  sendingDomainRuntime.verificationRequired = true;
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
  await admin.tenant.update({ where: { id: TENANT_A }, data: { lifecycleState: 'ACTIVE' } });
});

// ---------------------------------------------------------------------------
// ④ F-022 AC-7 / E2E #9: ドメイン未検証は保留 → 検証後に自動復帰して送信
// ---------------------------------------------------------------------------

describe('🔴 ④ F-022 AC-7 / E2E #9: ドメイン未検証は DOMAIN_UNVERIFIED の保留（SUBMIT_FAILED ではない）→ 検証後に自動復帰して送信', () => {
  it('#43 は 202 で APPROVED のまま保留し DNS レコードを添える。verify 後の send.hold-release が同じ attemptSeq で再 enqueue → SUBMITTED', async () => {
    const { id } = await approvedProposal();
    const callsBefore = mockConnectors.email.callCount();

    // #43（検証必須の環境。ドメイン未登録）。
    const held = await submitAccepted(hostSales, id);
    expect(held).toMatchObject({ outcome: 'HELD', attemptSeq: 1, jobId: null, state: 'APPROVED', sendHoldReasonKey: 'DOMAIN_UNVERIFIED' });
    expect(held.sendingDomain).toBeDefined();
    let row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.sendHoldReasonKey).toBe('DOMAIN_UNVERIFIED');
    expect(row.sendHoldSince).not.toBeNull();
    expect(await attempts(id)).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    // 監査: 人間の要求（USER）が 1 行。保留の事実を残す。
    const requested = await submitAudits(id);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({ actorKind: 'USER', actorId: USER_A_HOST });
    expect(requested[0]?.summary).toMatchObject({ operation: 'SUBMIT_REQUEST', outcome: 'HELD', holdReasonKey: 'DOMAIN_UNVERIFIED' });

    // 画面（S-021）の表示: 保留の理由と S-036 への導線。
    const view = await readProposalApproval(hostSales, id, { now: clock });
    expect(view.view.audience === 'HOST' && view.view.sendHold?.reasonKey).toBe('DOMAIN_UNVERIFIED');
    const rows = proposalApprovalRows(view, clock);
    expect(rows.sendHold?.settingsLink?.href).toBe('/settings/sending-domains');
    expect(rows.sendHold?.autoRelease).toBe(true);

    // 検証前の hold-release は触らない（ドメインは未検証のまま）。
    const before = holdRelease();
    expect((await before.run()).sendHoldsReleased).toBe(0);
    expect(before.enqueued).toHaveLength(0);
    expect((await proposalRow(id)).sendHoldReasonKey).toBe('DOMAIN_UNVERIFIED');

    // 検証完了 → 自動復帰（同じ attemptSeq = 1 / INITIAL）。
    await verifyDomain();
    const after = holdRelease();
    const outcome = await after.run();
    expect(outcome.sendHoldsReleased).toBe(1);
    expect(after.enqueued).toHaveLength(1);
    expect(after.enqueued[0]).toMatchObject({ tenantId: TENANT_A, proposalId: id, attemptSeq: 1, requestedBy: null });
    row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.sendHoldReasonKey).toBeNull();

    // 復帰したジョブは §10.2 を最初から通って送る。
    const sent = await runJob(after.enqueued[0]!);
    expect(sent).toMatchObject({ kind: 'SENT', attemptSeq: 1, mocked: true });
    row = await proposalRow(id);
    expect(row.state).toBe('SUBMITTED');
    expect(row.submittedAt).not.toBeNull();
    expect(row.sendHoldReasonKey).toBeNull();
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
    const rows1 = await attempts(id);
    expect(rows1).toHaveLength(1);
    expect(rows1[0]).toMatchObject({ attemptSeq: 1, idempotencyKey: `proposal:${id}:1`, status: 'SUCCEEDED', requestedBy: null });
    expect(rows1[0]?.externalId).toMatch(/^mock-/);
    // 履歴: APPROVED→SUBMITTING（system）→ SUBMITTED（system）。監査: SYSTEM の確定行。
    const history = await events(id);
    expect(history.slice(-2)).toEqual([
      expect.objectContaining({ fromState: 'APPROVED', toState: 'SUBMITTING', actorUserId: null }),
      expect.objectContaining({ fromState: 'SUBMITTING', toState: 'SUBMITTED', actorUserId: null }),
    ]);
    const settled = (await submitAudits(id)).at(-1);
    expect(settled).toMatchObject({ actorKind: 'SYSTEM', actorId: null });
    expect(settled?.summary).toMatchObject({ operation: 'SUBMIT_SETTLE', attemptSeq: 1, result: 'SUCCEEDED', toState: 'SUBMITTED' });
    // EMAIL_COUNT（テナントの日次通数）が 1 増える（予約 = 消費。docs/05 §8.7）。
    expect(await emailCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ① F-022 AC-1: 2 回起動しても外部 1 回
// ---------------------------------------------------------------------------

describe('🔴 ① F-022 AC-1: 同一提案に対して送信を 2 回起動しても外部への送信は 1 回（同一 idempotency_key）', () => {
  it('#43 を 2 回 → 同じ attemptSeq / 同じ jobId（BullMQ は 1 本）。ジョブを 2 回実行 → 外部 1 回・SendAttempt 1 行・SUBMITTED', async () => {
    const { id } = await approvedProposal();
    const callsBefore = mockConnectors.email.callCount();

    const first = await submitAccepted(hostSales, id);
    const second = await submitAccepted(hostSales, id);
    expect(first).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1, state: 'APPROVED', sendHoldReasonKey: null });
    expect(second).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1 });
    expect(first.jobId).toBe(second.jobId);
    expect(first.jobId).toBe(sendProposalJobId({ proposalId: id, attemptSeq: 1 }));
    // 🔴 BullMQ の重複排除: 同じ jobId は待機中に 1 本。
    expect(await sendQueue.jobState({ proposalId: id, attemptSeq: 1 })).toBe('waiting');
    // 🔴 #43 は状態を動かさない（SUBMITTING に入れるのはジョブ）。
    expect((await proposalRow(id)).state).toBe('APPROVED');
    expect(await attempts(id)).toHaveLength(0);
    expect((await submitAudits(id)).filter((row) => row.actorKind === 'USER')).toHaveLength(2);

    // 同じ payload でジョブを 2 回実行する（古い重複ジョブ / 再起動の再現）。
    const payload = payloadOf(first, id);
    const outcome1 = await runJob(payload);
    const outcome2 = await runJob(payload);
    expect(outcome1).toMatchObject({ kind: 'SENT', attemptSeq: 1 });
    // 2 回目は ①-b（`SUBMITTED` = `APPROVED` ではない）で外部を呼ばずに終了する。
    expect(outcome2).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMITTED' });

    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
    expect(await attempts(id)).toHaveLength(1);
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
    // 確定の監査は 1 行だけ（2 回目は何も書かない）。
    expect((await submitAudits(id)).filter((row) => row.actorKind === 'SYSTEM')).toHaveLength(1);
  });

  it('🔴 同時 2 回のジョブ実行でも外部 1 回（③ の CAS が 1 つに絞り、負けた側は NOT_APPROVED か ②-d で止まる）', async () => {
    const { id } = await approvedProposal();
    const callsBefore = mockConnectors.email.callCount();
    const body = await submitAccepted(hostSales, id);
    const payload = payloadOf(body, id);

    const outcomes = await Promise.all([runJob(payload), runJob(payload)]);
    const kinds = outcomes.map((outcome) => ('kind' in outcome ? outcome.kind : 'DEFER')).sort();
    expect(kinds.filter((kind) => kind === 'SENT')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'SKIPPED' || kind === 'RESERVATION_CONFLICT')).toHaveLength(1);
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
    const rows = await attempts(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SUCCEEDED');
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
  });
});

// ---------------------------------------------------------------------------
// ② GATE_FAILED / APPROVAL_PENDING は SUBMITTING に入らない
// ---------------------------------------------------------------------------

describe('🔴 ② F-020 AC-2 の送信側: GATE_FAILED / APPROVAL_PENDING は #43 が 422 で、ジョブも外部を呼ばず SUBMITTING に入らない', () => {
  it('APPROVAL_PENDING: #43 は 422 INVALID_STATE_TRANSITION（記録あり）。ジョブは NOT_APPROVED で終了', async () => {
    const { id } = await partnerProposalToPending();
    const callsBefore = mockConnectors.email.callCount();

    const error = await errorOf(await submit(hostSales, id), 422);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await admin.auditLog.count({ where: { targetId: id, action: 'state.invalid_transition' } })).toBe(1);

    const outcome = await runJob({ tenantId: TENANT_A, proposalId: id, attemptSeq: 1, requestedBy: null, enqueuedAt: clock.toISOString() });
    expect(outcome).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'APPROVAL_PENDING' });
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
    expect(await attempts(id)).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect((await events(id)).filter((row) => row.toState === 'SUBMITTING')).toHaveLength(0);
  });

  it('GATE_FAILED（PII 層 FAIL）: #43 は 422。ジョブは外部を呼ばない。「無視して送信」の入口は無い', async () => {
    const { id } = await partnerProposalToPending(PII_FAIL_OUTPUT);
    expect((await proposalRow(id)).state).toBe('GATE_FAILED');
    const callsBefore = mockConnectors.email.callCount();

    const error = await errorOf(await submit(hostSales, id), 422);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    // 承認 API も 422（承認を経ない実行遷移は存在しない。docs/05 §10.3）。
    expect((await approve(hostSales, id)).status).toBe(422);

    const outcome = await runJob({ tenantId: TENANT_A, proposalId: id, attemptSeq: 1, requestedBy: null, enqueuedAt: clock.toISOString() });
    expect(outcome).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'GATE_FAILED' });
    expect((await proposalRow(id)).state).toBe('GATE_FAILED');
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// ③ E2E #10 の送信側: 承認後に内容が変わると GATE_STALE の保留
// ---------------------------------------------------------------------------

describe('🔴 ③ E2E #10 の送信側 / docs/05 §11.5 手順 4: 承認後に content_hash がずれた提案は GATE_STALE の保留で外部 0。自動復帰しない', () => {
  it('#43 は 202 で積むが、ジョブは ①-c で GATE_STALE。send.hold-release は触らない。戻して再度 #43 → 送信', async () => {
    const { id, contentHash } = await approvedProposal();
    const callsBefore = mockConnectors.email.callCount();
    const shifted = 'f'.repeat(64);
    await admin.proposal.update({ where: { id }, data: { contentHash: shifted } });

    const body = await submitAccepted(hostSales, id);
    expect(body.outcome).toBe('ENQUEUED');
    const outcome = await runJob(payloadOf(body, id));
    expect(outcome).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });

    let row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.sendHoldReasonKey).toBe('GATE_STALE');
    expect(await attempts(id)).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect((await events(id)).filter((r) => r.toState === 'SUBMITTING')).toHaveLength(0);

    // 🔴 GATE_STALE は send.hold-release の対象外（走査にも現れない）。
    const release = holdRelease();
    const released = await release.run();
    expect(released.proposalsScanned).toBe(0);
    expect(released.sendHoldsReleased).toBe(0);
    expect(release.enqueued).toHaveLength(0);
    expect((await proposalRow(id)).sendHoldReasonKey).toBe('GATE_STALE');

    // 表示: 自動復帰しない旨で、設定導線は無い。
    const rows = proposalApprovalRows(await readProposalApproval(hostSales, id, { now: clock }), clock);
    expect(rows.sendHold).toMatchObject({ reasonKey: 'GATE_STALE', autoRelease: false, settingsLink: null });

    // 人間が内容を確認して（ここでは元に戻して）再度「送信」を選ぶ。attemptSeq は 1 のまま（試行は無い）。
    await admin.proposal.update({ where: { id }, data: { contentHash } });
    const again = await submitAccepted(hostSales, id);
    expect(again).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1 });
    expect(await runJob(payloadOf(again, id))).toMatchObject({ kind: 'SENT', attemptSeq: 1 });
    row = await proposalRow(id);
    expect(row.state).toBe('SUBMITTED');
    // 🔴 ③ の CAS が保留列を同時に NULL に揃える（送信済みの行に保留が残らない）。
    expect(row.sendHoldReasonKey).toBeNull();
    expect(row.sendHoldSince).toBeNull();
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
  });

  it('②-a: enqueue から 30 分を超えて実行されたジョブは送らずに GATE_STALE（時間が経ったものを黙って送らない）', async () => {
    const { id } = await approvedProposal();
    const callsBefore = mockConnectors.email.callCount();
    const body = await submitAccepted(hostSales, id);
    const stale = { ...payloadOf(body, id), enqueuedAt: new Date(clock.getTime() - 31 * 60_000).toISOString() };
    expect(await runJob(stale)).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });
    expect((await proposalRow(id)).state).toBe('APPROVED');
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// ⑤ SUSPENDED
// ---------------------------------------------------------------------------

describe('🔴 ⑤ SUSPENDED は TENANT_SUSPENDED の保留。castProposalToSubmitting が呼ばれない（履歴が増えない）。解除で自動復帰', () => {
  it('tenants.lifecycle_state を読む（ctx.lifecycleState は常に ACTIVE 固定なので使わない）', async () => {
    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const callsBefore = mockConnectors.email.callCount();
    const historyBefore = await events(id);
    await admin.tenant.update({ where: { id: TENANT_A }, data: { lifecycleState: 'SUSPENDED' } });

    const outcome = await runJob(payloadOf(body, id));
    expect(outcome).toEqual({ kind: 'HELD', reasonKey: 'TENANT_SUSPENDED', applied: true });
    const row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.sendHoldReasonKey).toBe('TENANT_SUSPENDED');
    expect(await events(id)).toHaveLength(historyBefore.length);
    expect(await attempts(id)).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);

    // 停止中は hold-release も復帰させない（ファンアウトの母集団にも入らないが、判定でも止まる）。
    const suspended = holdRelease();
    expect((await suspended.run()).sendHoldsReleased).toBe(0);

    // 解除 → 復帰 → 送信。
    await admin.tenant.update({ where: { id: TENANT_A }, data: { lifecycleState: 'ACTIVE' } });
    const resumed = holdRelease();
    expect((await resumed.run()).sendHoldsReleased).toBe(1);
    expect(resumed.enqueued[0]).toMatchObject({ proposalId: id, attemptSeq: 1, requestedBy: null });
    expect(await runJob(resumed.enqueued[0]!)).toMatchObject({ kind: 'SENT' });
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
  });
});

// ---------------------------------------------------------------------------
// ⑥ PROVIDER_QUOTA（§17.3 #23 の send.* 経路）
// ---------------------------------------------------------------------------

describe('🔴 ⑥ docs/05 §17.3 #23 send.* 経路: MAIL_PROVIDER_DAILY_QUOTA=1 で 2 件目が PROVIDER_QUOTA（RATE_LIMIT ではない）→ 24h 後に SUBMITTED', () => {
  it('production 相当（実 EmailSender + SES API スタブ）で 2 件送信 → 2 件目は APPROVED のまま保留 → hold-release → 外部合計 2 / SendAttempt は提案ごとに 1 行', async () => {
    const sesApi = stubSesApi();
    const providerSentCounter = new InMemoryProviderSendCounter();
    const real = createConnectors(
      { email: 'real', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' },
      {
        ses: {
          api: sesApi,
          defaultFromAddress: 'no-reply@ses-platform.example',
          configurationSet: 'ses-platform-test',
          sentCounter: providerSentCounter,
          now: () => clock,
        },
      },
    );
    const deps = sendDeps({ emailSender: real.email, emailImplementationKind: 'real', providerDailyQuota: 1, providerSentCounter });

    const first = await approvedProposal();
    const second = await approvedProposal();
    const firstBody = await submitAccepted(hostSales, first.id);
    const secondBody = await submitAccepted(hostSales, second.id);

    // 1 件目: 送れる（枠 1 のうち 0 消費）。
    expect(await runJob(payloadOf(firstBody, first.id), deps)).toMatchObject({ kind: 'SENT', attemptSeq: 1, mocked: false });
    expect(sesApi.sent).toBe(1);
    // 2 件目: 環境の枠が尽きている → PROVIDER_QUOTA（テナントの残量は潤沢 = RATE_LIMIT ではない）。
    expect(await runJob(payloadOf(secondBody, second.id), deps)).toEqual({ kind: 'HELD', reasonKey: 'PROVIDER_QUOTA', applied: true });
    const heldRow = await proposalRow(second.id);
    expect(heldRow.state).toBe('APPROVED');
    expect(heldRow.sendHoldReasonKey).toBe('PROVIDER_QUOTA');
    expect(heldRow.lastFailureReason).toBeNull();
    expect(await attempts(second.id)).toHaveLength(0);
    expect(sesApi.sent).toBe(1);

    // 表示: 文言は「送信基盤の混雑により保留中…」で、S-038 への導線が無い（F-059 AC-7）。
    const rows = proposalApprovalRows(await readProposalApproval(hostSales, second.id, { now: clock }), clock);
    expect(rows.sendHold).toMatchObject({ reasonKey: 'PROVIDER_QUOTA', settingsLink: null, autoRelease: true });
    expect(rows.sendHold?.message).toContain('お客様側の設定では解消しません');
    expect(JSON.stringify(rows.sendHold)).not.toContain('/settings/usage');

    // 枠が尽きている間は hold-release も配らない（時刻ではなく decideProviderQuota で判定）。
    const full = holdRelease({ providerDailyQuota: 1, providerSentCounter, emailSender: real.email });
    expect((await full.run()).sendHoldsReleased).toBe(0);
    expect(full.enqueued).toHaveLength(0);

    // 24h + 1ms 進めると ZSET から落ちる → headroom 1 → 同じ attemptSeq で再 enqueue。
    clock = new Date(NOW.getTime() + DAY_MS + 1);
    const release = holdRelease({ providerDailyQuota: 1, providerSentCounter, emailSender: real.email });
    const outcome = await release.run();
    expect(outcome.headroom).toBe(1);
    expect(outcome.sendHoldsReleased).toBe(1);
    expect(release.enqueued[0]).toMatchObject({ proposalId: second.id, attemptSeq: 1, requestedBy: null });

    // 復帰したジョブは ①②③ を最初から通り、今度は送れる。
    expect(await runJob(release.enqueued[0]!, deps)).toMatchObject({ kind: 'SENT', attemptSeq: 1 });
    expect(sesApi.sent).toBe(2);
    expect((await proposalRow(second.id)).state).toBe('SUBMITTED');
    expect(await attempts(first.id)).toHaveLength(1);
    expect(await attempts(second.id)).toHaveLength(1);
    expect((await attempts(second.id))[0]).toMatchObject({ attemptSeq: 1, status: 'SUCCEEDED', externalId: 'ses-msg-2' });
  });

  it('テナントの日次上限（BLOCK）は RATE_LIMIT で、PROVIDER_QUOTA とは別の値。S-038 への導線がある', async () => {
    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    // 日次 500 のカウンタを上限まで埋める（判定は UsageCounter が正）。
    await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
    const dailyLimit = 3;
    const full = sendDeps({ quotaDefaults: quotaDefaultsWith({ emailDailyLimit: dailyLimit }) });
    // 3 通ぶんの予約を先に積む（別の送信が消費した状態）。
    for (let i = 0; i < dailyLimit; i += 1) {
      const other = await approvedProposal();
      const otherBody = await submitAccepted(hostSales, other.id);
      expect(await runJob(payloadOf(otherBody, other.id), full)).toMatchObject({ kind: 'SENT' });
    }
    expect(await emailCount()).toBe(dailyLimit);
    expect(await runJob(payloadOf(body, id), full)).toEqual({ kind: 'HELD', reasonKey: 'RATE_LIMIT', applied: true });
    const rows = proposalApprovalRows(await readProposalApproval(hostSales, id, { now: clock }), clock);
    expect(rows.sendHold).toMatchObject({ reasonKey: 'RATE_LIMIT', settingsLink: { href: '/settings/usage' } });
    // 上限に余地が戻れば hold-release が復帰させる。
    const release = holdRelease({ quotaDefaults: quotaDefaultsWith({ emailDailyLimit: dailyLimit + 1 }) });
    expect((await release.run()).sendHoldsReleased).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑦ SUBMIT_FAILED → #44 相当 → 保留 → #43 が seq 2
// ---------------------------------------------------------------------------

describe('🔴 ⑦ T-09-05 の指摘: SUBMIT_FAILED → #44 相当 → seq 2 のジョブが GATE_STALE 保留 → #43 は 409 ではなく 202 で attemptSeq: 2、send_attempts は増えない', () => {
  it('復帰経路そのもの（docs/05 §10.5）', async () => {
    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const failing = throwingSender(() => new ExternalSendError('PERMANENT', 'MessageRejected', 'rejected by provider'));
    expect(await runJob(payloadOf(body, id), sendDeps({ emailSender: failing }))).toEqual({
      kind: 'FAILED',
      attemptSeq: 1,
      settlement: 'FAILED',
      failureKind: 'PERMANENT:MessageRejected',
    });
    expect((await proposalRow(id)).state).toBe('SUBMIT_FAILED');
    expect(await attempts(id)).toHaveLength(1);

    // #44 相当（T-09-08）: 人間が了承して APPROVED に戻す。管理接続で状態と履歴（人間の再送記録）を作る。
    await admin.proposal.update({ where: { id }, data: { state: 'APPROVED' } });
    await admin.proposalEvent.create({
      data: { tenantId: TENANT_A, proposalId: id, kind: 'STATE', fromState: 'SUBMIT_FAILED', toState: 'APPROVED', actorUserId: USER_A_HOST, occurredAt: clock },
    });

    // seq 2 のジョブが ②-a（遅延超過）で GATE_STALE に。send_attempts は 1 行のまま。
    const late: SendProposalJob = { tenantId: TENANT_A, proposalId: id, attemptSeq: 2, requestedBy: USER_A_HOST, enqueuedAt: new Date(clock.getTime() - 31 * 60_000).toISOString() };
    expect(await runJob(late)).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });
    expect(await attempts(id)).toHaveLength(1);

    // 🔴 #43: 409 にしない。attemptSeq = MAX(1) + 1 = 2 を返し、送信ジョブを積む。send_attempts は増えない。
    const again = await submitAccepted(hostSales, id);
    expect(again).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, jobId: sendProposalJobId({ proposalId: id, attemptSeq: 2 }) });
    expect(await attempts(id)).toHaveLength(1);

    // seq 2 = RESEND（requestedBy = 人間）。送れる。
    const resend = payloadOf(again, id, USER_A_HOST);
    expect(await runJob(resend)).toMatchObject({ kind: 'SENT', attemptSeq: 2 });
    const rows = await attempts(id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ attemptSeq: 2, idempotencyKey: `proposal:${id}:2`, status: 'SUCCEEDED', requestedBy: USER_A_HOST });
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
    const settled = (await submitAudits(id)).filter((row) => row.actorKind === 'SYSTEM').at(-1);
    expect(settled?.summary).toMatchObject({ attemptSeq: 2, requestedBy: USER_A_HOST, result: 'SUCCEEDED' });
  });
});

// ---------------------------------------------------------------------------
// ⑧ 立場
// ---------------------------------------------------------------------------

describe('🔴 ⑧ 取引先 / VIEWER の #43 は 403。他テナント / 不存在は 404', () => {
  it('取引先（作成者本人）は 403。VIEWER は 403。状態も送信も動かない', async () => {
    const { id } = await approvedProposal();
    expect((await submit(partnerA1, id)).status).toBe(403);
    expect((await submit(hostViewer, id)).status).toBe(403);
    expect((await proposalRow(id)).state).toBe('APPROVED');
    expect(await attempts(id)).toHaveLength(0);
    expect(await submitAudits(id)).toHaveLength(0);
  });

  it('不存在の ID は 404（存在を教えない）', async () => {
    expect((await submit(hostSales, randomUUID())).status).toBe(404);
  });

  it('🔴 ジョブ payload の tenantId を改竄しても他テナントの提案に到達しない（RLS。レビュー指摘で追加）', async () => {
    // テナント A の APPROVED 提案に対し、tenantId だけを B に差し替えた payload で send.proposal を実行する。
    // SystemTenantCtx(B) の RLS 下では A の行が見えないため、readProposalForSend が null → SKIPPED(NOT_FOUND)。
    // 状態・保留・試行・履歴・外部呼出・監査のいずれも動かない。
    const { id } = await approvedProposal();
    const callsBefore = mockConnectors.email.callCount();
    const eventsBefore = (await events(id)).length;

    const outcome = await runJob({
      tenantId: TENANT_B,
      proposalId: id,
      attemptSeq: 1,
      requestedBy: null,
      enqueuedAt: clock.toISOString(),
    });
    expect(outcome).toEqual({ kind: 'SKIPPED', reason: 'NOT_FOUND', detail: null });

    const row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.sendHoldReasonKey).toBeNull();
    expect(await attempts(id)).toHaveLength(0);
    expect((await events(id)).length).toBe(eventsBefore);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect((await submitAudits(id)).filter((r) => r.actorKind === 'SYSTEM')).toHaveLength(0);

    // send.hold-release を B の文脈で走らせても A の保留行は走査に現れない。
    const release = holdRelease();
    const handlerB = createSendHoldReleaseHandler({
      emailSender: mockConnectors.email,
      providerDailyQuota: 200,
      providerQuotaWarnRatio: 0.8,
      providerSentCounter: new InMemoryProviderSendCounter(),
      quotaDefaults: quotaDefaultsWith({ emailDailyLimit: 500 }),
      enqueueEmailDispatch: async () => {
        throw new Error('unexpected');
      },
      reissueAccountMail: async () => {
        throw new Error('unexpected');
      },
      enqueueSendProposal: async () => 'ENQUEUED' as const,
      now: () => clock,
    } as never);
    const releasedB = await handlerB({ tenantId: TENANT_B }, 'job-hold-release-b');
    expect(releasedB.proposalsScanned).toBe(0);
    expect(release.enqueued).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 失敗と応答不明
// ---------------------------------------------------------------------------

describe('🔴 ⑨ 明示的失敗 / 応答不明は SUBMIT_FAILED に確定し、自動再試行しない（F-022 AC-2 / AC-3 / AC-6 / docs/05 §10.6）', () => {
  it('明示的失敗: FAILED + SUBMIT_FAILED + last_failure_reason。同じ試行の再実行は ②-d で止まり外部を呼ばない', async () => {
    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const failing = throwingSender(() => new ExternalSendError('PERMANENT', 'MessageRejected', 'rejected'));
    const deps = sendDeps({ emailSender: failing });

    expect(await runJob(payloadOf(body, id), deps)).toMatchObject({ kind: 'FAILED', settlement: 'FAILED' });
    const row = await proposalRow(id);
    expect(row.state).toBe('SUBMIT_FAILED');
    expect(row.lastFailureReason).toBe('PERMANENT:MessageRejected');
    expect(row.sendHoldReasonKey).toBeNull();
    expect((await attempts(id))[0]).toMatchObject({ status: 'FAILED', failureKind: 'PERMANENT:MessageRejected' });
    expect(failing.calls).toBe(1);

    // 🔴 再実行しても外部を呼ばない（状態が SUBMIT_FAILED = APPROVED ではない）。
    expect(await runJob(payloadOf(body, id), deps)).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    expect(failing.calls).toBe(1);
    // 履歴: SUBMITTING → SUBMIT_FAILED（system）と、失敗の種別のメモ。
    expect((await events(id)).at(-1)).toMatchObject({ fromState: 'SUBMITTING', toState: 'SUBMIT_FAILED', actorUserId: null, note: 'SEND_FAILURE:PERMANENT:MessageRejected' });
    // #43 は SUBMIT_FAILED からは 422（SUBMIT_FAILED → APPROVED は #44 の専有）。
    expect((await submit(hostSales, id)).status).toBe(422);
  });

  it('応答不明（タイムアウト）: UNKNOWN + SUBMIT_FAILED（隔離）。LOST / GATE_FAILED とは別の状態', async () => {
    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const timeout = throwingSender(() => new ExternalSendError('UNKNOWN', 'TimeoutError', 'timed out'));
    expect(await runJob(payloadOf(body, id), sendDeps({ emailSender: timeout }))).toMatchObject({ kind: 'FAILED', settlement: 'UNKNOWN' });
    expect((await proposalRow(id)).state).toBe('SUBMIT_FAILED');
    expect((await attempts(id))[0]).toMatchObject({ status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError' });
    expect(timeout.calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 実 BullMQ の Worker
// ---------------------------------------------------------------------------

describe('🔴 ⑩ 実 BullMQ: #43 の enqueue を Worker が消費して SUBMITTED にする。removeOnComplete で記録が消え、分次上限は delayed（待機）', () => {
  let worker: BullMqWorker | null = null;
  const minuteWindow = new InMemoryMinuteWindowCounter();

  afterAll(async () => {
    await worker?.close();
  });

  it('enqueue → 消費 → SUBMITTED（外部 1 回）。完了後に jobState は null。分次上限中は delayed で状態・保留列が動かない', async () => {
    const callsBefore = mockConnectors.email.callCount();
    // 🔴 本番と同じ配線（`createBullMqWorker` + `createSendProposalHandler`）。実装種別は development の選択（mock）。
    worker = createBullMqWorker({
      queueName: 'send.proposal',
      connection: { url: redis.url },
      handler: createSendProposalHandler(sendDeps({ minuteWindow, now: () => new Date() })),
    });

    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    let state = (await proposalRow(id)).state;
    for (let attempt = 0; attempt < 100 && state !== 'SUBMITTED'; attempt += 1) {
      await delay(100);
      state = (await proposalRow(id)).state;
    }
    expect(state, 'send.proposal の Worker がジョブを消費していない').toBe('SUBMITTED');
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
    expect(await attempts(id)).toHaveLength(1);
    // removeOnComplete: true → 完了したジョブは消える（保留後の再 enqueue が阻まれない）。
    let jobState = await sendQueue.jobState({ proposalId: id, attemptSeq: 1 });
    for (let attempt = 0; attempt < 50 && jobState !== null; attempt += 1) {
      await delay(100);
      jobState = await sendQueue.jobState({ proposalId: id, attemptSeq: 1 });
    }
    expect(jobState).toBeNull();
    expect(body.jobId).toBe(sendProposalJobId({ proposalId: id, attemptSeq: 1 }));

    // 分次上限（30 通 / 分）を埋める → 次のジョブは待機（delayed）。保留列も状態も動かない。
    const now = new Date();
    for (let i = 0; i < 30; i += 1) await minuteWindow.record(TENANT_A, now);
    const deferred = await approvedProposal();
    await submitAccepted(hostSales, deferred.id);
    let deferredState = await sendQueue.jobState({ proposalId: deferred.id, attemptSeq: 1 });
    for (let attempt = 0; attempt < 100 && deferredState !== 'delayed'; attempt += 1) {
      await delay(100);
      deferredState = await sendQueue.jobState({ proposalId: deferred.id, attemptSeq: 1 });
    }
    expect(deferredState).toBe('delayed');
    const row = await proposalRow(deferred.id);
    expect(row.state).toBe('APPROVED');
    expect(row.sendHoldReasonKey).toBeNull();
    expect(await attempts(deferred.id)).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// ⑪ 環境分離（F-022 AC-4 / AC-5）
// ---------------------------------------------------------------------------

describe('🔴 ⑪ F-022 AC-4 / AC-5: 提案先（分類 3）は production 以外でモック sink に流れ、実在の宛先へ到達しない', () => {
  it.each(['development', 'demo', 'sandbox'] as const)('%s: 起動時の選択で分類 3 はモック（isMockedDelivery = true）', (appEnv) => {
    const selection = resolveConnectorSelection(loadAppEnv(buildValidEnv(appEnv)));
    expect(isMockedDelivery(selection.email, 'CLIENT')).toBe(true);
  });

  it('production: 分類 3 は実送信（モックが選ばれない）。development の送信ジョブはモック sink で終わり mocked = true', async () => {
    const production = resolveConnectorSelection(loadAppEnv(buildValidEnv('production')));
    expect(production.email).toBe('real');
    expect(isMockedDelivery(production.email, 'CLIENT')).toBe(false);

    const development = resolveConnectorSelection(loadAppEnv(buildValidEnv('development')));
    expect(development.email).toBe('mock');
    const { id } = await approvedProposal();
    const body = await submitAccepted(hostSales, id);
    const outcome = await runJob(payloadOf(body, id), sendDeps({ emailImplementationKind: development.email }));
    expect(outcome).toMatchObject({ kind: 'SENT', mocked: true });
    // 🔴 モックの記録に平文の宛先が残らない（docs/05 §8.6 の denylist）。
    const listed = await listSendAttempts(hostSales, { entityType: 'PROPOSAL', entityId: id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.externalId).toMatch(/^mock-/);
  });

  // ✅ T-12-04（docs/05 §17.4「`production` の送信経路」= NFR-ENV-10 / SP-12 T-12-04 の Phase 1 の 3 行目）。
  //    ④ はモックの選択で「未検証は保留 → 検証後に自動復帰」を通した。ここは **`production` の選択表（実コネクタ `SesEmailSender`。
  //    SES の HTTP API はスタブ）**で同じ経路を通し、①未検証テナントの提案送信は `DOMAIN_UNVERIFIED` の保留で SES スタブが 0 通
  //    ②検証済みテナントでは 1 通 ③取引先宛の `From` に共通ドメイン（`SES_DEFAULT_FROM_ADDRESS`）が使われない、を固定する。
  //    ⚠️ 実 SES への疎通は E-1（本番アクセス承認）が前提で CI では叩けない —— 実 SES での 1 回の疎通は `T-12-11`（リリース手順）で行う。
  it('🔴 T-12-04 NFR-ENV-10: production の選択（real + SES スタブ）で、未検証は DOMAIN_UNVERIFIED の保留（SES 0 通）→ 検証後に 1 通。From は独自ドメインで共通ドメインではない', async () => {
    const production = resolveConnectorSelection(loadAppEnv(buildValidEnv('production')));
    expect(production.email).toBe('real');
    const sesApi = stubSesApi();
    const providerSentCounter = new InMemoryProviderSendCounter();
    const commonFrom = 'no-reply@ses-platform.example';
    const real = createConnectors(
      { email: production.email, objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' },
      { ses: { api: sesApi, defaultFromAddress: commonFrom, configurationSet: 'ses-platform-test', sentCounter: providerSentCounter, now: () => clock } },
    );
    const deps = sendDeps({ emailSender: real.email, emailImplementationKind: production.email, providerSentCounter });

    // ① 未検証（`sendingDomainRuntime.verificationRequired = true`。前のテストが検証済みにした行を消して「未登録」に戻す）。
    //    #43 は保留で積まず、ジョブを直叩きしても ①-d で保留。
    await admin.tenantSendingDomain.deleteMany({ where: { tenantId: TENANT_A } });
    const { id } = await approvedProposal();
    const held = await submitAccepted(hostSales, id);
    expect(held).toMatchObject({ outcome: 'HELD', attemptSeq: 1, jobId: null, state: 'APPROVED', sendHoldReasonKey: 'DOMAIN_UNVERIFIED' });
    expect(await runJob({ tenantId: TENANT_A, proposalId: id, attemptSeq: 1, requestedBy: null, enqueuedAt: clock.toISOString() }, deps)).toEqual({
      kind: 'HELD',
      reasonKey: 'DOMAIN_UNVERIFIED',
      applied: true,
    });
    expect(sesApi.sent).toBe(0);
    expect(real.email.callCount()).toBe(0);
    expect(await attempts(id)).toHaveLength(0);
    expect((await proposalRow(id)).state).toBe('APPROVED');

    // ② 検証完了 → `send.hold-release` が同じ attemptSeq で再 enqueue → 実コネクタで 1 通。
    await verifyDomain();
    const release = holdRelease({ emailSender: real.email, providerSentCounter });
    expect((await release.run()).sendHoldsReleased).toBe(1);
    expect(release.enqueued).toHaveLength(1);
    expect(await runJob(release.enqueued[0]!, deps)).toMatchObject({ kind: 'SENT', attemptSeq: 1, mocked: false, externalId: 'ses-msg-1' });
    expect(sesApi.sent).toBe(1);
    expect(real.email.callCount()).toBe(1);
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
    expect((await attempts(id))[0]).toMatchObject({ attemptSeq: 1, status: 'SUCCEEDED', externalId: 'ses-msg-1' });

    // ③ 🔴 取引先（分類 3）宛の From は検証済みの独自ドメイン。共通ドメインが 1 度も使われていない。
    expect(sesApi.requests).toHaveLength(1);
    const request = sesApi.requests[0]!;
    expect(request.Destination.ToAddresses).toEqual([RECIPIENT.recipientEmail]);
    expect(request.FromEmailAddress).toBe(`no-reply@${DOMAIN}`);
    expect(request.FromEmailAddress).not.toBe(commonFrom);
    expect(request.TenantName).toBe(`t-${TENANT_A}`);
    expect(request.Content.Template.TemplateName).toBe('PROPOSAL_SUBMISSION');
  });
});
