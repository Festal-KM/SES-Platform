// tests/isolation/proposal-request-respond.test.ts
// 🔴 T-08-07（`docs/sprints/SP-08-anonymous-share.md` §5）: 提案依頼の応諾・辞退・期限切れを**実 DB・実 Route Handler**で
//    証明する。`F-018`（処理③④⑤⑥ / AC-1 / AC-3 / AC-5）/ `F-019 AC-1` / `BR-57` / docs/05 §6.5
//    「#33 / #34 と `proposal-request.expire` の実装の決着」/ §9.5 / §4.8 / §15.3 / `docs/02` `program-design` 申し送り 12。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① #33: 取引先が応諾すると `ACCEPTED` と `Proposal(DRAFT)` + `EngineerSnapshot` + `ProposalEvent` + 監査が
//      **1 トランザクション**で成立する。🔴 **注入テスト**: `proposal_events` の INSERT 権限を一時的に外して
//      `createProposalDraft` の途中（CAS・`proposals`・`engineer_snapshots` の後）で失敗させると、
//      `proposal_requests` / `proposals` / `engineer_snapshots` / `proposal_events` / `audit_logs` の**どれも増えない**
//      （片方だけ成立する状態を作らない。`docs/02` 申し送り 12 / `F-018 AC-3`。プロダクション経路に seam を置かない）。
//   ② 🔴 開示の前後比較（`F-018 AC-3` / `CLAUDE.md` §5 Phase 1 成功条件 3）: **同じテストの中で**、応諾前はホストの
//      応答（#32）とホスト文脈の `engineers` に実名・所属会社名が 1 文字も無く、応諾後に**`EngineerSnapshot` 経由で初めて**
//      実名が読める。台帳（`engineers`）は応諾後もホストから読めない（経路 2 は凍結情報だけ。`F-019 AC-1`）。
//   ③ 🔴 遷移表に無い応諾・辞退は **422 `INVALID_STATE_TRANSITION`**（状態は変わらず `Proposal` も作られず、
//      `state.invalid_transition` が記録される。サイレントに無視しない。`BR-33`）。
//   ④ 🔴 自社に公開されていない案件への依頼は応諾が **422 `PROPOSAL_REQUEST_PROJECT_NOT_SHARED`**（状態不変・`Proposal` 無し・
//      監査無し）で、**辞退はできる**（`BR-57`）。
//   ⑤ #34: 辞退の理由は行にだけ在り、監査の `summary` にもホストの応答（#32）のどの深さにも無い（`F-018 AC-1`）。
//      取引先の詳細（`S-018`）では自社の記録として読める。空の理由は `NULL`。
//   ⑥ 認可: ホストロール → 403、他社（A2）→ 404（C5）、取引先 `VIEWER` → 403、`SUSPENDED` → 409。ホスト文脈は `S-018` の
//      読み取りにも到達しない（404）。
//   ⑦ `proposal-request.expire`: 期限を過ぎた `REQUESTED` だけが `EXPIRED` になり（`responded_by = NULL`、`SYSTEM` の監査）、
//      2 度目は 0 件（冪等）。終端の行と期限内の行は触らない。`EXPIRED` は `DECLINED` / 取り下げと別の状態として一覧に出る。
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
import {
  ENGINEER_A_PARTNER,
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
const META = { deviceKind: 'mobile', ipAddress: '203.0.113.87' } as const;
const TEST_SECRET = 'D'.repeat(43) + '=';

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
const acceptRoute = await import('../../apps/web/app/api/(main)/proposal-requests/[id]/accept/route');
const declineRoute = await import('../../apps/web/app/api/(main)/proposal-requests/[id]/decline/route');
const { readPartnerProposalRequestDetail } = await import(
  '../../apps/web/lib/proposal-requests/service'
);
const { NotFoundError } = await import('../../apps/web/lib/api/errors');

/** 🔴 fixtures の値（応諾前のホストの応答に現れてはならないもの）。 */
const P1_DISPLAY_NAME = 'Engineer A-Partner';
const P1_COMPANY_NAME = 'Partner A1';
const DECLINE_REASON = 'T0807-decline-reason-社内都合により辞退';

const EXPIRES_AT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const MESSAGE = '11 月上旬の開始を希望しています。面談は来週中に設定可能です。';

const AUDIT_ACTIONS = [
  'proposal_request.create',
  'proposal_request.update',
  'state.invalid_transition',
  'proposal.create',
  'project.view',
];

let database: IsolationDatabase;
let admin: UnextendedClient;
/** 🔴 GRANT の一時取り外し（注入テスト）にだけ使う（`platform-plane.test.ts` ② と同じ手口）。 */
let migrator: UnextendedClient;
let hostA: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA1Viewer: AuthenticatedTenantCtx;
let partnerA1Suspended: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string } };
type ListBody = { readonly items: readonly Record<string, unknown>[] };

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

async function getRequests(ctx: AuthenticatedTenantCtx, query = ''): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await requestsRoute.GET(new Request(`https://app.test/api/proposal-requests${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
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

/** ホストが候補一覧（#30）を読んで `MatchCandidate` を作らせ、P1 の匿名候補に依頼を発行する（`S-016` と同じ入口）。 */
async function issue(projectId: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(hostA);
  const list = await candidatesRoute.GET(new Request(`https://app.test/api/projects/${projectId}/candidates`), {
    params: Promise.resolve({ id: projectId }),
  });
  expect(list.status).toBe(200);
  const response = await postRequest(hostA, {
    projectId,
    candidateRef: candidateRef(projectId, ENGINEER_A_PARTNER),
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

function expectNoHostLeak(body: unknown, label: string): void {
  const collected = collect(body);
  for (const forbidden of [P1_DISPLAY_NAME, P1_COMPANY_NAME, ENGINEER_A_PARTNER, PARTNER_A1, USER_A_PARTNER, DECLINE_REASON]) {
    expect(collected.values.some((v) => v.includes(forbidden)), `${label}: ${forbidden} が応答に含まれている`).toBe(false);
  }
  for (const key of ['declineReason', 'engineerId', 'engineer', 'partnerCompanyId', 'respondedBy', 'proposalId']) {
    expect(collected.keys, `${label}: キー ${key} が応答に含まれている`).not.toContain(key);
  }
}

async function countsFor(requestId: string) {
  const [request, proposals, snapshots, events, audits] = await Promise.all([
    admin.proposalRequest.findUniqueOrThrow({ where: { id: requestId } }),
    admin.proposal.findMany({ where: { proposalRequestId: requestId } }),
    admin.engineerSnapshot.count({ where: { proposal: { proposalRequestId: requestId } } }),
    admin.proposalEvent.count({ where: { proposal: { proposalRequestId: requestId } } }),
    admin.auditLog.findMany({ where: { action: { in: AUDIT_ACTIONS } }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { request, proposals, snapshots, events, audits };
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  migrator = createUnextendedClient(database.migratorUrl);
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
    { deviceKind: 'mobile' },
  );
  partnerA1Viewer = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'VIEWER' },
    { deviceKind: 'mobile' },
  );
  partnerA1Suspended = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES', lifecycleState: 'SUSPENDED' },
    { deviceKind: 'mobile' },
  );
  partnerA2 = await resolveTenantCtx(
    { ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' },
    { deviceKind: 'api' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await migrator?.$disconnect();
  await database?.stop();
});

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: null } });
});

afterEach(async () => {
  // 🔴 応諾で作られた提案（`proposal_request_id` 付き）とその子を先に消す（`proposal_requests` への FK は RESTRICT）。
  const created = await admin.proposal.findMany({ where: { proposalRequestId: { not: null } }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await admin.engineerSnapshot.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposalEvent.deleteMany({ where: { proposalId: { in: ids } } });
  await admin.proposal.deleteMany({ where: { id: { in: ids } } });
  await admin.proposalRequest.deleteMany({ where: { tenantId: TENANT_A } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ① / ② 応諾（#33）
// ---------------------------------------------------------------------------

describe('🔴 #33 応諾: ACCEPTED と Proposal(DRAFT) が同一トランザクションで成立し、その時点で初めて開示される（F-018 AC-3）', () => {
  it('前後比較: 応諾前はホストに実名・所属会社名が無く、応諾後に EngineerSnapshot 経由でだけ読める（台帳は読めないまま）', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);

    // --- 応諾前: ホストの応答（#32）とホスト文脈の台帳（C3）に、実名・所属会社名・engineer_id が 1 文字も無い。
    const before = await getRequests(hostA);
    expect(before.items[0]?.['state']).toBe('REQUESTED');
    expectNoHostLeak(before, '応諾前の #32');
    await withTenant(hostA, async (db) => {
      expect(await db.engineer.findFirst({ where: { id: ENGINEER_A_PARTNER } })).toBeNull();
      expect(await db.engineerSnapshot.findFirst({ where: { proposal: { proposalRequestId: id } } })).toBeNull();
    });

    // --- 応諾（取引先。モバイル端末）。
    const response = await accept(partnerA1, id);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly proposalId: string };
    expect(Object.keys(body)).toEqual(['proposalId']);

    // --- DB: 1 トランザクションの成果物がすべて揃っている。
    const { request, proposals, snapshots, events, audits } = await countsFor(id);
    expect(request.state).toBe('ACCEPTED');
    expect(request.respondedBy).toBe(USER_A_PARTNER);
    expect(request.respondedAt).not.toBeNull();
    expect(request.declineReason).toBeNull();
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0]!;
    expect(proposal.id).toBe(body.proposalId);
    expect(proposal.state).toBe('DRAFT');
    expect(proposal.ownerPartnerCompanyId).toBe(PARTNER_A1); // 🔴 認証コンテキストから（リクエスト入力ではない）
    expect(proposal.projectId).toBe(PROJECT_A_PUBLISHED);
    expect(proposal.engineerId).toBe(ENGINEER_A_PARTNER);
    expect(proposal.createdBy).toBe(USER_A_PARTNER);
    // 🔴 提案先は空文字（#33 は提案先を決められる主体を持たない。`S-020` / #37 が埋める）。
    expect(proposal.recipientCompanyName).toBe('');
    expect(proposal.recipientEmail).toBe('');
    expect(snapshots).toBe(1);
    expect(events).toBe(1);

    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: proposal.id } });
    expect(snapshot.displayName).toBe(P1_DISPLAY_NAME);
    expect(snapshot.ownerPartnerCompanyId).toBe(PARTNER_A1); // 継承トリガ
    // 🔴 `careers` は `[]`（`null` にしない。T-09-12 で行複製を足す）。
    expect(snapshot.careers).toEqual([]);
    expect(Array.isArray(snapshot.skills)).toBe(true);
    expect(snapshot.frozenAt.getTime()).toBe(request.respondedAt!.getTime());

    const event = await admin.proposalEvent.findFirstOrThrow({ where: { proposalId: proposal.id } });
    expect(event).toMatchObject({ kind: 'STATE', fromState: null, toState: 'DRAFT', actorUserId: USER_A_PARTNER });

    // --- 監査: proposal.create / proposal_request.update(ACCEPT) / project.view(PROPOSAL_REQUEST)。summary に engineer_id・依頼先・実名が無い。
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('proposal.create');
    expect(actions).toContain('proposal_request.update');
    expect(actions).toContain('project.view');
    const acceptAudit = audits.find((row) => row.action === 'proposal_request.update');
    expect(acceptAudit?.summary).toEqual({ operation: 'ACCEPT', fromState: 'REQUESTED', toState: 'ACCEPTED', proposalId: proposal.id });
    expect(acceptAudit?.actorId).toBe(USER_A_PARTNER);
    expect(acceptAudit?.deviceKind).toBe('mobile'); // 🔴 端末種別が残る（CLAUDE.md §13.3）
    const createAudit = audits.find((row) => row.action === 'proposal.create');
    expect(createAudit?.targetId).toBe(proposal.id);
    expect(createAudit?.summary).toEqual({ projectId: PROJECT_A_PUBLISHED, proposalRequestId: id });
    // 🔴 `issue()` の候補一覧（ホスト。`via='CANDIDATES'`）とは別に、取引先の応諾が `via='PROPOSAL_REQUEST'` で 1 行残す。
    const viewAudit = audits.find((row) => row.action === 'project.view' && row.actorId === USER_A_PARTNER);
    expect(viewAudit?.summary).toEqual({ via: 'PROPOSAL_REQUEST' });
    expect(viewAudit?.targetId).toBe(PROJECT_A_PUBLISHED);
    for (const row of audits) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(ENGINEER_A_PARTNER);
      expect(serialized).not.toContain(P1_DISPLAY_NAME);
      expect(serialized).not.toContain(PARTNER_A1);
    }

    // --- 応諾後: ホストは **EngineerSnapshot（C5）** で初めて実名を読める。台帳（C3）は依然として読めない。
    await withTenant(hostA, async (db) => {
      const frozen = await db.engineerSnapshot.findFirst({ where: { proposalId: proposal.id } });
      expect(frozen?.displayName).toBe(P1_DISPLAY_NAME);
      const own = await db.proposal.findFirst({ where: { id: proposal.id }, select: { ownerPartnerCompanyId: true } });
      expect(own?.ownerPartnerCompanyId).toBe(PARTNER_A1); // 所属会社はここで開示される（経路 2）
      expect(await db.engineer.findFirst({ where: { id: ENGINEER_A_PARTNER } })).toBeNull(); // F-019 AC-1
    });
    // ホストの #32 は ACCEPTED を示すが、引き続き実名・engineer_id・依頼先は載らない（開示は `Proposal` 側）。
    const after = await getRequests(hostA);
    expect(after.items[0]?.['state']).toBe('ACCEPTED');
    expectNoHostLeak(after, '応諾後の #32');
  });

  it('🔴 注入テスト: createProposalDraft の途中（proposal_events の INSERT）で失敗すると、ACCEPTED も Proposal も Snapshot も監査も 1 行も残らない', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });

    // 🔴 `proposal_events` の INSERT 権限を一時的に外す（`platform-plane.test.ts` ② と同じ手口。プロダクション経路に
    //    テスト用の seam を置かない）。`createProposalDraft` の手順⑤（`ProposalEvent`）は、CAS（`ACCEPTED`）・
    //    `proposals`・`engineer_snapshots` の INSERT より**後**に失敗するので、それらが「書かれた後に巻き戻る」ことを見る。
    await migrator.$executeRawUnsafe('REVOKE INSERT ON proposal_events FROM app_tenant');
    try {
      const response = await accept(partnerA1, id);
      expect(response.status).toBe(500);
      expect(((await response.json()) as ErrorBody).error.code).toBe('INTERNAL');
    } finally {
      await migrator.$executeRawUnsafe('GRANT INSERT ON proposal_events TO app_tenant');
    }

    const { request, proposals, snapshots, events, audits } = await countsFor(id);
    expect(request.state).toBe('REQUESTED'); // 🔴 ACCEPTED だけ成立していない
    expect(request.respondedAt).toBeNull();
    expect(request.respondedBy).toBeNull();
    expect(proposals).toHaveLength(0); // 🔴 Proposal だけ成立していない
    expect(snapshots).toBe(0);
    expect(events).toBe(0);
    expect(audits).toHaveLength(0); // proposal.create / proposal_request.update / project.view のどれも残らない

    // 🔴 対照: 権限を戻すと同じ依頼をあらためて応諾できる（注入が空振りでなく、半端な状態も残っていない）。
    expect((await accept(partnerA1, id)).status).toBe(201);
    expect((await countsFor(id)).request.state).toBe('ACCEPTED');
  });

  it.each(['ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'] as const)(
    '🔴 %s からの応諾は 422 INVALID_STATE_TRANSITION。状態は変わらず Proposal も作られず、state.invalid_transition が記録される',
    async (from) => {
      const id = await issue(PROJECT_A_PUBLISHED);
      await admin.proposalRequest.update({ where: { id }, data: { state: from } });
      await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });

      const error = await errorOf(await accept(partnerA1, id), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');

      const { request, proposals, audits } = await countsFor(id);
      expect(request.state).toBe(from);
      expect(proposals).toHaveLength(0);
      expect(audits.map((row) => row.action)).toEqual(['state.invalid_transition']);
      expect(audits[0]?.summary).toEqual({ entity: 'ProposalRequest', from, to: 'ACCEPTED' });
    },
  );

  it('🔴 同時に取り下げられた依頼（CAS の競合）は 422 で、応諾は成立しない', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    // 取引先が読んでから書くまでの間にホストが取り下げた状況を、行を直接進めて再現する。
    await admin.proposalRequest.update({ where: { id }, data: { state: 'WITHDRAWN_BY_HOST', respondedBy: USER_A_HOST, respondedAt: new Date() } });
    const error = await errorOf(await accept(partnerA1, id), 422);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await countsFor(id)).proposals).toHaveLength(0);
  });

  it('🔴 自社に公開されていない案件への依頼は応諾が 422 PROPOSAL_REQUEST_PROJECT_NOT_SHARED（辞退はできる。BR-57）', async () => {
    const id = await issue(PROJECT_A_PRIVATE);
    await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });

    const error = await errorOf(await accept(partnerA1, id), 422);
    expect(error.code).toBe('PROPOSAL_REQUEST_PROJECT_NOT_SHARED');
    const { request, proposals, audits } = await countsFor(id);
    expect(request.state).toBe('REQUESTED');
    expect(proposals).toHaveLength(0);
    // 🔴 見えなかった案件の「閲覧」も、起きなかった応諾も記録しない。
    expect(audits).toHaveLength(0);

    // S-018 の読み取りでも案件は null（依頼メッセージと自社エンジニアは読める）。
    const detail = await readPartnerProposalRequestDetail(partnerA1, id, { ipAddress: META.ipAddress });
    expect(detail.project).toBeNull();
    expect(detail.engineer).toEqual({ id: ENGINEER_A_PARTNER, displayName: P1_DISPLAY_NAME });
    expect(detail.message).toBe(MESSAGE);

    // 辞退は通る。
    expect((await decline(partnerA1, id, { reason: DECLINE_REASON })).status).toBe(204);
    expect((await countsFor(id)).request.state).toBe('DECLINED');
  });
});

// ---------------------------------------------------------------------------
// ⑤ 辞退（#34）
// ---------------------------------------------------------------------------

describe('🔴 #34 辞退: 理由はパートナー社内限定（F-018 AC-1 / BR-57）', () => {
  it('204 で DECLINED になり、理由は行にだけ在る（監査の summary にもホストの応答にも無い）。取引先の詳細では読める', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });

    expect((await decline(partnerA1, id, { reason: DECLINE_REASON })).status).toBe(204);

    const { request, proposals, audits } = await countsFor(id);
    expect(request.state).toBe('DECLINED');
    expect(request.declineReason).toBe(DECLINE_REASON);
    expect(request.respondedBy).toBe(USER_A_PARTNER);
    expect(proposals).toHaveLength(0);
    expect(audits.map((row) => row.action)).toEqual(['proposal_request.update']);
    expect(audits[0]?.summary).toEqual({ operation: 'DECLINE', fromState: 'REQUESTED', toState: 'DECLINED' });
    expect(JSON.stringify(audits[0])).not.toContain(DECLINE_REASON);
    expect(JSON.stringify(audits[0])).not.toContain('社内都合');

    // 🔴 ホストは DECLINED を区別できるが、理由はどの深さにも無い（`F-018 AC-1` / `AC-2`）。
    const host = await getRequests(hostA);
    expect(host.items[0]?.['state']).toBe('DECLINED');
    expectNoHostLeak(host, '辞退後の #32');
    expect(((await getRequests(hostA, '?state=DECLINED')).items)).toHaveLength(1);
    expect(((await getRequests(hostA, '?state=EXPIRED')).items)).toHaveLength(0);

    // 取引先の一覧（#32）にも理由は載らない（詳細型にだけある）。
    const partnerList = await getRequests(partnerA1);
    expect(collect(partnerList).keys).not.toContain('declineReason');
    expect(collect(partnerList).values.some((v) => v.includes(DECLINE_REASON))).toBe(false);

    // 🔴 取引先の詳細（`S-018`）では自社の記録として読める。
    const detail = await readPartnerProposalRequestDetail(partnerA1, id, { ipAddress: META.ipAddress });
    expect(detail.state).toBe('DECLINED');
    expect(detail.declineReason).toBe(DECLINE_REASON);
    expect(detail.proposalId).toBeNull();
  });

  it('理由が空（{} / 空文字）でも辞退できる（断る自由）。行の decline_reason は NULL', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    expect((await decline(partnerA1, id, {})).status).toBe(204);
    expect((await countsFor(id)).request.declineReason).toBeNull();

    const id2 = await issue(PROJECT_A_PRIVATE);
    expect((await decline(partnerA1, id2, { reason: '   ' })).status).toBe(204);
    expect((await countsFor(id2)).request.declineReason).toBeNull();
  });

  it.each(['ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'] as const)(
    '🔴 %s からの辞退は 422 INVALID_STATE_TRANSITION（状態と理由は変わらない）',
    async (from) => {
      const id = await issue(PROJECT_A_PUBLISHED);
      await admin.proposalRequest.update({ where: { id }, data: { state: from } });
      const error = await errorOf(await decline(partnerA1, id, { reason: DECLINE_REASON }), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');
      const { request } = await countsFor(id);
      expect(request.state).toBe(from);
      expect(request.declineReason).toBeNull();
    },
  );

  it('理由が長すぎる（1001 文字）は 400', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    expect((await errorOf(await decline(partnerA1, id, { reason: 'x'.repeat(1001) }), 400)).code).toBe('VALIDATION');
    expect((await countsFor(id)).request.state).toBe('REQUESTED');
  });
});

// ---------------------------------------------------------------------------
// ⑥ 認可
// ---------------------------------------------------------------------------

describe('🔴 認可: 応諾・辞退は共有元の取引先だけ。ホストは 403、他社は 404、VIEWER は 403、SUSPENDED は 409', () => {
  it.each([
    ['ホスト（SALES）', () => hostA, 403, 'FORBIDDEN'],
    ['他社（A2）', () => partnerA2, 404, 'NOT_FOUND'],
    ['取引先の VIEWER', () => partnerA1Viewer, 403, 'FORBIDDEN'],
    ['SUSPENDED の取引先', () => partnerA1Suspended, 409, 'TENANT_NOT_EXECUTABLE'],
  ])('%s → 応諾 %i / 辞退 %i（状態は動かず Proposal も作られない）', async (_label, ctxOf, status, code) => {
    const id = await issue(PROJECT_A_PUBLISHED);
    expect((await errorOf(await accept(ctxOf(), id), status)).code).toBe(code);
    expect((await errorOf(await decline(ctxOf(), id, { reason: 'x' }), status)).code).toBe(code);
    const { request, proposals } = await countsFor(id);
    expect(request.state).toBe('REQUESTED');
    expect(proposals).toHaveLength(0);
  });

  it('🔴 ホスト文脈は S-018 の読み取りにも到達しない（404）。他社の依頼も 404（C5）', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    await expect(readPartnerProposalRequestDetail(hostA, id, { ipAddress: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(readPartnerProposalRequestDetail(partnerA2, id, { ipAddress: null })).rejects.toBeInstanceOf(NotFoundError);
    // 見えない ID は 404。
    expect((await errorOf(await accept(partnerA1, '01930000-0000-7000-8000-00000000ffff'), 404)).code).toBe('NOT_FOUND');
  });

  it('S-018 の読み取りは案件の共通部分を返し、project.view / via=PROPOSAL_REQUEST を記録する（商流列は無い）', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
    const detail = await readPartnerProposalRequestDetail(partnerA1, id, { ipAddress: META.ipAddress });
    expect(detail.project?.id).toBe(PROJECT_A_PUBLISHED);
    expect(detail.project?.name).toBe('Project A Published');
    const collected = collect(detail);
    expect(collected.keys).not.toContain('endClientName');
    expect(collected.keys).not.toContain('internalUnitPrice');
    expect(collected.values.some((v) => v.includes('End Client A'))).toBe(false);
    const audits = await admin.auditLog.findMany({ where: { action: 'project.view' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.summary).toEqual({ via: 'PROPOSAL_REQUEST' });
    expect(audits[0]?.actorId).toBe(USER_A_PARTNER);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 期限切れジョブ（docs/05 §9.5）
// ---------------------------------------------------------------------------

describe('🔴 proposal-request.expire: 期限を過ぎた REQUESTED だけが EXPIRED になり、冪等である', () => {
  const JOB = { queue: 'proposal-request.expire', jobId: 'repeat:proposal-request.expire:1' };

  it('期限切れは EXPIRED（responded_by NULL・SYSTEM の監査）、期限内と終端は触らない。2 度目は 0 件', async () => {
    const overdue = await issue(PROJECT_A_PUBLISHED);
    const fresh = await issue(PROJECT_A_PRIVATE);
    const past = new Date(Date.now() - 60_000);
    await admin.proposalRequest.update({ where: { id: overdue }, data: { expiresAt: past } });
    await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });

    const now = new Date();
    const first = await expireProposalRequests(systemTenantCtx(TENANT_A, JOB), { now });
    expect(first).toEqual({ scanned: 1, expired: 1 });

    const expired = await admin.proposalRequest.findUniqueOrThrow({ where: { id: overdue } });
    expect(expired.state).toBe('EXPIRED');
    expect(expired.respondedAt?.getTime()).toBe(now.getTime());
    expect(expired.respondedBy).toBeNull();
    expect((await admin.proposalRequest.findUniqueOrThrow({ where: { id: fresh } })).state).toBe('REQUESTED');

    const audits = await admin.auditLog.findMany({ where: { action: 'proposal_request.update' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorKind).toBe('SYSTEM');
    expect(audits[0]?.actorId).toBeNull();
    expect(audits[0]?.targetId).toBe(overdue);
    expect(audits[0]?.summary).toEqual({
      operation: 'EXPIRE',
      fromState: 'REQUESTED',
      toState: 'EXPIRED',
      jobQueue: JOB.queue,
      jobId: JOB.jobId,
    });
    expect(JSON.stringify(audits[0])).not.toContain(ENGINEER_A_PARTNER);
    expect(JSON.stringify(audits[0])).not.toContain(PARTNER_A1);

    // 🔴 冪等: 2 度目は母集団が 0 件（監査も増えない）。
    expect(await expireProposalRequests(systemTenantCtx(TENANT_A, JOB), { now: new Date() })).toEqual({ scanned: 0, expired: 0 });
    expect(await admin.auditLog.count({ where: { action: 'proposal_request.update' } })).toBe(1);

    // 🔴 EXPIRED は DECLINED / 取り下げと別の状態として一覧に出る（F-018 AC-5）。
    expect((await getRequests(hostA, '?state=EXPIRED')).items.map((item) => item['id'])).toEqual([overdue]);
    expect((await getRequests(hostA, '?state=DECLINED')).items).toHaveLength(0);
    expect((await getRequests(partnerA1, '?state=EXPIRED')).items).toHaveLength(1);

    // 期限切れ後の応諾・辞退は 422。
    expect((await errorOf(await accept(partnerA1, overdue), 422)).code).toBe('INVALID_STATE_TRANSITION');
    expect((await errorOf(await decline(partnerA1, overdue, {}), 422)).code).toBe('INVALID_STATE_TRANSITION');
  });

  it('🔴 期限を過ぎていても終端（DECLINED / ACCEPTED 等）の行は上書きしない（CAS の条件は state = REQUESTED）', async () => {
    const id = await issue(PROJECT_A_PUBLISHED);
    await admin.proposalRequest.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000), state: 'DECLINED', declineReason: DECLINE_REASON },
    });
    const outcome = await expireProposalRequests(systemTenantCtx(TENANT_A, JOB), { now: new Date() });
    expect(outcome).toEqual({ scanned: 0, expired: 0 });
    const row = await admin.proposalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe('DECLINED');
    expect(row.declineReason).toBe(DECLINE_REASON);
  });

  it('limit で読む件数を切れる（残りは次回）', async () => {
    const a = await issue(PROJECT_A_PUBLISHED);
    const b = await issue(PROJECT_A_PRIVATE);
    await admin.proposalRequest.updateMany({ where: { id: { in: [a, b] } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect(await expireProposalRequests(systemTenantCtx(TENANT_A, JOB), { now: new Date(), limit: 1 })).toEqual({ scanned: 1, expired: 1 });
    expect(await expireProposalRequests(systemTenantCtx(TENANT_A, JOB), { now: new Date(), limit: 1 })).toEqual({ scanned: 1, expired: 1 });
    expect(await admin.proposalRequest.count({ where: { state: 'EXPIRED' } })).toBe(2);
  });
});
