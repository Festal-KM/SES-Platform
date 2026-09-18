// tests/isolation/ai-degraded.test.ts
// 🔴 T-12-05（`docs/sprints/SP-12-phase1-hardening.md` §4 T-12-05 / docs/05 §17.3 **#19** / `docs/02` 章 8.7「業務の継続性」）:
//    **AI が全停止（API 障害 / キー無効 / 上限到達）でも `F-021` の承認と `F-022` の送信が成立し、ゲートは安全側に止まる**ことを、
//    **実 DB（RLS 付き）+ 実 Route Handler（#36 / #39 / #40 / #41 / #43）+ 実 `gate.run` / 実 `send.proposal`（モック AI / モックのメール）**で通す。
//
// ---------------------------------------------------------------------------
// 🔴 なぜ E2E（Playwright）ではなく結合で代替するか（docs/05 §17.3 #19 の読み替え）
// ---------------------------------------------------------------------------
//   E2E ハーネスの worker は Playwright の 1 プロセスを**全 spec が共有**し、AI の台本は `startWorkerRuntime(config, { mockAnthropicScript })`
//   に**起動時の値として 1 つ**しか渡せない（`tests/e2e/harness/worker.ts`。Issue #47 の既定値 = 選択肢 1）。「AI 全停止」の台本を配ると
//   `proposal-cycle.spec.ts` 等の全 spec が落ち、spec 単位・提案単位で台本を切り替える注入口は設計上置いていない
//   （ゲート FAIL の E2E #4 は台本ではなく機械的検出で起こしている。docs/05 §17.5）。したがって #19 は結合で通し、
//   **画面（`S-020` / `S-021`）の判定は、画面が描くのと同じ view model**（#40 = `readProposalGateResult` / `readProposalEditor` →
//   `proposalEditRows` / `readProposalApproval` → `proposalApprovalRows`）で行う。DOM の描画（`proposal-approval-gate-ai-failed` /
//   `proposal-approval-gate-held` の testid）は、台本を spec 単位で切り替えられる注入口が入った時点で E2E に持ち上げる（申し送り）。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか（SP-12 T-12-05 の 4 点 = E2E #19 の 4 点）
// ---------------------------------------------------------------------------
//   ① 🔴 AI 全停止（キー無効 = 401。再試行しない）中のレビュー依頼 → `GATE_FAILED`。PII 層 / 商流層は**判定不能 = FAIL**（PASS へ倒さない）、
//      整合層は機械的照合の結果のまま。`S-020` は読み取り専用、`S-021` は `GATE_FAILED` の形で「検査を完了できなかった」を出し、
//      承認（#41）も送信（#43）も 422（「無視して送信」の入口は無い）。**3 つの失敗の形の違いは `gate-run.test.ts`（T-12-05）が固定する**
//   ② 🔴 停止前に 3 層 PASS で `APPROVAL_PENDING` になっていた提案は、AI 停止中でも #41 で `APPROVED` になる（承認は AI を呼ばない）
//   ③ 🔴 既に `APPROVED` の提案は AI 停止中でも #43 → `send.proposal` → `SUBMITTED`（外部メール 1 通）。**`send.proposal` は AI を一切呼ばない**
//      （モック AI の `callCount()` と `AiUsage` の行数が不変）
//   ④ 🔴 AI の日次コスト上限 → `GATE_RUNNING` のまま `HELD`（`GATE_FAILED` にしない）。`S-020` / `S-021` は「検査中」の 3 値目（`HELD`）を描き、
//      承認・送信は 422。上限解除後の再実行（`gate.hold-release` が積むのと同じ payload・同じ `jobId`）で同じ行が `DONE` になる
//      （**自動復帰の周期・多重化防止そのものは `gate-hold-release.test.ts` ① が実 Redis + 実 Worker で固定する**）
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）/ `sendingDomainRuntime`（起動時 DI の値）/ `MockAnthropicClient`（`createAiClient('mock')`。
//    E2E と同一実装）/ メール（`packages/connectors/src/mock`）/ SES の identity API（ドメイン検証）だけ。実 API に接続しない。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import {
  createConnectors,
  gateRunJobId,
  InMemoryMinuteWindowCounter,
  InMemoryProviderSendCounter,
  type Connectors,
  type GateRunJob,
  type SendProposalJob,
  type SesIdentityApi,
} from '@ses/connectors';
import { configureTenantDb, disconnectTenantDb, registerSendingDomain, resolveTenantCtx, type AuthenticatedTenantCtx } from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { t } from '../../packages/i18n/src/index.js';
import { createDomainProvisionHandler } from '../../apps/worker/src/jobs/domain-provision.js';
import { createDomainVerifyHandler } from '../../apps/worker/src/jobs/domain-verify.js';
import { createGateRunHandler, type GateRunDeps } from '../../apps/worker/src/jobs/gate-run.js';
import { createSendProposalHandler, resolveProposalSendingDomainFromDb } from '../../apps/worker/src/jobs/send-proposal.js';
import { ENGINEER_A_PARTNER, PARTNER_A1, PROJECT_A_PUBLISHED, TENANT_A, USER_A_HOST, USER_A_PARTNER } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { quotaDefaultsWith } from './support/quota-defaults.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.97' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-18T00:00:00.000Z');
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const DOMAIN = 'example.co.jp';
/** 1 回の呼び出しが通る上限（`gate-run.test.ts` と同じ値）。 */
const DAILY_LIMIT_USD = '5.000000';
/** 🔴 1 回でも通らない上限（`AiCostLimitExceededError` を実際に発生させる。「呼ばずに保留」の再現）。 */
const TINY_LIMIT_USD = '0.000001';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

/** 起動時 DI の値（`production` 相当 = 検証必須）。ドメインは `beforeAll` で実経路（provision → verify）を通して検証済みにする。 */
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
const { readProposalEditor } = await import('../../apps/web/lib/proposals/service');
const { proposalEditRows } = await import('../../apps/web/lib/proposals/editor-rows');

const P1_NAME = 'T1205 佐藤 花子';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009d9';
const SKILL_NAME = 'Gleam(t1205)';
const RECIPIENT = { recipientCompanyName: 'T1205 架空エンド株式会社', recipientEmail: 't1205-recipient@example.test' };
const CLEAN_BODY = `ご提案します。${SKILL_NAME} の経験が 6 年あります。`;

const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

/** 🔴 「無視して送信」に相当する語（`F-020 AC-2`。view model のどこにも現れてはならない）。 */
const FORBIDDEN_WORDS = ['無視して', '了解のうえ', 'override', 'force', 'skipLayers'];

type AiClient = GateRunDeps['aiClient'];
/** `createAiClient('mock', …)` の実体（`MockAnthropicClient`）は `callCount()` を持つ（バレルからは型として出ていない）。 */
type CountingAiClient = AiClient & { callCount(): number };
type MockStep = NonNullable<NonNullable<Parameters<typeof createAiClient>[1]>['mock']>['script'];

let database: IsolationDatabase;
let admin: UnextendedClient;
let mockConnectors: Connectors;
let hostSales: AuthenticatedTenantCtx;
let hostOwner: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
/** #39 が積んだ `gate.run`（実行はテストが明示的に行う）。 */
let gateEnqueued: GateRunJob[];
/** #43 が積んだ `send.proposal`。 */
let sendEnqueued: SendProposalJob[];

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string };
type SubmitBody = { readonly outcome: 'ENQUEUED' | 'HELD'; readonly attemptSeq: number; readonly jobId: string | null; readonly state: string };
type GateBody = {
  readonly execution: string;
  readonly layers: { readonly pii: { state: string }; readonly commerce: { state: string }; readonly consistency: { state: string } };
  readonly aiFailed: boolean;
  readonly held?: { readonly heldReasonKey: string; readonly resetAt: string; readonly limitRaise: string; readonly rerun: { auto: boolean } };
};

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

/** AI クライアント（モック）を 1 つ組む。`callCount()` で「呼ばれていない」を読む。 */
function aiClient(script: MockStep): CountingAiClient {
  return createAiClient('mock', { mock: { script } }) as CountingAiClient;
}

function gateHandler(client: AiClient, dailyLimitUsd: string = DAILY_LIMIT_USD) {
  return createGateRunHandler({
    now: () => NOW,
    aiClient: client,
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
    aiDailyCostLimitUsd: dailyLimitUsd,
  });
}

/** 積まれた `gate.run` を、そのジョブと同じ payload・同じ `jobId` で実行する（worker の配線が渡すものと同じ）。 */
async function runEnqueuedGate(job: GateRunJob, client: AiClient, dailyLimitUsd?: string) {
  return gateHandler(client, dailyLimitUsd)(job, gateRunJobId({ targetType: job.targetType, targetId: job.targetId, contentHash: job.contentHash }));
}

function sendHandler() {
  return createSendProposalHandler({
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
    now: () => NOW,
  });
}

async function createProposal(ctx: AuthenticatedTenantCtx): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.POST(
    new Request('https://app.test/api/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_A_PUBLISHED,
        engineerId: ENGINEER_A_PARTNER,
        ...RECIPIENT,
        subject: 'ご提案',
        body: CLEAN_BODY,
        offeredUnitPrice: 650000,
        offeredStartDate: '2026-11-01',
      }),
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

/** #39 レビュー依頼 → 積まれた `gate.run` を返す（実行はしない）。 */
async function requestGate(ctx: AuthenticatedTenantCtx, id: string): Promise<GateRunJob> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const before = gateEnqueued.length;
  const response = await gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
  expect(response.status, await response.clone().text()).toBe(202);
  expect(gateEnqueued).toHaveLength(before + 1);
  return gateEnqueued[before]!;
}

/** #40。 */
async function readGate(ctx: AuthenticatedTenantCtx, id: string): Promise<GateBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await gateRoute.GET(new Request(`https://app.test/api/proposals/${id}/gate`), segment(id));
  expect(response.status).toBe(200);
  return (await response.json()) as GateBody;
}

async function approve(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return approveRoute.POST(new Request(`https://app.test/api/proposals/${id}/approve`, { method: 'POST' }), segment(id));
}

async function submit(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return submitRoute.POST(new Request(`https://app.test/api/proposals/${id}/submit`, { method: 'POST' }), segment(id));
}

async function errorCode(response: Response, status: number): Promise<string> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error.code;
}

async function proposalState(id: string): Promise<string> {
  return (await admin.proposal.findUniqueOrThrow({ where: { id }, select: { state: true } })).state;
}

async function attempts(id: string) {
  return admin.sendAttempt.findMany({ where: { entityType: 'PROPOSAL', entityId: id }, orderBy: [{ attemptSeq: 'asc' }] });
}

/** `S-021` の表示値（画面が描くのと同じ 1 関数）。 */
async function approvalRows(id: string) {
  return proposalApprovalRows(await readProposalApproval(hostSales, id, { now: NOW }), NOW);
}

/** `S-020` の表示値（画面が描くのと同じ 1 関数）。 */
async function editorRows(ctx: AuthenticatedTenantCtx, id: string) {
  return proposalEditRows(await readProposalEditor(ctx, id));
}

/** 取引先 A1 が提案を作り、レビュー依頼 → 全層 PASS の AI で `gate.run` → `APPROVAL_PENDING`（= AI が動いていた頃の提案）。 */
async function proposalPendingBeforeOutage(): Promise<string> {
  const id = await createProposal(partnerA1);
  const job = await requestGate(partnerA1, id);
  const outcome = await runEnqueuedGate(job, aiClient([{ kind: 'output', output: CLEAN_OUTPUT }]));
  expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false, transitioned: true });
  expect(await proposalState(id)).toBe('APPROVAL_PENDING');
  return id;
}

/** さらにホストが #41 で承認して `APPROVED` にする（= AI が動いていた頃に承認まで済んだ提案）。 */
async function proposalApprovedBeforeOutage(): Promise<string> {
  const id = await proposalPendingBeforeOutage();
  expect((await approve(hostSales, id)).status).toBe(200);
  expect(await proposalState(id)).toBe('APPROVED');
  return id;
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

/** 送信ドメインを VERIFIED にする（登録 → provision → verify の実経路。`send-proposal.test.ts` と同じ）。 */
async function verifyDomain(): Promise<void> {
  const { row } = await registerSendingDomain(hostOwner, { domain: DOMAIN, observedAt: NOW });
  const identityApi = stubIdentityApi();
  await createDomainProvisionHandler({ identityApi, configurationSet: 'ses-platform-test', commonSendingDomain: 'ses-platform.example', now: () => NOW } as never)(
    { tenantId: TENANT_A, sendingDomainId: row.id },
    'job-provision',
  );
  await createDomainVerifyHandler({ identityApi, now: () => NOW } as never)({ tenantId: TENANT_A, sendingDomainId: row.id }, 'job-verify');
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  mockConnectors = createConnectors({ email: 'mock', objectStore: 'mock', malwareScanner: 'mock', esign: 'mock', billing: 'mock' });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostOwner = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'OWNER', twoFactor: 'VERIFIED' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);

  // 台帳: 凍結スキルに裏付けがあり（整合層 PASS）、本文に台帳の PII が無い（機械的検出 PASS）状態。
  await admin.skill.upsert({ where: { id: SKILL_BACKED }, create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 918 }, update: {} });
  await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerSkill.create({
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED, yearsOfExperience: 6, level: 4, source: 'MANUAL' },
  });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { displayName: P1_NAME, contactEmail: null, contactPhone: null } });
  await admin.skillSheet.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.create({
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2025-01', periodTo: null, role: 'PG', description: 'T1205 架空の基幹刷新（合成データ）', technologies: 'Gleam / BEAM', source: 'MANUAL' },
  });
  await admin.tenant.update({ where: { id: TENANT_A }, data: { autoApproveEnabled: false, lifecycleState: 'ACTIVE' } });
  await admin.tenantSendingDomain.deleteMany({ where: { tenantId: TENANT_A } });
  await verifyDomain();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER, description: { startsWith: 'T1205' } } });
  resetGateRunJobQueue();
  resetSendProposalJobQueue();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  gateEnqueued = [];
  sendEnqueued = [];
  // 🔴 キューはメモリ上で積むだけ（実行はテストが明示的に行う）。BullMQ の重複排除・failed の扱いは
  //    `gate-hold-release.test.ts` / `send-proposal.test.ts` ⑩ が実 Redis で固定する。
  configureGateRunJobQueue({
    enqueue: async (job) => {
      gateEnqueued.push(job);
      return 'ENQUEUED';
    },
    removeFailedJob: async () => 'NOT_FOUND',
  });
  configureSendProposalJobQueue({
    enqueue: async (job) => {
      sendEnqueued.push(job);
      return 'ENQUEUED';
    },
  });
});

afterEach(async () => {
  const created = await admin.proposal.findMany({ where: { tenantId: TENANT_A, recipientCompanyName: RECIPIENT.recipientCompanyName }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await admin.sendAttempt.deleteMany({ where: { entityId: { in: ids } } });
  await admin.reviewGate.deleteMany({ where: { targetId: { in: ids } } });
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { in: ['AI_COST_USD', 'EMAIL_COUNT'] } } });
  await admin.auditLog.deleteMany({ where: { targetId: { in: ids } } });
});

// ---------------------------------------------------------------------------
// ① AI 全停止中のレビュー依頼は GATE_FAILED。承認・送信の入口が閉じる
// ---------------------------------------------------------------------------

describe('🔴 ① AI 全停止（キー無効 401）中のレビュー依頼 → GATE_FAILED（PII / 商流は判定不能 = FAIL）。S-020 / S-021 に承認・送信の導線が無く、#41 / #43 は 422', () => {
  it('E2E #19 ①（結合代替）', async () => {
    // 🔴 「AI 全停止」の台本: 401（`API`。再試行しない）。台本が尽きたら最後の 1 手を繰り返す = 何度呼んでも失敗する。
    const outage = aiClient([{ kind: 'error', error: 'API', status: 401 }]);
    const id = await createProposal(partnerA1);
    const job = await requestGate(partnerA1, id);
    expect(await proposalState(id)).toBe('GATE_RUNNING');

    const outcome = await runEnqueuedGate(job, outage);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: true, transitioned: true, autoApproval: null });
    expect(outage.callCount()).toBe(1);
    expect(await proposalState(id)).toBe('GATE_FAILED');

    // #40（S-020 / S-021 が読む同じ 1 つの形）: PII / 商流は FAIL、整合層は機械的照合の結果（PASS）のまま、aiFailed。
    const gate = await readGate(hostSales, id);
    expect(gate).toMatchObject({
      execution: 'DONE',
      aiFailed: true,
      layers: { pii: { state: 'FAIL' }, commerce: { state: 'FAIL' }, consistency: { state: 'PASS' } },
    });
    expect(gate.held).toBeUndefined();

    // S-020（作成者 = 取引先）: 読み取り専用で「レビューに出す」も編集も無い（`GATE_FAILED` の形）。
    const editor = await editorRows(partnerA1, id);
    expect(editor.state).toBe('GATE_FAILED');
    expect(editor.readOnlyNotice).not.toBeNull();
    expect(editor.approveHref).toBe(`/proposals/${id}/approve`);

    // S-021（承認者 = ホスト）: `GATE_FAILED` の形で描かれ、「検査を完了できなかったため承認できません」が出る。
    const rows = await approvalRows(id);
    expect(rows.state).toBe('GATE_FAILED');
    expect(rows.disposition.kind).toBe('GATE_FAILED');
    expect(rows.gate).toMatchObject({ execution: 'DONE', aiFailed: true, failed: true, allPassed: false, heldResetAt: null });
    expect(rows.gate.layers.map((layer) => [layer.key, layer.state])).toEqual([
      ['pii', 'FAIL'],
      ['commerce', 'FAIL'],
      ['consistency', 'PASS'],
    ]);
    // 🔴 判定不能の FAIL は「直せる元データの指摘」を持たない（指摘 0 件で不合格）。画面はそれを aiFailed の文言で説明する。
    expect(rows.gate.findings).toEqual([]);
    expect(t('proposals.approval.gate.aiFailed')).toContain('検査を完了できなかった');
    expect(t('proposals.editor.gate.aiFailed')).toContain('検査を完了できなかった');
    // 🔴 「無視して送信」に相当する語が view model のどこにも無い（`F-020 AC-2`）。
    const serialized = JSON.stringify(rows);
    for (const word of FORBIDDEN_WORDS) expect(serialized).not.toContain(word);

    // 🔴 承認 API も送信 API も 422（承認を経ない実行遷移は存在しない。docs/05 §10.3）。外部メールは 0。
    const callsBefore = mockConnectors.email.callCount();
    expect(await errorCode(await approve(hostSales, id), 422)).toBe('INVALID_STATE_TRANSITION');
    expect(await errorCode(await submit(hostSales, id), 422)).toBe('INVALID_STATE_TRANSITION');
    expect(sendEnqueued).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect(await proposalState(id)).toBe('GATE_FAILED');

    // 🔴 aiFailed の行はキャッシュではない: AI が復旧した後の再依頼（`GATE_FAILED → DRAFT → GATE_RUNNING`）で再検査される。
    //    （復旧後に PASS へ進めることの本体は `gate-run.test.ts`「aiFailed の結果はキャッシュされない」が固定する。）
    const usage = await admin.aiUsage.findMany({ where: { tenantId: TENANT_A } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ succeeded: false, failureKind: 'API' });
  });
});

// ---------------------------------------------------------------------------
// ② 停止前に承認待ちになっていた提案は、AI 停止中でも承認できる
// ---------------------------------------------------------------------------

describe('🔴 ② AI 停止中でも、停止前に 3 層 PASS で APPROVAL_PENDING になっていた提案は #41 で APPROVED になる（F-021。承認は AI を呼ばない）', () => {
  it('E2E #19 ②-前半（結合代替）', async () => {
    const id = await proposalPendingBeforeOutage();
    const usageBefore = await admin.aiUsage.count({ where: { tenantId: TENANT_A } });
    const outage = aiClient([{ kind: 'error', error: 'API', status: 401 }]);

    // 停止中であることの対照: 同じ台本で新しい提案のゲートは FAIL になる。
    const other = await createProposal(partnerA1);
    expect(await runEnqueuedGate(await requestGate(partnerA1, other), outage)).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: true });
    expect(outage.callCount()).toBe(1);

    // 🔴 停止前の判定（3 層 PASS）で承認できる。承認は AI を呼ばない（callCount / AiUsage が増えない）。
    const rows = await approvalRows(id);
    expect(rows.disposition.kind).toBe('PENDING');
    expect(rows.canApprove).toBe(true);
    expect(rows.gate).toMatchObject({ execution: 'DONE', aiFailed: false, allPassed: true });
    expect((await approve(hostSales, id)).status).toBe(200);
    expect(await proposalState(id)).toBe('APPROVED');
    expect(outage.callCount()).toBe(1);
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(usageBefore + 1); // 増分は対照の FAIL 1 回だけ
  });
});

// ---------------------------------------------------------------------------
// ③ 既に APPROVED の提案は AI 停止中でも送信できる。send.proposal は AI を呼ばない
// ---------------------------------------------------------------------------

describe('🔴 ③ 既に APPROVED の提案は AI 停止中でも #43 → send.proposal → SUBMITTED（外部メール 1 通）。send.proposal は AI を一切呼ばない（F-022）', () => {
  it('E2E #19 ②-後半 / SP-12 T-12-05 の 3 点目（結合代替）', async () => {
    const id = await proposalApprovedBeforeOutage();
    const outage = aiClient([{ kind: 'error', error: 'API', status: 401 }]);
    const usageBefore = await admin.aiUsage.count({ where: { tenantId: TENANT_A } });
    const callsBefore = mockConnectors.email.callCount();

    // 停止中であることの対照（同じ台本で新しい提案は FAIL）。
    const other = await createProposal(partnerA1);
    expect(await runEnqueuedGate(await requestGate(partnerA1, other), outage)).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: true });
    expect(outage.callCount()).toBe(1);
    const usageDuringOutage = await admin.aiUsage.count({ where: { tenantId: TENANT_A } });
    expect(usageDuringOutage).toBe(usageBefore + 1);

    // S-021: `APPROVED` の形で「送信する」（#43）の対象。
    const rows = await approvalRows(id);
    expect(rows.disposition.kind).toBe('APPROVED');
    expect(rows.canSubmit).toBe(true);
    expect(rows.sendHold).toBeNull();

    // #43 → enqueue → `send.proposal`（本番と同じハンドラ）→ SUBMITTED。
    requireTenantCtxMock.mockResolvedValue(hostSales);
    const response = await submit(hostSales, id);
    expect(response.status, await response.clone().text()).toBe(202);
    const body = (await response.json()) as SubmitBody;
    expect(body).toMatchObject({ outcome: 'ENQUEUED', attemptSeq: 1, state: 'APPROVED' });
    expect(sendEnqueued).toHaveLength(1);
    const outcome = await sendHandler()(sendEnqueued[0]!, body.jobId ?? 'job-send');
    expect(outcome).toMatchObject({ kind: 'SENT', attemptSeq: 1, mocked: true });
    expect(await proposalState(id)).toBe('SUBMITTED');
    expect(await attempts(id)).toHaveLength(1);
    expect(mockConnectors.email.callCount()).toBe(callsBefore + 1);

    // 🔴 `send.proposal` は AI を一切呼んでいない: モックの呼び出し回数も `AiUsage` の行数も停止中の対照 1 回のまま。
    expect(outage.callCount()).toBe(1);
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(usageDuringOutage);

    // S-021 は送信済みの形になる。
    expect((await approvalRows(id)).disposition.kind).toBe('SUBMITTED');
  });
});

// ---------------------------------------------------------------------------
// ④ 日次コスト上限 → HELD（GATE_RUNNING のまま）。上限解除で同じ行が DONE
// ---------------------------------------------------------------------------

describe('🔴 ④ AI の日次コスト上限 → GATE_RUNNING のまま HELD（GATE_FAILED にしない）。S-020 / S-021 は「検査中」の 3 値目を描き、承認・送信は 422。上限解除で同じ行が DONE', () => {
  it('E2E #19 ③（結合代替。自動復帰の周期・多重化は gate-hold-release.test.ts ①）', async () => {
    const id = await createProposal(partnerA1);
    const job = await requestGate(partnerA1, id);
    // 🔴 上限で**呼べなかった**（`AiCostLimitExceededError`）。台本は PASS でも、呼んでいないので使われない。
    const pass = aiClient([{ kind: 'output', output: CLEAN_OUTPUT }]);
    const held = await runEnqueuedGate(job, pass, TINY_LIMIT_USD);
    expect(held.kind).toBe('HELD_AI_COST_LIMIT');
    expect(pass.callCount()).toBe(0);
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(0);
    // 🔴 `GATE_FAILED` にしない（元データの欠陥ではない）。
    expect(await proposalState(id)).toBe('GATE_RUNNING');

    // #40: 3 値目（HELD）。PII / 商流は「検査中」のまま、整合層は機械的照合の結果が確定している。金額（USD）は載らない。
    const gate = await readGate(hostSales, id);
    expect(gate).toMatchObject({
      execution: 'HELD_AI_COST_LIMIT',
      aiFailed: false,
      layers: { pii: { state: 'HELD' }, commerce: { state: 'HELD' }, consistency: { state: 'PASS' } },
    });
    expect(gate.held).toMatchObject({ heldReasonKey: 'gate.held.aiCostLimit', limitRaise: 'PLATFORM_OPERATOR', rerun: { auto: true } });
    expect(gate.held?.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(gate).toLowerCase()).not.toContain('usd');

    // S-020: 「検査中」の読み取り専用（修正を促さない = 「下書きに戻す」の前提である GATE_FAILED ではない）。
    const editor = await editorRows(partnerA1, id);
    expect(editor.state).toBe('GATE_RUNNING');
    expect(editor.readOnlyNotice).not.toBeNull();

    // S-021: `GATE_RUNNING` の形で HELD を描く（承認アクションを描画しない）。
    const rows = await approvalRows(id);
    expect(rows.disposition.kind).toBe('GATE_RUNNING');
    expect(rows.gate).toMatchObject({ execution: 'HELD_AI_COST_LIMIT', aiFailed: false, failed: false, allPassed: false });
    expect(rows.gate.heldResetAt).not.toBeNull();
    expect(rows.gate.layers.map((layer) => [layer.key, layer.state])).toEqual([
      ['pii', 'HELD'],
      ['commerce', 'HELD'],
      ['consistency', 'PASS'],
    ]);
    expect(t('proposals.approval.gate.held')).toContain('上限');
    expect(t('proposals.approval.gate.held')).toContain('整合層');

    // 🔴 承認・送信の前提（`execution='DONE'` かつ 3 層 PASS）を満たさない = 422。外部メール 0。
    const callsBefore = mockConnectors.email.callCount();
    expect(await errorCode(await approve(hostSales, id), 422)).toBe('INVALID_STATE_TRANSITION');
    expect(await errorCode(await submit(hostSales, id), 422)).toBe('INVALID_STATE_TRANSITION');
    expect(sendEnqueued).toHaveLength(0);
    expect(mockConnectors.email.callCount()).toBe(callsBefore);
    expect(await proposalState(id)).toBe('GATE_RUNNING');

    // 🔴 上限解除（翌日の枠）: `gate.hold-release` が積むのと**同じ payload・同じ jobId** で再実行 → 保留していた同じ行が DONE。
    const resumed = await runEnqueuedGate(job, pass);
    expect(resumed).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false, transitioned: true });
    expect(pass.callCount()).toBe(1);
    const gates = await admin.reviewGate.findMany({ where: { targetId: id } });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ execution: 'DONE', heldSince: null, piiVerdict: 'PASS', commerceVerdict: 'PASS', consistencyVerdict: 'PASS' });
    expect(await proposalState(id)).toBe('APPROVAL_PENDING');
    // 復帰後は承認できる（ここで初めて前提が満たされる）。
    expect((await approvalRows(id)).disposition.kind).toBe('PENDING');
    expect((await approve(hostSales, id)).status).toBe(200);
    expect(await proposalState(id)).toBe('APPROVED');
  });
});
