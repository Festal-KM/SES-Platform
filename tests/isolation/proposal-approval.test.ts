// tests/isolation/proposal-approval.test.ts
// 🔴 T-09-03（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-03 / §5）: 提案の承認・却下（#41 / #42）と自動承認を
//    **実 DB（RLS 付き）+ 実 Redis + 実 Route Handler + 実 `gate.run`（モック AI）** で証明する。
//    `F-021 AC-1`〜`AC-6`（AC-4 / AC-6 の画面側は render テストと E2E #13）/ `CLAUDE.md` §3.3 / §10.3 / docs/05 §6.5 #41 / #42 /
//    §10.3 / §11.5 手順 3 / §11.6 / §11.10 ②（T-09-03 の材料の是正）。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 `F-021 AC-1` / docs/05 §10.3: **DB 制約**（`CHECK`: `SUBMITTING` は `approved_at` を要求 / `APPROVED` は
//      `approved_at` + `content_hash` を要求。部分 UNIQUE `proposals_one_submitting`）が実在し、承認記録の無い行を特権接続でも
//      `SUBMITTING` / `APPROVED` にできない。#41 は `APPROVAL_PENDING` 以外で 422（`SUBMIT_FAILED → APPROVED` は #44 の専有）
//   ② 🔴 `F-021 AC-2`: 既定（`autoApproveEnabled = false`）では全層 PASS でも `APPROVAL_PENDING` に留まり、承認は人間の #41 を要する。
//      🔴 **取引先が作成した提案をホストが承認できる**（T-09-01 の申し送り = `contentHash` の所属による食い違いを T-09-03 で
//      直した効果。承認 CAS は承認者〔ホスト〕の文脈で再計算したハッシュで `review_gates` を引く）
//   ③ 🔴 #41 は **body を読まない**（ゲート結果を持ち込めない）: `{ gate: PASS, force: true }` を送っても `GATE_FAILED` は 422 のまま、
//      `APPROVAL_PENDING` では空 body と同じ結果
//   ④ 🔴 `F-021 AC-3`: `autoApproveEnabled = true` でも 1 層 FAIL なら `GATE_FAILED` に留まり、承認されない
//   ⑤ 🔴 `F-021 AC-5`: `autoApproveEnabled = true` かつ全層 PASS なら承認者 `system`（`approved_by NULL` / `approved_by_system true`）で
//      承認され、監査（`proposal.approve` / `SYSTEM` / `reason='ALL_LAYERS_PASS'` / `reviewGateId`）から根拠を辿れる
//   ⑥ 🔴 §11.5 手順 3: 内容が変わった（`proposals.content_hash` ≠ 現在の内容）/ 検査結果が無い / HELD なら **409 `GATE_STALE`**。
//      状態・履歴・監査は変わらない
//   ⑦ #42（却下）: 理由必須 → `DRAFT`。`ProposalEvent.note` に理由、監査の `summary` に理由なし。`GATE_FAILED` からは 422 RESERVED
//   ⑧ 認可・境界: 取引先（作成者でも）は 403、`VIEWER` は 403、他テナントは 404、`SUSPENDED` は 409。同時 2 リクエストで承認は 1 回
//   ⑨ `S-021` の読み取り（`readProposalApproval`）: ホストは判断材料（凍結側 + ゲート結果）を読め、作成した取引先は内容と
//      ゲート結果を読めるが `canApprove = false`、他社は 404
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と `MockAnthropicClient`（`packages/ai/src/mock/`。実 API に接続しない）だけ。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import { gateRunJobId } from '@ses/connectors';
import { createBullMqGateRunQueue, type BullMqGateRunQueue } from '@ses/connectors/bullmq';
import { configureTenantDb, disconnectTenantDb, resolveTenantCtx, type AuthenticatedTenantCtx } from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P1_PRIVATE,
  PROPOSAL_A_P2,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'mobile', ipAddress: '203.0.113.93' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const rejectRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/reject/route');
const { readProposalApproval } = await import('../../apps/web/lib/proposals/approval');
const { NotFoundError } = await import('../../apps/web/lib/api/errors');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');

/** 台帳の氏名（凍結される）。本文に残っていれば PII 層が機械的照合で FAIL になる（T-09-13 の `app_gate_probe`）。 */
const P1_NAME = 'T0903 佐藤 花子';
const HOST_NAME = 'T0903 山田 太郎';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009d3';
const SKILL_NAME = 'Scala(t0903)';
const RECIPIENT = { recipientCompanyName: 'T0903 架空エンド株式会社', recipientEmail: 't0903-recipient@example.test' };
const CLEAN_BODY = `ご提案します。${SKILL_NAME} の経験が 6 年あります。`;
const REJECT_REASON = 'T0903-単価を見直してください';

const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

const AUDIT_ACTIONS = ['proposal.create', 'proposal.update', 'proposal.approve', 'proposal.reject', 'state.invalid_transition'];
/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_ID = '01930000-0000-7000-8000-0000000fffff';

let database: IsolationDatabase;
let redis: IsolationRedis;
let admin: UnextendedClient;
let queue: BullMqGateRunQueue;
let hostSales: AuthenticatedTenantCtx;
let hostOwner: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let hostSuspended: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA1Admin: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string };
type StateBody = { readonly state: string };

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

async function runGate(targetId: string, contentHash: string) {
  const handler = createGateRunHandler({
    now: () => NOW,
    aiClient: createAiClient('mock', { mock: { script: [{ kind: 'output', output: CLEAN_OUTPUT }] } }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
    aiDailyCostLimitUsd: '5.000000',
  });
  const key = { targetType: 'PROPOSAL', targetId, contentHash } as const;
  return handler({ tenantId: TENANT_A, ...key }, gateRunJobId(key));
}

async function approve(ctx: AuthenticatedTenantCtx, id: string, body?: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return approveRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/approve`, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    segment(id),
  );
}

async function reject(ctx: AuthenticatedTenantCtx, id: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return rejectRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    segment(id),
  );
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

async function setAutoApprove(enabled: boolean): Promise<void> {
  await admin.tenant.update({ where: { id: TENANT_A }, data: { autoApproveEnabled: enabled } });
}

async function proposalRow(id: string) {
  return admin.proposal.findUniqueOrThrow({
    where: { id },
    select: { state: true, approvedBy: true, approvedBySystem: true, approvedAt: true, contentHash: true },
  });
}

async function events(id: string) {
  // 🔴 `id`（uuidv7 = 採番順）で並べる。`gate.run` は固定の NOW で書き、#41 / #42 は実時刻で書くため
  //    `occurred_at` の並びはテストの時計の都合で前後しうる（挙動ではなくテストの都合）。
  return admin.proposalEvent.findMany({
    where: { proposalId: id },
    orderBy: [{ id: 'asc' }],
    select: { kind: true, fromState: true, toState: true, actorUserId: true, note: true },
  });
}

async function audits(id: string, action: string) {
  return admin.auditLog.findMany({
    where: { targetId: id, action },
    orderBy: { createdAt: 'asc' },
    select: { actorKind: true, actorId: true, targetType: true, summary: true, deviceKind: true, ipAddress: true },
  });
}

/** 取引先 A1 が自社エンジニアで提案を作り、レビュー依頼 → `gate.run`（全層 PASS）まで進める。 */
async function partnerProposalToPending(): Promise<{ readonly id: string; readonly contentHash: string; readonly reviewGateId: string }> {
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
  const outcome = await runGate(id, contentHash);
  expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', transitioned: true });
  if (outcome.kind !== 'COMPLETED') throw new Error('unreachable');
  return { id, contentHash, reviewGateId: outcome.reviewGateId };
}

/** ホストが自社エンジニアで提案を作り、`gate.run` まで進める（本文に台帳の氏名を含めると PII 層が FAIL）。 */
async function hostProposalAfterGate(body: string): Promise<{ readonly id: string; readonly contentHash: string; readonly outcome: Awaited<ReturnType<typeof runGate>> }> {
  const id = await createProposal(hostSales, {
    projectId: PROJECT_A_PUBLISHED,
    engineerId: ENGINEER_A_HOST,
    ...RECIPIENT,
    subject: 'ご提案',
    body,
    offeredUnitPrice: 700000,
  });
  const contentHash = await requestGate(hostSales, id);
  const outcome = await runGate(id, contentHash);
  return { id, contentHash, outcome };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  queue = createBullMqGateRunQueue({ url: redis.url });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostOwner = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'OWNER', twoFactor: 'VERIFIED' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  hostSuspended = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'SUSPENDED' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA1Admin = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_ADMIN' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  // 台帳の裏付け（整合層）: 辞書 1 語 + A1 のエンジニアとホストのエンジニアに 6 年。氏名は PII 層の既知値になる。
  await admin.skill.upsert({
    where: { id: SKILL_BACKED },
    create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 913 },
    update: {},
  });
  await admin.engineerSkill.deleteMany({ where: { engineerId: { in: [ENGINEER_A_PARTNER, ENGINEER_A_HOST] } } });
  await admin.engineerSkill.createMany({
    data: [
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED, yearsOfExperience: 6, level: 4, source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_HOST, skillId: SKILL_BACKED, yearsOfExperience: 6, level: 4, source: 'MANUAL' },
    ],
  });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { displayName: P1_NAME, contactEmail: null, contactPhone: null } });
  await admin.engineer.update({ where: { id: ENGINEER_A_HOST }, data: { displayName: HOST_NAME, contactEmail: null, contactPhone: null } });
  // 🔴 取引先のエンジニアに CLEAN の版（凍結される添付。ハッシュの材料 = 凍結列 `skill_sheet_id`）。
  await admin.skillSheet.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.skillSheet.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT_A,
      engineerId: ENGINEER_A_PARTNER,
      version: 1,
      objectKey: `t0903/${randomUUID()}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: 1024n,
      scanStatus: 'CLEAN',
      isLatest: true,
      uploadedBy: USER_A_PARTNER,
      uploadedAt: NOW,
    },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  resetGateRunJobQueue();
  await queue?.close();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  configureGateRunJobQueue(queue);
  await setAutoApprove(false);
});

afterEach(async () => {
  const fixtureIds = [PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2, PROPOSAL_A_P1_PRIVATE];
  const created = await admin.proposal.findMany({ where: { tenantId: TENANT_A, id: { notIn: fixtureIds } }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await admin.reviewGate.deleteMany({ where: { targetId: { in: ids } } });
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_' } } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
  await setAutoApprove(false);
});

// ---------------------------------------------------------------------------
// ① F-021 AC-1 / docs/05 §10.3: DB 制約
// ---------------------------------------------------------------------------

describe('🔴 ① F-021 AC-1 / docs/05 §10.3: 承認を経ない実行遷移は DB 制約で不可能', () => {
  it('CHECK: approved_at の無い行は SUBMITTING に入れず、approved_at + content_hash の無い行は APPROVED に入れない（特権接続でも）', async () => {
    const { id } = await partnerProposalToPending();
    // APPROVAL_PENDING（承認記録なし）→ SUBMITTING は CHECK 違反。
    await expect(
      admin.$executeRawUnsafe(`UPDATE proposals SET state = 'SUBMITTING' WHERE id = '${id}'`),
    ).rejects.toThrow(/proposals_submitting_requires_approval_check/);
    // approved_at 無しで APPROVED も CHECK 違反。
    await expect(
      admin.$executeRawUnsafe(`UPDATE proposals SET state = 'APPROVED' WHERE id = '${id}'`),
    ).rejects.toThrow(/proposals_approved_requires_hash_check/);
    // content_hash を消して approved_at だけ入れても APPROVED になれない（ハッシュ無しの承認記録は存在しえない）。
    await expect(
      admin.$executeRawUnsafe(`UPDATE proposals SET state = 'APPROVED', approved_at = now(), content_hash = NULL WHERE id = '${id}'`),
    ).rejects.toThrow(/proposals_approved_requires_hash_check/);
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
  });

  it('部分 UNIQUE proposals_one_submitting（WHERE state = SUBMITTING）が実在する', async () => {
    const rows = await admin.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'proposals' AND indexname = 'proposals_one_submitting'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(+state = 'SUBMITTING'::text\)+/);
  });

  it('🔴 #41 は APPROVAL_PENDING 以外で 422: DRAFT / GATE_RUNNING / GATE_FAILED / APPROVED は INVALID_STATE_TRANSITION（記録あり）、SUBMIT_FAILED は #44 の専有で RESERVED', async () => {
    const { id } = await partnerProposalToPending();
    // APPROVAL_PENDING → 各状態へ特権で置き換えて #41 を叩く。
    for (const state of ['DRAFT', 'GATE_RUNNING', 'GATE_FAILED'] as const) {
      await admin.proposal.update({ where: { id }, data: { state, approvedAt: null, approvedBy: null, approvedBySystem: false } });
      await admin.auditLog.deleteMany({ where: { action: 'state.invalid_transition' } });
      const error = await errorOf(await approve(hostSales, id), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await proposalRow(id)).state).toBe(state);
      const recorded = await audits(id, 'state.invalid_transition');
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.summary).toEqual({ entity: 'Proposal', from: state, to: 'APPROVED' });
    }
    await admin.proposal.update({
      where: { id },
      data: { state: 'SUBMIT_FAILED', approvedAt: NOW, approvedBy: USER_A_HOST, approvedBySystem: false },
    });
    const reserved = await errorOf(await approve(hostSales, id), 422);
    expect(reserved.code).toBe('PROPOSAL_TRANSITION_RESERVED');
    expect((await proposalRow(id)).state).toBe('SUBMIT_FAILED');
    expect(await audits(id, 'proposal.approve')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ② F-021 AC-2 / ③ #41 は body を読まない
// ---------------------------------------------------------------------------

describe('🔴 ② F-021 AC-2: 既定は人間承認必須。取引先が作成した提案をホストが承認できる（T-09-03 のハッシュの是正）', () => {
  it('全層 PASS でも APPROVAL_PENDING に留まり、ホストの #41 で APPROVED になる。承認者・ゲート結果の参照・ハッシュが記録される', async () => {
    const { id, contentHash, reviewGateId } = await partnerProposalToPending();
    const pending = await proposalRow(id);
    expect(pending).toMatchObject({ state: 'APPROVAL_PENDING', approvedAt: null, approvedBy: null, approvedBySystem: false, contentHash });

    // 🔴 ホスト文脈で読んだ判断材料の contentHash が取引先文脈で書いた列と一致する（所属で食い違わない）。
    const hostView = await readProposalApproval(hostSales, id, { now: NOW });
    expect(hostView.view.contentHash).toBe(contentHash);
    expect(hostView.gate.contentHash).toBe(contentHash);
    expect(hostView.canApprove).toBe(true);

    const response = await approve(hostSales, id);
    expect(response.status).toBe(200);
    expect((await response.json()) as StateBody).toEqual({ state: 'APPROVED' });

    const approved = await proposalRow(id);
    expect(approved).toMatchObject({ state: 'APPROVED', approvedBy: USER_A_HOST, approvedBySystem: false, contentHash });
    expect(approved.approvedAt).not.toBeNull();

    const history = await events(id);
    expect(history.map((row) => `${row.fromState ?? 'null'}->${row.toState ?? 'null'}`)).toEqual([
      'null->DRAFT',
      'DRAFT->GATE_RUNNING',
      'GATE_RUNNING->APPROVAL_PENDING',
      'APPROVAL_PENDING->APPROVED',
    ]);
    expect(history[3]).toMatchObject({ kind: 'STATE', actorUserId: USER_A_HOST, note: `REVIEW_GATE:${reviewGateId}` });

    const recorded = await audits(id, 'proposal.approve');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorKind: 'USER',
      actorId: USER_A_HOST,
      targetType: 'Proposal',
      deviceKind: 'mobile',
      ipAddress: META.ipAddress,
      summary: { operation: 'APPROVE', reviewGateId, contentHash, approvedBySystem: false },
    });
    expect(recorded[0]?.summary).not.toHaveProperty('reason');
    // 🔴 summary に本文・単価・提案先・氏名が無い。
    const serialized = JSON.stringify(recorded[0]?.summary);
    for (const forbidden of [CLEAN_BODY, '650000', RECIPIENT.recipientCompanyName, RECIPIENT.recipientEmail, P1_NAME]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('🔴 ③ #41 は body を読まない: GATE_FAILED に { gate: PASS, force: true, reviewGateId } を送っても 422。APPROVAL_PENDING では空 body と同じ 200', async () => {
    const failed = await hostProposalAfterGate(`ご提案します。${HOST_NAME} です。`);
    expect(failed.outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL' });
    expect((await proposalRow(failed.id)).state).toBe('GATE_FAILED');
    const bypass = {
      gate: { pii: 'PASS', commerce: 'PASS', consistency: 'PASS' },
      force: true,
      override: true,
      reviewGateId: randomUUID(),
      contentHash: failed.contentHash,
      approvedBySystem: true,
    };
    const error = await errorOf(await approve(hostSales, failed.id, bypass), 422);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await proposalRow(failed.id)).state).toBe('GATE_FAILED');
    expect(await audits(failed.id, 'proposal.approve')).toHaveLength(0);

    const { id, reviewGateId } = await partnerProposalToPending();
    const response = await approve(hostOwner, id, bypass);
    expect(response.status).toBe(200);
    // 🔴 記録されたゲート結果の参照は「持ち込んだ値」ではなく、現在の内容から引いた実在の行である。
    expect((await audits(id, 'proposal.approve'))[0]?.summary).toMatchObject({ reviewGateId, approvedBySystem: false });
    expect((await proposalRow(id)).approvedBySystem).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ ⑤ 自動承認（docs/05 §11.6）
// ---------------------------------------------------------------------------

describe('🔴 ④⑤ 自動承認（F-021 AC-3 / AC-5 / docs/05 §11.6）', () => {
  it('🔴 AC-3: autoApproveEnabled が有効でも PII 層が FAIL なら GATE_FAILED に留まり、承認されない', async () => {
    await setAutoApprove(true);
    const { id, outcome } = await hostProposalAfterGate(`ご提案します。${HOST_NAME} です。`);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', transitioned: true, autoApproval: null });
    expect(await proposalRow(id)).toMatchObject({ state: 'GATE_FAILED', approvedAt: null, approvedBy: null, approvedBySystem: false });
    expect(await audits(id, 'proposal.approve')).toHaveLength(0);
    // 人間が #41 を叩いても 422（FAIL を無視して承認する経路が無い）。
    expect((await errorOf(await approve(hostSales, id), 422)).code).toBe('INVALID_STATE_TRANSITION');
  });

  it('🔴 AC-5: autoApproveEnabled が有効かつ全層 PASS なら承認者 system で承認され、監査から根拠（ALL_LAYERS_PASS + reviewGateId）を辿れる', async () => {
    await setAutoApprove(true);
    const { id, contentHash, outcome } = await hostProposalAfterGate(CLEAN_BODY);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', transitioned: true, autoApproval: 'APPROVED' });
    if (outcome.kind !== 'COMPLETED') throw new Error('unreachable');

    const row = await proposalRow(id);
    expect(row).toMatchObject({ state: 'APPROVED', approvedBy: null, approvedBySystem: true, contentHash });
    expect(row.approvedAt).toEqual(NOW);

    const history = await events(id);
    expect(history.map((entry) => `${entry.fromState ?? 'null'}->${entry.toState ?? 'null'}`)).toEqual([
      'null->DRAFT',
      'DRAFT->GATE_RUNNING',
      'GATE_RUNNING->APPROVAL_PENDING',
      'APPROVAL_PENDING->APPROVED',
    ]);
    expect(history[3]).toMatchObject({ actorUserId: null, note: `REVIEW_GATE:${outcome.reviewGateId}` });

    const recorded = await audits(id, 'proposal.approve');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorKind: 'SYSTEM',
      actorId: null,
      summary: { operation: 'APPROVE', reason: 'ALL_LAYERS_PASS', reviewGateId: outcome.reviewGateId, contentHash, approvedBySystem: true },
    });
    // 🔴 S-021 の承認者欄は「システム」。
    const view = await readProposalApproval(hostSales, id, { now: NOW });
    expect(view.approval).toEqual({ kind: 'SYSTEM', approvedAt: NOW.toISOString() });
  });

  it('🔴 AC-2 の対照: autoApproveEnabled が無効なら同じ提案でも自動承認されない（設定の唯一の出所は tenants.auto_approve_enabled）', async () => {
    await setAutoApprove(false);
    const { id, outcome } = await hostProposalAfterGate(CLEAN_BODY);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', transitioned: true, autoApproval: null });
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
  });
});

// ---------------------------------------------------------------------------
// ⑥ §11.5 手順 3: GATE_STALE
// ---------------------------------------------------------------------------

describe('🔴 ⑥ docs/05 §11.5 手順 3: 内容が変わった / 検査結果が無い / HELD なら 409 GATE_STALE（状態・履歴・監査は不変）', () => {
  it('承認待ちの本文を（列を直接）書き換えると、承認 CAS は 0 件更新 = 409 GATE_STALE', async () => {
    const { id } = await partnerProposalToPending();
    const before = await events(id);
    await admin.proposal.update({ where: { id }, data: { body: `${CLEAN_BODY} 追記。` } });
    const error = await errorOf(await approve(hostSales, id), 409);
    expect(error.code).toBe('GATE_STALE');
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
    expect(await events(id)).toHaveLength(before.length);
    expect(await audits(id, 'proposal.approve')).toHaveLength(0);
    expect(await audits(id, 'state.invalid_transition')).toHaveLength(0);
  });

  it('凍結側の添付（skill_sheet_id）を差し替えても 409（凍結列が材料であり、リレーションではない）', async () => {
    const { id } = await partnerProposalToPending();
    await admin.engineerSnapshot.update({ where: { proposalId: id }, data: { skillSheetId: null } });
    expect((await errorOf(await approve(hostSales, id), 409)).code).toBe('GATE_STALE');
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
  });

  it('3 層 PASS の DONE 行が無い（FAIL 行だけ / HELD 行だけ）なら 409', async () => {
    const { id } = await partnerProposalToPending();
    // 検査結果を FAIL に書き換える（実運用では起きないが、CAS の EXISTS が判定を見ていることの証明）。
    await admin.reviewGate.updateMany({ where: { targetId: id }, data: { piiVerdict: 'FAIL' } });
    expect((await errorOf(await approve(hostSales, id), 409)).code).toBe('GATE_STALE');
    // HELD 行だけ（判定 NULL）でも 409。
    await admin.reviewGate.updateMany({
      where: { targetId: id },
      data: { execution: 'HELD_AI_COST_LIMIT', heldSince: NOW, piiVerdict: null, commerceVerdict: null, executedAt: null },
    });
    expect((await errorOf(await approve(hostSales, id), 409)).code).toBe('GATE_STALE');
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
  });
});

// ---------------------------------------------------------------------------
// ⑦ #42 却下
// ---------------------------------------------------------------------------

describe('🔴 ⑦ #42 却下（差し戻し）: 理由必須で DRAFT に戻る。理由は履歴にだけ残り監査には載らない', () => {
  it('APPROVAL_PENDING → DRAFT。ProposalEvent.note = 理由、AuditLog(proposal.reject) の summary に理由なし', async () => {
    const { id, contentHash } = await partnerProposalToPending();
    const response = await reject(hostSales, id, { reason: REJECT_REASON });
    expect(response.status).toBe(200);
    expect((await response.json()) as StateBody).toEqual({ state: 'DRAFT' });
    const row = await proposalRow(id);
    expect(row).toMatchObject({ state: 'DRAFT', approvedAt: null, approvedBy: null, approvedBySystem: false, contentHash });
    const last = (await events(id)).at(-1);
    expect(last).toMatchObject({ kind: 'STATE', fromState: 'APPROVAL_PENDING', toState: 'DRAFT', actorUserId: USER_A_HOST, note: REJECT_REASON });
    const recorded = await audits(id, 'proposal.reject');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ actorKind: 'USER', actorId: USER_A_HOST, summary: { operation: 'REJECT', fromState: 'APPROVAL_PENDING', toState: 'DRAFT' } });
    expect(JSON.stringify(recorded[0]?.summary)).not.toContain(REJECT_REASON);
    // 🔴 却下後は作成者（取引先）が編集できる（DRAFT に戻っている）ことの対照: S-020 の読み取りが DRAFT を返す。
    const view = await readProposalApproval(partnerA1, id, { now: NOW });
    expect(view.view.state).toBe('DRAFT');
  });

  it('理由が無い / 空白だけなら 400 で状態は変わらない', async () => {
    const { id } = await partnerProposalToPending();
    expect((await errorOf(await reject(hostSales, id, {}), 400)).code).toBe('VALIDATION');
    expect((await errorOf(await reject(hostSales, id, { reason: '   ' }), 400)).code).toBe('VALIDATION');
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
    expect(await audits(id, 'proposal.reject')).toHaveLength(0);
  });

  it('🔴 GATE_FAILED → DRAFT は #48（MANUAL）の専有: #42 からは 422 PROPOSAL_TRANSITION_RESERVED。APPROVED からは 422 INVALID_STATE_TRANSITION', async () => {
    const failed = await hostProposalAfterGate(`ご提案します。${HOST_NAME} です。`);
    expect((await errorOf(await reject(hostSales, failed.id, { reason: REJECT_REASON }), 422)).code).toBe('PROPOSAL_TRANSITION_RESERVED');
    expect((await proposalRow(failed.id)).state).toBe('GATE_FAILED');
    const { id } = await partnerProposalToPending();
    expect((await approve(hostSales, id)).status).toBe(200);
    expect((await errorOf(await reject(hostSales, id, { reason: REJECT_REASON }), 422)).code).toBe('INVALID_STATE_TRANSITION');
    expect((await proposalRow(id)).state).toBe('APPROVED');
  });
});

// ---------------------------------------------------------------------------
// ⑧ 認可・境界・同時実行
// ---------------------------------------------------------------------------

describe('🔴 ⑧ 認可・境界: 承認・却下できるのはホストの OWNER / ADMIN / SALES だけ', () => {
  it('取引先（作成者本人・PARTNER_ADMIN）は 403、VIEWER は 403、他テナントは 404（不存在と同じ本文）、SUSPENDED は 409', async () => {
    const { id } = await partnerProposalToPending();
    for (const ctx of [partnerA1, partnerA1Admin, partnerA2, hostViewer]) {
      expect((await errorOf(await approve(ctx, id), 403)).code).toBe('FORBIDDEN');
      expect((await errorOf(await reject(ctx, id, { reason: REJECT_REASON }), 403)).code).toBe('FORBIDDEN');
    }
    const foreign = await approve(hostB, id);
    const absent = await approve(hostB, ABSENT_ID);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await absent.text());
    expect((await errorOf(await approve(hostSuspended, id), 409)).code).toBe('TENANT_NOT_EXECUTABLE');
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
    expect(await audits(id, 'proposal.approve')).toHaveLength(0);
    expect(await audits(id, 'proposal.reject')).toHaveLength(0);
  });

  it('🔴 同時に 2 回承認しても、承認は 1 回（CAS）。もう片方は 422 で記録される', async () => {
    const { id } = await partnerProposalToPending();
    const [first, second] = await Promise.all([approve(hostSales, id), approve(hostOwner, id)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 422]);
    expect(await audits(id, 'proposal.approve')).toHaveLength(1);
    expect((await events(id)).filter((row) => row.toState === 'APPROVED')).toHaveLength(1);
    expect((await proposalRow(id)).state).toBe('APPROVED');
  });
});

// ---------------------------------------------------------------------------
// ⑨ S-021 の読み取り
// ---------------------------------------------------------------------------

describe('⑨ S-021 の読み取り（readProposalApproval）: 判断材料は凍結側 + ゲート結果、立場で承認可否が決まる', () => {
  it('ホストは判断材料を読め canApprove=true。作成した取引先は内容とゲート結果を読めるが canApprove=false。他社・他テナント・不存在は 404', async () => {
    const { id, contentHash } = await partnerProposalToPending();
    // 台帳を更新しても判断材料（凍結側）は変わらない。
    await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { displayName: `${P1_NAME}（更新後）` } });

    const host = await readProposalApproval(hostSales, id, { now: NOW });
    expect(host.view.audience).toBe('HOST');
    expect(host.view.snapshot.displayName).toBe(P1_NAME);
    expect(host.view.recipient).toEqual({ companyName: RECIPIENT.recipientCompanyName, email: RECIPIENT.recipientEmail });
    expect(host.view.terms.offeredUnitPrice).toBe(650000);
    expect(host.gate).toMatchObject({ execution: 'DONE', contentHash });
    expect(host.gate.layers).toMatchObject({ pii: { state: 'PASS' }, commerce: { state: 'PASS' }, consistency: { state: 'PASS' } });
    expect(host.approval).toEqual({ kind: 'NONE' });
    expect(host.canApprove).toBe(true);
    expect(host.createdByName).toBe('Partner A1');

    const partner = await readProposalApproval(partnerA1, id, { now: NOW });
    expect(partner.view.audience).toBe('PARTNER');
    expect(partner.canApprove).toBe(false);
    expect(partner.gate.execution).toBe('DONE');
    expect(partner.view).not.toHaveProperty('owner');

    for (const ctx of [partnerA2, hostB]) {
      await expect(readProposalApproval(ctx, id, { now: NOW })).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(readProposalApproval(hostSales, ABSENT_ID, { now: NOW })).rejects.toBeInstanceOf(NotFoundError);

    // 承認後は承認者欄に人間の表示名が載る。
    expect((await approve(hostSales, id)).status).toBe(200);
    const after = await readProposalApproval(partnerA1, id, { now: NOW });
    expect(after.approval).toMatchObject({ kind: 'USER', approverName: 'Host A' });
  });
});
