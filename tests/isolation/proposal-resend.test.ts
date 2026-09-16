// tests/isolation/proposal-resend.test.ts
// 🔴 T-09-08（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-08）: **送信失敗からの人手再送（`F-023 AC-1`〜`AC-3`）と `S-022`** を
//    **実 DB（RLS 付き）+ 実 Redis（BullMQ）+ 実 Route Handler（#36 / #39 / #41 / #43 / #44）+ 実 `gate.run`（モック AI）+
//    実 `send.proposal` / `send.hold-release`** で証明する。docs/05 §6.5 #44 / §10.1 / §10.6 / §12.5 / `CLAUDE.md` §3.4 / §4.2。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 `SUBMIT_FAILED` → #44（`acknowledged: true`）→ `APPROVED` + seq 2 のジョブ。ジョブ実行で `SUBMITTED`、**外部は再送分の 1 回だけ**、
//      `SendAttempt` は 2 行（seq 1 FAILED / seq 2 SUCCEEDED、`requested_by` = 操作者）
//   ② 🔴 `acknowledged: false` は 400 `RESEND_NOT_ACKNOWLEDGED`、欠落は 400 `VALIDATION`。状態・履歴・監査・キューは不変（`F-023 AC-2`）
//   ③ 🔴 `SUBMIT_FAILED` 以外（`APPROVED` / `SUBMITTED` / `GATE_FAILED`）は 422 `INVALID_STATE_TRANSITION` + `state.invalid_transition` の記録。
//      `APPROVAL_PENDING → APPROVED` は `APPROVE` の専有 = 422 `PROPOSAL_TRANSITION_RESERVED`（記録なし）
//   ④ 🔴 取引先（作成者本人）/ `VIEWER` は 403。状態不変
//   ⑤ 🔴 `AuditLog(proposal.resend)` に指示者・理由の文字数（`reasonLength`。本文は載せない）・`previousFailureKind`・`attemptSeq`（`F-023 AC-3`）。
//      全文は `ProposalEvent.note` に残る
//   ⑥ 🔴 `ProposalEvent(SUBMIT_FAILED → APPROVED)` の `actorUserId` = 操作者。`send.hold-release` の復帰（seq 2）が
//      そこから `requestedBy` を復元する（T-09-06 の申し送り 2。ドメイン未検証の保留 → 検証 → 復帰 → 送信）
//   ⑦ `SUBMIT_FAILED` → #44 → seq 2 が `GATE_STALE` 保留 → #43 が 202 で `attemptSeq: 2`、`send_attempts` は増えない
//      （管理接続で #44 を模した版は `send-proposal.test.ts` ⑦。ここは**実 #44** を通す）
//   ⑧ 🔴 他テナント（B）からは 404。不存在も 404
//   ⑨ `S-022` の一覧（`listProposalSendFailures`）: `SUBMIT_FAILED` だけ（保留中の `APPROVED` / `GATE_FAILED` / `SUBMITTED` は出ない）。
//      試行の要約（`externalId` を含む）が付く。取引先の文脈では自社の行だけ・試行は 0 行（C2）。テナント B からは 0 件
//   ⑩ 🔴 自動再送が存在しない: 同じ試行（seq 1）のジョブを再実行しても外部を呼ばず、`SUBMIT_FAILED` のまま
//   ⑪ 🔴 同一提案への同時 2 回の #44: 一方だけが CAS に勝ち 202、もう一方は 422（現在の状態次第）。
//      `send.proposal` のジョブは seq 2 の 1 本、`proposal.resend` の監査は 1 件、`send_attempts` は増えない（二重実行にならない）
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）/ `sendingDomainRuntime`（起動時 DI の値）/ `MockAnthropicClient` / メール
//    （`packages/connectors/src/mock` = `development` / `demo` / E2E と同一実装、または例外を投げるスタブ）だけ。実 API に接続しない。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import {
  createConnectors,
  ExternalSendError,
  gateRunJobId,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  sendProposalJobId,
  type Connectors,
  type EmailSender,
  type SendProposalJob,
  type SesIdentityApi,
} from '@ses/connectors';
import {
  createBullMqGateRunQueue,
  createBullMqSendProposalQueue,
  type BullMqGateRunQueue,
  type BullMqSendProposalQueue,
} from '@ses/connectors/bullmq';
import { configureTenantDb, disconnectTenantDb, registerSendingDomain, resolveTenantCtx, type AuthenticatedTenantCtx } from '@ses/db';
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
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.98' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const DOMAIN = 'example.co.jp';
const REASON = 'T0908 先方に電話で未着を確認した';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

/** 🔴 起動時 DI の値（`production` / `staging` 相当 = 検証必須）。#43 / #44 の判定は本番と同じ `evaluateSendingDomain` を通す。 */
const sendingDomainRuntime = { region: 'ap-northeast-1', verificationRequired: true };
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  sendingDomainRuntime: () => sendingDomainRuntime,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const submitRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/submit/route');
const resendRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/resend/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');
const { configureSendProposalJobQueue, resetSendProposalJobQueue } = await import('../../apps/web/lib/jobs/send-proposal-queue');
const { listProposalSendFailures } = await import('../../apps/web/lib/proposals/send-failures');
const { sendFailureRows } = await import('../../apps/web/lib/proposals/send-failure-rows');

const P1_NAME = 'T0908 佐藤 花子';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009d8';
const SKILL_NAME = 'Gleam(t0908)';
const RECIPIENT = { recipientCompanyName: 'T0908 架空エンド株式会社', recipientEmail: 't0908-recipient@example.test' };
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
let tenantBSales: AuthenticatedTenantCtx;
let clock: Date;

type ErrorBody = { readonly error: { readonly code: string; readonly details?: readonly string[] } };
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

/** #43。body を送らない。 */
async function submit(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return submitRoute.POST(new Request(`https://app.test/api/proposals/${id}/submit`, { method: 'POST' }), segment(id));
}

async function submitAccepted(ctx: AuthenticatedTenantCtx, id: string): Promise<SubmitBody> {
  const response = await submit(ctx, id);
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as SubmitBody;
}

/** 🔴 「body を送らない」の印（`undefined` は既定値に化けるため別の値にする）。 */
const NO_BODY = Symbol('no-body');

/** #44。`body` は呼び出し側が組む（既定 = 確認済み + 理由。`NO_BODY` = body なし）。 */
async function resend(ctx: AuthenticatedTenantCtx, id: string, body: unknown = { acknowledged: true, reason: REASON }): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return resendRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === NO_BODY ? {} : { body: JSON.stringify(body) }),
    }),
    segment(id),
  );
}

async function resendAccepted(ctx: AuthenticatedTenantCtx, id: string, body?: unknown): Promise<SubmitBody> {
  const response = await resend(ctx, id, body);
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as SubmitBody;
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status, await response.clone().text()).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

async function proposalRow(id: string) {
  return admin.proposal.findUniqueOrThrow({
    where: { id },
    select: { state: true, sendHoldReasonKey: true, sendHoldSince: true, submittedAt: true, lastFailureReason: true, contentHash: true, approvedAt: true },
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

async function audits(id: string, action: string) {
  return admin.auditLog.findMany({
    where: { targetId: id, action },
    orderBy: [{ id: 'asc' }],
    select: { actorKind: true, actorId: true, summary: true, ipAddress: true },
  });
}

/** 取引先 A1 が自社エンジニアで提案を作り、レビュー依頼 → `gate.run` → `APPROVAL_PENDING`（または PII FAIL で `GATE_FAILED`）。 */
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

function sendDeps(overrides: Partial<SendProposalDeps> = {}): SendProposalDeps {
  return {
    emailSender: mockConnectors.email,
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

function runJob(payload: SendProposalJob, deps: SendProposalDeps = sendDeps()) {
  return createSendProposalHandler(deps)(payload, sendProposalJobId(payload));
}

/** `send.hold-release`（`Proposal` 側の再 enqueue を捕まえる）。 */
function holdRelease() {
  const enqueued: SendProposalJob[] = [];
  const handler = createSendHoldReleaseHandler({
    emailSender: mockConnectors.email,
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

/**
 * 🔴 送信失敗の前提を**実経路**で作る: 承認済み → #43 → `send.proposal`（⑤ で明示的失敗）→ `SUBMIT_FAILED` + `SendAttempt(1, FAILED)`。
 *    `failureKind` は `PERMANENT:MessageRejected`（既定）または応答不明（`UNKNOWN:*`）。
 */
async function failedProposal(kind: 'PERMANENT' | 'UNKNOWN' = 'PERMANENT'): Promise<{ readonly id: string; readonly contentHash: string }> {
  const approved = await approvedProposal();
  const body = await submitAccepted(hostSales, approved.id);
  expect(body.outcome).toBe('ENQUEUED');
  const failing = throwingSender(() =>
    kind === 'PERMANENT'
      ? new ExternalSendError('PERMANENT', 'MessageRejected', 'rejected by provider')
      : new ExternalSendError('UNKNOWN', 'TimeoutError', 'no response'),
  );
  const outcome = await runJob(payloadOf(body, approved.id), sendDeps({ emailSender: failing }));
  expect(outcome).toMatchObject({ kind: 'FAILED', attemptSeq: 1, settlement: kind === 'PERMANENT' ? 'FAILED' : 'UNKNOWN' });
  expect(failing.calls).toBe(1);
  const row = await proposalRow(approved.id);
  expect(row.state).toBe('SUBMIT_FAILED');
  expect(row.lastFailureReason).toBe(kind === 'PERMANENT' ? 'PERMANENT:MessageRejected' : 'UNKNOWN:TimeoutError');
  expect(await attempts(approved.id)).toHaveLength(1);
  return approved;
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
  tenantBSales = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  await admin.skill.upsert({
    where: { id: SKILL_BACKED },
    create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 918 },
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
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2025-01', periodTo: null, role: 'PG', description: 'T0908 架空の基幹刷新（合成データ）', technologies: 'Gleam / BEAM', source: 'MANUAL' },
  });
  await admin.tenant.update({ where: { id: TENANT_A }, data: { autoApproveEnabled: false, lifecycleState: 'ACTIVE' } });
  await admin.tenantSendingDomain.deleteMany({ where: { tenantId: TENANT_A } });
  // 🔴 送信失敗を実経路で作るには ①-d を通る必要がある（検証済みドメイン）。
  await verifyDomain();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER, description: { startsWith: 'T0908' } } });
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
// ① F-023: SUBMIT_FAILED → #44 → APPROVED + seq 2 → ジョブ → SUBMITTED（外部は再送分の 1 回だけ）
// ---------------------------------------------------------------------------

describe('🔴 ① F-023: SUBMIT_FAILED → #44（acknowledged: true）→ APPROVED + seq 2 のジョブ → 実行で SUBMITTED。外部は再送分の 1 回だけ', () => {
  it('SendAttempt は 2 行（seq 1 FAILED / seq 2 SUCCEEDED、requested_by = 操作者）。履歴・監査に人間の再送が残る', async () => {
    const { id } = await failedProposal();
    const callsBefore = mockConnectors.email.callCount();
    const eventsBefore = await events(id);

    // #44
    const body = await resendAccepted(hostSales, id);
    expect(body).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, state: 'APPROVED', sendHoldReasonKey: null });
    expect(body.jobId).toBe(sendProposalJobId({ proposalId: id, attemptSeq: 2 }));
    // 🔴 202 の時点では APPROVED（SUBMITTING に入れるのはジョブ）。承認記録は残っている（CHECK: APPROVED は approved_at + content_hash）。
    let row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.approvedAt).not.toBeNull();
    expect(row.contentHash).not.toBeNull();
    // 🔴 前回の失敗種別は次の確定まで残る（S-022 の previousFailureKind の出所）。
    expect(row.lastFailureReason).toBe('PERMANENT:MessageRejected');
    // まだ外部は呼ばれていない。試行も増えていない（採番は読むだけ）。
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect(await attempts(id)).toHaveLength(1);
    // BullMQ に seq 2 のジョブが 1 本。
    expect(await sendQueue.jobState({ proposalId: id, attemptSeq: 2 })).not.toBeNull();

    // ⑥ 履歴: SUBMIT_FAILED → APPROVED は**人間**（actorUserId = 操作者）+ 'RESEND:<理由>'。
    const history = await events(id);
    expect(history).toHaveLength(eventsBefore.length + 1);
    expect(history.at(-1)).toMatchObject({ kind: 'STATE', fromState: 'SUBMIT_FAILED', toState: 'APPROVED', actorUserId: USER_A_HOST, note: `RESEND:${REASON}` });

    // ⑤ 監査: proposal.resend（USER）+ proposal.submit（SUBMIT_REQUEST, USER, seq 2）。
    const resendAudits = await audits(id, 'proposal.resend');
    expect(resendAudits).toHaveLength(1);
    expect(resendAudits[0]).toMatchObject({ actorKind: 'USER', actorId: USER_A_HOST, ipAddress: META.ipAddress });
    expect(resendAudits[0]?.summary).toEqual({
      operation: 'RESEND',
      fromState: 'SUBMIT_FAILED',
      toState: 'APPROVED',
      attemptSeq: 2,
      previousFailureKind: 'PERMANENT:MessageRejected',
      reasonLength: REASON.length,
    });
    const submitRequests = (await audits(id, 'proposal.submit')).filter((r) => r.actorKind === 'USER');
    expect(submitRequests.at(-1)?.summary).toMatchObject({ operation: 'SUBMIT_REQUEST', attemptSeq: 2, outcome: 'ENQUEUED', jobId: body.jobId });

    // seq 2 = RESEND（requestedBy = 人間）。§10.2 を最初から通って送る。
    const sent = await runJob(payloadOf(body, id, USER_A_HOST));
    expect(sent).toMatchObject({ kind: 'SENT', attemptSeq: 2, mocked: true });
    row = await proposalRow(id);
    expect(row.state).toBe('SUBMITTED');
    expect(row.submittedAt).not.toBeNull();
    expect(row.lastFailureReason).toBeNull();
    // 🔴 外部は再送分の 1 回だけ増える（初回の失敗は throwingSender 側で数えた）。
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
    const rows = await attempts(id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attemptSeq: 1, idempotencyKey: `proposal:${id}:1`, status: 'FAILED', failureKind: 'PERMANENT:MessageRejected', requestedBy: null });
    expect(rows[1]).toMatchObject({ attemptSeq: 2, idempotencyKey: `proposal:${id}:2`, status: 'SUCCEEDED', failureKind: null, requestedBy: USER_A_HOST });
    expect(rows[1]?.externalId).toMatch(/^mock-/);
    const settled = (await audits(id, 'proposal.submit')).filter((r) => r.actorKind === 'SYSTEM').at(-1);
    expect(settled?.summary).toMatchObject({ operation: 'SUBMIT_SETTLE', attemptSeq: 2, result: 'SUCCEEDED', requestedBy: USER_A_HOST });

    // ⑩ 🔴 自動再送が存在しない: 送信済みの提案に対して seq 1 / seq 2 のジョブを再実行しても外部を呼ばない。
    expect(await runJob(payloadOf({ ...body, attemptSeq: 1 }, id))).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMITTED' });
    expect(await runJob(payloadOf(body, id, USER_A_HOST))).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMITTED' });
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
    expect(await attempts(id)).toHaveLength(2);
  });

  it('🔴 ⑩ F-023 AC-1: 失敗した試行（seq 1）のジョブを再実行しても外部を呼ばず SUBMIT_FAILED のまま（人間の #44 だけが戻す）', async () => {
    const { id } = await failedProposal('UNKNOWN');
    const callsBefore = mockConnectors.email.callCount();
    // 同じ試行の再実行（BullMQ の自動再試行 / 手動の再実行に相当）: ②-d で止まる or 状態違いで止まる。外部 0。
    const again = await runJob({ tenantId: TENANT_A, proposalId: id, attemptSeq: 1, requestedBy: null, enqueuedAt: clock.toISOString() });
    expect(again).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    // 人間の再送を経ない seq 2 のジョブ（自動再送を模した payload）も状態違いで止まる。
    const forged = await runJob({ tenantId: TENANT_A, proposalId: id, attemptSeq: 2, requestedBy: USER_A_HOST, enqueuedAt: clock.toISOString() });
    expect(forged).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'SUBMIT_FAILED' });
    // send.hold-release も SUBMIT_FAILED を拾わない（失敗は保留ではない）。
    const release = holdRelease();
    await release.run();
    expect(release.enqueued).toHaveLength(0);
    const row = await proposalRow(id);
    expect(row.state).toBe('SUBMIT_FAILED');
    expect(row.lastFailureReason).toBe('UNKNOWN:TimeoutError');
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect(await attempts(id)).toHaveLength(1);
    expect(await audits(id, 'proposal.resend')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ② F-023 AC-2: acknowledged が true でなければ 400
// ---------------------------------------------------------------------------

describe('🔴 ② F-023 AC-2: acknowledged: false / 欠落 / body なしは 400。状態・履歴・監査・キューは不変', () => {
  it('false は RESEND_NOT_ACKNOWLEDGED、欠落は VALIDATION。reason 欠落も VALIDATION', async () => {
    const { id } = await failedProposal();
    const eventsBefore = (await events(id)).length;

    const notAcknowledged = await errorOf(await resend(hostSales, id, { acknowledged: false, reason: REASON }), 400);
    expect(notAcknowledged.code).toBe('RESEND_NOT_ACKNOWLEDGED');
    const missing = await errorOf(await resend(hostSales, id, { reason: REASON }), 400);
    expect(missing.code).toBe('VALIDATION');
    const noReason = await errorOf(await resend(hostSales, id, { acknowledged: true }), 400);
    expect(noReason.code).toBe('VALIDATION');
    const emptyReason = await errorOf(await resend(hostSales, id, { acknowledged: true, reason: '   ' }), 400);
    expect(emptyReason.code).toBe('VALIDATION');
    const stringTrue = await errorOf(await resend(hostSales, id, { acknowledged: 'true', reason: REASON }), 400);
    expect(stringTrue.code).toBe('VALIDATION');
    expect((await resend(hostSales, id, NO_BODY)).status).toBe(400);

    const row = await proposalRow(id);
    expect(row.state).toBe('SUBMIT_FAILED');
    expect((await events(id)).length).toBe(eventsBefore);
    expect(await audits(id, 'proposal.resend')).toHaveLength(0);
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
    expect(await attempts(id)).toHaveLength(1);
    expect(await sendQueue.jobState({ proposalId: id, attemptSeq: 2 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ③ SUBMIT_FAILED 以外は 422（記録あり）/ 専有の組は 422（記録なし）
// ---------------------------------------------------------------------------

describe('🔴 ③ SUBMIT_FAILED 以外は 422 INVALID_STATE_TRANSITION + state.invalid_transition の記録。APPROVAL_PENDING は APPROVE の専有 = 422 RESERVED', () => {
  it('APPROVED / SUBMITTED / GATE_FAILED → 422 + 記録。状態不変', async () => {
    const approved = await approvedProposal();
    const submitted = await approvedProposal();
    await runJob(payloadOf(await submitAccepted(hostSales, submitted.id), submitted.id));
    expect((await proposalRow(submitted.id)).state).toBe('SUBMITTED');
    const gateFailed = await partnerProposalToPending(PII_FAIL_OUTPUT);
    expect((await proposalRow(gateFailed.id)).state).toBe('GATE_FAILED');

    for (const [id, state] of [
      [approved.id, 'APPROVED'],
      [submitted.id, 'SUBMITTED'],
      [gateFailed.id, 'GATE_FAILED'],
    ] as const) {
      const error = await errorOf(await resend(hostSales, id), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await proposalRow(id)).state).toBe(state);
      const recorded = await audits(id, 'state.invalid_transition');
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.summary).toEqual({ entity: 'Proposal', from: state, to: 'APPROVED' });
      expect(await audits(id, 'proposal.resend')).toHaveLength(0);
    }
  });

  it('APPROVAL_PENDING → APPROVED は #41 の専有: #44 からは 422 PROPOSAL_TRANSITION_RESERVED（承認を再送で迂回できない。記録なし）', async () => {
    const pending = await partnerProposalToPending();
    const error = await errorOf(await resend(hostSales, pending.id), 422);
    expect(error.code).toBe('PROPOSAL_TRANSITION_RESERVED');
    expect((await proposalRow(pending.id)).state).toBe('APPROVAL_PENDING');
    expect(await audits(pending.id, 'state.invalid_transition')).toHaveLength(0);
    expect(await audits(pending.id, 'proposal.resend')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 立場 / ⑧ 他テナント
// ---------------------------------------------------------------------------

describe('🔴 ④ 取引先（作成者本人）/ VIEWER の #44 は 403。⑧ 他テナント / 不存在は 404。状態不変', () => {
  it('取引先は 403（requireRole）。VIEWER は 403。テナント B からは 404。不存在は 404', async () => {
    const { id } = await failedProposal();
    expect((await resend(partnerA1, id)).status).toBe(403);
    expect((await resend(hostViewer, id)).status).toBe(403);
    expect((await resend(tenantBSales, id)).status).toBe(404);
    expect((await resend(hostSales, randomUUID())).status).toBe(404);
    const row = await proposalRow(id);
    expect(row.state).toBe('SUBMIT_FAILED');
    expect(await attempts(id)).toHaveLength(1);
    expect(await audits(id, 'proposal.resend')).toHaveLength(0);
    expect(await sendQueue.jobState({ proposalId: id, attemptSeq: 2 })).toBeNull();
  });

  it('SUSPENDED のテナントでは 409（requireExecutable。F-004 AC-7）', async () => {
    const { id } = await failedProposal();
    await admin.tenant.update({ where: { id: TENANT_A }, data: { lifecycleState: 'SUSPENDED' } });
    const suspended = await resolveTenantCtx(
      { tenantId: TENANT_A, lifecycleState: 'SUSPENDED', partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED', partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' },
      DEVICE,
    );
    expect((await resend(suspended, id)).status).toBe(409);
    expect((await proposalRow(id)).state).toBe('SUBMIT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// ⑤ 監査の reasonLength（自由入力の PII を summary に残さない）
// ---------------------------------------------------------------------------

describe('🔴 ⑤ F-023 AC-3: 自由入力の reason は AuditLog.summary に文字数だけが残り、本文（PII を含みうる）は載らない', () => {
  it('summary.reasonLength は文字数、summary の文字列化に PII（メール / 電話）が含まれない。note には全文が残る', async () => {
    const { id } = await failedProposal('UNKNOWN');
    const reason = 'T0908 yamada@example.test 090-1234-5678 に電話';
    await resendAccepted(hostSales, id, { acknowledged: true, reason });
    const [audit] = await audits(id, 'proposal.resend');
    const summary = audit?.summary as { reasonLength: number; previousFailureKind: string; attemptSeq: number };
    expect(summary.reasonLength).toBe(reason.length);
    expect(summary.previousFailureKind).toBe('UNKNOWN:TimeoutError');
    expect(summary.attemptSeq).toBe(2);
    // 🔴 summary を丸ごと文字列化しても、reason 本文（PII）が 1 文字も出ない。
    const serializedSummary = JSON.stringify(audit?.summary);
    expect(serializedSummary).not.toContain('@');
    expect(serializedSummary).not.toContain('090-');
    expect((await events(id)).at(-1)?.note).toBe(`RESEND:${reason}`);
  });
});

// ---------------------------------------------------------------------------
// ⑥ ドメイン未検証 → 202 + DOMAIN_UNVERIFIED の保留 → 検証 → 復帰が requestedBy を復元する
// ---------------------------------------------------------------------------

describe('🔴 ⑥ 送信ドメイン未検証の #44 は 202 + DOMAIN_UNVERIFIED の保留（APPROVED のまま）。検証後の send.hold-release が seq 2 / requestedBy = 操作者で復帰', () => {
  it('保留 → 検証 → 復帰 → 送信。SendAttempt 2 行目の requested_by は ProposalEvent の人間から復元される', async () => {
    const { id } = await failedProposal();
    const callsBefore = mockConnectors.email.callCount();
    // 失敗の後にドメインが失効した（行を消す）。
    await admin.tenantSendingDomain.deleteMany({ where: { tenantId: TENANT_A } });
    try {
      const held = await resendAccepted(hostSales, id);
      expect(held).toMatchObject({ outcome: 'HELD', attemptSeq: 2, jobId: null, state: 'APPROVED', sendHoldReasonKey: 'DOMAIN_UNVERIFIED' });
      expect(held.sendingDomain).toBeDefined();
      let row = await proposalRow(id);
      expect(row.state).toBe('APPROVED');
      expect(row.sendHoldReasonKey).toBe('DOMAIN_UNVERIFIED');
      expect(await attempts(id)).toHaveLength(1);
      expect(await sendQueue.jobState({ proposalId: id, attemptSeq: 2 })).toBeNull();
      // 履歴に人間の再送、監査に proposal.resend + proposal.submit(HELD)。
      expect((await events(id)).at(-1)).toMatchObject({ fromState: 'SUBMIT_FAILED', toState: 'APPROVED', actorUserId: USER_A_HOST });
      expect((await audits(id, 'proposal.resend'))[0]?.summary).toMatchObject({ operation: 'RESEND', attemptSeq: 2 });
      expect((await audits(id, 'proposal.submit')).filter((r) => r.actorKind === 'USER').at(-1)?.summary).toMatchObject({
        operation: 'SUBMIT_REQUEST',
        attemptSeq: 2,
        outcome: 'HELD',
        holdReasonKey: 'DOMAIN_UNVERIFIED',
      });
      // 🔴 S-022 には出ない（保留は失敗ではない。docs/05 §10.4）。
      expect((await listProposalSendFailures(hostSales)).items.map((item) => item.id)).not.toContain(id);

      // 検証前の hold-release は触らない。
      const before = holdRelease();
      await before.run();
      expect(before.enqueued).toHaveLength(0);

      // 検証完了 → 復帰。🔴 attemptSeq 2 / requestedBy = 操作者（resolveProposalSendResumeOrigin が ProposalEvent から復元）。
      await verifyDomain();
      const after = holdRelease();
      expect((await after.run()).sendHoldsReleased).toBe(1);
      expect(after.enqueued).toHaveLength(1);
      expect(after.enqueued[0]).toMatchObject({ tenantId: TENANT_A, proposalId: id, attemptSeq: 2, requestedBy: USER_A_HOST });
      row = await proposalRow(id);
      expect(row.state).toBe('APPROVED');
      expect(row.sendHoldReasonKey).toBeNull();

      const sent = await runJob(after.enqueued[0]!);
      expect(sent).toMatchObject({ kind: 'SENT', attemptSeq: 2 });
      expect((await proposalRow(id)).state).toBe('SUBMITTED');
      expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);
      const rows = await attempts(id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ attemptSeq: 2, status: 'SUCCEEDED', requestedBy: USER_A_HOST });
    } finally {
      // 後続のテストのためにドメインを検証済みに戻す（消えたままなら再登録）。
      const existing = await admin.tenantSendingDomain.findFirst({ where: { tenantId: TENANT_A }, select: { id: true } });
      if (existing === null) await verifyDomain();
    }
  });
});

// ---------------------------------------------------------------------------
// ⑦ #44 → seq 2 が GATE_STALE 保留 → #43 が 202 で attemptSeq: 2（実 #44 版）
// ---------------------------------------------------------------------------

describe('🔴 ⑦ 実 #44 → seq 2 のジョブが GATE_STALE 保留（自動復帰しない）→ #43 が 202 で attemptSeq: 2、send_attempts は増えない → 送れる', () => {
  it('docs/05 §10.5 の復帰経路（send-proposal.test.ts ⑦ の管理接続版を実経路で）', async () => {
    const { id } = await failedProposal();
    const body = await resendAccepted(hostSales, id);
    expect(body.attemptSeq).toBe(2);
    // seq 2 のジョブが ②-a（遅延超過）で GATE_STALE に。
    const late: SendProposalJob = { ...payloadOf(body, id, USER_A_HOST), enqueuedAt: new Date(clock.getTime() - 31 * 60_000).toISOString() };
    expect(await runJob(late)).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });
    expect(await attempts(id)).toHaveLength(1);
    expect((await proposalRow(id)).sendHoldReasonKey).toBe('GATE_STALE');
    // 自動復帰しない。
    const release = holdRelease();
    await release.run();
    expect(release.enqueued).toHaveLength(0);
    // #44 は APPROVED なので 422（SUBMIT_FAILED ではない）。#43 が復帰経路。
    expect((await errorOf(await resend(hostSales, id), 422)).code).toBe('INVALID_STATE_TRANSITION');
    const again = await submitAccepted(hostSales, id);
    expect(again).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 2, jobId: sendProposalJobId({ proposalId: id, attemptSeq: 2 }) });
    expect(await attempts(id)).toHaveLength(1);
    expect(await runJob(payloadOf(again, id, USER_A_HOST))).toMatchObject({ kind: 'SENT', attemptSeq: 2 });
    expect((await proposalRow(id)).state).toBe('SUBMITTED');
    expect(await attempts(id)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ⑨ S-022 の一覧
// ---------------------------------------------------------------------------

describe('🔴 ⑨ S-022 の一覧（listProposalSendFailures）は SUBMIT_FAILED 専用。保留 / GATE_FAILED / SUBMITTED は出ない。境界は RLS', () => {
  it('ホスト: 失敗した提案だけ（試行の要約付き）。再送後は消える。取引先: 自社の行だけで試行は 0 行。テナント B: 0 件', async () => {
    const failed = await failedProposal('UNKNOWN');
    const gateFailed = await partnerProposalToPending(PII_FAIL_OUTPUT);
    const approvedHeld = await approvedProposal();
    // 保留中の APPROVED（ドメイン検証は済んでいるので GATE_STALE で保留を作る）。
    const heldBody = await submitAccepted(hostSales, approvedHeld.id);
    expect(await runJob({ ...payloadOf(heldBody, approvedHeld.id), enqueuedAt: new Date(clock.getTime() - 31 * 60_000).toISOString() })).toMatchObject({ kind: 'HELD', reasonKey: 'GATE_STALE' });
    const submitted = await approvedProposal();
    await runJob(payloadOf(await submitAccepted(hostSales, submitted.id), submitted.id));

    const host = await listProposalSendFailures(hostSales);
    expect(host.truncated).toBe(false);
    expect(host.items.map((item) => item.id)).toEqual([failed.id]);
    const item = host.items[0]!;
    expect(item).toMatchObject({
      recipientCompanyName: RECIPIENT.recipientCompanyName,
      engineerDisplayName: P1_NAME,
      offeredUnitPrice: 650000,
      lastFailureReason: 'UNKNOWN:TimeoutError',
    });
    expect(item.projectName).not.toBeNull();
    expect(item.attempts).toHaveLength(1);
    expect(item.attempts[0]).toMatchObject({ attemptSeq: 1, status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', externalId: null });
    expect(item.attempts[0]?.settledAt).not.toBeNull();
    // 画面の行: 応答不明は失敗と別の語 + 注記。
    const [row] = sendFailureRows(host.items, clock);
    expect(row).toMatchObject({ failureCategory: 'UNKNOWN', deliveryUnknown: true, attemptCount: 1, repeated: false });
    expect(row?.notes).toHaveLength(1);
    for (const other of [gateFailed.id, approvedHeld.id, submitted.id]) expect(host.items.map((i) => i.id)).not.toContain(other);

    // VIEWER（ホスト）も読める（閲覧のみ）。
    expect((await listProposalSendFailures(hostViewer)).items.map((i) => i.id)).toEqual([failed.id]);
    // 取引先: 自社が作成した行だけ（C5）。試行は C2 HOST_ONLY で 0 行。
    const partner = await listProposalSendFailures(partnerA1);
    expect(partner.items.map((i) => i.id)).toEqual([failed.id]);
    expect(partner.items[0]?.attempts).toEqual([]);
    // テナント B: 0 件。
    expect((await listProposalSendFailures(tenantBSales)).items).toEqual([]);

    // 再送後は一覧から消える（APPROVED）。
    await resendAccepted(hostSales, failed.id);
    expect((await listProposalSendFailures(hostSales)).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⑪ 同時 2 回の #44（二重実行防止）
// ---------------------------------------------------------------------------

describe('🔴 ⑪ 同一提案への同時 2 回の #44: CAS に勝つのは一方だけ。send_attempts は増えず、ジョブは 1 本だけ', () => {
  it('status の集合は {202, 422}。sendQueue に seq 2 のジョブが 1 本、proposal.resend の監査 1 件、state.invalid_transition 1 件', async () => {
    const { id } = await failedProposal();
    const [first, second] = await Promise.all([resend(hostSales, id), resend(hostSales, id)]);
    expect([first.status, second.status].sort()).toEqual([202, 422]);
    expect(await sendQueue.jobState({ proposalId: id, attemptSeq: 2 })).not.toBeNull();
    expect(await audits(id, 'proposal.resend')).toHaveLength(1);
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(1);
    // 🔴 負けた側は外部を呼ぶ前に tx の中で止まっている（CAS の外に出ない）。試行は seq 1 のまま。
    expect(await attempts(id)).toHaveLength(1);
  });
});
