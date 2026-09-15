// tests/isolation/proposal-request-outcomes.test.ts
// 🔴 T-08-08（`docs/sprints/SP-08-anonymous-share.md` §5）: `DECLINED` / `EXPIRED` の区別と理由の非開示を**実 DB・実 Route
//    Handler**で証明する。`F-018 AC-1` / `AC-2` / `AC-4` / `AC-5` / `AC-6` / `BR-57` / `BR-60` / `BR-23` / docs/05 §4.8 /
//    `docs/02` §5.1「状態の意味と、混同してはならない区別」。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか（T-08-06 / T-08-07 のテストが持つものは繰り返さない）
// ---------------------------------------------------------------------------
//   ① AC-2: **理由を書いて辞退した依頼と、理由を書かずに辞退した依頼が、ホストからは区別できない。** #32 の 2 件を
//      `id` / 日時 / 案件を除いて比べると同一であり、`S-017` の行（`hostProposalRequestRows`）でも同一である。
//      DB の行では `decline_reason` が片方だけに在る（対照）。理由の**有無**すらホストに漏れない。
//   ② AC-5: `DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` の 3 件を作り、`?state=` で 1 件ずつ別に引ける。3 つの状態
//      バッジは別の語。🔴 `Proposal` の状態名（`LOST` / `GATE_FAILED` / `SUBMIT_FAILED`）を #32 のフィルタに渡すと **400**
//      （2 つのエンティティの状態が 1 つのフィルタに畳まれていない）。
//   ③ AC-4: 3 つの結末が確定しても、**成約率の分母（`CONVERSION_DENOMINATOR_PROPOSAL_STATES` に該当する `proposals`）の
//      件数は前後で変わらない**。`proposal_requests` の状態別件数はホストの集計として別に立つ。
//   ④ AC-6: A1 / A2 の両社の匿名候補にホストが依頼を出しても、**A1 の #32 / `S-018` / `S-015`（`proposalRequestCount`）に
//      A2 宛の依頼の存在・件数・実名・辞退の痕跡が現れない**（逆も同じ）。A2 が辞退しても A1 の件数は動かない。
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と `candidateReference`（起動時 DI の鍵）の 2 点だけ。
//    DB・RLS・共有スコープ・Route Handler・ガード・トランザクションはすべて実物である。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  expireProposalRequests,
  resolveTenantCtx,
  systemTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
// 🔴 `@ses/domain` はルートの devDependencies に無いため、他の静的テストと同じくソースを直接 import する。
import { CONVERSION_DENOMINATOR_PROPOSAL_STATES } from '../../packages/domain/src/state/indicators.js';
import { PROPOSAL_REQUEST_STATES } from '../../packages/domain/src/state/proposalRequest.js';
import {
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  SHARE_A_P1,
  TENANT_A,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.88' } as const;
const TEST_SECRET = 'E'.repeat(43) + '=';

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

const candidatesRoute = await import('../../apps/web/app/api/(main)/projects/[id]/candidates/route');
const requestsRoute = await import('../../apps/web/app/api/(main)/proposal-requests/route');
const withdrawRoute = await import('../../apps/web/app/api/(main)/proposal-requests/[id]/withdraw/route');
const acceptRoute = await import('../../apps/web/app/api/(main)/proposal-requests/[id]/accept/route');
const declineRoute = await import('../../apps/web/app/api/(main)/proposal-requests/[id]/decline/route');
const sharesRoute = await import('../../apps/web/app/api/(main)/engineer-shares/route');
const { readPartnerProposalRequestDetail } = await import('../../apps/web/lib/proposal-requests/service');
const { hostProposalRequestRows, proposalRequestStateOptions } = await import(
  '../../apps/web/lib/proposal-requests/list-rows'
);
const { HOST_PROPOSAL_REQUEST_VIEW_KEYS } = await import('../../apps/web/lib/proposal-requests/views');
const { NotFoundError } = await import('../../apps/web/lib/api/errors');

/** 🔴 fixtures の値（相手側・ホスト側の応答に現れてはならないもの）。 */
const P1_DISPLAY_NAME = 'Engineer A-Partner';
const P2_DISPLAY_NAME = 'Engineer A-Partner2';
const P1_COMPANY_NAME = 'Partner A1';
const P2_COMPANY_NAME = 'Partner A2';
const DECLINE_REASON_A1 = 'T0808-A1-decline-reason-単価が合わない';
const DECLINE_REASON_A2 = 'T0808-A2-decline-reason-稼働中のため';

const EXPIRES_AT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const MESSAGE = '11 月上旬の開始を希望しています。面談は来週中に設定可能です。';

const AUDIT_ACTIONS = ['proposal_request.create', 'proposal_request.update', 'state.invalid_transition', 'project.view'];
const EXPIRE_JOB = { queue: 'proposal-request.expire', jobId: 'repeat:proposal-request.expire:t0808' };

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostA: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
/** A2 の共有行（本テストが作る。fixtures は A1 だけが共有している）。 */
let shareA2Id: string;

type ErrorBody = { readonly error: { readonly code: string } };
type ListItem = Record<string, unknown>;
type ListBody = { readonly items: readonly ListItem[]; readonly nextCursor: string | null };
type ShareItem = { readonly engineerId: string; readonly displayName: string; readonly proposalRequestCount: number };
type ShareListBody = { readonly items: readonly ShareItem[] };

async function postRequest(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return requestsRoute.POST(
    new Request('https://app.test/api/proposal-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function getRequestsResponse(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return requestsRoute.GET(new Request(`https://app.test/api/proposal-requests${query}`));
}

async function getRequests(ctx: AuthenticatedTenantCtx, query = ''): Promise<ListBody> {
  const response = await getRequestsResponse(ctx, query);
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function getShares(ctx: AuthenticatedTenantCtx): Promise<ShareListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await sharesRoute.GET(new Request('https://app.test/api/engineer-shares'));
  expect(response.status).toBe(200);
  return (await response.json()) as ShareListBody;
}

async function withdraw(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return withdrawRoute.POST(new Request(`https://app.test/api/proposal-requests/${id}/withdraw`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

async function accept(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return acceptRoute.POST(new Request(`https://app.test/api/proposal-requests/${id}/accept`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

async function decline(ctx: AuthenticatedTenantCtx, id: string, body: unknown = {}): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return declineRoute.POST(
    new Request(`https://app.test/api/proposal-requests/${id}/decline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** ホストが候補一覧（#30）を読んで `MatchCandidate` を作らせ、指定エンジニアの匿名候補に依頼を発行する。 */
async function issue(projectId: string, engineerId: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(hostA);
  const list = await candidatesRoute.GET(new Request(`https://app.test/api/projects/${projectId}/candidates`), {
    params: Promise.resolve({ id: projectId }),
  });
  expect(list.status).toBe(200);
  const response = await postRequest(hostA, {
    projectId,
    candidateRef: candidateRef(projectId, engineerId),
    message: MESSAGE,
    expiresAt: EXPIRES_AT,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { readonly id: string }).id;
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

type Collected = { readonly keys: string[]; readonly values: string[] };
function collect(value: unknown, depth = 0, acc: Collected = { keys: [], values: [] }): Collected {
  if (depth > 6 || value === null || value === undefined) return acc;
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

/**
 * 深さ走査で禁止値・禁止キーが無いことを見る。
 * 🔴 fixtures の表示名は `'Engineer A-Partner'` ⊂ `'Engineer A-Partner2'` の包含関係にあるので、**表示名だけは完全一致**
 *    で見る（A2 の応答に自社の `'Engineer A-Partner2'` が在るのは正しい）。ID・社名・理由の目印は部分一致で見る。
 */
function expectAbsent(body: unknown, forbiddenValues: readonly string[], forbiddenKeys: readonly string[], label: string): void {
  const collected = collect(body);
  for (const forbidden of forbiddenValues) {
    const hit =
      forbidden === P1_DISPLAY_NAME || forbidden === P2_DISPLAY_NAME
        ? collected.values.some((v) => v === forbidden)
        : collected.values.some((v) => v.includes(forbidden));
    expect(hit, `${label}: ${forbidden} が応答に含まれている`).toBe(false);
  }
  for (const key of forbiddenKeys) {
    expect(collected.keys, `${label}: キー ${key} が応答に含まれている`).not.toContain(key);
  }
}

const HOST_FORBIDDEN_VALUES = [
  P1_DISPLAY_NAME,
  P2_DISPLAY_NAME,
  P1_COMPANY_NAME,
  P2_COMPANY_NAME,
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
  PARTNER_A2,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  DECLINE_REASON_A1,
  DECLINE_REASON_A2,
];
const HOST_FORBIDDEN_KEYS = ['declineReason', 'engineerId', 'engineer', 'partnerCompanyId', 'respondedBy', 'issuedBy', 'proposalId'];

/** ホストの 1 件から、依頼ごとに当然異なる列（`id` / 日時 / 案件）を落とす。残りが同一なら区別できない。 */
const PER_REQUEST_KEYS: ReadonlySet<string> = new Set(['id', 'createdAt', 'respondedAt', 'expiresAt', 'project']);
function distinguishingFree(item: ListItem): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !PER_REQUEST_KEYS.has(key)));
}

/** 成約率の分母に該当する `proposals` の件数（SP-19 が `WHERE state IN (...)` に使う集合と同じ）。 */
async function conversionDenominatorCount(): Promise<number> {
  return withTenant(hostA, (db) =>
    db.proposal.count({ where: { state: { in: [...CONVERSION_DENOMINATOR_PROPOSAL_STATES] } } }),
  );
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = {
    tenantId: TENANT_A,
    lifecycleState: 'ACTIVE' as const,
    partnerSuspendedAt: null,
    twoFactor: 'NOT_ENROLLED' as const,
  };
  hostA = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' },
    { deviceKind: 'api' },
  );
  partnerA1 = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' },
    { deviceKind: 'api' },
  );
  partnerA2 = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' },
    { deviceKind: 'api' },
  );

  // 🔴 A2 も自社エンジニア（P2）を共有する（fixtures は A1 だけ）。AC-6 は「両社に依頼がある」状態で見る。
  const shareA2 = await admin.engineerShare.create({
    data: {
      tenantId: TENANT_A,
      engineerId: ENGINEER_A_PARTNER2,
      partnerCompanyId: PARTNER_A2,
      sharedAt: new Date(),
      sharedBy: USER_A_PARTNER2,
    },
    select: { id: true },
  });
  shareA2Id = shareA2.id;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: null } });
  await admin.engineerShare.update({ where: { id: shareA2Id }, data: { revokedAt: null } });
});

afterEach(async () => {
  const created = await admin.proposal.findMany({ where: { proposalRequestId: { not: null } }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.proposalRequest.deleteMany({ where: { tenantId: TENANT_A } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ① AC-2: 理由の有無すら区別できない
// ---------------------------------------------------------------------------

describe('🔴 F-018 AC-2: ホストは DECLINED と EXPIRED を区別できるが、DECLINED の理由（その有無を含む）は区別できない', () => {
  it('理由ありの辞退と理由なしの辞退は、#32 の応答でも S-017 の行でも同一に見える（DB の行では片方にだけ理由が在る）', async () => {
    const withReason = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const withoutReason = await issue(PROJECT_A_PRIVATE, ENGINEER_A_PARTNER);
    expect((await decline(partnerA1, withReason, { reason: DECLINE_REASON_A1 })).status).toBe(204);
    expect((await decline(partnerA1, withoutReason, {})).status).toBe(204);

    // --- 対照: DB の行では区別できる。
    const rows = await admin.proposalRequest.findMany({ where: { id: { in: [withReason, withoutReason] } } });
    expect(rows.find((r) => r.id === withReason)?.declineReason).toBe(DECLINE_REASON_A1);
    expect(rows.find((r) => r.id === withoutReason)?.declineReason).toBeNull();

    // --- ホストの #32: 2 件とも DECLINED。id / 日時 / 案件を除くと**完全に同一**。
    const host = await getRequests(hostA);
    expect(host.items).toHaveLength(2);
    const a = host.items.find((item) => item['id'] === withReason);
    const b = host.items.find((item) => item['id'] === withoutReason);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.['state']).toBe('DECLINED');
    expect(b?.['state']).toBe('DECLINED');
    expect(Object.keys(a ?? {}).sort()).toEqual([...HOST_PROPOSAL_REQUEST_VIEW_KEYS].sort());
    expect(Object.keys(b ?? {}).sort()).toEqual([...HOST_PROPOSAL_REQUEST_VIEW_KEYS].sort());
    expect(distinguishingFree(a ?? {})).toEqual(distinguishingFree(b ?? {}));
    expectAbsent(host, HOST_FORBIDDEN_VALUES, HOST_FORBIDDEN_KEYS, '辞退後の #32（ホスト）');

    // --- S-017 の行（画面が描く値）でも同一。状態バッジは同じ語で、理由に相当する列が型として無い。
    const rowViews = hostProposalRequestRows(
      host.items as unknown as Parameters<typeof hostProposalRequestRows>[0],
    );
    const rowA = rowViews.find((row) => row.id === withReason);
    const rowB = rowViews.find((row) => row.id === withoutReason);
    expect(rowA?.stateLabel).toBe(rowB?.stateLabel);
    expect(rowA?.candidate).toBe(rowB?.candidate);
    expect(rowA?.canWithdraw).toBe(false);
    expect(rowA?.respondHref).toBeNull();
    expectAbsent(rowViews, HOST_FORBIDDEN_VALUES, ['declineReason', 'partnerCompanyName', 'engineerId', 'respondedBy'], 'S-017 の行');

    // --- 状態は区別できる: DECLINED のフィルタで 2 件、EXPIRED で 0 件。
    expect((await getRequests(hostA, '?state=DECLINED')).items).toHaveLength(2);
    expect((await getRequests(hostA, '?state=EXPIRED')).items).toHaveLength(0);

    // --- 監査にも理由が無い（2 件の DECLINE の summary が同一）。
    const audits = await admin.auditLog.findMany({ where: { action: 'proposal_request.update' }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.summary).toEqual(audits[1]?.summary);
    expect(JSON.stringify(audits)).not.toContain('T0808');
  });

  it('対照: 取引先 A1 自身の S-018 では理由の有無が区別できる（記録は社内に在る）', async () => {
    const withReason = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const withoutReason = await issue(PROJECT_A_PRIVATE, ENGINEER_A_PARTNER);
    await decline(partnerA1, withReason, { reason: DECLINE_REASON_A1 });
    await decline(partnerA1, withoutReason, {});
    const a = await readPartnerProposalRequestDetail(partnerA1, withReason, { ipAddress: META.ipAddress });
    const b = await readPartnerProposalRequestDetail(partnerA1, withoutReason, { ipAddress: META.ipAddress });
    expect(a.declineReason).toBe(DECLINE_REASON_A1);
    expect(b.declineReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ② AC-5 / ③ AC-4: 3 つの結末は別の区分で、成約率の分母を動かさない
// ---------------------------------------------------------------------------

describe('🔴 F-018 AC-4 / AC-5: DECLINED / EXPIRED / WITHDRAWN_BY_HOST は別の区分であり、成約率の分母に入らない', () => {
  it('3 つの結末が ?state= で 1 件ずつ別に引け、Proposal の状態名はフィルタ値として 400。分母の件数は前後で不変', async () => {
    const denominatorBefore = await conversionDenominatorCount();

    const toDecline = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const toExpire = await issue(PROJECT_A_PRIVATE, ENGINEER_A_PARTNER);
    const toWithdraw = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER2);
    expect((await getRequests(hostA, '?state=REQUESTED')).items).toHaveLength(3);

    expect((await decline(partnerA1, toDecline, { reason: DECLINE_REASON_A1 })).status).toBe(204);
    await admin.proposalRequest.update({ where: { id: toExpire }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect(await expireProposalRequests(systemTenantCtx(TENANT_A, EXPIRE_JOB), { now: new Date() })).toEqual({
      scanned: 1,
      expired: 1,
    });
    expect((await withdraw(hostA, toWithdraw)).status).toBe(204);

    // --- 🔴 1 件ずつ別のフィルタ値で引ける（「失効」に畳まれていない）。
    expect((await getRequests(hostA, '?state=DECLINED')).items.map((i) => i['id'])).toEqual([toDecline]);
    expect((await getRequests(hostA, '?state=EXPIRED')).items.map((i) => i['id'])).toEqual([toExpire]);
    expect((await getRequests(hostA, '?state=WITHDRAWN_BY_HOST')).items.map((i) => i['id'])).toEqual([toWithdraw]);
    expect((await getRequests(hostA, '?state=REQUESTED')).items).toHaveLength(0);
    expect((await getRequests(hostA, '?state=ACCEPTED')).items).toHaveLength(0);

    // --- 🔴 Proposal の状態名（LOST / GATE_FAILED / SUBMIT_FAILED / WITHDRAWN）と畳んだ語は 400（別のエンティティ）。
    for (const foreign of ['LOST', 'GATE_FAILED', 'SUBMIT_FAILED', 'WITHDRAWN', 'CLOSED', 'FAILED']) {
      expect((await getRequestsResponse(hostA, `?state=${foreign}`)).status, foreign).toBe(400);
    }

    // --- 3 つの状態バッジは別の語。フィルタの選択肢は「すべて」+ 5 状態で、重複が無い。
    const all = await getRequests(hostA);
    const rows = hostProposalRequestRows(all.items as unknown as Parameters<typeof hostProposalRequestRows>[0]);
    const labels = new Set(rows.map((row) => row.stateLabel));
    expect(labels.size).toBe(3);
    const options = proposalRequestStateOptions();
    expect(options.map((o) => o.value)).toEqual(['', ...PROPOSAL_REQUEST_STATES]);
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length);
    expectAbsent(all, HOST_FORBIDDEN_VALUES, HOST_FORBIDDEN_KEYS, '3 結末後の #32');

    // --- 🔴 AC-4: 成約率の分母（SUBMITTED に到達した proposals）は 3 つの結末で 1 件も動かない。
    expect(await conversionDenominatorCount()).toBe(denominatorBefore);
    // 提案依頼の状態別件数はホストの集計として別に立つ（proposals とは別の表・別の状態集合）。
    const byState = await withTenant(hostA, (db) =>
      db.proposalRequest.groupBy({ by: ['state'], _count: { _all: true } }),
    );
    expect(
      Object.fromEntries(byState.map((row) => [row.state, row._count._all])),
    ).toEqual({ DECLINED: 1, EXPIRED: 1, WITHDRAWN_BY_HOST: 1 });
    // 🔴 分母の状態集合と提案依頼の状態集合は交わらない（WHERE state IN (...) が proposal_requests を拾いようがない）。
    for (const state of PROPOSAL_REQUEST_STATES) {
      expect(CONVERSION_DENOMINATOR_PROPOSAL_STATES as readonly string[]).not.toContain(state);
    }
    // 対照: proposals 側の状態には該当行が 1 件も無い（fixtures はすべて DRAFT）。
    expect(await withTenant(hostA, (db) => db.proposal.count({ where: { state: { in: ['DECLINED', 'EXPIRED', 'WITHDRAWN_BY_HOST'] } } }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ AC-6: 他社への依頼を知る手段が無い
// ---------------------------------------------------------------------------

describe('🔴 F-018 AC-6: パートナーは、同じ案件で他社に提案依頼が来ているかを知る手段を持たない', () => {
  it('A1 / A2 の両社に依頼を出しても、各社の #32 / S-018 / S-015 は自社宛だけを映し、他社の辞退も件数を動かさない', async () => {
    const forA1 = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const forA2 = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER2);
    expect((await getRequests(hostA, '?state=REQUESTED')).items).toHaveLength(2);

    // --- #32: 各社 1 件だけ。相手の実名・ID・社名・依頼 ID がどの深さにも無い。
    const a1 = await getRequests(partnerA1);
    expect(a1.items.map((i) => i['id'])).toEqual([forA1]);
    expect(a1.nextCursor).toBeNull();
    expect(a1.items[0]?.['engineer']).toEqual({ id: ENGINEER_A_PARTNER, displayName: P1_DISPLAY_NAME });
    expectAbsent(a1, [P2_DISPLAY_NAME, P2_COMPANY_NAME, ENGINEER_A_PARTNER2, PARTNER_A2, USER_A_PARTNER2, forA2], ['declineReason', 'partnerCompanyId', 'issuedBy', 'respondedBy', 'total', 'count'], 'A1 の #32');

    const a2 = await getRequests(partnerA2);
    expect(a2.items.map((i) => i['id'])).toEqual([forA2]);
    expect(a2.nextCursor).toBeNull();
    // 🔴 A2 には PROJECT_A_PUBLISHED が公開されていない（C4）。依頼の存在は隠さないが案件名は出ない。
    expect(a2.items[0]?.['project']).toBeNull();
    expectAbsent(a2, [P1_DISPLAY_NAME, P1_COMPANY_NAME, ENGINEER_A_PARTNER, PARTNER_A1, USER_A_PARTNER, forA1, 'Project A Published'], ['declineReason', 'partnerCompanyId', 'issuedBy', 'respondedBy', 'total', 'count'], 'A2 の #32');

    // --- S-018: 他社宛の依頼は 404（存在を示唆しない）。応諾・辞退も 404。
    await expect(readPartnerProposalRequestDetail(partnerA1, forA2, { ipAddress: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(readPartnerProposalRequestDetail(partnerA2, forA1, { ipAddress: null })).rejects.toBeInstanceOf(NotFoundError);
    expect((await errorOf(await accept(partnerA1, forA2), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await decline(partnerA1, forA2, { reason: 'x' }), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await decline(partnerA2, forA1, { reason: 'x' }), 404)).code).toBe('NOT_FOUND');

    // --- S-015: 自社の台帳だけ。自社宛の件数 = 1、他社のエンジニアは行として存在しない。
    const sharesA1 = await getShares(partnerA1);
    expect(sharesA1.items.map((i) => i.engineerId)).toEqual([ENGINEER_A_PARTNER]);
    expect(sharesA1.items[0]?.proposalRequestCount).toBe(1);
    expectAbsent(sharesA1, [P2_DISPLAY_NAME, ENGINEER_A_PARTNER2, PARTNER_A2], [], 'A1 の S-015');
    const sharesA2 = await getShares(partnerA2);
    expect(sharesA2.items.map((i) => i.engineerId)).toEqual([ENGINEER_A_PARTNER2]);
    expect(sharesA2.items[0]?.proposalRequestCount).toBe(1);
    expectAbsent(sharesA2, [P1_DISPLAY_NAME, ENGINEER_A_PARTNER, PARTNER_A1], [], 'A2 の S-015');

    // --- A2 が理由付きで辞退しても、A1 側は何も変わらない（一覧・件数・詳細）。
    expect((await decline(partnerA2, forA2, { reason: DECLINE_REASON_A2 })).status).toBe(204);
    const a1After = await getRequests(partnerA1);
    expect(a1After.items).toEqual(a1.items);
    expect((await getShares(partnerA1)).items[0]?.proposalRequestCount).toBe(1);
    const detailA1 = await readPartnerProposalRequestDetail(partnerA1, forA1, { ipAddress: META.ipAddress });
    expect(detailA1.state).toBe('REQUESTED');
    expect(detailA1.declineReason).toBeNull();
    expectAbsent(detailA1, [DECLINE_REASON_A2, P2_DISPLAY_NAME, ENGINEER_A_PARTNER2, PARTNER_A2, forA2], [], 'A1 の S-018');
    // A1 の DECLINED フィルタは 0 件（他社の辞退は A1 の母集団に無い）。
    expect((await getRequests(partnerA1, '?state=DECLINED')).items).toHaveLength(0);
    expect((await getRequests(partnerA2, '?state=DECLINED')).items.map((i) => i['id'])).toEqual([forA2]);

    // --- ホストは A2 の DECLINED を区別できるが、理由はどの深さにも無い。A1 宛は REQUESTED のまま。
    const host = await getRequests(hostA);
    expect(host.items.find((i) => i['id'] === forA2)?.['state']).toBe('DECLINED');
    expect(host.items.find((i) => i['id'] === forA1)?.['state']).toBe('REQUESTED');
    expectAbsent(host, HOST_FORBIDDEN_VALUES, HOST_FORBIDDEN_KEYS, '辞退後の #32（ホスト）');

    // --- 対照: DB では A2 の理由が実在し、依頼先が別会社である（走査が空振りしていない）。
    const rowA2 = await admin.proposalRequest.findUniqueOrThrow({ where: { id: forA2 } });
    expect(rowA2.declineReason).toBe(DECLINE_REASON_A2);
    expect(rowA2.partnerCompanyId).toBe(PARTNER_A2);
    expect((await admin.proposalRequest.findUniqueOrThrow({ where: { id: forA1 } })).partnerCompanyId).toBe(PARTNER_A1);
  });

  it('🔴 共有を止めた A2 の候補には依頼が出せず（404）、A1 の一覧・件数はその前後で変わらない', async () => {
    const forA1 = await issue(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const before = await getRequests(partnerA1);
    await admin.engineerShare.update({ where: { id: shareA2Id }, data: { revokedAt: new Date() } });
    const response = await postRequest(hostA, {
      projectId: PROJECT_A_PUBLISHED,
      candidateRef: candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER2),
      message: MESSAGE,
      expiresAt: EXPIRES_AT,
    });
    expect((await errorOf(response, 404)).code).toBe('NOT_FOUND');
    expect(await admin.proposalRequest.count({ where: { partnerCompanyId: PARTNER_A2 } })).toBe(0);
    const after = await getRequests(partnerA1);
    expect(after.items).toEqual(before.items);
    expect(after.items.map((i) => i['id'])).toEqual([forA1]);
    expect((await getShares(partnerA1)).items[0]?.proposalRequestCount).toBe(1);
  });
});
