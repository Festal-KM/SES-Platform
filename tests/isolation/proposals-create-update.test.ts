// tests/isolation/proposals-create-update.test.ts
// 🔴 T-09-01（`docs/sprints/SP-09-proposal-flow.md` §4）: 提案の作成（#36）・編集（#37）・レビュー依頼（#39）を
//    **実 DB（RLS 付き）+ 実 Redis（BullMQ）+ 実 Route Handler** で証明する。`F-019 AC-1`〜`AC-4` / `F-011 AC-1` /
//    `BR-06` `BR-07` / docs/05 §6.5「T-09-01 の決着」/ §4.8 / SP-08 の申し送り②。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① #36: 取引先が自社エンジニアで作成 → 201。`Proposal(DRAFT)` + `EngineerSnapshot`（凍結）+ `ProposalEvent` + `proposal.create`
//      が **`createProposalDraft()` の 1 実装**で書かれる（#33 と同じ関数）。
//   ② 🔴 `F-019 AC-2`: 作成後に台帳（氏名・スキル・経歴・連絡先）を更新しても、凍結情報（`readProposalEditor` の `snapshot` /
//      `engineer_snapshots.careers::text`）は 1 バイトも変わらない。
//   ③ 🔴 `F-019 AC-1`: ホストが読む `HostProposalView` のエンジニア情報は凍結側だけ。**台帳の現在値（更新後の氏名・連絡先）
//      と `engineerId` が応答のどの深さにも無い**（深さ走査）。ホスト文脈からは `engineers` が 0 行（対照）。
//   ④ 🔴 `F-019 AC-4` / `BR-07`: 取引先が読む `PartnerProposalView` に、他社の提案の値・作成した会社・ホストの上流
//      （エンド企業名・販売単価）が無い（深さ走査）。他社（A2）は A1 の提案に到達できない（404。403 と区別しない）。
//   ⑤ 🔴 `F-019 AC-3` / `F-011 AC-1`: `CLEAN` でない版は添付できない（409）。他社の版・別エンジニアの版は 404。
//      添付できる版の一覧は `CLEAN` だけ。
//   ⑥ 🔴 #37 は `DRAFT` のみ（他状態は 422 `PROPOSAL_NOT_EDITABLE`。行・イベント・監査は変わらない）。
//      提案先の 2 列は空にできない（400）。更新は `ProposalEvent(NOTE)` と `proposal.update`（値を載せない）に残る。
//   ⑦ 🔴 SP-08 の申し送り②: 経路 4 の応諾で作った `DRAFT`（提案先が空）は #39 が **422 `PROPOSAL_RECIPIENT_MISSING`**
//      （`GATE_RUNNING` へ遷移しない・ジョブを積まない）。#37 で提案先を設定した**後にだけ** 202 で `GATE_RUNNING` になる。
//   ⑧ 🔴 T-09-13 の効果: #36 / #33 で取引先が作成した提案が、#39 → `gate.run`（モック AI）で **3 層の判定を受けて
//      `APPROVAL_PENDING` に到達する**（`ReviewGate` 1 行）。
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）/ `candidateReference`（起動時 DI の鍵）/ Anthropic（`createAiClient('mock')`）
//    の 3 点だけ。DB・RLS・Route Handler・ガード・トランザクション・BullMQ はすべて実物である。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import { gateRunJobId } from '@ses/connectors';
import { createBullMqGateRunQueue, type BullMqGateRunQueue } from '@ses/connectors/bullmq';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { createGateRunHandler } from '../../apps/worker/src/jobs/gate-run.js';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  PROPOSAL_A_P1_PRIVATE,
  PROPOSAL_A_P2,
  TENANT_A,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { startIsolationRedis, type IsolationRedis } from './support/redis.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.90' } as const;
const TEST_SECRET = 'E'.repeat(43) + '=';
const NOW = new Date('2026-09-15T00:00:00.000Z');
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { createCandidateReference } = await import('../../apps/web/lib/anonymize/reference');
const candidateRef = createCandidateReference(TEST_SECRET);

vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  candidateReference: () => candidateRef,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const gateRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/gate/route');
const candidatesRoute = await import('../../apps/web/app/api/(main)/projects/[id]/candidates/route');
const requestsRoute = await import('../../apps/web/app/api/(main)/proposal-requests/route');
const acceptRoute = await import('../../apps/web/app/api/(main)/proposal-requests/[id]/accept/route');
const { readProposalEditor } = await import('../../apps/web/lib/proposals/service');
const { NotFoundError } = await import('../../apps/web/lib/api/errors');
const { toProposalPatchBody } = await import('../../apps/web/lib/proposals/form-body');
const { proposalEditRows } = await import('../../apps/web/lib/proposals/editor-rows');
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import('../../apps/web/lib/jobs/gate-run-queue');

/** 🔴 台帳の値（凍結される側）。更新後の値は応答に現れてはならない。 */
const P1_NAME_BEFORE = 'T0901 佐藤 花子';
const P1_NAME_AFTER = 'T0901 佐藤 花子（更新後）';
const P1_EMAIL_AFTER = 't0901-after@partner-a1.example';
const P1_CAREER_BEFORE = ['T0901-career-1', 'T0901-career-2'] as const;
const P1_CAREER_AFTER = 'T0901-career-3-after';
const P2_NAME = 'T0901 鈴木 次郎';
const P2_PROPOSAL_BODY = 'T0901-p2-body-他社の本文';
/** fixtures の値（ホストの上流。取引先の応答に現れてはならない）。 */
const END_CLIENT_A = 'End Client A';
const INTERNAL_UNIT_PRICE_A = '900000';
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009c9';
const SKILL_NAME = 'Kotlin(t0901)';
const RECIPIENT = { recipientCompanyName: 'T0901 架空エンド株式会社', recipientEmail: 't0901-recipient@example.test' };

const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

const AUDIT_ACTIONS = ['proposal.create', 'proposal.update', 'proposal_request.create', 'proposal_request.update', 'project.view', 'state.invalid_transition'];

let database: IsolationDatabase;
let redis: IsolationRedis;
let admin: UnextendedClient;
let queue: BullMqGateRunQueue;
let hostA: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA1Viewer: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let cleanSheetId: string;
let scanningSheetId: string;
let p2SheetId: string;

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string; readonly snapshot: { readonly frozenAt: string; readonly careerCount: number } };

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function post(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return proposalsRoute.POST(
    new Request('https://app.test/api/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
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

async function requestGate(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return gateRoute.POST(new Request(`https://app.test/api/proposals/${id}/gate`, { method: 'POST' }), segment(id));
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

async function createAsPartner(overrides: Record<string, unknown> = {}): Promise<CreatedBody> {
  const response = await post(partnerA1, {
    projectId: PROJECT_A_PUBLISHED,
    engineerId: ENGINEER_A_PARTNER,
    ...RECIPIENT,
    subject: 'ご提案',
    body: `ご提案します。${SKILL_NAME} の経験が 6 年あります。`,
    offeredUnitPrice: 650000,
    offeredStartDate: '2026-11-01',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedBody;
}

type Collected = { readonly keys: string[]; readonly values: string[] };
function collect(value: unknown, depth = 0, acc: Collected = { keys: [], values: [] }): Collected {
  if (depth > 8 || value === null || value === undefined) return acc;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    acc.values.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      acc.keys.push(key);
      collect(entry, depth + 1, acc);
    }
  }
  return acc;
}

function expectNoValues(body: unknown, label: string, forbidden: readonly string[]): void {
  const collected = collect(body);
  for (const value of forbidden) {
    expect(collected.values.some((v) => v.includes(value)), `${label}: ${value} が応答に含まれている`).toBe(false);
  }
}

function expectNoKeys(body: unknown, label: string, forbidden: readonly string[]): void {
  const collected = collect(body);
  for (const key of forbidden) {
    expect(collected.keys, `${label}: キー ${key} が応答に含まれている`).not.toContain(key);
  }
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

function hashOfJobId(jobId: string): string {
  const parts = jobId.split('.');
  return parts[parts.length - 1] ?? '';
}

async function createSheet(engineerId: string, version: number, scanStatus: 'CLEAN' | 'SCANNING', uploadedBy: string): Promise<string> {
  const id = randomUUID();
  await admin.skillSheet.create({
    data: {
      id,
      tenantId: TENANT_A,
      engineerId,
      version,
      objectKey: `t0901/${id}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: 1024n,
      scanStatus,
      isLatest: scanStatus === 'CLEAN' && version === 1,
      uploadedBy,
      uploadedAt: NOW,
    },
  });
  return id;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  redis = await startIsolationRedis();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  queue = createBullMqGateRunQueue({ url: redis.url });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostA = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, { deviceKind: 'api' });
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, { deviceKind: 'api' });
  partnerA1Viewer = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'VIEWER' }, { deviceKind: 'api' });
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, { deviceKind: 'api' });

  // 台帳の裏付け（整合層。T-09-13 と同じ手口）: 辞書 1 語 + 取引先 A1 のエンジニアに 6 年。
  await admin.skill.upsert({
    where: { id: SKILL_BACKED },
    create: { id: SKILL_BACKED, name: SKILL_NAME, category: 'LANGUAGE', sortKey: 909 },
    update: {},
  });
  await admin.engineerSkill.deleteMany({ where: { engineerId: { in: [ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2] } } });
  await admin.engineerSkill.create({
    data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED, yearsOfExperience: 6, level: 4, source: 'MANUAL' },
  });
  await admin.engineer.update({ where: { id: ENGINEER_A_PARTNER2 }, data: { displayName: P2_NAME } });
  await admin.proposal.update({ where: { id: PROPOSAL_A_P2 }, data: { subject: 'T0901 他社の件名', body: P2_PROPOSAL_BODY, offeredUnitPrice: 777777 } });

  // 版: A1 のエンジニアに CLEAN（最新）と SCANNING、A2 のエンジニアに CLEAN。
  await admin.skillSheet.deleteMany({ where: { engineerId: { in: [ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2] } } });
  cleanSheetId = await createSheet(ENGINEER_A_PARTNER, 1, 'CLEAN', USER_A_PARTNER);
  scanningSheetId = await createSheet(ENGINEER_A_PARTNER, 2, 'SCANNING', USER_A_PARTNER);
  p2SheetId = await createSheet(ENGINEER_A_PARTNER2, 1, 'CLEAN', USER_A_PARTNER2);
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
  await admin.engineer.update({
    where: { id: ENGINEER_A_PARTNER },
    data: { displayName: P1_NAME_BEFORE, contactEmail: null, contactPhone: null },
  });
  await admin.engineerSkill.updateMany({ where: { engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED }, data: { yearsOfExperience: 6 } });
  await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
  await admin.engineerCareer.createMany({
    data: [
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2024-04', periodTo: null, role: 'PL', description: P1_CAREER_BEFORE[0], technologies: 'Kotlin' },
      { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: P1_CAREER_BEFORE[1], technologies: 'Java' },
    ],
  });
});

afterEach(async () => {
  // 🔴 本テストで作った提案（fixtures の 4 件以外）とその子を消す。`proposal_requests` への FK は RESTRICT なので先に。
  const fixtureIds = [PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2, PROPOSAL_A_P1_PRIVATE];
  const created = await admin.proposal.findMany({ where: { tenantId: TENANT_A, id: { notIn: fixtureIds } }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await admin.reviewGate.deleteMany({ where: { targetId: { in: ids } } });
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.proposalRequest.deleteMany({ where: { tenantId: TENANT_A } });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_' } } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ① #36 作成と凍結 / ② AC-2 / ③ AC-1 / ④ AC-4
// ---------------------------------------------------------------------------

describe('🔴 #36 POST /api/proposals: 取引先が自社エンジニアで作成すると凍結され、以後の台帳更新が提案を変えない（F-019 AC-1 / AC-2）', () => {
  it('201 で { id, snapshot } を返し、Proposal(DRAFT) + EngineerSnapshot + ProposalEvent + proposal.create が 1 実装で書かれる', async () => {
    const created = await createAsPartner();
    expect(Object.keys(created).sort()).toEqual(['id', 'snapshot']);
    expect(created.snapshot.careerCount).toBe(2);

    const row = await admin.proposal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({
      state: 'DRAFT',
      ownerPartnerCompanyId: PARTNER_A1,
      projectId: PROJECT_A_PUBLISHED,
      engineerId: ENGINEER_A_PARTNER,
      proposalRequestId: null,
      recipientCompanyName: RECIPIENT.recipientCompanyName,
      recipientEmail: RECIPIENT.recipientEmail,
      createdBy: USER_A_PARTNER,
    });
    expect(Number(row.offeredUnitPrice?.toString())).toBe(650000);

    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } });
    expect(snapshot.displayName).toBe(P1_NAME_BEFORE);
    expect(snapshot.ownerPartnerCompanyId).toBe(PARTNER_A1);
    // 🔴 最新の CLEAN 版だけが凍結される（SCANNING の版は選ばれない。F-019 AC-3）。
    expect(snapshot.skillSheetId).toBe(cleanSheetId);
    expect((snapshot.careers as { description: string }[]).map((c) => c.description)).toEqual([...P1_CAREER_BEFORE]);
    expect((snapshot.skills as { skillId: string }[]).map((s) => s.skillId)).toEqual([SKILL_BACKED]);

    const events = await admin.proposalEvent.findMany({ where: { proposalId: created.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'STATE', fromState: null, toState: 'DRAFT', actorUserId: USER_A_PARTNER });

    const audits = await admin.auditLog.findMany({ where: { action: 'proposal.create', targetId: created.id } });
    expect(audits).toHaveLength(1);
    // 🔴 summary に氏名・engineer_id・提案先・単価を載せない。
    const summary = JSON.stringify(audits[0]?.summary);
    expect(summary).not.toContain(P1_NAME_BEFORE);
    expect(summary).not.toContain(ENGINEER_A_PARTNER);
    expect(summary).not.toContain(RECIPIENT.recipientCompanyName);
    expect(summary).not.toContain('650000');
  });

  it('🔴 F-019 AC-2 / AC-1: 台帳を更新（氏名・連絡先・スキル・経歴）しても凍結情報は変わらず、ホストの応答は凍結側だけ（台帳の現在値・engineerId が無い）', async () => {
    const created = await createAsPartner();
    const before = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } });
    const beforeCareersText = JSON.stringify(before.careers);

    // 台帳の更新（取引先の手による、と同じ結果）。
    await admin.engineer.update({
      where: { id: ENGINEER_A_PARTNER },
      data: { displayName: P1_NAME_AFTER, contactEmail: P1_EMAIL_AFTER },
    });
    await admin.engineerSkill.update({
      where: { tenantId_engineerId_skillId: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, skillId: SKILL_BACKED } },
      data: { yearsOfExperience: 9 },
    });
    await admin.engineerCareer.deleteMany({ where: { engineerId: ENGINEER_A_PARTNER } });
    await admin.engineerCareer.create({
      data: { tenantId: TENANT_A, engineerId: ENGINEER_A_PARTNER, periodFrom: '2025-01', periodTo: null, role: 'PM', description: P1_CAREER_AFTER, technologies: 'Rust' },
    });

    // 凍結側は 1 バイトも変わらない。
    const after = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } });
    expect(after.displayName).toBe(P1_NAME_BEFORE);
    expect(JSON.stringify(after.careers)).toBe(beforeCareersText);
    expect((after.skills as { years: number }[])[0]?.years).toBe(6);

    // 🔴 ホストの応答（HostProposalView）: 凍結側の値だけ。更新後の氏名・連絡先・engineerId・経歴本文が無い。
    const host = await readProposalEditor(hostA, created.id);
    expect(host.view.audience).toBe('HOST');
    if (host.view.audience !== 'HOST') throw new Error('unreachable');
    expect(host.view.owner).toEqual({ kind: 'PARTNER', partnerCompanyName: 'Partner A1' });
    expect(host.view.snapshot.displayName).toBe(P1_NAME_BEFORE);
    expect(host.view.snapshot.careerCount).toBe(2);
    expect(host.view.snapshot.skills).toEqual([{ skillId: SKILL_BACKED, name: SKILL_NAME, years: 6, level: 4 }]);
    expect(host.view.recipient).toEqual({ companyName: RECIPIENT.recipientCompanyName, email: RECIPIENT.recipientEmail });
    expectNoValues(host, 'ホストの S-020 応答', [P1_NAME_AFTER, P1_EMAIL_AFTER, P1_CAREER_AFTER, ...P1_CAREER_BEFORE, ENGINEER_A_PARTNER, USER_A_PARTNER]);
    expectNoKeys(host, 'ホストの S-020 応答', ['engineerId', 'engineer', 'contactEmail', 'contactPhone', 'birthDate', 'createdBy', 'careers', 'duplicateFindings']);
    // 🔴 ホストは他社の台帳の版を読めないので添付の選択肢は 0 件（凍結された版はある）。
    expect(host.attachableSkillSheets).toEqual([]);
    expect(host.ownedEngineerId).toBeNull();
    expect(host.view.attachment.skillSheetId).toBe(cleanSheetId);
    // 対照: ホスト文脈からは台帳が 1 行も読めない（C3）。到達できるのは凍結側だけである。
    await withTenant(hostA, async (db) => {
      expect(await db.engineer.count({ where: { id: ENGINEER_A_PARTNER } })).toBe(0);
    });
    // ホストは編集できる立場（`canEditProposal`: ホストの SALES）。
    expect(host.canEdit).toBe(true);
  });

  it('🔴 F-019 AC-4 / BR-07: 取引先の応答に他社の提案・作成した会社・ホストの上流（エンド企業名・販売単価）が無く、他社は到達できない', async () => {
    const created = await createAsPartner();
    const partner = await readProposalEditor(partnerA1, created.id);
    expect(partner.view.audience).toBe('PARTNER');
    expectNoKeys(partner, '取引先の S-020 応答', ['owner', 'duplicateFindings', 'endClientName', 'internalUnitPrice', 'engineerId', 'partnerCompanyId', 'ownerPartnerCompanyId']);
    expectNoValues(partner, '取引先の S-020 応答', [END_CLIENT_A, INTERNAL_UNIT_PRICE_A, P2_NAME, P2_PROPOSAL_BODY, PROPOSAL_A_P2, PARTNER_A2, '777777', ENGINEER_A_PARTNER2, ENGINEER_A_HOST]);
    // 自社の台帳の版だけが選択肢（CLEAN のみ）。
    expect(partner.attachableSkillSheets.map((s) => s.id)).toEqual([cleanSheetId]);
    expect(partner.ownedEngineerId).toBe(ENGINEER_A_PARTNER);

    // 🔴 他社（A2）は A1 の提案に到達できない（読み取りも編集も 404。403 と区別しない）。
    await expect(readProposalEditor(partnerA2, created.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await errorOf(await patch(partnerA2, created.id, { subject: 'x' }), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await requestGate(partnerA2, created.id), 404)).code).toBe('NOT_FOUND');
    // 行は変わっていない。
    expect((await admin.proposal.findUniqueOrThrow({ where: { id: created.id } })).subject).toBe('ご提案');

    // 🔴 A2 が自社の提案を作っても、その応答に A1 の値は無い。
    const p2 = await post(partnerA2, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER2, ...RECIPIENT });
    // PROJECT_A_PUBLISHED は A1 にだけ公開されている → A2 には見えず 404（他社の案件の存在を教えない）。
    expect(p2.status).toBe(404);
  });

  it('🔴 境界: 公開されていない案件 / 他社のエンジニア / 取引先のエンジニアをホストが指定 → いずれも 404。VIEWER は 403。提案先が無いと 400', async () => {
    expect((await errorOf(await post(partnerA1, { projectId: PROJECT_A_PRIVATE, engineerId: ENGINEER_A_PARTNER, ...RECIPIENT }), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await post(partnerA1, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER2, ...RECIPIENT }), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await post(partnerA1, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_HOST, ...RECIPIENT }), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await post(hostA, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, ...RECIPIENT }), 404)).code).toBe('NOT_FOUND');
    // VIEWER は `requireRole`（ガードの固定順で `requireNotViewer` より先）が 403 にする。
    expect((await errorOf(await post(partnerA1Viewer, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, ...RECIPIENT }), 403)).code).toBe('FORBIDDEN');
    expect((await errorOf(await post(partnerA1, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, recipientCompanyName: 'x' }), 400)).code).toBe('VALIDATION');
    // 🔴 どの失敗も Proposal / EngineerSnapshot / 監査を残していない。
    expect(await admin.proposal.count({ where: { recipientCompanyName: RECIPIENT.recipientCompanyName } })).toBe(0);
    expect(await admin.auditLog.count({ where: { action: 'proposal.create' } })).toBe(0);

    // 対照: ホストは自社所有のエンジニアなら作れる。
    const host = await post(hostA, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_HOST, ...RECIPIENT });
    expect(host.status).toBe(201);
    const hostView = await readProposalEditor(hostA, ((await host.json()) as CreatedBody).id);
    if (hostView.view.audience !== 'HOST') throw new Error('unreachable');
    expect(hostView.view.owner).toEqual({ kind: 'HOST' });
  });
});

// ---------------------------------------------------------------------------
// ⑤ AC-3 / ⑥ #37
// ---------------------------------------------------------------------------

describe('🔴 #37 PATCH /api/proposals/{id}: DRAFT のみ編集でき、添付は CLEAN の版に限る（F-019 AC-3 / F-011 AC-1）', () => {
  it('提案先・条件・本文を更新すると { id, contentHash } を返し、ProposalEvent(NOTE) と proposal.update（値を載せない）が残る', async () => {
    const created = await createAsPartner();
    const before = await readProposalEditor(partnerA1, created.id);

    const response = await patch(partnerA1, created.id, {
      recipientCompanyName: 'T0901 別のエンド株式会社',
      subject: '改訂した件名',
      body: '改訂した本文',
      offeredUnitPrice: 700000,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; contentHash: string };
    expect(Object.keys(body).sort()).toEqual(['contentHash', 'id']);
    expect(body.contentHash).not.toBe(before.view.contentHash);

    const row = await admin.proposal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ state: 'DRAFT', recipientCompanyName: 'T0901 別のエンド株式会社', recipientEmail: RECIPIENT.recipientEmail, subject: '改訂した件名', body: '改訂した本文' });
    expect(Number(row.offeredUnitPrice?.toString())).toBe(700000);

    // 🔴 再読込した view のハッシュと一致する（§11.5 ②。1 実装）。
    const after = await readProposalEditor(partnerA1, created.id);
    expect(after.view.contentHash).toBe(body.contentHash);

    const events = await admin.proposalEvent.findMany({ where: { proposalId: created.id }, orderBy: { occurredAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: 'NOTE', fromState: 'DRAFT', toState: 'DRAFT', actorUserId: USER_A_PARTNER });
    expect(events[1]?.note).toBe('DRAFT_UPDATED:recipientCompanyName,offeredUnitPrice,subject,body');
    expect(events[1]?.note).not.toContain('改訂した');

    const audits = await admin.auditLog.findMany({ where: { action: 'proposal.update', targetId: created.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.summary).toEqual({ operation: 'DRAFT_UPDATE', fields: 'recipientCompanyName,offeredUnitPrice,subject,body' });
  });

  it('🔴 提案先の 2 列は空にできない（400）。指定されていない列は変わらない', async () => {
    const created = await createAsPartner();
    expect((await errorOf(await patch(partnerA1, created.id, { recipientCompanyName: '' }), 400)).code).toBe('VALIDATION');
    expect((await errorOf(await patch(partnerA1, created.id, { recipientEmail: null }), 400)).code).toBe('VALIDATION');
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.recipientCompanyName).toBe(RECIPIENT.recipientCompanyName);
    expect(await admin.proposalEvent.count({ where: { proposalId: created.id } })).toBe(1);
  });

  it('🔴 F-019 AC-3: CLEAN でない版は 409 SKILL_SHEET_NOT_ATTACHABLE、他社 / 別エンジニアの版は 404、CLEAN の版は差し替えられる', async () => {
    const created = await createAsPartner();
    expect((await errorOf(await patch(partnerA1, created.id, { skillSheetId: scanningSheetId }), 409)).code).toBe('SKILL_SHEET_NOT_ATTACHABLE');
    expect((await errorOf(await patch(partnerA1, created.id, { skillSheetId: p2SheetId }), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await patch(partnerA1, created.id, { skillSheetId: randomUUID() }), 404)).code).toBe('NOT_FOUND');
    // 失敗では凍結側もイベントも変わらない。
    expect((await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } })).skillSheetId).toBe(cleanSheetId);
    expect(await admin.proposalEvent.count({ where: { proposalId: created.id } })).toBe(1);

    // 添付なし → CLEAN の版へ差し替え。
    expect((await patch(partnerA1, created.id, { skillSheetId: null })).status).toBe(200);
    expect((await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } })).skillSheetId).toBeNull();
    expect((await patch(partnerA1, created.id, { skillSheetId: cleanSheetId })).status).toBe(200);
    expect((await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } })).skillSheetId).toBe(cleanSheetId);
    const events = await admin.proposalEvent.findMany({ where: { proposalId: created.id, kind: 'NOTE' }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.attachmentKey)).toEqual([null, cleanSheetId]);
  });

  it('🔴 DRAFT 以外は 422 PROPOSAL_NOT_EDITABLE（行・イベント・監査は変わらない）。VIEWER は 403', async () => {
    const created = await createAsPartner();
    for (const state of ['GATE_RUNNING', 'GATE_FAILED', 'APPROVAL_PENDING', 'SUBMITTED'] as const) {
      await admin.proposal.update({ where: { id: created.id }, data: { state } });
      const error = await errorOf(await patch(partnerA1, created.id, { subject: `x-${state}` }), 422);
      expect(error.code).toBe('PROPOSAL_NOT_EDITABLE');
      expect((await admin.proposal.findUniqueOrThrow({ where: { id: created.id } })).subject).toBe('ご提案');
    }
    expect(await admin.proposalEvent.count({ where: { proposalId: created.id } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: 'proposal.update', targetId: created.id } })).toBe(0);
    await admin.proposal.update({ where: { id: created.id }, data: { state: 'DRAFT' } });
    expect((await errorOf(await patch(partnerA1Viewer, created.id, { subject: 'x' }), 403)).code).toBe('FORBIDDEN');
    // ホストの SALES は取引先の DRAFT を編集できる（`canEditProposal`。#39 と同じ立場）。
    expect((await patch(hostA, created.id, { workStyle: '常駐' })).status).toBe(200);
  });

  it('🔴 NG-1: ホストが取引先作成の DRAFT（凍結添付あり）を S-020 と同じ payload で保存 → 200、skill_sheet_id は不変', async () => {
    const created = await createAsPartner();
    // 🔴 画面（S-020）が組み立てるのと同じ 2 関数を通す: 表示値（`proposalEditRows`）→ 送信 body（`toProposalPatchBody`）。
    //    ホストの editor は凍結版 ID を `initial.skillSheetId` に持つが、`skill_sheets` は他社の台帳で 1 行も見えない。
    const editor = await readProposalEditor(hostA, created.id);
    expect(editor.attachableSkillSheets).toEqual([]);
    const rows = proposalEditRows(editor);
    expect(rows.initial.skillSheetId).toBe(cleanSheetId);
    const values = { ...rows.initial, subject: 'ホストが手直しした件名' };
    const body = toProposalPatchBody(values, rows.initial);
    expect(Object.keys(body)).not.toContain('skillSheetId');

    const response = await patch(hostA, created.id, body);
    expect(response.status).toBe(200);
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.subject).toBe('ホストが手直しした件名');
    expect(row.recipientCompanyName).toBe(RECIPIENT.recipientCompanyName);
    expect((await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } })).skillSheetId).toBe(cleanSheetId);
    const audits = await admin.auditLog.findMany({ where: { action: 'proposal.update', targetId: created.id } });
    expect(audits).toHaveLength(1);
    expect((audits[0]?.summary as { fields: string }).fields).not.toContain('skillSheetId');
  });

  it('🔴 NG-2: ホストは取引先の添付を触れない —— { skillSheetId: null } も差し替えも 403、skill_sheet_id・イベント・監査は不変', async () => {
    const created = await createAsPartner();
    expect((await errorOf(await patch(hostA, created.id, { skillSheetId: null }), 403)).code).toBe('PROPOSAL_EDIT_FORBIDDEN');
    expect((await errorOf(await patch(hostA, created.id, { skillSheetId: cleanSheetId }), 403)).code).toBe('PROPOSAL_EDIT_FORBIDDEN');
    // 添付と本文を同時に送っても、本文だけ通る片側成立にはならない（③ は CAS の前）。
    expect((await errorOf(await patch(hostA, created.id, { skillSheetId: null, subject: 'x' }), 403)).code).toBe('PROPOSAL_EDIT_FORBIDDEN');
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.subject).toBe('ご提案');
    expect((await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.id } })).skillSheetId).toBe(cleanSheetId);
    expect(await admin.proposalEvent.count({ where: { proposalId: created.id } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: 'proposal.update', targetId: created.id } })).toBe(0);
    // 対照: 所有者（取引先）は外して戻せる（一方向にならない）。ホストは自社所有のエンジニアの提案なら触れる。
    expect((await patch(partnerA1, created.id, { skillSheetId: null })).status).toBe(200);
    expect((await patch(partnerA1, created.id, { skillSheetId: cleanSheetId })).status).toBe(200);
    const own = await post(hostA, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_HOST, ...RECIPIENT });
    expect(own.status).toBe(201);
    expect((await patch(hostA, ((await own.json()) as CreatedBody).id, { skillSheetId: null })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 経路 4 の DRAFT と #39 / ⑧ T-09-13 の効果
// ---------------------------------------------------------------------------

/** ホストが候補一覧（#30）を読んで依頼を発行し、A1 が応諾する（S-016 → S-018 と同じ入口）。 */
async function acceptViaRoute4(): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(hostA);
  const list = await candidatesRoute.GET(new Request(`https://app.test/api/projects/${PROJECT_A_PUBLISHED}/candidates`), segment(PROJECT_A_PUBLISHED));
  expect(list.status).toBe(200);
  const issued = await requestsRoute.POST(
    new Request('https://app.test/api/proposal-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_A_PUBLISHED,
        candidateRef: candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER),
        message: '11 月上旬の開始を希望しています。',
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    }),
  );
  expect(issued.status).toBe(201);
  const requestId = ((await issued.json()) as { id: string }).id;
  requireTenantCtxMock.mockResolvedValue(partnerA1);
  const accepted = await acceptRoute.POST(new Request(`https://app.test/api/proposal-requests/${requestId}/accept`, { method: 'POST' }), segment(requestId));
  expect(accepted.status).toBe(201);
  return ((await accepted.json()) as { proposalId: string }).proposalId;
}

describe('🔴 SP-08 の申し送り②: 経路 4 の応諾で作った DRAFT は提案先を設定するまでレビューに出せない', () => {
  it('提案先が空の DRAFT は #39 が 422 PROPOSAL_RECIPIENT_MISSING（GATE_RUNNING に遷移せず、ジョブも監査も無い）→ #37 で設定 → 202 → gate.run が 3 層 PASS', async () => {
    const proposalId = await acceptViaRoute4();
    // 応諾直後: 提案先が空（recipient = null）で、経路 4 由来。
    const draft = await readProposalEditor(partnerA1, proposalId);
    expect(draft.view.recipient).toBeNull();
    expect(draft.view.origin).toBe('PROPOSAL_REQUEST');
    expect(draft.view.state).toBe('DRAFT');
    const row = await admin.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(row.recipientCompanyName).toBe('');
    expect(row.recipientEmail).toBe('');
    const eventsBefore = await admin.proposalEvent.count({ where: { proposalId } });

    // 🔴 #39 → 422。状態は DRAFT のまま、イベント・監査・ジョブが増えない。
    const rejected = await errorOf(await requestGate(partnerA1, proposalId), 422);
    expect(rejected.code).toBe('PROPOSAL_RECIPIENT_MISSING');
    expect((await admin.proposal.findUniqueOrThrow({ where: { id: proposalId } })).state).toBe('DRAFT');
    expect(await admin.proposalEvent.count({ where: { proposalId } })).toBe(eventsBefore);
    expect(await admin.auditLog.count({ where: { action: 'proposal.update', targetId: proposalId } })).toBe(0);
    expect(await admin.reviewGate.count({ where: { targetId: proposalId } })).toBe(0);
    const hashNow = draft.view.contentHash;
    expect(await queue.jobState({ targetType: 'PROPOSAL', targetId: proposalId, contentHash: hashNow })).toBeNull();

    // 片方だけ埋めても 422（提案先は会社名とメールアドレスの組）。
    expect((await patch(partnerA1, proposalId, { recipientCompanyName: RECIPIENT.recipientCompanyName })).status).toBe(200);
    expect((await errorOf(await requestGate(partnerA1, proposalId), 422)).code).toBe('PROPOSAL_RECIPIENT_MISSING');

    // 🔴 #37 で提案先を揃え、本文を入れる → #39 → 202、GATE_RUNNING。
    const saved = await patch(partnerA1, proposalId, {
      recipientEmail: RECIPIENT.recipientEmail,
      subject: 'ご提案',
      body: `ご提案します。${SKILL_NAME} の経験が 6 年あります。`,
    });
    expect(saved.status).toBe(200);
    const { contentHash } = (await saved.json()) as { contentHash: string };
    const accepted = await requestGate(partnerA1, proposalId);
    expect(accepted.status).toBe(202);
    const { jobId } = (await accepted.json()) as { jobId: string };
    expect(hashOfJobId(jobId)).toBe(contentHash);
    expect(await admin.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ state: 'GATE_RUNNING', contentHash });
    expect(await queue.jobState({ targetType: 'PROPOSAL', targetId: proposalId, contentHash })).toBe('waiting');

    // GATE_RUNNING では #37 は 422（検査した内容と送る内容が食い違う経路を作らない）。
    expect((await errorOf(await patch(partnerA1, proposalId, { body: '差し替え' }), 422)).code).toBe('PROPOSAL_NOT_EDITABLE');

    // 🔴 T-09-13 の効果: 取引先が作成した提案が gate.run で 3 層の判定を受け、APPROVAL_PENDING に到達する。
    const outcome = await runGate(proposalId, contentHash);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false, transitioned: true });
    const gate = await admin.reviewGate.findFirst({ where: { targetId: proposalId } });
    expect(gate).toMatchObject({ execution: 'DONE', piiVerdict: 'PASS', commerceVerdict: 'PASS', consistencyVerdict: 'PASS', contentHash });
    expect((await admin.proposal.findUniqueOrThrow({ where: { id: proposalId } })).state).toBe('APPROVAL_PENDING');
  });

  it('🔴 #36 で取引先が作成した提案（提案先あり）は、そのまま #39 → gate.run で 3 層 PASS になる（T-09-13 の効果）', async () => {
    const created = await createAsPartner();
    const accepted = await requestGate(partnerA1, created.id);
    expect(accepted.status).toBe(202);
    const { jobId } = (await accepted.json()) as { jobId: string };
    const contentHash = hashOfJobId(jobId);
    const outcome = await runGate(created.id, contentHash);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false, transitioned: true });
    expect(await admin.reviewGate.count({ where: { targetId: created.id } })).toBe(1);
    expect((await admin.proposal.findUniqueOrThrow({ where: { id: created.id } })).state).toBe('APPROVAL_PENDING');
    // ホストの S-020 応答は APPROVAL_PENDING を示し、凍結側の氏名を出す（台帳の現在値ではない）。
    const host = await readProposalEditor(hostA, created.id);
    expect(host.view.state).toBe('APPROVAL_PENDING');
    expect(host.view.snapshot.displayName).toBe(P1_NAME_BEFORE);
  });
});
