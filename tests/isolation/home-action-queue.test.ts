// tests/isolation/home-action-queue.test.ts
// 🔴 T-12-15（`docs/sprints/SP-12-phase1-hardening.md` T-12-15 完了の判定 ②）: `S-003` / `S-004` の要対応キュー（Phase 1 分）を
//    **実 DB（RLS 付き）+ 実 Route Handler（`GET /api/home`）** で証明する。`F-006 AC-1`〜`AC-3` / `F-024 AC-2` / `BR-23` / `BR-60` /
//    `CLAUDE.md` §3.1（経路 4 / 第二境界）/ §4.2「4 つの失敗を混同しない」/ docs/05 §6.3 #9 / §10.4。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① ホストの 5 種別が種別表の並び（`SEND_FAILED` → `APPROVAL_PENDING` → `GATE_FAILED` → `SEND_HELD` → `PROPOSAL_REQUEST_PENDING`）どおりに
//      並び、依頼は `expiresAt` 昇順。**種別ごとの件数を 1 つの合計に丸めるフィールドが無い**
//   ② 🔴 `LOST` / `DRAFT` / `SUBMITTED` の提案、`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` の依頼、**`PROVIDER_QUOTA` の保留**が載らない
//      （`SEND_HELD` は `DOMAIN_UNVERIFIED` / `GATE_STALE` だけ）
//   ③ `scope=mine`（既定）: 提案は作成者 / 承認者 / 自動承認のいずれかが自分（🔴 `APPROVAL_PENDING` は担当を問わず載る）、
//      依頼は起票者 = 自分。`scope=all` で組織全体
//   ④ 🔴 取引先は 2 種別（自社宛の `REQUESTED` → `S-018` / 自社提案の `GATE_FAILED` → `S-020`）のみ。`APPROVAL_PENDING` / `SEND_FAILED` /
//      `SEND_HELD` は自社提案であっても載らない。依頼が先（`S-004` セクション 1）。**取引先宛の依頼は `scope` で絞らない**
//   ⑤ 🔴 他社の行・件数が 0（A1 の応答に A2 の提案・依頼・凍結名・社名が 1 文字も無い。A2 も同様。他テナントも 0 件）
//   ⑥ 🔴 ホストの `PROPOSAL_REQUEST_PENDING` の行を深さ走査して、実名・`engineerId`・所属会社名（ID / 社名）が 0 件。行のキーは 8 つだけ
//   ⑦ `changedSince`: 変わっていない行は `items` に返らない（`targetIds` は全件）。更新した行だけが返る。形が壊れていれば 400
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）だけ。Redis / worker は要らない。状態の材料（`SUBMIT_FAILED` / 保留中 `APPROVED` / `GATE_FAILED` /
//    `LOST` / 依頼の 5 状態）は、送信ジョブ・承認 CAS・依頼の応答が書くのと**同じ列**を特権接続で作る（`proposal-list-detail.test.ts` と同じ手口）。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTenantDb, disconnectTenantDb, resolveTenantCtx, type AuthenticatedTenantCtx } from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ENGINEER_A_HOST,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
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
const NOW = new Date('2026-09-17T00:00:00.000Z');
const DAY_MS = 86_400_000;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const homeRoute = await import('../../apps/web/app/api/(main)/home/route');
const proposalsRoute = await import('../../apps/web/app/api/(main)/proposals/route');
const { CHANGED_SINCE_SAFETY_MARGIN_MS, HOST_ACTION_QUEUE_KIND_ORDER, PARTNER_ACTION_QUEUE_KIND_ORDER } = await import(
  '../../apps/web/lib/home/action-queue'
);

/** 2 人目のホスト利用者（`scope=mine` の対照。fixtures にはホストが 1 人しか居ない）。 */
const USER_A_HOST2 = '01930000-0000-7000-8000-000000001215';
const MEMBERSHIP_A_HOST2 = '01930000-0000-7000-8000-000000001216';
/** 依頼の状態を 5 つ揃えるための追加案件（`@@unique([tenantId, projectId, engineerId])` のため案件を増やす）。 */
const PROJECT_A_EXTRA = '01930000-0000-7000-8000-000000001217';

/** 🔴 A1 の応答に 1 文字も現れてはならない A2 の値 / ホストの依頼の行に現れてはならない取引先の値。 */
const A2_SECRET_SNAPSHOT_NAME = 'T1215 A2 Secret Frozen Name';
const P1_ENGINEER_NAME = 'Engineer A-Partner';
const P2_ENGINEER_NAME = 'Engineer A-Partner2';
const P1_COMPANY_NAME = 'Partner A1';
const P2_COMPANY_NAME = 'Partner A2';

const RECIPIENT = { recipientCompanyName: 'T1215 架空エンド株式会社', recipientEmail: 't1215@example.test' };
const APPROVED_COLUMNS = { approvedBy: USER_A_HOST, approvedBySystem: false, approvedAt: NOW, contentHash: 'v4:t1215' } as const;

type ActionRow = {
  readonly kind: string;
  readonly targetId: string;
  readonly subjectLabel: string;
  readonly counterpartyLabel: string | null;
  readonly since: string;
  readonly deadline: string | null;
  readonly rowVersion: number;
  readonly href: string;
};
type ActionBlock = { readonly kind: 'ACTION_QUEUE'; readonly targetIds: readonly string[]; readonly items: readonly ActionRow[] };
type HomeBody = { readonly audience: string; readonly blocks: readonly { readonly kind: string }[]; readonly changedSince: string };

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostSales: AuthenticatedTenantCtx;
let hostSales2: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

/** 本テストが作る提案（`beforeAll` で 1 度だけ作り、`afterAll` で消す）。 */
const created = {
  hostFailed: '',
  hostPending: '',
  hostGateFailed: '',
  hostHeldDomain: '',
  hostHeldStale: '',
  hostHeldQuota: '',
  hostLost: '',
  hostDraft: '',
  hostSubmitted: '',
  host2GateFailed: '',
  host2Pending: '',
  p1GateFailed: '',
  p1Pending: '',
  p1Failed: '',
  /** 🔴 レビュー指摘 1: 自動承認（`approvedBySystem: true`）の取引先作成 `SUBMIT_FAILED`。担当不問で全ホストの mine に載る。 */
  p1FailedAuto: '',
  p2GateFailed: '',
};
const requests = { r1: '', r2: '', r3: '', r4Declined: '', r5Expired: '', r6Withdrawn: '' };

async function createProposal(ctx: AuthenticatedTenantCtx, body: Record<string, unknown>): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await proposalsRoute.POST(
    new Request('https://app.test/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function homeResponse(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return homeRoute.GET(new Request(`https://app.test/api/home${query}`));
}

async function home(ctx: AuthenticatedTenantCtx, query = ''): Promise<{ readonly body: HomeBody; readonly block: ActionBlock; readonly text: string }> {
  const response = await homeResponse(ctx, query);
  expect(response.status).toBe(200);
  const text = await response.text();
  const body = JSON.parse(text) as HomeBody;
  const block = body.blocks.find((candidate): candidate is ActionBlock => candidate.kind === 'ACTION_QUEUE');
  if (block === undefined) throw new Error('ACTION_QUEUE ブロックが無い（0 件でも必ず返る契約）。');
  return { body, block, text };
}

function idsOfKind(block: ActionBlock, kind: string): readonly string[] {
  return block.items.filter((row) => row.kind === kind).map((row) => row.targetId);
}

function kindSequence(block: ActionBlock): readonly string[] {
  return block.items.map((row) => row.kind).filter((kind, index, all) => index === 0 || all[index - 1] !== kind);
}

/** JSON を深さ優先で走査し、キー名とスカラー値を集める（`anonymous-candidate-view.test.ts` と同じ手口）。 */
function collect(value: unknown, into: { keys: Set<string>; values: string[] }): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.keys.add(key);
      collect(nested, into);
    }
    return;
  }
  if (value !== null && value !== undefined) into.values.push(String(value));
}

const ROW_KEYS = ['counterpartyLabel', 'deadline', 'href', 'kind', 'rowVersion', 'since', 'subjectLabel', 'targetId'];

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  // 2 人目のホスト利用者と追加案件（特権接続）。
  await admin.user.create({
    data: { id: USER_A_HOST2, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host-a2-t1215@example.test', displayName: 'Host A2', passwordHash: 'seed-hash' },
  });
  await admin.membership.create({
    data: { id: MEMBERSHIP_A_HOST2, tenantId: TENANT_A, userId: USER_A_HOST2, role: 'SALES', partnerCompanyId: null, joinedAt: NOW },
  });
  await admin.project.create({ data: { id: PROJECT_A_EXTRA, tenantId: TENANT_A, name: 'T1215 Extra Project', status: 'OPEN' } });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostSales2 = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST2, role: 'SALES' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  // 材料（実 #36 で作る = 凍結は本物。ホストは自社エンジニア、A1 は自社エンジニア）。
  const hostBody = { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_HOST, subject: 'ご提案', body: 'T1215 本文', offeredUnitPrice: 700000, ...RECIPIENT };
  const p1Body = { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, subject: 'ご提案', body: 'T1215 本文', offeredUnitPrice: 650000, ...RECIPIENT };
  created.hostFailed = await createProposal(hostSales, hostBody);
  created.hostPending = await createProposal(hostSales, hostBody);
  created.hostGateFailed = await createProposal(hostSales, hostBody);
  created.hostHeldDomain = await createProposal(hostSales, hostBody);
  created.hostHeldStale = await createProposal(hostSales, hostBody);
  created.hostHeldQuota = await createProposal(hostSales, hostBody);
  created.hostLost = await createProposal(hostSales, hostBody);
  created.hostDraft = await createProposal(hostSales, hostBody);
  created.hostSubmitted = await createProposal(hostSales, hostBody);
  created.host2GateFailed = await createProposal(hostSales2, hostBody);
  created.host2Pending = await createProposal(hostSales2, hostBody);
  created.p1GateFailed = await createProposal(partnerA1, p1Body);
  created.p1Pending = await createProposal(partnerA1, p1Body);
  created.p1Failed = await createProposal(partnerA1, p1Body);
  created.p1FailedAuto = await createProposal(partnerA1, p1Body);

  // A2 の提案は #36 を通せない（`PROJECT_A_PUBLISHED` は A1 にだけ公開）ので特権接続で置く。凍結名は A1 の応答に現れてはならない値。
  created.p2GateFailed = randomUUID();
  await admin.proposal.create({
    data: {
      id: created.p2GateFailed,
      tenantId: TENANT_A,
      ownerPartnerCompanyId: PARTNER_A2,
      projectId: PROJECT_A_PUBLISHED,
      engineerId: ENGINEER_A_PARTNER2,
      state: 'GATE_FAILED',
      contentHash: 'v4:t1215',
      ...RECIPIENT,
      createdBy: USER_A_PARTNER2,
      // 放置時間の並びを固定する（GATE_FAILED の末尾 = いちばん新しい）。
      updatedAt: NOW,
    },
  });
  await admin.engineerSnapshot.create({
    data: {
      tenantId: TENANT_A,
      ownerPartnerCompanyId: PARTNER_A2,
      proposalId: created.p2GateFailed,
      displayName: A2_SECRET_SNAPSHOT_NAME,
      skills: [],
      careers: [],
      frozenAt: NOW,
    },
  });

  // 状態の材料（送信ジョブ / 承認 CAS が書くのと同じ列）。`updated_at` は放置時間の並びを固定するため明示する（古い順 = 先）。
  const at = (daysAgo: number): Date => new Date(NOW.getTime() - daysAgo * DAY_MS);
  const setState = (id: string, data: Record<string, unknown>, daysAgo: number) =>
    admin.proposal.update({ where: { id }, data: { ...data, updatedAt: at(daysAgo) } });
  await setState(created.hostFailed, { state: 'SUBMIT_FAILED', ...APPROVED_COLUMNS, lastFailureReason: 'UNKNOWN:TimeoutError' }, 1);
  await setState(created.p1Failed, { state: 'SUBMIT_FAILED', ...APPROVED_COLUMNS, lastFailureReason: 'FAILED:Bounce' }, 3);
  // 🔴 レビュー指摘 1: 自動承認（`approvedBySystem: true`）。担当が存在しないので誰の mine にも載る（APPROVAL_PENDING と同じ扱い）。
  await setState(
    created.p1FailedAuto,
    { state: 'SUBMIT_FAILED', approvedBy: null, approvedBySystem: true, approvedAt: NOW, contentHash: 'v4:t1215', lastFailureReason: 'UNKNOWN:AutoApprovedTimeout' },
    0,
  );
  await setState(created.hostPending, { state: 'APPROVAL_PENDING', contentHash: 'v4:t1215' }, 2);
  await setState(created.host2Pending, { state: 'APPROVAL_PENDING', contentHash: 'v4:t1215' }, 4);
  await setState(created.p1Pending, { state: 'APPROVAL_PENDING', contentHash: 'v4:t1215' }, 1);
  await setState(created.hostGateFailed, { state: 'GATE_FAILED', contentHash: 'v4:t1215' }, 5);
  await setState(created.host2GateFailed, { state: 'GATE_FAILED', contentHash: 'v4:t1215' }, 2);
  await setState(created.p1GateFailed, { state: 'GATE_FAILED', contentHash: 'v4:t1215' }, 6);
  await setState(created.hostHeldDomain, { state: 'APPROVED', ...APPROVED_COLUMNS, sendHoldReasonKey: 'DOMAIN_UNVERIFIED', sendHoldSince: at(1) }, 1);
  await setState(created.hostHeldStale, { state: 'APPROVED', ...APPROVED_COLUMNS, sendHoldReasonKey: 'GATE_STALE', sendHoldSince: at(2) }, 2);
  await setState(created.hostHeldQuota, { state: 'APPROVED', ...APPROVED_COLUMNS, sendHoldReasonKey: 'PROVIDER_QUOTA', sendHoldSince: at(1) }, 1);
  await setState(created.hostLost, { state: 'LOST', ...APPROVED_COLUMNS, submittedAt: NOW }, 1);
  await setState(created.hostSubmitted, { state: 'SUBMITTED', ...APPROVED_COLUMNS, submittedAt: NOW }, 1);

  // 提案依頼（5 状態）。`REQUESTED` は 3 件（A1 宛 2 / A2 宛 1）。期限は R2 < R1 < R3。
  type RequestSeed = {
    readonly projectId: string;
    readonly engineerId: string;
    readonly partnerCompanyId: string;
    readonly state: string;
    readonly issuedBy: string;
    readonly expiresAt: Date;
    readonly declineReason?: string;
    readonly respondedBy?: string;
    readonly respondedAt?: Date;
  };
  const request = (id: string, data: RequestSeed) =>
    admin.proposalRequest.create({ data: { id, tenantId: TENANT_A, message: 'T1215', createdAt: NOW, ...data } });
  requests.r1 = randomUUID();
  requests.r2 = randomUUID();
  requests.r3 = randomUUID();
  requests.r4Declined = randomUUID();
  requests.r5Expired = randomUUID();
  requests.r6Withdrawn = randomUUID();
  await request(requests.r1, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER, partnerCompanyId: PARTNER_A1, state: 'REQUESTED', issuedBy: USER_A_HOST, expiresAt: new Date(NOW.getTime() + 5 * DAY_MS) });
  await request(requests.r2, { projectId: PROJECT_A_PRIVATE, engineerId: ENGINEER_A_PARTNER, partnerCompanyId: PARTNER_A1, state: 'REQUESTED', issuedBy: USER_A_HOST2, expiresAt: new Date(NOW.getTime() + 2 * DAY_MS) });
  await request(requests.r3, { projectId: PROJECT_A_PUBLISHED, engineerId: ENGINEER_A_PARTNER2, partnerCompanyId: PARTNER_A2, state: 'REQUESTED', issuedBy: USER_A_HOST, expiresAt: new Date(NOW.getTime() + 9 * DAY_MS) });
  await request(requests.r4Declined, { projectId: PROJECT_A_PRIVATE, engineerId: ENGINEER_A_PARTNER2, partnerCompanyId: PARTNER_A2, state: 'DECLINED', issuedBy: USER_A_HOST, expiresAt: new Date(NOW.getTime() + DAY_MS), declineReason: 'T1215 社内の理由', respondedBy: USER_A_PARTNER2, respondedAt: NOW });
  await request(requests.r5Expired, { projectId: PROJECT_A_EXTRA, engineerId: ENGINEER_A_PARTNER, partnerCompanyId: PARTNER_A1, state: 'EXPIRED', issuedBy: USER_A_HOST, expiresAt: new Date(NOW.getTime() - DAY_MS), respondedAt: NOW });
  await request(requests.r6Withdrawn, { projectId: PROJECT_A_EXTRA, engineerId: ENGINEER_A_PARTNER2, partnerCompanyId: PARTNER_A2, state: 'WITHDRAWN_BY_HOST', issuedBy: USER_A_HOST, expiresAt: new Date(NOW.getTime() + DAY_MS), respondedAt: NOW });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  const ids = Object.values(created).filter((id) => id !== '');
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.proposalRequest.deleteMany({ where: { id: { in: Object.values(requests).filter((id) => id !== '') } } });
  await admin.auditLog.deleteMany({ where: { action: 'proposal.create' } });
  await admin.membership.deleteMany({ where: { id: MEMBERSHIP_A_HOST2 } });
  await admin.user.deleteMany({ where: { id: USER_A_HOST2 } });
  await admin.project.deleteMany({ where: { id: PROJECT_A_EXTRA } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

// ---------------------------------------------------------------------------
// ① ② ホスト（scope=all）: 5 種別の並びと、載らないもの
// ---------------------------------------------------------------------------

describe('🔴 ① ② ホスト scope=all: 5 種別が種別表の並びで載り、終端・PROVIDER_QUOTA・依頼の終端は載らない', () => {
  it('種別の並びは SEND_FAILED → APPROVAL_PENDING → GATE_FAILED → SEND_HELD → PROPOSAL_REQUEST_PENDING', async () => {
    const { block } = await home(hostSales, '?scope=all');
    expect(kindSequence(block)).toEqual([...HOST_ACTION_QUEUE_KIND_ORDER]);
    expect(block.targetIds).toEqual(block.items.map((row) => row.targetId));
  });

  it('各種別の母集団と、種別の中の並び（放置が長い順 / 依頼は期限昇順）', async () => {
    const { block } = await home(hostSales, '?scope=all');
    // SEND_FAILED: p1Failed（3 日前）→ hostFailed（1 日前）→ p1FailedAuto（自動承認。作成時刻 = 今）。
    expect(idsOfKind(block, 'SEND_FAILED')).toEqual([created.p1Failed, created.hostFailed, created.p1FailedAuto]);
    // APPROVAL_PENDING: host2Pending（4 日前）→ hostPending（2 日前）→ p1Pending（1 日前）。
    expect(idsOfKind(block, 'APPROVAL_PENDING')).toEqual([created.host2Pending, created.hostPending, created.p1Pending]);
    // GATE_FAILED: p1GateFailed（6）→ hostGateFailed（5）→ host2GateFailed（2）→ p2GateFailed（作成時刻 = 今）。
    expect(idsOfKind(block, 'GATE_FAILED')).toEqual([created.p1GateFailed, created.hostGateFailed, created.host2GateFailed, created.p2GateFailed]);
    // SEND_HELD: hostHeldStale（2 日前）→ hostHeldDomain（1 日前）。🔴 PROVIDER_QUOTA は無い。
    expect(idsOfKind(block, 'SEND_HELD')).toEqual([created.hostHeldStale, created.hostHeldDomain]);
    // PROPOSAL_REQUEST_PENDING: 期限昇順 r2（+2 日）→ r1（+5 日）→ r3（+9 日）。
    expect(idsOfKind(block, 'PROPOSAL_REQUEST_PENDING')).toEqual([requests.r2, requests.r1, requests.r3]);
  });

  it('🔴 LOST / DRAFT / SUBMITTED の提案、PROVIDER_QUOTA の保留、DECLINED / EXPIRED / WITHDRAWN_BY_HOST の依頼は載らない', async () => {
    const { block } = await home(hostSales, '?scope=all');
    for (const absent of [created.hostLost, created.hostDraft, created.hostSubmitted, created.hostHeldQuota, requests.r4Declined, requests.r5Expired, requests.r6Withdrawn]) {
      expect(block.targetIds).not.toContain(absent);
    }
    expect(block.items.map((row) => row.kind).every((kind) => (HOST_ACTION_QUEUE_KIND_ORDER as readonly string[]).includes(kind))).toBe(true);
  });

  it('🔴 SEND_HELD と SEND_FAILED は別の種別・別の遷移先（保留は失敗ではない。docs/05 §10.4）', async () => {
    const { block } = await home(hostSales, '?scope=all');
    const held = block.items.find((row) => row.targetId === created.hostHeldDomain);
    const failed = block.items.find((row) => row.targetId === created.hostFailed);
    expect(held?.kind).toBe('SEND_HELD');
    expect(held?.href).toBe('/proposals?state=APPROVED');
    expect(failed?.kind).toBe('SEND_FAILED');
    expect(failed?.href).toBe('/proposals/send-failures');
    // 遷移先: 承認待ち → S-021 / ゲート差し戻し → S-020 / 依頼 → S-017。
    expect(block.items.find((row) => row.targetId === created.hostPending)?.href).toBe(`/proposals/${created.hostPending}/approve`);
    expect(block.items.find((row) => row.targetId === created.hostGateFailed)?.href).toBe(`/proposals/${created.hostGateFailed}/edit`);
    expect(block.items.find((row) => row.targetId === requests.r1)?.href).toBe('/proposal-requests');
  });

  it('🔴 ブロックは kind / targetIds / items の 3 キーだけ（種別ごとの件数を 1 つの合計に丸めるフィールドが無い）', async () => {
    const { block, body } = await home(hostSales, '?scope=all');
    expect(Object.keys(block).sort()).toEqual(['items', 'kind', 'targetIds']);
    expect(body.audience).toBe('HOST');
    expect(Object.keys(body).sort()).toEqual(['audience', 'blocks', 'changedSince']);
  });

  it('提案の行の「対象」は案件名 + 凍結側のエンジニア名、「相手」は提案先。since / rowVersion は updated_at', async () => {
    const { block } = await home(hostSales, '?scope=all');
    const row = block.items.find((item) => item.targetId === created.hostGateFailed);
    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.hostGateFailed } });
    expect(row?.subjectLabel).toBe(`Project A Published / ${snapshot.displayName}`);
    expect(row?.counterpartyLabel).toBe(RECIPIENT.recipientCompanyName);
    expect(row?.since).toBe(new Date(NOW.getTime() - 5 * DAY_MS).toISOString());
    expect(row?.rowVersion).toBe(NOW.getTime() - 5 * DAY_MS);
    expect(row?.deadline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ③ scope=mine（既定）
// ---------------------------------------------------------------------------

describe('🔴 ③ scope=mine（既定）: 作成者 / 承認者 / 自動承認 = 自分の提案 + 承認待ちは担当を問わず + 自分が出した依頼', () => {
  it('既定（scope 未指定）は mine と同じ', async () => {
    const mine = await home(hostSales, '?scope=mine');
    const defaulted = await home(hostSales);
    expect(defaulted.block.targetIds).toEqual(mine.block.targetIds);
  });

  it('自分が作った提案 + 自分が承認した提案 + 自動承認の提案 + 承認待ち（他人・取引先が作ったものも）+ 自分が出した依頼が載る', async () => {
    const { block } = await home(hostSales);
    // 🔴 レビュー指摘 1: p1Failed は取引先作成だがホスト（hostSales = USER_A_HOST）が人間承認した行 = 承認者の担当。
    //    p1FailedAuto は自動承認（approvedBySystem: true）= 担当が存在しないので誰の mine にも載る。
    expect(idsOfKind(block, 'SEND_FAILED')).toEqual([created.p1Failed, created.hostFailed, created.p1FailedAuto]);
    // 🔴 APPROVAL_PENDING は担当を問わない（誰かが承認すれば進む。docs/04 §S-003 権限差分）。
    expect(idsOfKind(block, 'APPROVAL_PENDING')).toEqual([created.host2Pending, created.hostPending, created.p1Pending]);
    expect(idsOfKind(block, 'GATE_FAILED')).toEqual([created.hostGateFailed]);
    expect(idsOfKind(block, 'SEND_HELD')).toEqual([created.hostHeldStale, created.hostHeldDomain]);
    // 依頼は起票者 = 自分（r2 は host2 が出した）。
    expect(idsOfKind(block, 'PROPOSAL_REQUEST_PENDING')).toEqual([requests.r1, requests.r3]);
    for (const absent of [created.host2GateFailed, created.p1GateFailed, created.p2GateFailed, requests.r2]) {
      expect(block.targetIds).not.toContain(absent);
    }
  });

  it('2 人目のホスト（host2）の mine は host2 の分 + 承認待ち全件 + 自動承認の提案（担当不問）', async () => {
    const { block } = await home(hostSales2);
    // 🔴 レビュー指摘 1: p1Failed（承認者 = USER_A_HOST）は host2 の mine には載らない。p1FailedAuto（自動承認）は載る。
    expect(idsOfKind(block, 'SEND_FAILED')).toEqual([created.p1FailedAuto]);
    expect(idsOfKind(block, 'APPROVAL_PENDING')).toEqual([created.host2Pending, created.hostPending, created.p1Pending]);
    expect(idsOfKind(block, 'GATE_FAILED')).toEqual([created.host2GateFailed]);
    expect(idsOfKind(block, 'SEND_HELD')).toEqual([]);
    expect(idsOfKind(block, 'PROPOSAL_REQUEST_PENDING')).toEqual([requests.r2]);
  });

  it('scope の形が壊れていれば 400', async () => {
    expect((await homeResponse(hostSales, '?scope=everyone')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ④ ⑤ 取引先: 2 種別のみ。他社の行・件数が 0
// ---------------------------------------------------------------------------

describe('🔴 ④ ⑤ 取引先: 自社宛の REQUESTED → 自社提案の GATE_FAILED の 2 種別のみ。他社の行・件数が 0', () => {
  it('A1: 依頼（期限昇順）→ GATE_FAILED。APPROVAL_PENDING / SEND_FAILED / SEND_HELD は自社提案でも載らない', async () => {
    const { block, body } = await home(partnerA1);
    expect(body.audience).toBe('PARTNER');
    expect(kindSequence(block)).toEqual([...PARTNER_ACTION_QUEUE_KIND_ORDER]);
    expect(idsOfKind(block, 'PROPOSAL_REQUEST_PENDING')).toEqual([requests.r2, requests.r1]);
    expect(idsOfKind(block, 'GATE_FAILED')).toEqual([created.p1GateFailed]);
    expect(block.targetIds).toEqual([requests.r2, requests.r1, created.p1GateFailed]);
    // 🔴 自社の提案であっても承認・送信の工程は載らない。
    expect(block.targetIds).not.toContain(created.p1Pending);
    expect(block.targetIds).not.toContain(created.p1Failed);
    expect(block.targetIds).not.toContain(created.p1FailedAuto);
  });

  it('A1 の行: 依頼は案件名（公開されていなければその旨）+ 自社の実名、遷移先は S-018 / GATE_FAILED は S-020', async () => {
    const { block } = await home(partnerA1);
    const r1 = block.items.find((row) => row.targetId === requests.r1);
    const r2 = block.items.find((row) => row.targetId === requests.r2);
    expect(r1?.subjectLabel).toBe(`Project A Published / ${P1_ENGINEER_NAME}`);
    expect(r1?.href).toBe(`/proposal-requests/${requests.r1}`);
    expect(r1?.deadline).toBe(new Date(NOW.getTime() + 5 * DAY_MS).toISOString());
    // PROJECT_A_PRIVATE は A1 に公開されていない（C4 で行が消える）→ 案件名は出ないが依頼の存在は隠さない。
    expect(r2?.subjectLabel).toBe(`（案件名は公開されていません） / ${P1_ENGINEER_NAME}`);
    expect(block.items.find((row) => row.targetId === created.p1GateFailed)?.href).toBe(`/proposals/${created.p1GateFailed}/edit`);
  });

  it('🔴 取引先宛の依頼は scope で絞らない（mine / all で同じ）', async () => {
    const mine = await home(partnerA1, '?scope=mine');
    const all = await home(partnerA1, '?scope=all');
    expect(idsOfKind(mine.block, 'PROPOSAL_REQUEST_PENDING')).toEqual([requests.r2, requests.r1]);
    expect(idsOfKind(all.block, 'PROPOSAL_REQUEST_PENDING')).toEqual([requests.r2, requests.r1]);
    expect(all.block.targetIds).toEqual(mine.block.targetIds);
  });

  it('🔴 A1 の応答に A2 の提案・依頼・凍結名・社名・ID、ホストの提案が 1 文字も無い（F-006 AC-1 / BR-07）', async () => {
    const { text, block } = await home(partnerA1, '?scope=all');
    for (const forbidden of [
      created.p2GateFailed,
      requests.r3,
      requests.r4Declined,
      requests.r6Withdrawn,
      A2_SECRET_SNAPSHOT_NAME,
      P2_ENGINEER_NAME,
      P2_COMPANY_NAME,
      PARTNER_A2,
      ENGINEER_A_PARTNER2,
      created.hostFailed,
      created.hostPending,
      created.hostGateFailed,
      created.hostHeldDomain,
      created.host2GateFailed,
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // 🔴 行のキーは 8 つだけ（件数・順位・所属を示唆するキーが無い）。
    for (const row of block.items) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(text).not.toMatch(/他\s*[0-9]+\s*件|[0-9]+\s*件中|[0-9]+\s*番目/);
  });

  it('🔴 A2 の応答は A2 宛の依頼 1 件 + A2 の GATE_FAILED 1 件だけ。A1 の値が 1 文字も無い', async () => {
    const { text, block } = await home(partnerA2, '?scope=all');
    expect(block.targetIds).toEqual([requests.r3, created.p2GateFailed]);
    // `PROJECT_A_PUBLISHED` は A1 にだけ公開されている（C4）ので、A2 には案件名が出ない。自社の凍結名は出る（自社の情報）。
    expect(block.items.find((row) => row.targetId === created.p2GateFailed)?.subjectLabel).toBe(`（案件名は公開されていません） / ${A2_SECRET_SNAPSHOT_NAME}`);
    for (const forbidden of [requests.r1, requests.r2, requests.r5Expired, created.p1GateFailed, created.p1Pending, created.p1Failed, P1_COMPANY_NAME, PARTNER_A1, ENGINEER_A_PARTNER]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // A1 の実名（`Engineer A-Partner`）は A2 の実名（`Engineer A-Partner2`）の前方一致なので、後続が `2` でないものだけを禁止する。
    expect(text).not.toMatch(new RegExp(`${P1_ENGINEER_NAME}(?!2)`));
  });

  it('🔴 他テナントのホストには本テストの行が 1 件も無い', async () => {
    const { text, block } = await home(hostB, '?scope=all');
    for (const id of [...Object.values(created), ...Object.values(requests)]) expect(block.targetIds).not.toContain(id);
    expect(text).not.toContain(A2_SECRET_SNAPSHOT_NAME);
    expect(text).not.toContain(RECIPIENT.recipientCompanyName);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 経路 4: ホストの PROPOSAL_REQUEST_PENDING の行に実名・engineerId・所属会社名が無い
// ---------------------------------------------------------------------------

describe('🔴 ⑥ 経路 4: ホストの PROPOSAL_REQUEST_PENDING の行を深さ走査して実名・engineerId・所属会社名が 0 件', () => {
  it('行は 8 キーだけ。対象は案件名 + 「共有候補（匿名）」、相手は null', async () => {
    const { block, text } = await home(hostSales, '?scope=all');
    const rows = block.items.filter((row) => row.kind === 'PROPOSAL_REQUEST_PENDING');
    expect(rows).toHaveLength(3);
    const collected = { keys: new Set<string>(), values: [] as string[] };
    collect(rows, collected);
    expect([...collected.keys].sort()).toEqual(ROW_KEYS);
    for (const forbidden of [ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2, P1_ENGINEER_NAME, P2_ENGINEER_NAME, P1_COMPANY_NAME, P2_COMPANY_NAME, PARTNER_A1, PARTNER_A2, USER_A_PARTNER, USER_A_PARTNER2]) {
      expect(collected.values.some((value) => value.includes(forbidden)), forbidden).toBe(false);
    }
    for (const row of rows) {
      expect(row.subjectLabel).toMatch(/ \/ 共有候補（匿名）$/);
      expect(row.counterpartyLabel).toBeNull();
      expect(row.deadline).not.toBeNull();
    }
    // 🔴 応答全体でも、取引先の実名・社名・エンジニア ID は現れない（提案の行の凍結名はホスト自社のエンジニアだけ）。
    for (const forbidden of [ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2, P2_ENGINEER_NAME, 'declineReason', 'engineerId', 'partnerCompanyId', 'issuedBy']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('対照: 経路 2（Proposal ができた後）では凍結側の名が出る = 取引先が作った提案の行にだけ凍結名がある', async () => {
    const { block } = await home(hostSales, '?scope=all');
    const p1 = block.items.find((row) => row.targetId === created.p1GateFailed);
    const p1Snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: created.p1GateFailed } });
    expect(p1?.subjectLabel).toBe(`Project A Published / ${p1Snapshot.displayName}`);
  });
});

// ---------------------------------------------------------------------------
// ⑦ changedSince: 変わっていない行は返らない
// ---------------------------------------------------------------------------

describe('🔴 ⑦ changedSince: 変わっていない行は items に返らず、targetIds は全件のまま', () => {
  it('前回応答の changedSince を付けると items は空、更新した行だけが次に返る', async () => {
    const first = await home(hostSales, '?scope=all');
    expect(first.block.items.length).toBeGreaterThan(0);

    const unchanged = await home(hostSales, `?scope=all&changedSince=${encodeURIComponent(first.body.changedSince)}`);
    expect(unchanged.block.items).toEqual([]);
    expect(unchanged.block.targetIds).toEqual(first.block.targetIds);

    // 1 行だけ更新する（`updated_at` を changedSince より後に置く）。
    const bumpedAt = new Date(Date.parse(first.body.changedSince) + 60_000);
    await admin.proposal.update({ where: { id: created.hostGateFailed }, data: { updatedAt: bumpedAt } });
    try {
      const delta = await home(hostSales, `?scope=all&changedSince=${encodeURIComponent(first.body.changedSince)}`);
      expect(delta.block.items.map((row) => row.targetId)).toEqual([created.hostGateFailed]);
      expect(delta.block.items[0]?.rowVersion).toBe(bumpedAt.getTime());
      // 並びは更新後の放置時間で決まる（いま更新されたので GATE_FAILED の末尾に移る）。targetIds は全件で、その並びを持つ。
      expect(delta.block.targetIds).toHaveLength(first.block.targetIds.length);
      const after = await home(hostSales, '?scope=all');
      expect(idsOfKind(after.block, 'GATE_FAILED')).toEqual([created.p1GateFailed, created.host2GateFailed, created.p2GateFailed, created.hostGateFailed]);
      expect(delta.block.targetIds).toEqual(after.block.targetIds);
    } finally {
      await admin.proposal.update({ where: { id: created.hostGateFailed }, data: { updatedAt: new Date(NOW.getTime() - 5 * DAY_MS) } });
    }
  });

  it('changedSince の形が壊れていれば 400', async () => {
    expect((await homeResponse(hostSales, '?changedSince=yesterday')).status).toBe(400);
  });

  it('🔴 T-12-15 指摘 4: changedSince は応答の読み取り時刻（ISO 8601）から安全マージンを引いた値で、現在時刻に近い', async () => {
    const before = Date.now();
    const { body } = await home(hostSales);
    const after = Date.now();
    expect(Date.parse(body.changedSince)).toBeGreaterThanOrEqual(before - CHANGED_SINCE_SAFETY_MARGIN_MS);
    expect(Date.parse(body.changedSince)).toBeLessThanOrEqual(after - CHANGED_SINCE_SAFETY_MARGIN_MS);
  });
});
