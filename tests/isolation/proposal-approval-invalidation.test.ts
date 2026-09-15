// tests/isolation/proposal-approval-invalidation.test.ts
// 🔴 T-09-04（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-04）: **承認後の内容変更で承認が無効になる**ことと、
//    送信前判定 / 送信 CAS が承認 CAS と**同じ述語**で判定することを **実 DB（RLS 付き）+ 実 Redis + 実 Route Handler +
//    実 `gate.run`（モック AI）** で証明する。docs/05 §11.5 手順 2 / 手順 3 / 手順 4 / §10.2 ①-c ②-b ③ / §10.3 / §6.5
//    「承認の無効化と送信前判定の共有（T-09-04）」/ `F-021` / E2E #10 の結合テスト側。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ⓪ 承認済みの提案は `readProposalGateFreshness` が `gateFresh = true`（`storedHash` = `currentHash` = `review_gates` の hash。
//      三つ巴の一致）。読む側の所属（ホスト / 作成した取引先）で値が変わらない。他社・他テナントは `null`
//   ① 🔴 **API を通らない経路**（管理接続）で `proposals.content_hash` をずらす → `gateFresh = false` →
//      `castProposalToSubmitting` が 0 件更新 = `GATE_STALE`。状態は `APPROVED` のまま、履歴も増えない
//   ② 同じく本文 / 凍結の careers（1 行の値 / 行の順序）を変える → `GATE_STALE`（`v4` で careers が材料に入った証明）
//   ③ 旧版（`v3` 相当）のハッシュで保存された行（`proposals` と `review_gates` の両方が同じ古い値）→ `GATE_STALE`
//      （docs/05 §11.5「版の切り替え」= fail-closed。マイグレーションしない根拠）
//   ④ ずらさなければ `castProposalToSubmitting` が 1 件更新で `SUBMITTING` + `ProposalEvent(APPROVED → SUBMITTING, system)`。
//      2 回目は `NOT_APPROVED`（状態 `SUBMITTING`）。**`SUBMITTED` / `SUBMIT_FAILED` に確定させる処理は T-09-06 / T-09-07**
//      のため、テスト内で行を `APPROVED` に戻す
//   ⑤ 🔴 同時 2 回の `castProposalToSubmitting` で 1 回だけ成功（CAS + 行ロック）。`SUBMITTING` への履歴は 1 行
//   ⑥ `APPROVAL_PENDING`（未承認）は `NOT_APPROVED`（§10.3「CAS の条件 `WHERE state='APPROVED'`」）。他テナントのジョブ文脈は `NOT_FOUND`
//   ⑦ 🔴 #37 `PATCH` は `APPROVED` / `APPROVAL_PENDING` で 422 `PROPOSAL_NOT_EDITABLE`。`content_hash` / 状態 / 承認記録 /
//      履歴 / 監査のいずれも不変（§11.5 手順 2 の改訂 = API からは変更できない）
//   ⑧ 承認 CAS と送信 CAS が同じ内容で同じ判定: ずらした `APPROVAL_PENDING` は #41 が 409、戻せば 200 → 送信 CAS が `SUBMITTING`
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と `MockAnthropicClient`（`packages/ai/src/mock/`。実 API に接続しない）だけ。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import { gateRunJobId } from '@ses/connectors';
import { createBullMqGateRunQueue, type BullMqGateRunQueue } from '@ses/connectors/bullmq';
import {
  castProposalToSubmitting,
  configureTenantDb,
  disconnectTenantDb,
  readProposalGateFreshness,
  resolveTenantCtx,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import { GATE_HASH_ALGORITHM_VERSION } from '../../packages/domain/src/gate/hash.js';
import { proposalTransitionOwner } from '../../packages/domain/src/state/proposal.js';
import {
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
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.94' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');
const SEND_NOW = new Date('2026-09-16T00:05:00.000Z');
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const approveRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/approve/route');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');

const P1_NAME = 'T0904 佐藤 花子';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009d4';
const SKILL_NAME = 'Elixir(t0904)';
const RECIPIENT = { recipientCompanyName: 'T0904 架空エンド株式会社', recipientEmail: 't0904-recipient@example.test' };
const CLEAN_BODY = `ご提案します。${SKILL_NAME} の経験が 6 年あります。`;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

const AUDIT_ACTIONS = ['proposal.create', 'proposal.update', 'proposal.approve', 'proposal.reject', 'state.invalid_transition'];
/** 送信ジョブの識別（T-09-06 の `send.proposal` と同じ形。ここでは CAS の実体だけを呼ぶ）。 */
const SEND_JOB = { queue: 'send.proposal', jobId: 'send.proposal.t0904' } as const;

let database: IsolationDatabase;
let redis: IsolationRedis;
let admin: UnextendedClient;
let queue: BullMqGateRunQueue;
let hostSales: AuthenticatedTenantCtx;
let hostOwner: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;
let sendJobA: SystemTenantCtx;
let sendJobB: SystemTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string };
type StateBody = { readonly state: string };
// 🔴 `@prisma/client` を tests/** から import しない（ESLint）。JSON 列の入力型は管理クライアントの型から導く。
type SnapshotUpdateData = Parameters<UnextendedClient['engineerSnapshot']['update']>[0]['data'];
type CareersJsonInput = NonNullable<SnapshotUpdateData['careers']>;
type FrozenCareerJson = {
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
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

async function patch(ctx: AuthenticatedTenantCtx, id: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return proposalRoute.PATCH(
    new Request(`https://app.test/api/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    segment(id),
  );
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

async function approve(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return approveRoute.POST(new Request(`https://app.test/api/proposals/${id}/approve`, { method: 'POST' }), segment(id));
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

async function proposalRow(id: string) {
  return admin.proposal.findUniqueOrThrow({
    where: { id },
    select: { state: true, approvedBy: true, approvedBySystem: true, approvedAt: true, contentHash: true, body: true, subject: true },
  });
}

async function events(id: string) {
  return admin.proposalEvent.findMany({
    where: { proposalId: id },
    orderBy: [{ id: 'asc' }],
    select: { kind: true, fromState: true, toState: true, actorUserId: true, note: true, occurredAt: true },
  });
}

async function audits(id: string, action: string) {
  return admin.auditLog.findMany({ where: { targetId: id, action }, select: { id: true } });
}

async function frozenCareers(id: string): Promise<FrozenCareerJson[]> {
  const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: id }, select: { careers: true } });
  return snapshot.careers as FrozenCareerJson[];
}

async function setFrozenCareers(id: string, careers: readonly FrozenCareerJson[]): Promise<void> {
  await admin.engineerSnapshot.update({
    where: { proposalId: id },
    data: { careers: careers as unknown as CareersJsonInput },
  });
}

/** 取引先 A1 が自社エンジニアで提案を作り、レビュー依頼 → `gate.run`（全層 PASS）→ `APPROVAL_PENDING` まで進める。 */
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

/** さらにホストが #41 で承認して `APPROVED` にする。 */
async function approvedProposal(): Promise<{ readonly id: string; readonly contentHash: string; readonly reviewGateId: string }> {
  const pending = await partnerProposalToPending();
  const response = await approve(hostSales, pending.id);
  expect(response.status).toBe(200);
  expect((await response.json()) as StateBody).toEqual({ state: 'APPROVED' });
  expect((await proposalRow(pending.id)).state).toBe('APPROVED');
  return pending;
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
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
  sendJobA = systemTenantCtx(TENANT_A, SEND_JOB);
  sendJobB = systemTenantCtx(TENANT_B, SEND_JOB);

  await admin.skill.upsert({
    where: { id: SKILL_BACKED },
    create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 914 },
    update: {},
  });
  await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerSkill.create({
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED, yearsOfExperience: 6, level: 4, source: 'MANUAL' },
  });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER }, data: { displayName: P1_NAME, contactEmail: null, contactPhone: null } });
  await admin.skillSheet.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.skillSheet.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT_A,
      engineerId: ENGINEER_A_PARTNER,
      version: 1,
      objectKey: `t0904/${randomUUID()}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: 1024n,
      scanStatus: 'CLEAN',
      isLatest: true,
      uploadedBy: USER_A_PARTNER,
      uploadedAt: NOW,
    },
  });
  // 🔴 凍結される経歴（v4 の材料）。台帳に 3 行置き、createProposalDraft が §3.4.1 の順（period_from DESC → created_at ASC → id ASC）で凍結する。
  await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.createMany({
    data: [
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2025-01', periodTo: null, role: 'PG', description: 'T0904 架空の基幹刷新（合成データ）', technologies: 'Elixir / Phoenix', source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2023-06', periodTo: '2024-12', role: 'SE', description: 'T0904 架空の EC 保守（合成データ）', technologies: 'TypeScript / React', source: 'MANUAL' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2022-01', periodTo: '2023-05', role: 'PG', description: 'T0904 架空の受発注（合成データ）', technologies: 'Java', source: 'MANUAL' },
    ],
  });
  await admin.tenant.update({ where: { id: TENANT_A }, data: { autoApproveEnabled: false } });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER, description: { startsWith: 'T0904' } } });
  resetGateRunJobQueue();
  await queue?.close();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await redis?.stop();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  configureGateRunJobQueue(queue);
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
});

// ---------------------------------------------------------------------------
// ⓪ 三つ巴の一致
// ---------------------------------------------------------------------------

describe('⓪ readProposalGateFreshness（docs/05 §10.2 ①-c / ②-b）: 承認済みは三つ巴が一致し gateFresh=true。所属で値が変わらない', () => {
  it('ホストと作成した取引先で同じ値。他社・他テナントは null。凍結の careers は 3 行あり v4 の材料に入っている', async () => {
    const { id, contentHash, reviewGateId } = await approvedProposal();
    expect(contentHash).toMatch(SHA256_HEX);
    expect(GATE_HASH_ALGORITHM_VERSION).toBe('v4');
    const careers = await frozenCareers(id);
    expect(careers).toHaveLength(3);
    // 凍結の順序は §3.4.1（period_from DESC）。ハッシュはこの順のまま綴じる。
    expect(careers.map((row) => row.periodFrom)).toEqual(['2025-01', '2023-06', '2022-01']);

    const host = await readProposalGateFreshness(hostSales, id);
    expect(host).toEqual({ state: 'APPROVED', storedHash: contentHash, currentHash: contentHash, reviewGateId, gateFresh: true });
    const partner = await readProposalGateFreshness(partnerA1, id);
    expect(partner).toEqual(host);
    const job = await readProposalGateFreshness(sendJobA, id);
    expect(job).toEqual(host);

    expect(await readProposalGateFreshness(partnerA2, id)).toBeNull();
    expect(await readProposalGateFreshness(hostB, id)).toBeNull();
    expect(await readProposalGateFreshness(sendJobB, id)).toBeNull();
    // 🔴 読むだけ。状態も履歴も動かない。
    expect((await proposalRow(id)).state).toBe('APPROVED');
    expect((await events(id)).filter((row) => row.toState === 'SUBMITTING')).toHaveLength(0);
  });

  it('🔴 送信の遷移の所有者は SEND_JOB（castProposalToSubmitting が動かす組。#48 の MANUAL と重ならない）', () => {
    expect(proposalTransitionOwner('APPROVED', 'SUBMITTING')).toBe('SEND_JOB');
  });
});

// ---------------------------------------------------------------------------
// ①②③ API を通らない経路で内容が変わる → GATE_STALE
// ---------------------------------------------------------------------------

describe('🔴 ①②③ docs/05 §11.5 手順 4: 承認後に内容が変われば送信 CAS は 0 件更新 = GATE_STALE。状態は APPROVED のまま', () => {
  it('① proposals.content_hash を管理接続でずらす → gateFresh=false → castProposalToSubmitting が GATE_STALE。履歴も増えない', async () => {
    const { id, contentHash, reviewGateId } = await approvedProposal();
    const before = await events(id);
    const shifted = 'f'.repeat(64);
    await admin.proposal.update({ where: { id }, data: { contentHash: shifted } });

    const freshness = await readProposalGateFreshness(sendJobA, id);
    // 現在の内容は変わっていないので review_gates は引ける。列だけが食い違う = 三つ巴が崩れている。
    expect(freshness).toEqual({ state: 'APPROVED', storedHash: shifted, currentHash: contentHash, reviewGateId, gateFresh: false });

    const outcome = await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW });
    expect(outcome).toEqual({ kind: 'GATE_STALE' });
    const row = await proposalRow(id);
    expect(row.state).toBe('APPROVED');
    expect(row.contentHash).toBe(shifted);
    expect(row.approvedBy).toBe(USER_A_HOST);
    expect(await events(id)).toHaveLength(before.length);
  });

  it('② 本文を管理接続で書き換える（API を通らない内容の変更）→ 現在の内容に対するゲート結果が無く GATE_STALE', async () => {
    const { id, contentHash } = await approvedProposal();
    await admin.proposal.update({ where: { id }, data: { body: `${CLEAN_BODY} 承認後の追記。` } });
    const freshness = await readProposalGateFreshness(sendJobA, id);
    expect(freshness).toMatchObject({ state: 'APPROVED', storedHash: contentHash, reviewGateId: null, gateFresh: false });
    expect(freshness?.currentHash).not.toBe(contentHash);
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'GATE_STALE' });
    expect((await proposalRow(id)).state).toBe('APPROVED');
  });

  it('🔴 ② 凍結の careers の 1 行を変える / 行の順序を入れ替える → GATE_STALE（v4: 経歴はハッシュの材料である）', async () => {
    const { id, contentHash } = await approvedProposal();
    const original = await frozenCareers(id);
    expect(original.length).toBeGreaterThanOrEqual(2);
    const [first, ...rest] = original;
    if (first === undefined) throw new Error('unreachable');

    // 1 行の値（technologies）を変える。
    await setFrozenCareers(id, [{ ...first, technologies: `${first.technologies} / Rust` }, ...rest]);
    let freshness = await readProposalGateFreshness(sendJobA, id);
    expect(freshness).toMatchObject({ storedHash: contentHash, reviewGateId: null, gateFresh: false });
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'GATE_STALE' });

    // 元に戻すと三つ巴が戻る（材料が careers そのものであり、書き換えの副作用ではない）。
    await setFrozenCareers(id, original);
    freshness = await readProposalGateFreshness(sendJobA, id);
    expect(freshness).toMatchObject({ currentHash: contentHash, gateFresh: true });

    // 行の順序だけを入れ替える（値の集合は同じ）。
    await setFrozenCareers(id, [...original].reverse());
    freshness = await readProposalGateFreshness(sendJobA, id);
    expect(freshness).toMatchObject({ reviewGateId: null, gateFresh: false });
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'GATE_STALE' });
    expect((await proposalRow(id)).state).toBe('APPROVED');
  });

  it('③ 旧版（v3 相当）のハッシュで保存された行: proposals と review_gates の両方が同じ古い値でも、現在の内容の再計算と食い違い GATE_STALE（fail-closed）', async () => {
    const { id, contentHash } = await approvedProposal();
    const legacy = '3'.repeat(64);
    await admin.proposal.update({ where: { id }, data: { contentHash: legacy } });
    await admin.reviewGate.updateMany({ where: { targetType: 'PROPOSAL', targetId: id }, data: { contentHash: legacy } });
    const freshness = await readProposalGateFreshness(sendJobA, id);
    expect(freshness).toEqual({ state: 'APPROVED', storedHash: legacy, currentHash: contentHash, reviewGateId: null, gateFresh: false });
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'GATE_STALE' });
    expect((await proposalRow(id)).state).toBe('APPROVED');
  });
});

// ---------------------------------------------------------------------------
// ④⑤⑥ 送信 CAS
// ---------------------------------------------------------------------------

describe('🔴 ④⑤⑥ castProposalToSubmitting（docs/05 §10.2 ③ / §10.3）: 三つ巴が一致するときだけ 1 件更新。多重実行は 1 回', () => {
  it('④ ずらさなければ SUBMITTING（1 件更新 + ProposalEvent APPROVED→SUBMITTING, system）。2 回目は NOT_APPROVED(SUBMITTING)', async () => {
    const { id, contentHash } = await approvedProposal();
    const before = await events(id);

    const outcome = await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW });
    expect(outcome).toEqual({ kind: 'SUBMITTING', contentHash });
    const row = await proposalRow(id);
    expect(row).toMatchObject({ state: 'SUBMITTING', contentHash, approvedBy: USER_A_HOST, approvedBySystem: false });
    expect(row.approvedAt).not.toBeNull();

    const history = await events(id);
    expect(history).toHaveLength(before.length + 1);
    expect(history.at(-1)).toMatchObject({ kind: 'STATE', fromState: 'APPROVED', toState: 'SUBMITTING', actorUserId: null, note: null, occurredAt: SEND_NOW });
    // 🔴 送信の監査（proposal.submit）は書かない（§10.2 ⑥ = T-09-06 の確定時）。
    expect(await admin.auditLog.count({ where: { targetId: id, action: 'proposal.submit' } })).toBe(0);

    // 2 回目: 状態が SUBMITTING なので 0 件。GATE_STALE ではなく NOT_APPROVED（多重実行 = 外部 API を呼ばない）。
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'NOT_APPROVED', state: 'SUBMITTING' });
    expect(await events(id)).toHaveLength(before.length + 1);

    // 🔴 SUBMITTED / SUBMIT_FAILED に確定させる処理は T-09-06 / T-09-07。SUBMITTING は片道なので、テストの後始末として
    //    管理接続で APPROVED に戻す（アプリの経路ではない）。
    await admin.proposal.update({ where: { id }, data: { state: 'APPROVED' } });
    expect((await proposalRow(id)).state).toBe('APPROVED');
    // 戻せば再び 1 件更新になる（判定が状態と三つ巴だけで決まる）。
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'SUBMITTING', contentHash });
    await admin.proposal.update({ where: { id }, data: { state: 'APPROVED' } });
  });

  it('🔴 ⑤ 同時 2 回の castProposalToSubmitting で 1 回だけ SUBMITTING。もう片方は NOT_APPROVED(SUBMITTING)。履歴は 1 行', async () => {
    const { id, contentHash } = await approvedProposal();
    const [first, second] = await Promise.all([
      castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW }),
      castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW }),
    ]);
    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(['NOT_APPROVED', 'SUBMITTING']);
    const winner = first.kind === 'SUBMITTING' ? first : second;
    const loser = first.kind === 'SUBMITTING' ? second : first;
    expect(winner).toEqual({ kind: 'SUBMITTING', contentHash });
    expect(loser).toEqual({ kind: 'NOT_APPROVED', state: 'SUBMITTING' });
    expect((await proposalRow(id)).state).toBe('SUBMITTING');
    expect((await events(id)).filter((row) => row.toState === 'SUBMITTING')).toHaveLength(1);
    await admin.proposal.update({ where: { id }, data: { state: 'APPROVED' } });
  });

  it('⑥ APPROVAL_PENDING（未承認）は NOT_APPROVED で状態不変（承認を経ない実行遷移は CAS の条件で不可能）。他テナントのジョブ文脈は NOT_FOUND', async () => {
    const { id, contentHash, reviewGateId } = await partnerProposalToPending();
    // 三つ巴は一致している（承認できる状態）が、状態が APPROVED ではない。
    expect(await readProposalGateFreshness(sendJobA, id)).toEqual({
      state: 'APPROVAL_PENDING',
      storedHash: contentHash,
      currentHash: contentHash,
      reviewGateId,
      gateFresh: true,
    });
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'NOT_APPROVED', state: 'APPROVAL_PENDING' });
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
    expect((await events(id)).filter((row) => row.toState === 'SUBMITTING')).toHaveLength(0);

    expect(await castProposalToSubmitting(sendJobB, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'NOT_FOUND' });
    expect(await castProposalToSubmitting(sendJobA, { proposalId: randomUUID(), now: SEND_NOW })).toEqual({ kind: 'NOT_FOUND' });
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');
  });
});

// ---------------------------------------------------------------------------
// ⑦ #37 は APPROVED / APPROVAL_PENDING で 422
// ---------------------------------------------------------------------------

describe('🔴 ⑦ docs/05 §11.5 手順 2（改訂）: APPROVED / APPROVAL_PENDING の内容は API から変更できない（#37 は 422 PROPOSAL_NOT_EDITABLE）', () => {
  it('APPROVED への PATCH（作成者 / ホスト OWNER）は 422。content_hash・状態・承認記録・履歴・監査が不変', async () => {
    const { id, contentHash } = await approvedProposal();
    const before = await proposalRow(id);
    const history = await events(id);
    const updates = await audits(id, 'proposal.update');

    for (const [ctx, body] of [
      [partnerA1, { body: '承認後に本文を差し替える' }],
      [hostOwner, { subject: '承認後に件名を差し替える', offeredUnitPrice: 900000 }],
      [hostSales, { skillSheetId: null }],
      [partnerA1, { recipientEmail: 'other@example.test' }],
    ] as const) {
      const error = await errorOf(await patch(ctx, id, body), 422);
      expect(error.code).toBe('PROPOSAL_NOT_EDITABLE');
    }
    expect(await proposalRow(id)).toEqual(before);
    expect(before).toMatchObject({ state: 'APPROVED', contentHash });
    expect(await events(id)).toEqual(history);
    expect(await audits(id, 'proposal.update')).toEqual(updates);
    // 三つ巴も崩れていない（送信できる状態のまま）。
    expect(await readProposalGateFreshness(sendJobA, id)).toMatchObject({ state: 'APPROVED', gateFresh: true });
  });

  it('APPROVAL_PENDING への PATCH も 422（承認待ちの内容を変えたければ #42 の却下で DRAFT に戻す）', async () => {
    const { id, contentHash } = await partnerProposalToPending();
    const before = await proposalRow(id);
    expect((await errorOf(await patch(partnerA1, id, { body: '承認待ちに本文を差し替える' }), 422)).code).toBe('PROPOSAL_NOT_EDITABLE');
    expect(await proposalRow(id)).toEqual(before);
    expect(before).toMatchObject({ state: 'APPROVAL_PENDING', contentHash });
  });
});

// ---------------------------------------------------------------------------
// ⑧ 承認 CAS と送信 CAS が同じ述語
// ---------------------------------------------------------------------------

describe('🔴 ⑧ 承認 CAS（#41）と送信 CAS が同じ内容で同じ判定を返す（1 実装）', () => {
  it('ずらした APPROVAL_PENDING は #41 が 409 GATE_STALE。戻せば 200 → 送信 CAS が SUBMITTING。承認直後に再びずらせば送信 CAS が GATE_STALE', async () => {
    const { id, contentHash } = await partnerProposalToPending();
    const shifted = 'e'.repeat(64);

    await admin.proposal.update({ where: { id }, data: { contentHash: shifted } });
    expect(await readProposalGateFreshness(hostSales, id)).toMatchObject({ state: 'APPROVAL_PENDING', gateFresh: false });
    expect((await errorOf(await approve(hostSales, id), 409)).code).toBe('GATE_STALE');
    expect((await proposalRow(id)).state).toBe('APPROVAL_PENDING');

    await admin.proposal.update({ where: { id }, data: { contentHash } });
    expect(await readProposalGateFreshness(hostSales, id)).toMatchObject({ state: 'APPROVAL_PENDING', gateFresh: true });
    expect((await approve(hostSales, id)).status).toBe(200);
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'SUBMITTING', contentHash });
    await admin.proposal.update({ where: { id }, data: { state: 'APPROVED' } });

    await admin.proposal.update({ where: { id }, data: { contentHash: shifted } });
    expect(await castProposalToSubmitting(sendJobA, { proposalId: id, now: SEND_NOW })).toEqual({ kind: 'GATE_STALE' });
    expect((await proposalRow(id)).state).toBe('APPROVED');
  });
});
