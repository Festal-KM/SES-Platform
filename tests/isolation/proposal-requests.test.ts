// tests/isolation/proposal-requests.test.ts
// 🔴 T-08-06（`docs/sprints/SP-08-anonymous-share.md` §5）: 提案依頼の発行・一覧・取り下げを**実 DB・実 Route Handler**で
//    証明する。`F-018`（処理①⑤⑥ / AC-1）/ `F-017 AC-4` / `F-004 AC-7` / docs/05 §4.5「T-08-06 の決着」/
//    §6.5「#31 / #32 / #35 の実装の決着」/ §4.8 / §15.3。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① #31: ホストが `candidateRef` で依頼を発行でき、**応答は `{ id }` だけ**。DB の行には依頼先
//      （`partner_company_id` = 共有元）と `engineer_id` が入るが、応答・監査の `summary` には 1 文字も無い。
//   ② 🔴 `candidateRef` は capability ではない: 参照子が一致しない（改ざん / 他案件の参照子）→ 404、
//      共有が解除された候補 → 404（存在を示唆しない。§4.8）、同一案件 × 同一候補の 2 件目 → 409。
//   ③ 🔴 依頼メッセージに商流情報（単価表記 / 案件のエンド企業名）があると 422 で、行も監査も作らない。
//   ④ 認可: 取引先ロール → 403、`VIEWER` → 403、`SUSPENDED` → 409（`requireExecutable`。`F-004 AC-7`）。
//   ⑤ #32: ホストの応答のキー集合は `HOST_PROPOSAL_REQUEST_VIEW_KEYS` ちょうどで、**`declineReason` /
//      `engineerId` / `partnerCompanyId` / 共有元の社名 / 実名が応答のどの深さにも無い**（`F-018 AC-1`）。
//      取引先 A1 は自社宛の 1 件を自社の実名で読み、A2 は 0 件（C5）。公開されていない案件は `project: null`。
//   ⑥ #35: `REQUESTED → WITHDRAWN_BY_HOST` が CAS で確定し、`responded_at` / `responded_by` と監査
//      （`proposal_request.update` / `WITHDRAW`）が残る。2 回目は **422 `INVALID_STATE_TRANSITION`** で
//      状態が変わらず、`state.invalid_transition` が記録される（サイレントに無視しない。`BR-33` / §15.3）。
//
// 🔴 モックは `requireTenantCtx`（ctx の出所）と `candidateReference`（起動時 DI の鍵）の 2 点だけ。
//    DB・RLS・共有スコープ・Route Handler・ガードはすべて実物である（`project-candidates.test.ts` と同じ方針）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
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
const META = { deviceKind: 'api', ipAddress: '203.0.113.86' } as const;
const TEST_SECRET = 'C'.repeat(43) + '=';

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
const { HOST_PROPOSAL_REQUEST_VIEW_KEYS } = await import('../../apps/web/lib/proposal-requests/views');

/** 🔴 fixtures の値（応答に現れてはならないもの。対照テストで DB に実在することを確かめる）。 */
const P1_DISPLAY_NAME = 'Engineer A-Partner';
const P1_COMPANY_NAME = 'Partner A1';
const PUBLISHED_PROJECT_NAME = 'Project A Published';
const PUBLISHED_END_CLIENT = 'End Client A';
/** 🔴 テストが DB に直接書く辞退理由（ホストのどの応答にも現れてはならない）。 */
const DECLINE_REASON_MARKER = 'T0806-decline-reason-社内都合';

/** 🔴 返答期限は「現在より後、かつ 30 日以内」なので、固定日付ではなく実行時刻から組む（テストが日付で腐らない）。 */
const EXPIRES_AT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const MESSAGE = '11 月上旬の開始を希望しています。面談は来週中に設定可能です。';

const AUDIT_ACTIONS = ['proposal_request.create', 'proposal_request.update', 'state.invalid_transition'];

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostA: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let hostSuspended: AuthenticatedTenantCtx;
let hostClosing: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;

type ErrorBody = { readonly error: { readonly code: string; readonly details?: string[]; readonly params?: Record<string, unknown> } };
type ListBody = { readonly items: readonly Record<string, unknown>[]; readonly nextCursor: string | null };

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

async function getRequests(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return requestsRoute.GET(new Request(`https://app.test/api/proposal-requests${query}`));
}

async function withdraw(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return withdrawRoute.POST(
    new Request(`https://app.test/api/proposal-requests/${id}/withdraw`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );
}

/** 候補一覧（#30）を読んで `MatchCandidate` を作らせ、P1 の匿名候補の `candidateRef` を得る（`S-016` と同じ入口）。 */
async function candidateRefOf(projectId: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(hostA);
  const response = await candidatesRoute.GET(
    new Request(`https://app.test/api/projects/${projectId}/candidates`),
    { params: Promise.resolve({ id: projectId }) },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly items: readonly Record<string, unknown>[] };
  const anonymous = body.items.filter((item) => 'candidateRef' in item);
  expect(anonymous).toHaveLength(1);
  const ref = anonymous[0]?.['candidateRef'];
  if (typeof ref !== 'string') throw new Error('candidateRef が取れませんでした（前提の破綻）。');
  // 🔴 対照: 参照子は HMAC(projectId ‖ engineerId) であり、テストの鍵で再計算できる。
  expect(ref).toBe(candidateRef(projectId, ENGINEER_A_PARTNER));
  return ref;
}

async function issueForPublished(): Promise<string> {
  const ref = await candidateRefOf(PROJECT_A_PUBLISHED);
  const response = await postRequest(hostA, {
    projectId: PROJECT_A_PUBLISHED,
    candidateRef: ref,
    message: MESSAGE,
    expiresAt: EXPIRES_AT,
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { readonly id: string };
  expect(Object.keys(body)).toEqual(['id']);
  return body.id;
}

async function errorOf(response: Response, status: number): Promise<ErrorBody['error']> {
  expect(response.status).toBe(status);
  return ((await response.json()) as ErrorBody).error;
}

// 深さ走査（project-candidates.test.ts と同じ手口）
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

/** 🔴 ホストの応答のどの深さにも現れてはならない値。 */
const FORBIDDEN_VALUES_FOR_HOST: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'P1 の engineer_id', value: ENGINEER_A_PARTNER },
  { label: '共有元 P1 の ID', value: PARTNER_A1 },
  { label: '共有元 P1 の社名', value: P1_COMPANY_NAME },
  { label: 'P1 の実名', value: P1_DISPLAY_NAME },
  { label: 'P1 の担当者 ID', value: USER_A_PARTNER },
  { label: '辞退理由', value: DECLINE_REASON_MARKER },
];
const FORBIDDEN_KEYS_FOR_HOST: readonly string[] = [
  'declineReason',
  'engineerId',
  'engineer',
  'partnerCompanyId',
  'partnerCompany',
  'partnerCompanyName',
  'respondedBy',
  'issuedBy',
  'candidateRef',
];

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
  hostViewer = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' },
    { deviceKind: 'api' },
  );
  hostSuspended = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'SUSPENDED' },
    { deviceKind: 'api' },
  );
  hostClosing = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'CLOSING' },
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
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(async () => {
  requireTenantCtxMock.mockReset();
  await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: null } });
});

afterEach(async () => {
  await admin.proposalRequest.deleteMany({ where: { tenantId: TENANT_A } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

// ---------------------------------------------------------------------------
// ① 発行（#31）
// ---------------------------------------------------------------------------

describe('🔴 #31 発行: 応答は { id } だけで、依頼先・engineer_id は DB の行にだけ在る', () => {
  it('ホスト（SALES）が匿名候補に依頼を発行できる。行・監査が 1 件ずつでき、summary は projectId だけ', async () => {
    const id = await issueForPublished();

    const row = await admin.proposalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.tenantId).toBe(TENANT_A);
    expect(row.projectId).toBe(PROJECT_A_PUBLISHED);
    expect(row.engineerId).toBe(ENGINEER_A_PARTNER);
    // 🔴 依頼先は共有元（PARTNER_A1）。ホストはこの値を知らずに発行している（共有スコープの中で決まる）。
    expect(row.partnerCompanyId).toBe(PARTNER_A1);
    expect(row.state).toBe('REQUESTED');
    expect(row.message).toBe(MESSAGE);
    expect(row.expiresAt.toISOString()).toBe(EXPIRES_AT);
    expect(row.issuedBy).toBe(USER_A_HOST);
    expect(row.respondedAt).toBeNull();
    expect(row.declineReason).toBeNull();

    const audit = await admin.auditLog.findMany({ where: { action: 'proposal_request.create' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetType).toBe('ProposalRequest');
    expect(audit[0]?.targetId).toBe(id);
    expect(audit[0]?.actorId).toBe(USER_A_HOST);
    expect(audit[0]?.summary).toEqual({ projectId: PROJECT_A_PUBLISHED });
    expect(audit[0]?.ipAddress).toBe(META.ipAddress);
    expect(audit[0]?.deviceKind).toBe('api');
    // 🔴 監査の行全体に engineer_id / 依頼先 / 参照子 / 本文が無い（運営者が横断検索する）。
    const serialized = JSON.stringify(audit[0]);
    for (const forbidden of [ENGINEER_A_PARTNER, PARTNER_A1, candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER), MESSAGE]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('🔴 同一案件 × 同一候補の 2 件目は 409（行は 1 件のまま、監査も増えない）', async () => {
    await issueForPublished();
    const ref = candidateRef(PROJECT_A_PUBLISHED, ENGINEER_A_PARTNER);
    const error = await errorOf(
      await postRequest(hostA, { projectId: PROJECT_A_PUBLISHED, candidateRef: ref, message: MESSAGE, expiresAt: EXPIRES_AT }),
      409,
    );
    expect(error.code).toBe('PROPOSAL_REQUEST_ALREADY_EXISTS');
    expect(await admin.proposalRequest.count({ where: { tenantId: TENANT_A } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: 'proposal_request.create' } })).toBe(1);
  });

  it('🔴 参照子が一致しない（改ざん / 他案件の参照子）は 404（存在を示唆しない）', async () => {
    await candidateRefOf(PROJECT_A_PUBLISHED);
    const forged = 'A'.repeat(22);
    const otherProjectRef = candidateRef(PROJECT_A_PRIVATE, ENGINEER_A_PARTNER);
    for (const ref of [forged, otherProjectRef]) {
      const error = await errorOf(
        await postRequest(hostA, { projectId: PROJECT_A_PUBLISHED, candidateRef: ref, message: MESSAGE, expiresAt: EXPIRES_AT }),
        404,
      );
      expect(error.code).toBe('NOT_FOUND');
    }
    expect(await admin.proposalRequest.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });

  it('🔴 共有が解除された候補への依頼は 404（MatchCandidate の行が残っていても発行されない。F-016 AC-2）', async () => {
    const ref = await candidateRefOf(PROJECT_A_PUBLISHED);
    // 一覧を読んだ後に取引先が解除した（`MatchCandidate` は古いまま残る）。
    await admin.engineerShare.update({ where: { id: SHARE_A_P1 }, data: { revokedAt: new Date() } });
    expect(await admin.matchCandidate.count({ where: { projectId: PROJECT_A_PUBLISHED, isAnonymous: true } })).toBe(1);

    const error = await errorOf(
      await postRequest(hostA, { projectId: PROJECT_A_PUBLISHED, candidateRef: ref, message: MESSAGE, expiresAt: EXPIRES_AT }),
      404,
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(await admin.proposalRequest.count({ where: { tenantId: TENANT_A } })).toBe(0);
    expect(await admin.auditLog.count({ where: { action: 'proposal_request.create' } })).toBe(0);
  });

  it('見えない案件（他テナント / 存在しない ID）は 404', async () => {
    const error = await errorOf(
      await postRequest(hostA, {
        projectId: '01930000-0000-7000-8000-00000000ffff',
        candidateRef: 'A'.repeat(22),
        message: MESSAGE,
        expiresAt: EXPIRES_AT,
      }),
      404,
    );
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('🔴 #31 依頼メッセージの商流検証（F-018 入力 / BR-58）', () => {
  it.each([
    ['単価の表記', '単価は 65万円 でお願いできますか。', ['UNIT_PRICE']],
    ['案件のエンド企業名（既知値）', `${PUBLISHED_END_CLIENT} の現場です。`, ['END_CLIENT']],
    ['案件の内部単価（既知値。90 万）', '弊社の受注は 90万 です。', ['UNIT_PRICE']],
  ])('🔴 %s → 422 PROPOSAL_REQUEST_MESSAGE_COMMERCE（行も監査も作らない）', async (_label, message, categories) => {
    const ref = await candidateRefOf(PROJECT_A_PUBLISHED);
    const error = await errorOf(
      await postRequest(hostA, { projectId: PROJECT_A_PUBLISHED, candidateRef: ref, message, expiresAt: EXPIRES_AT }),
      422,
    );
    expect(error.code).toBe('PROPOSAL_REQUEST_MESSAGE_COMMERCE');
    expect(error.params).toEqual({ categories });
    // 🔴 応答に本文・一致した文字列を載せない。
    expect(JSON.stringify(error)).not.toContain('65万円');
    expect(JSON.stringify(error)).not.toContain(PUBLISHED_END_CLIENT);
    expect(await admin.proposalRequest.count({ where: { tenantId: TENANT_A } })).toBe(0);
    expect(await admin.auditLog.count({ where: { action: 'proposal_request.create' } })).toBe(0);
  });

  it('対照: 案件のエンド企業名と内部単価は DB に実在する（照合が空振りしていない）', async () => {
    const project = await admin.project.findUniqueOrThrow({
      where: { id: PROJECT_A_PUBLISHED },
      select: { endClientName: true, internalUnitPrice: true },
    });
    expect(project.endClientName).toBe(PUBLISHED_END_CLIENT);
    expect(Number(project.internalUnitPrice?.toString())).toBe(900000);
  });

  it.each([
    ['過去', '2020-01-01T00:00:00.000Z'],
    ['31 日後より先', '2099-01-01T00:00:00.000Z'],
    ['日付だけ', '2026-12-31'],
  ])('返答期限が範囲外（%s）は 400 で details は body.expiresAt', async (_label, expiresAt) => {
    const ref = await candidateRefOf(PROJECT_A_PUBLISHED);
    const error = await errorOf(
      await postRequest(hostA, { projectId: PROJECT_A_PUBLISHED, candidateRef: ref, message: MESSAGE, expiresAt }),
      400,
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toEqual(['body.expiresAt']);
  });
});

describe('🔴 #31 認可: 取引先 / VIEWER は 403、SUSPENDED / CLOSING は 409（F-004 AC-7 / AC-8）', () => {
  it.each([
    ['PARTNER_SALES（A1）', () => partnerA1, 403, 'FORBIDDEN'],
    ['PARTNER_SALES（A2）', () => partnerA2, 403, 'FORBIDDEN'],
    ['VIEWER（ホスト）', () => hostViewer, 403, 'FORBIDDEN'],
    ['SUSPENDED のホスト', () => hostSuspended, 409, 'TENANT_NOT_EXECUTABLE'],
    ['CLOSING のホスト', () => hostClosing, 409, 'TENANT_NOT_EXECUTABLE'],
  ])('%s → %i', async (_label, ctxOf, status, code) => {
    const ref = await candidateRefOf(PROJECT_A_PUBLISHED);
    const error = await errorOf(
      await postRequest(ctxOf(), { projectId: PROJECT_A_PUBLISHED, candidateRef: ref, message: MESSAGE, expiresAt: EXPIRES_AT }),
      status,
    );
    expect(error.code).toBe(code);
    expect(await admin.proposalRequest.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 一覧（#32）
// ---------------------------------------------------------------------------

describe('🔴 #32 一覧: ホストの応答に declineReason / engineer_id / 依頼先 / 実名が無い（F-018 AC-1）', () => {
  it('キー集合は HOST_PROPOSAL_REQUEST_VIEW_KEYS ちょうどで、禁止値・禁止キーが応答のどの深さにも無い', async () => {
    const id = await issueForPublished();
    // 🔴 辞退理由を DB に直接書く（T-08-07 前だが、列は既にあり、ホストの応答に出ないことを今から固定する）。
    await admin.proposalRequest.update({
      where: { id },
      data: { state: 'DECLINED', declineReason: DECLINE_REASON_MARKER, respondedAt: new Date(), respondedBy: USER_A_PARTNER },
    });

    const response = await getRequests(hostA);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as ListBody;
    expect(body.items).toHaveLength(1);
    const item = body.items[0] ?? {};
    expect(Object.keys(item).sort()).toEqual([...HOST_PROPOSAL_REQUEST_VIEW_KEYS].sort());
    expect(item['state']).toBe('DECLINED');
    expect(item['project']).toEqual({ id: PROJECT_A_PUBLISHED, name: PUBLISHED_PROJECT_NAME });

    const collected = collect(body);
    for (const { label, value } of FORBIDDEN_VALUES_FOR_HOST) {
      expect(collected.values.some((v) => v.includes(value)), `${label} が応答に含まれている`).toBe(false);
    }
    for (const key of FORBIDDEN_KEYS_FOR_HOST) {
      expect(collected.keys, `キー ${key} が応答に含まれている`).not.toContain(key);
    }
  });

  it('対照: 辞退理由と依頼先は DB に実在する（走査が空振りしていない）', async () => {
    const id = await issueForPublished();
    await admin.proposalRequest.update({ where: { id }, data: { declineReason: DECLINE_REASON_MARKER } });
    const row = await admin.proposalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.declineReason).toBe(DECLINE_REASON_MARKER);
    expect(row.partnerCompanyId).toBe(PARTNER_A1);
    const partner = await admin.partnerCompany.findUniqueOrThrow({ where: { id: PARTNER_A1 }, select: { name: true } });
    expect(partner.name).toBe(P1_COMPANY_NAME);
  });

  it('🔴 取引先 A1 は自社宛の 1 件を自社の実名で読み、A2 は 0 件（C5。他社の依頼の存在も件数も知れない）', async () => {
    await issueForPublished();

    const a1 = (await (await getRequests(partnerA1)).json()) as ListBody;
    expect(a1.items).toHaveLength(1);
    expect(a1.items[0]?.['engineer']).toEqual({ id: ENGINEER_A_PARTNER, displayName: P1_DISPLAY_NAME });
    expect(a1.items[0]?.['project']).toEqual({ id: PROJECT_A_PUBLISHED, name: PUBLISHED_PROJECT_NAME });
    expect(a1.items[0]?.['message']).toBe(MESSAGE);
    // 🔴 取引先の応答にも `declineReason` / `partnerCompanyId` / `issuedBy` は無い（T-08-07 が辞退側にだけ足す）。
    for (const key of ['declineReason', 'partnerCompanyId', 'issuedBy', 'respondedBy']) {
      expect(collect(a1).keys).not.toContain(key);
    }

    const a2 = (await (await getRequests(partnerA2)).json()) as ListBody;
    expect(a2.items).toHaveLength(0);
    expect(a2.nextCursor).toBeNull();
  });

  it('🔴 自社に公開されていない案件への依頼は、取引先の応答で project が null になる（C4。名前を出さない）', async () => {
    const ref = await candidateRefOf(PROJECT_A_PRIVATE);
    const response = await postRequest(hostA, { projectId: PROJECT_A_PRIVATE, candidateRef: ref, message: MESSAGE, expiresAt: EXPIRES_AT });
    expect(response.status).toBe(201);

    const a1 = (await (await getRequests(partnerA1)).json()) as ListBody;
    expect(a1.items).toHaveLength(1);
    expect(a1.items[0]?.['project']).toBeNull();
    expect(collect(a1).values.some((v) => v.includes('Project A Private'))).toBe(false);
    expect(collect(a1).values.some((v) => v.includes('End Client B'))).toBe(false);

    // ホストには案件名が見える。
    const host = (await (await getRequests(hostA)).json()) as ListBody;
    expect(host.items[0]?.['project']).toEqual({ id: PROJECT_A_PRIVATE, name: 'Project A Private' });
  });

  it('state フィルタは 5 状態のいずれか。畳んだ値は 400', async () => {
    const id = await issueForPublished();
    expect(((await (await getRequests(hostA, '?state=REQUESTED')).json()) as ListBody).items).toHaveLength(1);
    expect(((await (await getRequests(hostA, '?state=WITHDRAWN_BY_HOST')).json()) as ListBody).items).toHaveLength(0);
    expect((await getRequests(hostA, '?state=CLOSED')).status).toBe(400);
    // VIEWER / CLOSING でも一覧は読める（読み取りに requireExecutable を掛けない。F-004 AC-6 / AC-8）。
    expect(((await (await getRequests(hostViewer)).json()) as ListBody).items.map((item) => item['id'])).toEqual([id]);
    expect((await getRequests(hostClosing)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 取り下げ（#35）
// ---------------------------------------------------------------------------

describe('🔴 #35 取り下げ: REQUESTED → WITHDRAWN_BY_HOST だけが成立し、それ以外は 422（BR-33）', () => {
  it('ホストが取り下げると 204。行と監査が確定する', async () => {
    const id = await issueForPublished();
    const response = await withdraw(hostA, id);
    expect(response.status).toBe(204);

    const row = await admin.proposalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe('WITHDRAWN_BY_HOST');
    expect(row.respondedAt).not.toBeNull();
    expect(row.respondedBy).toBe(USER_A_HOST);

    const audit = await admin.auditLog.findMany({ where: { action: 'proposal_request.update' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(id);
    expect(audit[0]?.summary).toEqual({ operation: 'WITHDRAW', fromState: 'REQUESTED', toState: 'WITHDRAWN_BY_HOST' });
    expect(JSON.stringify(audit[0])).not.toContain(ENGINEER_A_PARTNER);
    expect(JSON.stringify(audit[0])).not.toContain(PARTNER_A1);

    // 一覧で区別できる（取り下げは「辞退」でも「期限切れ」でもない。F-018 AC-5）。
    const list = (await (await getRequests(hostA)).json()) as ListBody;
    expect(list.items[0]?.['state']).toBe('WITHDRAWN_BY_HOST');
    expect(list.items[0]?.['respondedAt']).not.toBeNull();
  });

  it.each(['WITHDRAWN_BY_HOST', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const)(
    '🔴 %s からの取り下げは 422 INVALID_STATE_TRANSITION。状態は変わらず、state.invalid_transition が記録される',
    async (from) => {
      const id = await issueForPublished();
      await admin.proposalRequest.update({ where: { id }, data: { state: from } });

      const error = await errorOf(await withdraw(hostA, id), 422);
      expect(error.code).toBe('INVALID_STATE_TRANSITION');

      const row = await admin.proposalRequest.findUniqueOrThrow({ where: { id } });
      expect(row.state).toBe(from);
      expect(row.respondedBy).toBeNull();

      const audit = await admin.auditLog.findMany({ where: { action: 'state.invalid_transition' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.targetId).toBe(id);
      expect(audit[0]?.summary).toEqual({ entity: 'ProposalRequest', from, to: 'WITHDRAWN_BY_HOST' });
      expect(await admin.auditLog.count({ where: { action: 'proposal_request.update' } })).toBe(0);
    },
  );

  it('見えない ID は 404、取引先 / VIEWER は 403、SUSPENDED は 409（状態は動かない）', async () => {
    const id = await issueForPublished();
    expect((await errorOf(await withdraw(hostA, '01930000-0000-7000-8000-00000000ffff'), 404)).code).toBe('NOT_FOUND');
    expect((await errorOf(await withdraw(partnerA1, id), 403)).code).toBe('FORBIDDEN');
    expect((await errorOf(await withdraw(hostViewer, id), 403)).code).toBe('FORBIDDEN');
    expect((await errorOf(await withdraw(hostSuspended, id), 409)).code).toBe('TENANT_NOT_EXECUTABLE');
    const row = await admin.proposalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe('REQUESTED');
    expect(await admin.auditLog.count({ where: { action: { in: ['proposal_request.update', 'state.invalid_transition'] } } })).toBe(0);
  });
});

describe('🔴 対照: fixtures の値が実在する（走査が空振りしていない）', () => {
  it('P1 の実名・共有元の社名・案件名は DB に在る', async () => {
    const engineer = await admin.engineer.findUniqueOrThrow({ where: { id: ENGINEER_A_PARTNER }, select: { displayName: true, ownerPartnerCompanyId: true } });
    expect(engineer.displayName).toBe(P1_DISPLAY_NAME);
    expect(engineer.ownerPartnerCompanyId).toBe(PARTNER_A1);
    const project = await admin.project.findUniqueOrThrow({ where: { id: PROJECT_A_PUBLISHED }, select: { name: true } });
    expect(project.name).toBe(PUBLISHED_PROJECT_NAME);
  });
});
