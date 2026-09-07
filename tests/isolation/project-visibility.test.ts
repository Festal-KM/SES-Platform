// tests/isolation/project-visibility.test.ts
// 🔴 SP-06 T-06-06 の完了判定を **DB + RLS 付きで**実証する（`F-014 AC-1` / `AC-2`）:
//
//   AC-1 🔴 **公開範囲に含まれないパートナーの画面・検索・件数・通知のいずれにも、
//        その案件が現れない**
//        → ①詳細（#27）が 404 ②一覧（#25）の `items` に無い ③一覧の `total` にも数えられない
//          を、実 DB + RLS を通した応答ボディで確かめる。**越境の根拠は
//          `project_visibilities` の行の有無だけ**（docs/05 §4.4 C4）であり、
//          本ファイルはその行を `#28` 経由で動かして母集団が動くことを見る。
//   AC-2 🔴 **公開範囲は「全公開」を既定値として持たない。新規案件の初期状態は非公開である**
//        → `POST /api/projects`（#26）の直後に `project_visibilities` が 0 行であり、
//          同一テナントのどのパートナーからも 404 になる。
//
//   🔴 **ゲート接続点のスタブが `PENDING_GATE` として公開を保留すること**（T-06-06 の完了判定）
//        → `PUT /api/projects/{id}/visibility`（#28）で公開先を追加しても
//          **行が 1 件も増えず**、パートナーからは依然として見えない。
//          ⚠️ `F-014 AC-3`（ゲート FAIL なら公開しない）の検証は **SP-07（T-07-09）**である。
//
// 併せて次を固定する:
//   - 🔴 **解除は即時である**（`F-014` 処理④）。`revoked_at` が入り、対象パートナーの
//     一覧・件数・詳細から消える。**行は消さない**（作成済みの提案が残せるように）。
//   - 公開範囲の変更が `AuditLog`（`project.visibility_change`）に**変更前後**とともに残る
//     （`F-014 AC-5`。**詳細な検証は T-06-07**）。
//   - 認可（docs/05 §6.4 #28 / `docs/04` §S-013 権限差分）: パートナー・`VIEWER` は 403、
//     `CLOSING` / `SUSPENDED` のテナントは 409、他テナントの案件 ID は 404。
//   - 🔴 `S-013` が読む選択肢（`listProjectVisibilityChoices`）は**ホスト専用**である
//     （パートナー文脈は `requireHost` で 404）。他社の社名を取引先に見せる経路を作らない。
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`projects.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけである。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  HostOnlyContextError,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import {
  createUnextendedClient,
  type UnextendedClient,
} from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-07T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.21' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { NotFoundError, toAppError } = await import('../../apps/web/lib/api/errors');
const { listProjectVisibilityChoices } = await import('../../apps/web/lib/projects/visibility');
const projectsRoute = await import('../../apps/web/app/api/(main)/projects/route');
const projectRoute = await import('../../apps/web/app/api/(main)/projects/[id]/route');
const visibilityRoute = await import(
  '../../apps/web/app/api/(main)/projects/[id]/visibility/route'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_USER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};
const PARTNER_USER_2: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_2.partnerCompanyId,
  userId: PARTNER_1_2.userId,
};

/** 🔴 テストが作った行だけを片付けるための目印。 */
const MARKER = 'T0606-';

/** seed が作った公開範囲の行（テストが足した行だけを消すための基準）。 */
const SEED_VISIBILITY_IDS = [TENANT_1.visibilityId, TENANT_2.visibilityId];

const PROJECT_AUDIT_ACTIONS = [
  'project.create',
  'project.update',
  'project.view',
  'project.visibility_change',
];

type CreatedBody = { readonly id: string };
type ErrorBody = { readonly error: { readonly code: string } };
type VisibilityBody = {
  readonly reviewGateId: string | null;
  readonly verdict: 'PENDING_GATE' | 'NO_PUBLISH_REQUESTED';
};
type ListBody = {
  readonly items: readonly { readonly id: string }[];
  readonly total: number;
};

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
}

async function setLifecycle(tenantId: string, lifecycleState: string): Promise<void> {
  await admin.tenant.update({
    where: { id: tenantId },
    data: { lifecycleState, lifecycleChangedAt: NOW },
  });
}

async function enrollTwoFactor(userId: string, tenantId: string): Promise<void> {
  const existing = await admin.twoFactorCredential.findFirst({
    where: { subjectId: userId, subjectType: 'USER' },
    select: { id: true },
  });
  if (existing !== null) return;
  await admin.twoFactorCredential.create({
    data: {
      subjectType: 'USER',
      subjectId: userId,
      tenantId,
      secretEncrypted: 'test:not-a-real-secret',
      recoveryCodeHashes: [],
      confirmedAt: NOW,
    },
  });
}

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function postProject(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectsRoute.POST(
    new Request('https://app.test/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** `PUT /api/projects/{id}/visibility`（#28）を**実物の Route Handler**で叩く。 */
async function putVisibility(
  ctx: AuthenticatedTenantCtx,
  id: string,
  partnerCompanyIds: readonly string[],
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return visibilityRoute.PUT(
    new Request(`https://app.test/api/projects/${id}/visibility`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partnerCompanyIds }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function getProject(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectRoute.GET(new Request(`https://app.test/api/projects/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function getProjects(ctx: AuthenticatedTenantCtx): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await projectsRoute.GET(new Request('https://app.test/api/projects?limit=100'));
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function createdIdOf(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function visibilityRows(projectId: string) {
  return admin.projectVisibility.findMany({
    where: { projectId },
    orderBy: [{ partnerCompanyId: 'asc' }],
  });
}

async function activeVisibilityRows(projectId: string) {
  return (await visibilityRows(projectId)).filter((row) => row.revokedAt === null);
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

function summaryOf(row: { readonly summary: unknown }): Record<string, unknown> {
  return (row.summary ?? {}) as Record<string, unknown>;
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });

  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  await setLifecycle(TENANT_1.tenantId, 'ACTIVE');
  await setRole(HOST_1, 'SALES');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await setRole(PARTNER_USER_2, 'PARTNER_SALES');
  await admin.partnerCompany.updateMany({ data: { suspendedAt: null } });
  // 🔴 公開範囲を seed の 1 行（パートナー 1 社目）だけに戻す。
  await admin.projectVisibility.deleteMany({ where: { id: { notIn: SEED_VISIBILITY_IDS } } });
  await admin.projectVisibility.updateMany({ data: { revokedAt: null } });
  await admin.project.deleteMany({ where: { name: { startsWith: MARKER } } });
  await admin.auditLog.deleteMany({ where: { action: { in: PROJECT_AUDIT_ACTIONS } } });
});

describe('🔴 F-014 AC-2: 既定は誰にも公開されない（「全公開」の既定値が無い）', () => {
  it('登録直後の案件には公開範囲の行が 1 件も無い', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const id = await createdIdOf(await postProject(ctx, { name: `${MARKER}既定は非公開` }));

    expect(await visibilityRows(id)).toHaveLength(0);
  });

  it('🔴 同一テナントのどのパートナーからも見えない（詳細・一覧・件数のすべて）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(host, { name: `${MARKER}未公開` }));

    for (const identity of [PARTNER_USER_1, PARTNER_USER_2]) {
      const partner = await ctxOf(identity, 'PARTNER_SALES');
      const detail = await getProject(partner, id);
      expect(detail.status).toBe(404);
      // 🔴 「一度も公開されていない」は素の 404 である（`PROJECT_NOT_SHARED` にしない）。
      expect(((await detail.json()) as ErrorBody).error.code).toBe('NOT_FOUND');

      const list = await getProjects(partner);
      expect(list.items.map((item) => item.id)).not.toContain(id);
      // 🔴 件数にも数えられない（`total` は一覧と同じ母集団の `COUNT`）。
      expect(list.total).toBe(list.items.length);
    }
  });
});

describe('🔴 T-06-06: ゲート接続点のスタブが公開を保留する', () => {
  it('公開先を追加しても `PENDING_GATE` を返し、行が 1 件も増えない', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(host, { name: `${MARKER}保留` }));

    const response = await putVisibility(host, id, [PARTNER_1_1.partnerCompanyId]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as VisibilityBody;
    expect(body.verdict).toBe('PENDING_GATE');
    // 🔴 `review_gates` には確定した行しか存在できないので、ここでは ID を返せない。
    expect(body.reviewGateId).toBeNull();
    expect(await visibilityRows(id)).toHaveLength(0);
  });

  it('🔴 保留された公開先には、案件が依然として現れない（`F-014 AC-1`）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(host, { name: `${MARKER}保留-見えない` }));
    await putVisibility(host, id, [PARTNER_1_1.partnerCompanyId]);

    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await getProject(partner, id)).status).toBe(404);
    expect((await getProjects(partner)).items.map((item) => item.id)).not.toContain(id);
  });

  it('公開先が 1 社も増えないとき（解除のみ）は `NO_PUBLISH_REQUESTED`（ゲートを起動しない）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    const response = await putVisibility(host, TENANT_1.publishedProjectId, []);

    expect(response.status).toBe(200);
    expect(((await response.json()) as VisibilityBody).verdict).toBe('NO_PUBLISH_REQUESTED');
  });
});

describe('🔴 F-014 AC-1 / 処理④: 公開解除は即時に効く（提案は残せる形で）', () => {
  it('解除すると、対象パートナーの一覧・件数・詳細から消える', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const before = await getProjects(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'));
    expect(before.items.map((item) => item.id)).toContain(TENANT_1.publishedProjectId);

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const after = await getProjects(partner);
    expect(after.items.map((item) => item.id)).not.toContain(TENANT_1.publishedProjectId);
    expect(after.total).toBe(before.total - 1);

    const detail = await getProject(partner, TENANT_1.publishedProjectId);
    expect(detail.status).toBe(404);
    // 🔴 「以前は公開されていた」相手だけが `PROJECT_NOT_SHARED` を受け取る（`docs/04` §10.1 `S-011`）。
    expect(((await detail.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_SHARED');
  });

  it('🔴 行を消さない（`revoked_at` が入るだけ）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const rows = await visibilityRows(TENANT_1.publishedProjectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
    // 公開時のゲート結果への参照も残る（誰にいつ公開していたかを後から遡れる）。
    expect(rows[0]?.reviewGateId).toBe(TENANT_1.publishGateId);
  });

  it('解除しなかった相手には影響しない（同じ要求で維持できる）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    const response = await putVisibility(host, TENANT_1.publishedProjectId, [
      PARTNER_1_1.partnerCompanyId,
    ]);

    expect(((await response.json()) as VisibilityBody).verdict).toBe('NO_PUBLISH_REQUESTED');
    expect(await activeVisibilityRows(TENANT_1.publishedProjectId)).toHaveLength(1);
  });
});

describe('🔴 F-014 AC-5: 公開範囲の変更が監査ログに残る（詳細な検証は T-06-07）', () => {
  it('実施者と変更前後が `project.visibility_change` に残る', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    await putVisibility(host, TENANT_1.publishedProjectId, [PARTNER_1_2.partnerCompanyId]);

    const rows = await auditRows('project.visibility_change');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(rows[0]?.targetId).toBe(TENANT_1.publishedProjectId);
    const summary = summaryOf(rows[0] ?? { summary: null });
    expect(summary['before']).toBe(PARTNER_1_1.partnerCompanyId);
    // 🔴 追加はゲート待ちなので「変更後の公開先」には入らない（`pending` に出る）。
    expect(summary['after']).toBe('');
    expect(summary['pending']).toBe(PARTNER_1_2.partnerCompanyId);
    expect(summary['revoked']).toBe(PARTNER_1_1.partnerCompanyId);
    expect(summary['verdict']).toBe('PENDING_GATE');
  });

  it('🔴 `summary` に取引先の社名を載せない（運営者の横断検索に出るため。docs/05 §16.2）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const partnerName = (
      await admin.partnerCompany.findUniqueOrThrow({
        where: { id: PARTNER_1_1.partnerCompanyId },
        select: { name: true },
      })
    ).name;

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const rows = await auditRows('project.visibility_change');
    expect(JSON.stringify(rows[0]?.summary)).not.toContain(partnerName);
  });
});

describe('認可（docs/05 §6.4 #28 / docs/04 §S-013 権限差分）', () => {
  it('🔴 パートナーは 403（公開範囲はホストの持ち物である）', async () => {
    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const response = await putVisibility(partner, TENANT_1.publishedProjectId, []);

    expect(response.status).toBe(403);
  });

  it('🔴 `VIEWER` は 403（`BR-31` / `F-004 AC-6`）', async () => {
    const viewer = await ctxOf(HOST_1, 'VIEWER');

    expect((await putVisibility(viewer, TENANT_1.publishedProjectId, [])).status).toBe(403);
  });

  it('🔴 `CLOSING` のテナントでは公開範囲を変更できない（`F-004 AC-7`）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const host = await ctxOf(HOST_1, 'SALES');

    const response = await putVisibility(host, TENANT_1.publishedProjectId, []);

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('TENANT_NOT_EXECUTABLE');
  });

  it('🔴 他テナントの案件 ID は 404（境界外と不存在を区別しない。docs/05 §4.8）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    const response = await putVisibility(host, TENANT_2.publishedProjectId, []);

    expect(response.status).toBe(404);
    expect(await activeVisibilityRows(TENANT_2.publishedProjectId)).toHaveLength(1);
  });

  it('🔴 他テナントの取引先 ID を公開先に指定しても 400（存在を教えない）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    const response = await putVisibility(host, TENANT_1.publishedProjectId, [
      TENANT_2.partners[0].partnerCompanyId,
    ]);

    expect(response.status).toBe(400);
    expect(await visibilityRows(TENANT_1.publishedProjectId)).toHaveLength(1);
  });

  it('実在しない取引先 ID も同じ 400（他テナントと区別できない）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    const response = await putVisibility(host, TENANT_1.publishedProjectId, [
      '01930000-0000-7000-8000-00000000fee1',
    ]);

    expect(response.status).toBe(400);
  });
});

describe('🔴 S-013 の選択肢はホスト専用（他社の社名を取引先に見せない）', () => {
  it('ホストは自テナントの取引先を、公開状態つきで一覧できる', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    const choices = await listProjectVisibilityChoices(host, TENANT_1.publishedProjectId);

    expect(choices.map((choice) => choice.partnerCompanyId).sort()).toEqual(
      [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId].sort(),
    );
    const published = choices.find(
      (choice) => choice.partnerCompanyId === PARTNER_1_1.partnerCompanyId,
    );
    expect(published?.publishedOn).not.toBeNull();
    expect(
      choices.find((choice) => choice.partnerCompanyId === PARTNER_1_2.partnerCompanyId)
        ?.publishedOn,
    ).toBeNull();
  });

  it('🔴 パートナー文脈からは到達できない（`requireHost` → API 境界で 404）', async () => {
    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const error = await listProjectVisibilityChoices(
      partner,
      TENANT_1.publishedProjectId,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HostOnlyContextError);
    // 🔴 API 境界では **404** に写像される（403 にすると「その機能はあるが使えない」が伝わる）。
    const mapped = toAppError(error);
    expect(mapped).toBeInstanceOf(NotFoundError);
    expect(mapped.httpStatus).toBe(404);
  });
});
