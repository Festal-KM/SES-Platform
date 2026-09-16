// tests/isolation/proposal-list-detail.test.ts
// 🔴 T-09-09（`docs/sprints/SP-09-proposal-flow.md` §4 T-09-09 / §5）: 提案一覧（#45）・詳細（#46）・履歴へのメモ（#47）を
//    **実 DB（RLS 付き）+ 実 Route Handler** で証明する。`F-024 AC-2` / `AC-3` / `F-037 AC-1` / docs/05 §4.8 / §6.5 / §10.4 / §16.2。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 🔴 `F-024 AC-2`: `byState` は 14 状態の**別のキー**で、`GATE_FAILED` / `SUBMIT_FAILED` / `LOST` がそれぞれ独立に数えられる。
//      `DECLINED` は `byState` に**キーとして存在せず**、`requestsByState`（`ProposalRequest`）の側にだけ現れる。
//      状態フィルタも独立（`state=SUBMIT_FAILED` に `GATE_FAILED` / `LOST` / 保留中の `APPROVED` が混ざらない）
//   ② 🔴 docs/05 §10.4: 保留中の `APPROVED`（`sendHoldReasonKey` あり）は `SUBMIT_FAILED` に混ざらない（`byState.APPROVED` に数え、行は
//      `sendHold` を持つ）。`S-022` の一覧（`listProposalSendFailures`）にも出ない
//   ③ 🔴 `F-024 AC-3` / §4.8: 取引先は**自社が作成した提案だけ**を読み、`byState` / `requestsByState` / `total` も自社分だけ（境界適用後）。
//      他社の提案・他テナントの提案・不存在は #46 で**同じ 404**。取引先向けの行・詳細の**キー集合**に `owner` / `sendHold` /
//      `sendAttempts` / `lastFailureReason` / `approval` / `duplicateFindings` が無い
//   ④ 🔴 #46 の取引先向けの履歴では、送信基盤の事情（再送の理由 / 送信失敗の種別）が伏せられ、出来事（遷移）は残る
//   ⑤ 🔴 #47: メモは `proposals` を**一切動かさない**（`state` / `updated_at` 不変）。`ProposalEvent(NOTE, from = to = 現在の状態)` 1 行 +
//      `AuditLog(proposal_event.create, summary = { kind })`。🔴 `summary` に `note` の本文が載らない（§16.2）。`kind='STATE'` は 400
//   ⑥ 認可・境界: `VIEWER` は 403、取引先の非作成者（他社）は 404、他テナントは 404、`SUSPENDED` は 409。作成者（取引先）は 201
//   ⑦ `q`（提案先・案件名の部分一致）/ `projectId` / カーソルページング（`total` は一覧と同じ `where`）
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）だけ。Redis / worker は要らない（#45 / #46 / #47 はジョブを積まない）。
//    状態の材料（`SUBMIT_FAILED` / 保留中 `APPROVED` / `GATE_FAILED` / `LOST` / 履歴の印）は、送信ジョブ・承認 CAS が書くのと**同じ列**を
//    特権接続で作る（ジョブ・CAS の正しさは `send-proposal.test.ts` / `proposal-approval.test.ts` / `proposal-resend.test.ts` の射程）。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  PROPOSAL_APPROVAL_NOTE_PREFIX,
  PROPOSAL_AUDIT_TARGET_TYPE,
  PROPOSAL_SEND_FAILURE_NOTE_PREFIX,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
// 🔴 `@ses/domain` をパッケージ名で import しない（ルートの package.json は依存に持たない。他の isolation テストと同じ）。
import { PROPOSAL_STATES } from '../../packages/domain/src/state/proposal.js';
import { PROPOSAL_REQUEST_STATES } from '../../packages/domain/src/state/proposalRequest.js';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
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

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.99' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const NOW = new Date('2026-09-16T00:00:00.000Z');

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const proposalRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/route');
const eventsRoute = await import('../../apps/web/app/api/(main)/proposals/[id]/events/route');
const { listProposalSendFailures } = await import('../../apps/web/lib/proposals/send-failures');
const { PROPOSAL_RESEND_NOTE_PREFIX } = await import('../../apps/web/lib/proposals/resend');
const { PROPOSAL_EVENT_AUDIT_ACTION_CREATE } = await import('../../apps/web/lib/proposals/notes');
const {
  HOST_PROPOSAL_DETAIL_VIEW_KEYS,
  HOST_PROPOSAL_LIST_ITEM_KEYS,
  PARTNER_PROPOSAL_DETAIL_VIEW_KEYS,
  PARTNER_PROPOSAL_LIST_ITEM_KEYS,
} = await import('../../apps/web/lib/proposals/views');

const RECIPIENT_ALPHA = { recipientCompanyName: 'T0909 Alpha 架空エンド株式会社', recipientEmail: 't0909-alpha@example.test' };
const RECIPIENT_BETA = { recipientCompanyName: 'T0909 Beta 架空商事株式会社', recipientEmail: 't0909-beta@example.test' };
const NOTE_TEXT = 'T0909 先方に電話で確認済み。担当は佐藤様。';
const RESEND_REASON = 'T0909 電話で未着を確認した';
const FAILURE_KIND = 'UNKNOWN:TimeoutError';
const REVIEW_GATE_ID = '01930000-0000-7000-8000-000000000999';
/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_ID = '01930000-0000-7000-8000-000000000fff';
const FIXTURE_IDS = [PROPOSAL_A_HOST, PROPOSAL_A_P1, PROPOSAL_A_P2, PROPOSAL_A_P1_PRIVATE];
/** 秘匿キー（取引先の応答の JSON に 1 度も現れてはならない）。 */
const HOST_ONLY_KEYS = ['owner', 'sendHold', 'sendAttempts', 'lastFailureReason', 'approval', 'duplicateFindings'];

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostSales: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let hostSuspended: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type CreatedBody = { readonly id: string };
type ListBody = {
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly byState: Record<string, number>;
  readonly requestsByState: Record<string, number>;
  readonly nextCursor: string | null;
};

/** 本テストが作る提案（`beforeAll` で 1 度だけ作り、`afterAll` で消す）。 */
const created = {
  hostDraft: '',
  hostHeld: '',
  hostGateFailed: '',
  hostLost: '',
  p1Pending: '',
  p1Failed: '',
};
let declinedRequestId = '';

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function createProposal(ctx: AuthenticatedTenantCtx, body: Record<string, unknown>): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.POST(
    new Request('https://app.test/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function list(ctx: AuthenticatedTenantCtx, query = ''): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.GET(new Request(`https://app.test/api/proposals${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function detail(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return proposalRoute.GET(new Request(`https://app.test/api/proposals/${id}`), segment(id));
}

async function addNote(ctx: AuthenticatedTenantCtx, id: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return eventsRoute.POST(
    new Request(`https://app.test/api/proposals/${id}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    segment(id),
  );
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

/** 応答 JSON を深さ優先で走査し、`keys` のどれかが**どこにも**現れないことを確かめる。 */
function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
}

function idsOf(body: ListBody): string[] {
  return body.items.map((item) => item['id'] as string);
}

const APPROVED_COLUMNS = { approvedBy: USER_A_HOST, approvedBySystem: false, approvedAt: NOW, contentHash: 'v4:t0909' } as const;

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  hostSuspended = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'SUSPENDED' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  // 材料（実 #36 で作る = 凍結と `ProposalEvent(null → DRAFT)` は本物）。
  const hostBody = { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_HOST, subject: 'ご提案', body: 'T0909 本文', offeredUnitPrice: 700000 };
  const partnerBody = { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, subject: 'ご提案', body: 'T0909 本文', offeredUnitPrice: 650000 };
  created.hostDraft = await createProposal(hostSales, { ...hostBody, ...RECIPIENT_ALPHA });
  created.hostHeld = await createProposal(hostSales, { ...hostBody, ...RECIPIENT_ALPHA });
  created.hostGateFailed = await createProposal(hostSales, { ...hostBody, ...RECIPIENT_BETA });
  created.hostLost = await createProposal(hostSales, { ...hostBody, ...RECIPIENT_BETA });
  created.p1Pending = await createProposal(partnerA1, { ...partnerBody, ...RECIPIENT_ALPHA });
  created.p1Failed = await createProposal(partnerA1, { ...partnerBody, ...RECIPIENT_BETA });

  // 状態の材料（送信ジョブ / 承認 CAS が書くのと同じ列。順序は作成より後の `occurred_at`）。
  await admin.proposal.update({ where: { id: created.hostHeld }, data: { state: 'APPROVED', ...APPROVED_COLUMNS, sendHoldReasonKey: 'DOMAIN_UNVERIFIED', sendHoldSince: NOW } });
  await admin.proposal.update({ where: { id: created.hostGateFailed }, data: { state: 'GATE_FAILED', contentHash: 'v4:t0909' } });
  await admin.proposal.update({ where: { id: created.hostLost }, data: { state: 'LOST', ...APPROVED_COLUMNS, submittedAt: NOW } });
  await admin.proposal.update({ where: { id: created.p1Pending }, data: { state: 'APPROVAL_PENDING', contentHash: 'v4:t0909' } });
  await admin.proposal.update({
    where: { id: created.p1Failed },
    data: { state: 'SUBMIT_FAILED', ...APPROVED_COLUMNS, lastFailureReason: FAILURE_KIND, sendHoldReasonKey: null, sendHoldSince: null },
  });
  await admin.sendAttempt.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT_A,
      entityType: 'PROPOSAL',
      entityId: created.p1Failed,
      attemptSeq: 1,
      idempotencyKey: `proposal:${created.p1Failed}:1`,
      status: 'UNKNOWN',
      failureKind: FAILURE_KIND,
      failureDetail: 't0909: no response',
      startedAt: NOW,
      settledAt: NOW,
    },
  });
  // 🔴 履歴の並びは `occurred_at` 昇順。#36 が書いた作成の行（実時刻）より後に置く。
  const createdEvent = await admin.proposalEvent.findFirstOrThrow({ where: { proposalId: created.p1Failed }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });
  const at = (offsetMinutes: number) => new Date(createdEvent.occurredAt.getTime() + offsetMinutes * 60_000);
  await admin.proposalEvent.createMany({
    data: [
      { tenantId: TENANT_A, proposalId: created.p1Failed, kind: 'STATE', fromState: 'APPROVAL_PENDING', toState: 'APPROVED', actorUserId: USER_A_HOST, note: `${PROPOSAL_APPROVAL_NOTE_PREFIX}${REVIEW_GATE_ID}`, occurredAt: at(1) },
      { tenantId: TENANT_A, proposalId: created.p1Failed, kind: 'STATE', fromState: 'APPROVED', toState: 'SUBMITTING', actorUserId: null, occurredAt: at(2) },
      { tenantId: TENANT_A, proposalId: created.p1Failed, kind: 'STATE', fromState: 'SUBMITTING', toState: 'SUBMIT_FAILED', actorUserId: null, note: `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}${FAILURE_KIND}`, occurredAt: at(3) },
      { tenantId: TENANT_A, proposalId: created.p1Failed, kind: 'STATE', fromState: 'SUBMIT_FAILED', toState: 'APPROVED', actorUserId: USER_A_HOST, note: `${PROPOSAL_RESEND_NOTE_PREFIX}${RESEND_REASON}`, occurredAt: at(4) },
      { tenantId: TENANT_A, proposalId: created.p1Failed, kind: 'STATE', fromState: 'APPROVED', toState: 'SUBMITTING', actorUserId: null, occurredAt: at(5) },
      { tenantId: TENANT_A, proposalId: created.p1Failed, kind: 'STATE', fromState: 'SUBMITTING', toState: 'SUBMIT_FAILED', actorUserId: null, note: `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}${FAILURE_KIND}`, occurredAt: at(6) },
    ],
  });
  // 提案依頼（`DECLINED`）。`Proposal` の状態ではないので `byState` には現れず、`requestsByState` にだけ現れる。
  declinedRequestId = randomUUID();
  await admin.proposalRequest.create({
    data: {
      id: declinedRequestId,
      tenantId: TENANT_A,
      projectId: PROJECT_A_PUBLISHED,
      engineerId: ENGINEER_A_PARTNER,
      partnerCompanyId: PARTNER_A1,
      state: 'DECLINED',
      message: 'T0909',
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      declineReason: 'T0909 内部の理由',
      issuedBy: USER_A_HOST,
      respondedBy: USER_A_PARTNER,
      respondedAt: NOW,
    },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  const ids = Object.values(created).filter((id) => id !== '');
  await admin.sendAttempt.deleteMany({ where: { entityId: { in: ids } } });
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  if (declinedRequestId !== '') await admin.proposalRequest.deleteMany({ where: { id: declinedRequestId } });
  await admin.auditLog.deleteMany({ where: { action: { in: ['proposal.create', PROPOSAL_EVENT_AUDIT_ACTION_CREATE] } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  // #47 のテストが足したメモを消す（材料の履歴は残す）。
  await admin.proposalEvent.deleteMany({ where: { kind: 'NOTE', proposalId: { in: [...Object.values(created), ...FIXTURE_IDS] } } });
  await admin.auditLog.deleteMany({ where: { action: PROPOSAL_EVENT_AUDIT_ACTION_CREATE } });
});

// ---------------------------------------------------------------------------
// ① ② #45: byState の 4 区分と保留
// ---------------------------------------------------------------------------

describe('🔴 ① ② #45 GET /api/proposals: byState は 14 キー。GATE_FAILED / SUBMIT_FAILED / LOST は別、DECLINED は別ブロック、保留は APPROVED', () => {
  it('ホスト: 14 キーが全部あり、3 つの失敗がそれぞれ数えられる。DECLINED は byState に無く requestsByState にある', async () => {
    const body = await list(hostSales);
    expect(Object.keys(body.byState).sort()).toEqual([...PROPOSAL_STATES].sort());
    expect(body.byState).not.toHaveProperty('DECLINED');
    expect(body.byState['GATE_FAILED']).toBe(1);
    expect(body.byState['SUBMIT_FAILED']).toBe(1);
    expect(body.byState['LOST']).toBe(1);
    expect(body.byState['APPROVED']).toBe(1); // 保留中の行は APPROVED に数える（SUBMIT_FAILED に混ぜない）
    expect(body.byState['APPROVAL_PENDING']).toBe(1);
    // DRAFT = fixture 3 件（ホスト / A1 / A2）+ 本テストの 1 件。WON = fixture の 1 件。
    expect(body.byState['DRAFT']).toBe(4);
    expect(body.byState['WON']).toBe(1);
    expect(Object.keys(body.requestsByState).sort()).toEqual([...PROPOSAL_REQUEST_STATES].sort());
    expect(body.requestsByState['DECLINED']).toBe(1);
    // total は境界適用後・同じ where（フィルタ無し = 全件）。
    expect(body.total).toBe(Object.values(body.byState).reduce((sum, count) => sum + count, 0));
    expect(body.total).toBe(body.items.length);
    expect(body.nextCursor).toBeNull();
  });

  it('保留中の APPROVED の行は sendHold を持ち、SUBMIT_FAILED の行は sendAttempts / lastFailureReason を持つ。ホストの行のキー集合は固定', async () => {
    const body = await list(hostSales);
    const held = body.items.find((item) => item['id'] === created.hostHeld);
    expect(held).toMatchObject({ state: 'APPROVED', sendHold: { reasonKey: 'DOMAIN_UNVERIFIED', since: NOW.toISOString() }, owner: { kind: 'HOST' } });
    const failed = body.items.find((item) => item['id'] === created.p1Failed);
    expect(failed).toMatchObject({ state: 'SUBMIT_FAILED', sendHold: null, lastFailureReason: FAILURE_KIND, owner: { kind: 'PARTNER' } });
    expect((failed?.['sendAttempts'] as unknown[]).length).toBe(1);
    expect((failed?.['owner'] as { partnerCompanyName: string }).partnerCompanyName).toBeTypeOf('string');
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual([...HOST_PROPOSAL_LIST_ITEM_KEYS].sort());
    // 🔴 一覧の行に本文・contentHash・engineerId は載らない。
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('T0909 本文');
    expect(serialized).not.toContain('contentHash');
    expect(serialized).not.toContain(ENGINEER_A_PARTNER);
  });

  it('🔴 状態フィルタは独立: state=SUBMIT_FAILED に GATE_FAILED / LOST / 保留中の APPROVED が混ざらない。複数選択は和集合。byState はフィルタ抜き', async () => {
    const failedOnly = await list(hostSales, '?state=SUBMIT_FAILED');
    expect(idsOf(failedOnly)).toEqual([created.p1Failed]);
    expect(failedOnly.total).toBe(1);
    // byState はフィルタを外した母集団（チップの件数を切り替えの判断材料にするため）。
    expect(failedOnly.byState['GATE_FAILED']).toBe(1);
    expect(failedOnly.byState['LOST']).toBe(1);

    const gateFailedOnly = await list(hostSales, '?state=GATE_FAILED');
    expect(idsOf(gateFailedOnly)).toEqual([created.hostGateFailed]);
    const lostOnly = await list(hostSales, '?state=LOST');
    expect(idsOf(lostOnly)).toEqual([created.hostLost]);
    const heldOnly = await list(hostSales, '?state=APPROVED');
    expect(idsOf(heldOnly)).toEqual([created.hostHeld]);

    const two = await list(hostSales, '?state=SUBMIT_FAILED&state=LOST');
    expect(idsOf(two).sort()).toEqual([created.p1Failed, created.hostLost].sort());
    expect(two.total).toBe(2);
    // DECLINED は Proposal の状態ではない → 400。
    requireTenantCtxMock.mockResolvedValue(hostSales);
    expect((await proposalsRoute.GET(new Request('https://app.test/api/proposals?state=DECLINED'))).status).toBe(400);
  });

  it('⑦ q は提案先の社名・案件名の部分一致（本文は検索しない）。projectId の絞り込み。カーソルページング', async () => {
    const alpha = await list(hostSales, `?q=${encodeURIComponent('Alpha')}`);
    expect(idsOf(alpha).sort()).toEqual([created.hostDraft, created.hostHeld, created.p1Pending].sort());
    expect(alpha.total).toBe(3);
    // 本文の語では一致しない。
    expect((await list(hostSales, `?q=${encodeURIComponent('T0909 本文')}`)).items).toEqual([]);
    // 案件名の部分一致（fixture の案件名 "Project A Published" を含む提案は全部）。
    const byProject = await list(hostSales, `?q=${encodeURIComponent('Project A Published')}`);
    expect(byProject.items.length).toBeGreaterThanOrEqual(6);
    expect(idsOf(byProject)).not.toContain(PROPOSAL_A_P1_PRIVATE);
    const project = await list(hostSales, `?projectId=${PROJECT_A_PUBLISHED}`);
    expect(idsOf(project)).not.toContain(PROPOSAL_A_P1_PRIVATE);
    expect(project.total).toBe(project.items.length);

    const first = await list(hostSales, '?limit=3');
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(hostSales, `?limit=3&cursor=${first.nextCursor ?? ''}`);
    expect(second.items.length).toBeGreaterThan(0);
    expect(idsOf(second).some((id) => idsOf(first).includes(id))).toBe(false);
    // total はページに依らず一覧と同じ where。
    expect(first.total).toBe(second.total);
  });

  it('② S-022 の一覧（listProposalSendFailures）は SUBMIT_FAILED だけ。保留中の APPROVED / GATE_FAILED / LOST は出ない', async () => {
    const failures = await listProposalSendFailures(hostSales);
    expect(failures.items.map((item) => item.id)).toEqual([created.p1Failed]);
    expect(failures.items[0]).toMatchObject({ lastFailureReason: FAILURE_KIND, recipientCompanyName: RECIPIENT_BETA.recipientCompanyName });
    expect(failures.items[0]?.attempts).toHaveLength(1);
    expect(failures.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ③ ④ 取引先の境界と型
// ---------------------------------------------------------------------------

describe('🔴 ③ ④ F-024 AC-3 / §4.8: 取引先は自社が作成した提案だけ。byState も境界適用後。行・詳細に host-only のキーが無い', () => {
  it('取引先 A1 の一覧は自社の行だけ。byState / requestsByState / total も自社分。行のキー集合に owner / sendHold / sendAttempts / lastFailureReason が無い', async () => {
    const body = await list(partnerA1);
    expect(idsOf(body).sort()).toEqual([created.p1Pending, created.p1Failed, PROPOSAL_A_P1, PROPOSAL_A_P1_PRIVATE].sort());
    expect(body.total).toBe(4);
    expect(body.byState).toMatchObject({ APPROVAL_PENDING: 1, SUBMIT_FAILED: 1, DRAFT: 1, WON: 1, GATE_FAILED: 0, LOST: 0, APPROVED: 0 });
    expect(Object.keys(body.byState).sort()).toEqual([...PROPOSAL_STATES].sort());
    expect(body.requestsByState['DECLINED']).toBe(1); // 依頼先 = 自社の依頼は見える（C5）
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual([...PARTNER_PROPOSAL_LIST_ITEM_KEYS].sort());
    const keys = new Set<string>();
    collectKeys(body, keys);
    for (const secret of HOST_ONLY_KEYS) expect(keys.has(secret)).toBe(false);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAILURE_KIND);
    expect(serialized).not.toContain('DOMAIN_UNVERIFIED');
    // 他社（A2）の提案は存在も件数も現れない。
    expect(idsOf(body)).not.toContain(PROPOSAL_A_P2);
    expect(idsOf(body)).not.toContain(created.hostDraft);
    // 取引先 A2 は A1 の行を 1 件も見ない。
    const a2 = await list(partnerA2);
    expect(idsOf(a2)).toEqual([PROPOSAL_A_P2]);
    expect(a2.byState['SUBMIT_FAILED']).toBe(0);
    expect(a2.requestsByState['DECLINED']).toBe(0);
    // テナント B: 0 件。
    const b = await list(hostB);
    expect(b.items).toEqual([]);
    expect(b.total).toBe(0);
  });

  it('#46 取引先 A1: 自社の提案は読め、キー集合は PARTNER_PROPOSAL_DETAIL_VIEW_KEYS ちょうど。履歴では再送の理由・失敗の種別が伏せられる', async () => {
    const response = await detail(partnerA1, created.p1Failed);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...PARTNER_PROPOSAL_DETAIL_VIEW_KEYS].sort());
    expect(body['audience']).toBe('PARTNER');
    const keys = new Set<string>();
    collectKeys(body, keys);
    for (const secret of HOST_ONLY_KEYS) expect(keys.has(secret)).toBe(false);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAILURE_KIND);
    expect(serialized).not.toContain(RESEND_REASON);
    expect(serialized).not.toContain(USER_A_HOST); // actorUserId は載らない（表示名だけ）
    // 出来事（遷移）は残る。
    const events = body['events'] as readonly { readonly entry: Record<string, unknown>; readonly fromState: string | null; readonly toState: string | null }[];
    expect(events.length).toBeGreaterThanOrEqual(7);
    expect(events[0]).toMatchObject({ fromState: null, toState: 'DRAFT', entry: { kind: 'TRANSITION', note: null } });
    expect(events.some((event) => event.entry['kind'] === 'SEND_FAILURE' && event.entry['failureKind'] === null)).toBe(true);
    expect(events.some((event) => event.entry['kind'] === 'RESEND' && event.entry['reason'] === null)).toBe(true);
    expect(events.some((event) => event.entry['kind'] === 'APPROVAL' && event.entry['reviewGateId'] === REVIEW_GATE_ID)).toBe(true);
    // 凍結された経歴は行単位（fixture のエンジニアは 0 行 = []）。
    expect(Array.isArray((body['snapshot'] as Record<string, unknown>)['careers'])).toBe(true);
  });

  it('#46 ホスト: キー集合は HOST_PROPOSAL_DETAIL_VIEW_KEYS ちょうど。owner / sendAttempts / lastFailureReason / approval / 履歴の理由と種別を持つ', async () => {
    const response = await detail(hostSales, created.p1Failed);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...HOST_PROPOSAL_DETAIL_VIEW_KEYS].sort());
    expect(body).toMatchObject({
      audience: 'HOST',
      state: 'SUBMIT_FAILED',
      owner: { kind: 'PARTNER' },
      sendHold: null,
      lastFailureReason: FAILURE_KIND,
      approval: { kind: 'USER', approvedAt: NOW.toISOString() },
    });
    expect((body['sendAttempts'] as unknown[]).length).toBe(1);
    const events = body['events'] as readonly { readonly entry: Record<string, unknown> }[];
    expect(events.some((event) => event.entry['kind'] === 'SEND_FAILURE' && event.entry['failureKind'] === FAILURE_KIND)).toBe(true);
    expect(events.some((event) => event.entry['kind'] === 'RESEND' && event.entry['reason'] === RESEND_REASON)).toBe(true);
    expect(body).not.toHaveProperty('duplicateFindings');
    expect(body).not.toHaveProperty('engineerId');
    // 保留中の行は sendHold を持つ。
    const held = (await (await detail(hostSales, created.hostHeld)).json()) as Record<string, unknown>;
    expect(held).toMatchObject({ state: 'APPROVED', sendHold: { reasonKey: 'DOMAIN_UNVERIFIED' } });
  });

  it('🔴 #46 境界外は 404 で、不存在と区別できない: 取引先 A1 → ホストの提案 / 他社の提案、A2 → A1 の提案、テナント B → A の提案', async () => {
    const absent = await detail(partnerA1, ABSENT_ID);
    const absentBody = await absent.text();
    expect(absent.status).toBe(404);
    for (const [ctx, id] of [
      [partnerA1, created.hostDraft],
      [partnerA1, PROPOSAL_A_P2],
      [partnerA2, created.p1Failed],
      [hostB, created.p1Failed],
      [hostB, created.hostDraft],
    ] as const) {
      const response = await detail(ctx, id);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(absentBody);
    }
    // 形が UUID でなければ 400（存在を探らせない）。
    expect((await detail(hostSales, 'not-a-uuid')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ⑤ ⑥ #47: メモ
// ---------------------------------------------------------------------------

describe('🔴 ⑤ ⑥ #47 POST /api/proposals/{id}/events: 状態を動かさず、監査に note を載せない。認可と境界', () => {
  it('ホスト SALES のメモ → 201 { id }。proposals は state / updated_at とも不変。ProposalEvent(NOTE, from = to = 現在)。AuditLog は summary { kind } だけ', async () => {
    const before = await admin.proposal.findUniqueOrThrow({ where: { id: created.hostGateFailed }, select: { state: true, updatedAt: true, contentHash: true } });
    const response = await addNote(hostSales, created.hostGateFailed, { kind: 'NOTE', note: NOTE_TEXT });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as CreatedBody;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const after = await admin.proposal.findUniqueOrThrow({ where: { id: created.hostGateFailed }, select: { state: true, updatedAt: true, contentHash: true } });
    expect(after).toEqual(before);

    const event = await admin.proposalEvent.findUniqueOrThrow({ where: { id } });
    expect(event).toMatchObject({ proposalId: created.hostGateFailed, kind: 'NOTE', fromState: 'GATE_FAILED', toState: 'GATE_FAILED', actorUserId: USER_A_HOST, note: NOTE_TEXT });

    const audits = await admin.auditLog.findMany({ where: { action: PROPOSAL_EVENT_AUDIT_ACTION_CREATE, targetId: created.hostGateFailed } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorKind: 'USER', actorId: USER_A_HOST, targetType: PROPOSAL_AUDIT_TARGET_TYPE, summary: { kind: 'NOTE' }, deviceKind: META.deviceKind, ipAddress: META.ipAddress });
    expect(JSON.stringify(audits[0]?.summary)).not.toContain('T0909');
    expect(PROPOSAL_EVENT_AUDIT_ACTION_CREATE.endsWith('.create')).toBe(true); // S-041 の CREATE_UPDATE_DELETE（接尾辞一致）で拾える

    // #46 の履歴に NOTE として現れる（人手のメモ。DRAFT_UPDATED とは別の kind）。
    const body = (await (await detail(hostSales, created.hostGateFailed)).json()) as { events: readonly { id: string; entry: Record<string, unknown>; actor: Record<string, unknown> }[] };
    const noted = body.events.find((event) => event.id === id);
    expect(noted?.entry).toEqual({ kind: 'NOTE', note: NOTE_TEXT });
    expect(noted?.actor).toEqual({ kind: 'USER', displayName: expect.any(String) });
  });

  it('作成者（取引先 A1）は自社の提案にメモを残せる（201）。他社（A2）は 404、ホストの提案には 404。VIEWER は 403。テナント B は 404。SUSPENDED は 409', async () => {
    expect((await addNote(partnerA1, created.p1Pending, { kind: 'NOTE', note: 'T0909 partner note' })).status).toBe(201);
    expect((await admin.proposal.findUniqueOrThrow({ where: { id: created.p1Pending }, select: { state: true } })).state).toBe('APPROVAL_PENDING');
    expect((await addNote(partnerA2, created.p1Pending, { kind: 'NOTE', note: 'x' })).status).toBe(404);
    expect((await addNote(partnerA1, created.hostDraft, { kind: 'NOTE', note: 'x' })).status).toBe(404);
    expect((await addNote(hostB, created.hostDraft, { kind: 'NOTE', note: 'x' })).status).toBe(404);
    // `requireRole`（VIEWER を含まない）が先に 403 にする（`requireNotViewer` と二重）。
    const viewer = await errorOf(await addNote(hostViewer, created.hostDraft, { kind: 'NOTE', note: 'x' }), 403);
    expect(['FORBIDDEN', 'VIEWER_NOT_ALLOWED']).toContain(viewer.code);
    const suspended = await errorOf(await addNote(hostSuspended, created.hostDraft, { kind: 'NOTE', note: 'x' }), 409);
    expect(suspended.code).toBe('TENANT_NOT_EXECUTABLE');
    // 起きなかった操作は履歴にも監査にも残らない。
    expect(await admin.proposalEvent.count({ where: { proposalId: created.hostDraft, kind: 'NOTE' } })).toBe(0);
    expect(await admin.auditLog.count({ where: { action: PROPOSAL_EVENT_AUDIT_ACTION_CREATE, targetId: created.hostDraft } })).toBe(0);
  });

  it('🔴 kind=STATE / 空の note / note 欠落は 400（状態を動かす入力面が無い）', async () => {
    for (const body of [{ kind: 'STATE', note: 'x' }, { kind: 'ATTACHMENT', note: 'x' }, { kind: 'NOTE', note: '' }, { kind: 'NOTE' }, { kind: 'NOTE', note: 'x', fromState: 'DRAFT', toState: 'APPROVED' }]) {
      const response = await addNote(hostSales, created.hostDraft, body);
      if ('fromState' in body) {
        // 余分なキーは strip（201）で、状態は動かない。
        expect(response.status).toBe(201);
      } else {
        expect(response.status).toBe(400);
      }
    }
    expect((await admin.proposal.findUniqueOrThrow({ where: { id: created.hostDraft }, select: { state: true } })).state).toBe('DRAFT');
  });
});
