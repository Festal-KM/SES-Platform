// tests/isolation/project-visibility.test.ts
// 🔴 SP-06 T-06-06 / T-06-07 の完了判定を **DB + RLS 付きで**実証する。
//
// ============================================================================
// T-06-06（`F-014 AC-1` / `AC-2`）
// ============================================================================
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
//   - 認可（docs/05 §6.4 #28 / `docs/04` §S-013 権限差分）: パートナー・`VIEWER` は 403、
//     `CLOSING` / `SUSPENDED` のテナントは 409、他テナントの案件 ID は 404。
//   - 🔴 `S-013` が読む選択肢（`listProjectVisibilityChoices`）は**ホスト専用**である
//     （パートナー文脈は `requireHost` で 404）。他社の社名を取引先に見せる経路を作らない。
//
// ============================================================================
// T-06-07（`F-014 AC-5` / `F-014` 処理④。docs/sprints/SP-06 §4 T-06-07）
// ============================================================================
//   AC-5 🔴 **公開範囲の変更が、実施者・変更前後の公開先とともに監査ログに残る**
//        → ①実施者は操作した本人（別の利用者が変更すれば別の ID）②`before` / `after` が
//          **連鎖して遡れる**（次の記録の `before` は前の記録の `after`）③変更が
//          **起きなかった**要求（404 / 400 / 403）は 1 行も残さない ④モバイルからの変更でも
//          `deviceKind` / `ipAddress` が落ちない（`CLAUDE.md` §13.3）
//        → 🔴 記録が `S-041` の閲覧経路（`GET /api/audit-logs`。T-03-05）から
//          **`VISIBILITY_CHANGE` として、実施者・対象とともに読める**こと。
//
//   処理④ 🔴 **公開解除で対象パートナーの一覧・検索・件数から消えるが、作成済みの提案は残る**
//        → ①検索（`?q=`）と `total` から消える ②`Proposal` の行は変わらず、**当事者
//          （作成したパートナー）から依然として読める** —— `proposals` の RLS は C5 PARTY で
//          あり、C4（案件の公開範囲）に依存しない ③ホスト側の公開先表示（`S-011` の
//          セクション 5 / `S-010` の公開先社数）からも即時に消える ④解除は**他の公開先に
//          影響しない** ⑤🔴 解除した相手を再び選んでも**行は復活せず**、ゲートを通り直す。
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`projects.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけである。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  HostOnlyContextError,
  withTenant,
  type AuthenticatedTenantCtx,
  type DeviceKind,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import {
  createUnextendedClient,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  ISOLATION_SEED_IDS,
  isolationSeedCompanyNames,
  isolationSeedProjectNames,
  runSeed,
} from '@ses/db/seed';
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
// 🔴 T-06-07: 記録が **`S-041` の閲覧経路**（#10。T-03-05 で実装済み）から読めることまで見る。
//    「記録されているのに検索で出てこない」を作らないため（`categories.ts` の規律）。
const auditLogsRoute = await import('../../apps/web/app/api/(main)/audit-logs/route');
// 🔴 T-07-09: `#28` はゲート（`gate.run`）を積むようになった。ここでは **Redis を立てずに**
//    「何が積まれたか」だけを記録するキューを起動時 DI に登録する（本番の実装は BullMQ。
//    `lib/db/bootstrap.ts`）。**登録しない選択肢は無い** —— 未登録なら `#28` は例外になる
//    （黙って保留にしない。`lib/jobs/gate-run-queue.ts`）。
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import(
  '../../apps/web/lib/jobs/gate-run-queue'
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
/** 🔴 T-06-07: 「実施者は操作した本人である」を、**2 人目のホスト利用者**で確かめるために使う。 */
const HOST_OWNER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostOwnerUserId,
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

/** `#28` が積んだ `gate.run` の payload（T-07-09）。 */
type EnqueuedGateJob = {
  readonly tenantId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly contentHash: string;
};
const enqueuedGateJobs: EnqueuedGateJob[] = [];

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
  /** 🔴 `visibleToCount` は**ホストの応答にしか無い**（`PartnerProjectView` は `?: never`）。 */
  readonly items: readonly { readonly id: string; readonly visibleToCount?: number }[];
  readonly total: number;
};
/** `GET /api/projects/{id}`（#27）のホスト応答のうち、本ファイルが見る部分。 */
type HostDetailBody = {
  readonly visibilities: readonly { readonly partnerCompanyId: string }[];
};
/** `GET /api/audit-logs`（#10 / `S-041`）の応答 1 件（`AuditLogListItem`）。 */
type AuditLogItemBody = {
  readonly action: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly deviceKind: string | null;
  readonly ipAddress: string | null;
};
type AuditLogPageBody = { readonly items: readonly AuditLogItemBody[] };

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

async function ctxOf(
  identity: TenantIdentity,
  role: TenantRole,
  deviceKind: DeviceKind = 'api',
): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

/**
 * 🔴 **ゲートを通過した公開の前提づくり**（特権接続。検証には使わない）。
 *
 * SP-06 のゲート接続点は「保留」だけを行うスタブなので（T-06-06 / `publish-gate.ts`）、
 * **API では 2 社目の公開状態を作れない**。「複数社に公開している案件から 1 社だけ解除する」
 * ような T-06-07 の前提は、ゲート通過後にワーカーが作る行（SP-07）を先取りしてここで作る。
 * 🔴 `review_gate_id` は NOT NULL + FK であり、**ゲート結果の行が無ければ公開範囲の行は
 *    物理的に作れない**（docs/05 §6.4「#28 の実装の決着」）。seed の `PROJECT_PUBLISH` の
 *    ゲート結果を指す。
 */
async function publishDirectly(partnerCompanyId: string): Promise<void> {
  await admin.projectVisibility.create({
    data: {
      tenantId: TENANT_1.tenantId,
      projectId: TENANT_1.publishedProjectId,
      partnerCompanyId,
      publishedAt: NOW,
      publishedBy: TENANT_1.hostUserId,
      reviewGateId: TENANT_1.publishGateId,
    },
  });
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

async function getProjects(
  ctx: AuthenticatedTenantCtx,
  search?: Readonly<Record<string, string>>,
): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const params = new URLSearchParams({ limit: '100', ...(search ?? {}) });
  const response = await projectsRoute.GET(
    new Request(`https://app.test/api/projects?${params.toString()}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

/**
 * `GET /api/audit-logs`（#10 / `S-041`）を**実物の Route Handler**で叩く。
 * 🔴 期間は必須（`docs/04` §S-041）。記録は実時刻で入るので、実行時刻の前後 1 時間を渡す。
 */
async function getAuditLogs(
  ctx: AuthenticatedTenantCtx,
  category: string,
): Promise<AuditLogPageBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const params = new URLSearchParams({
    from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    to: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    action: category,
  });
  const response = await auditLogsRoute.GET(
    new Request(`https://app.test/api/audit-logs?${params.toString()}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as AuditLogPageBody;
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

/** 1 件だけであることを確かめてから取り出す（`[0]` の `undefined` を持ち回らない）。 */
function only<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error('前提の破綻（1 件を期待した集合が空でした）。');
  return row;
}

/**
 * 🔴 記録を**内容で**特定する（`created_at` の並びに依存しない）。
 *    `audit_logs.created_at` はミリ秒精度であり、続けて実行した 2 つの要求が同じ値になりうる。
 *    そのとき第 2 キーの `id`（`uuid(7)`）は同一ミリ秒内では単調ではないため、
 *    「1 件目 / 2 件目」で指すとテストが実行のたびに揺れる。
 */
function auditRowByRevoked<T extends { readonly summary: unknown }>(
  rows: readonly T[],
  revoked: string,
): T {
  return only(rows.filter((row) => summaryOf(row)['revoked'] === revoked));
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
  configureGateRunJobQueue({
    enqueue: async (job) => {
      enqueuedGateJobs.push(job);
      return 'ENQUEUED';
    },
    removeFailedJob: async () => 'NOT_FOUND',
  });

  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
  // 🔴 `OWNER` / `ADMIN` は 2 要素認証が必須（`CLAUDE.md` §3.5）。T-06-07 は 2 人目の実施者と
  //    `GET /api/audit-logs`（`OWNER` / `ADMIN` のみ）を使うので、こちらも登録しておく。
  await enrollTwoFactor(TENANT_1.hostOwnerUserId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  resetGateRunJobQueue();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  enqueuedGateJobs.length = 0;
});

afterEach(async () => {
  await setLifecycle(TENANT_1.tenantId, 'ACTIVE');
  await setRole(HOST_1, 'SALES');
  await setRole(HOST_OWNER_1, 'OWNER');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await setRole(PARTNER_USER_2, 'PARTNER_SALES');
  await admin.partnerCompany.updateMany({ data: { suspendedAt: null } });
  // 🔴 公開範囲を seed の 1 行（パートナー 1 社目）だけに戻す。
  await admin.projectVisibility.deleteMany({ where: { id: { notIn: SEED_VISIBILITY_IDS } } });
  await admin.projectVisibility.updateMany({ data: { revokedAt: null } });
  // 🔴 T-07-09: ゲート待ちの公開要求は、ワーカーが確定させるまで残る（本テストはワーカーを
  //    走らせないので必ず残る）。片付けないと次のテストの差分計算に混ざる。
  await admin.projectPublishRequest.deleteMany({});
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

describe('🔴 T-06-06 → T-07-09: 公開の要求はゲートに預けられ、その場では成立しない', () => {
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

  it('🔴 T-07-09: 「これから公開する相手」が公開要求として残り、`gate.run` が 1 本積まれる', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(host, { name: `${MARKER}要求` }));

    await putVisibility(host, id, [PARTNER_1_1.partnerCompanyId]);

    const requests = await admin.projectPublishRequest.findMany({ where: { projectId: id } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.partnerCompanyIds).toEqual([PARTNER_1_1.partnerCompanyId]);
    // 🔴 実施者は操作した本人（`ProjectVisibility.published_by` になる値）。
    expect(requests[0]?.requestedBy).toBe(TENANT_1.hostUserId);

    // 🔴 payload の `contentHash` は公開要求に残した値と**同じ 1 つ**である
    //    （`jobId` の材料であり、ジョブ側が突き合わせる鍵でもある）。
    expect(enqueuedGateJobs).toEqual([
      {
        tenantId: TENANT_1.tenantId,
        targetType: 'PROJECT_PUBLISH',
        targetId: id,
        contentHash: requests[0]?.contentHash,
      },
    ]);
  });

  it('🔴 T-07-09: 同じ案件への再要求は行を積み上げず、1 行を差し替える', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(host, { name: `${MARKER}差し替え` }));

    await putVisibility(host, id, [PARTNER_1_1.partnerCompanyId]);
    await putVisibility(host, id, [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId]);

    const requests = await admin.projectPublishRequest.findMany({ where: { projectId: id } });
    expect(requests).toHaveLength(1);
    expect([...(requests[0]?.partnerCompanyIds ?? [])].sort()).toEqual(
      [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId].sort(),
    );
    // 🔴 公開先が変われば内容も変わる（＝ 別の `jobId`。古い検査結果を使い回さない）。
    expect(enqueuedGateJobs).toHaveLength(2);
    expect(enqueuedGateJobs[0]?.contentHash).not.toBe(enqueuedGateJobs[1]?.contentHash);
    expect(enqueuedGateJobs[1]?.contentHash).toBe(requests[0]?.contentHash);
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
    // 🔴 T-07-09: 境界を**狭める**操作にゲートは要らない（ジョブも公開要求も生まれない）。
    expect(enqueuedGateJobs).toEqual([]);
    expect(
      await admin.projectPublishRequest.findMany({
        where: { projectId: TENANT_1.publishedProjectId },
      }),
    ).toHaveLength(0);
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

describe('🔴 F-014 AC-5: 公開範囲の変更が監査ログに残る', () => {
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

  it('🔴 `summary` に社名・案件名を載せない（運営者の横断検索に出るため。docs/05 §16.2）', async () => {
    // 🔴 2 社を一度に解除する（複数社が並ぶ記録でも、載るのは ID だけであること）。
    await publishDirectly(PARTNER_1_2.partnerCompanyId);
    const host = await ctxOf(HOST_1, 'SALES');
    const companyNames = isolationSeedCompanyNames(1);

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const rows = await auditRows('project.visibility_change');
    const serialized = JSON.stringify(rows[0]?.summary);
    for (const name of [...companyNames.partners, companyNames.host, isolationSeedProjectNames(1).published]) {
      expect(serialized).not.toContain(name);
    }
    // 🔴 載ってよいのは ID・列挙値だけである（載っていること自体は `before` / `revoked` で確認済み）。
    expect(serialized).toContain(PARTNER_1_1.partnerCompanyId);
  });
});

// ---------------------------------------------------------------------------
// T-06-07（`F-014 AC-5` の詳細 / `F-014` 処理④）
// ---------------------------------------------------------------------------

describe('🔴 T-06-07 / F-014 AC-5: 変更が実施者・変更前後とともに「遡れる」', () => {
  it('実施者は操作した本人である（別の利用者が変更すれば別の ID が残る）', async () => {
    const sales = await ctxOf(HOST_1, 'SALES');
    await putVisibility(sales, TENANT_1.publishedProjectId, [PARTNER_1_1.partnerCompanyId]);

    const owner = await ctxOf(HOST_OWNER_1, 'OWNER');
    await putVisibility(owner, TENANT_1.publishedProjectId, []);

    const rows = await auditRows('project.visibility_change');
    expect(rows).toHaveLength(2);
    // 変更なしの要求は `SALES`、解除は `OWNER` が実施した（記録が実施者ごとに分かれている）。
    expect(auditRowByRevoked(rows, '').actorId).toBe(TENANT_1.hostUserId);
    expect(auditRowByRevoked(rows, PARTNER_1_1.partnerCompanyId).actorId).toBe(
      TENANT_1.hostOwnerUserId,
    );
    // 🔴 `SYSTEM` ではない（この操作に自動実行の枝は無い。`F-005 AC-4` の区別）。
    expect(rows.every((row) => row.actorKind === 'USER')).toBe(true);
  });

  it('🔴 変更前後が連鎖する（次の記録の `before` は前の記録の `after` に一致する）', async () => {
    await publishDirectly(PARTNER_1_2.partnerCompanyId);
    const host = await ctxOf(HOST_1, 'SALES');
    const both = [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId].sort().join(',');

    // ① 2 社公開 → 1 社目だけ残す
    await putVisibility(host, TENANT_1.publishedProjectId, [PARTNER_1_1.partnerCompanyId]);
    // ② 1 社目も解除する
    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const rows = await auditRows('project.visibility_change');
    expect(rows).toHaveLength(2);
    const first = summaryOf(auditRowByRevoked(rows, PARTNER_1_2.partnerCompanyId));
    const second = summaryOf(auditRowByRevoked(rows, PARTNER_1_1.partnerCompanyId));
    expect(first['before']).toBe(both);
    expect(first['after']).toBe(PARTNER_1_1.partnerCompanyId);
    // 🔴 ここが `F-014 AC-5` の「遡れる」の実体である。切れていると、ある時点の公開先を
    //    記録だけから復元できない（＝ 取引先への説明が成り立たない）。
    expect(second['before']).toBe(first['after']);
    expect(second['after']).toBe('');
  });

  it('1 回の要求で複数社を解除しても、ID の昇順で 1 行に残る', async () => {
    await publishDirectly(PARTNER_1_2.partnerCompanyId);
    const host = await ctxOf(HOST_1, 'SALES');
    const both = [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId].sort().join(',');

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const rows = await auditRows('project.visibility_change');
    expect(rows).toHaveLength(1);
    const summary = summaryOf(rows[0] ?? { summary: null });
    expect(summary['before']).toBe(both);
    expect(summary['revoked']).toBe(both);
    expect(summary['after']).toBe('');
    expect(summary['requested']).toBe('');
    expect(summary['pending']).toBe('');
    expect(summary['verdict']).toBe('NO_PUBLISH_REQUESTED');
    // 🔴 行は 2 件とも残る（消さない）。
    expect(await visibilityRows(TENANT_1.publishedProjectId)).toHaveLength(2);
    expect(await activeVisibilityRows(TENANT_1.publishedProjectId)).toHaveLength(0);
  });

  it('冪等な再送でも記録は 2 行残る（誰がいつ確定したかも説明責任の一部）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    await putVisibility(host, TENANT_1.publishedProjectId, [PARTNER_1_1.partnerCompanyId]);
    await putVisibility(host, TENANT_1.publishedProjectId, [PARTNER_1_1.partnerCompanyId]);

    const rows = await auditRows('project.visibility_change');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const summary = summaryOf(row);
      expect(summary['before']).toBe(PARTNER_1_1.partnerCompanyId);
      expect(summary['after']).toBe(PARTNER_1_1.partnerCompanyId);
      expect(summary['revoked']).toBe('');
      expect(summary['pending']).toBe('');
    }
    // 🔴 行は増えも減りもしない（同じ相手を 2 回選んでも 1 回の公開である）。
    expect(await activeVisibilityRows(TENANT_1.publishedProjectId)).toHaveLength(1);
  });

  it('🔴 モバイルからの変更でも `deviceKind` と `ipAddress` が残る（`CLAUDE.md` §13.3）', async () => {
    const host = await ctxOf(HOST_1, 'SALES', 'mobile');

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const rows = await auditRows('project.visibility_change');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceKind).toBe('mobile');
    expect(rows[0]?.ipAddress).toBe(META.ipAddress);
  });

  it('🔴 変更が起きなかった要求は 1 行も残さない（404 / 400 / 403）', async () => {
    const host = await ctxOf(HOST_1, 'SALES');

    // ① 他テナントの案件（404）
    expect((await putVisibility(host, TENANT_2.publishedProjectId, [])).status).toBe(404);
    // ② 実在しない取引先（400）
    expect(
      (
        await putVisibility(host, TENANT_1.publishedProjectId, [
          '01930000-0000-7000-8000-00000000fee1',
        ])
      ).status,
    ).toBe(400);
    // ③ 認可で弾かれた要求（403）
    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await putVisibility(partner, TENANT_1.publishedProjectId, [])).status).toBe(403);

    // 🔴 `withApiRoute` の `audit` オプションを使っていれば、ここに 3 行残ってしまう
    //    （ハンドラの前に別トランザクションで書くため）。**起きなかった変更**を記録に残さない。
    expect(await auditRows('project.visibility_change')).toHaveLength(0);
    expect(await activeVisibilityRows(TENANT_1.publishedProjectId)).toHaveLength(1);
  });
});

describe('🔴 T-06-07: 記録が `S-041` の閲覧経路から読める（`GET /api/audit-logs`。#10）', () => {
  it('`VISIBILITY_CHANGE` で、実施者（表示名つき）と対象の案件が読める', async () => {
    const admin1 = await ctxOf(HOST_1, 'ADMIN');
    const actorName = (
      await admin.user.findUniqueOrThrow({
        where: { id: TENANT_1.hostUserId },
        select: { displayName: true },
      })
    ).displayName;

    await putVisibility(admin1, TENANT_1.publishedProjectId, []);

    const page = await getAuditLogs(admin1, 'VISIBILITY_CHANGE');
    expect(page.items).toHaveLength(1);
    const item = page.items[0];
    expect(item?.action).toBe('project.visibility_change');
    expect(item?.actorKind).toBe('USER');
    expect(item?.actorId).toBe(TENANT_1.hostUserId);
    // 🔴 「誰が」を ID ではなく人として読める（`S-041` の「主体」列）。
    expect(item?.actorDisplayName).toBe(actorName);
    expect(item?.targetType).toBe('Project');
    expect(item?.targetId).toBe(TENANT_1.publishedProjectId);
    expect(item?.deviceKind).toBe('api');
  });

  it('🔴 `CREATE_UPDATE_DELETE` には現れない（`project.update` に畳んでいない）', async () => {
    const admin1 = await ctxOf(HOST_1, 'ADMIN');

    await putVisibility(admin1, TENANT_1.publishedProjectId, []);

    const page = await getAuditLogs(admin1, 'CREATE_UPDATE_DELETE');
    expect(page.items.map((item) => item.action)).not.toContain('project.visibility_change');
  });

  it('🔴 応答は `docs/04` §S-041 の列だけで、`summary`（変更前後の公開先）を返さない', async () => {
    // 🔴 **これは意図した境界である。** `F-014 AC-5` が要求するのは「監査ログに**残る**」ことで
    //    あり（記録は上の describe が固定した）、`docs/04` §S-041 の結果テーブルは
    //    「日時 / 主体 / 操作 / 対象 / IP・デバイス種別」の 5 列である。`summary` を無条件に
    //    応答へ載せると、**全 action の `summary` が画面に出る**ことになり（`docs/05` §16.2 の
    //    「PII を入れない」規律に頼り切った露出面になる）、`membership.role_change` など
    //    他の記録の扱いとも食い違う。前後の公開先を画面に出す判断は `docs/04` の改訂事項である。
    const admin1 = await ctxOf(HOST_1, 'ADMIN');

    await putVisibility(admin1, TENANT_1.publishedProjectId, []);

    const page = await getAuditLogs(admin1, 'VISIBILITY_CHANGE');
    expect(page.items[0]).not.toHaveProperty('summary');
    expect(JSON.stringify(page.items)).not.toContain(PARTNER_1_1.partnerCompanyId);
  });
});

describe('🔴 T-06-07 / F-014 処理④: 解除で一覧から消えるが、作成済みの提案は残る', () => {
  it('解除後は検索（`?q=`）と件数からも消える', async () => {
    const projectName = isolationSeedProjectNames(1).published;
    const host = await ctxOf(HOST_1, 'SALES');
    const before = await getProjects(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'), {
      q: projectName,
    });
    expect(before.items.map((item) => item.id)).toEqual([TENANT_1.publishedProjectId]);
    expect(before.total).toBe(1);

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const after = await getProjects(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'), {
      q: projectName,
    });
    expect(after.items).toHaveLength(0);
    // 🔴 `total` も同じ母集団の `COUNT` である（`F-015 AC-1`）。「0 件だが 1 件ある」を作らない。
    expect(after.total).toBe(0);
  });

  it('🔴 案件は見えなくなるが、当事者の提案は残り、当事者から読める', async () => {
    const proposalId = PARTNER_1_1.wonProposalId;
    const before = await admin.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      select: { state: true, projectId: true, ownerPartnerCompanyId: true },
    });
    expect(before.projectId).toBe(TENANT_1.publishedProjectId);
    const host = await ctxOf(HOST_1, 'SALES');

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    // ① 行そのものが変わっていない（`F-014` 処理④「作成済みの提案は残る」）。
    expect(
      await admin.proposal.findUniqueOrThrow({
        where: { id: proposalId },
        select: { state: true, projectId: true, ownerPartnerCompanyId: true },
      }),
    ).toEqual(before);

    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    // ② 🔴 当事者は依然として読める。`proposals` の RLS は **C5 PARTY**（作成した会社）であり、
    //    案件の公開範囲（C4）に依存しない —— 公開をやめても、送った提案の履歴は消えない。
    expect(
      await withTenant(partner, (db) =>
        db.proposal.findMany({ where: { id: proposalId }, select: { id: true, state: true } }),
      ),
    ).toEqual([{ id: proposalId, state: before.state }]);
    // ③ 🔴 一方、案件そのものは同じ文脈から 1 行も見えない（C4）。
    expect(
      await withTenant(partner, (db) =>
        db.project.findFirst({
          where: { id: TENANT_1.publishedProjectId },
          select: { id: true },
        }),
      ),
    ).toBeNull();
    // ④ ホストからも当然残っている（提案の一覧・KPI の母集団が痩せない）。
    expect(
      await withTenant(host, (db) =>
        db.proposal.count({ where: { projectId: TENANT_1.publishedProjectId } }),
      ),
    ).toBeGreaterThan(0);
  });

  it('ホスト側の公開先表示（`S-011` セクション 5 / `S-010` の公開先社数）からも即時に消える', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const detailBefore = (await (
      await getProject(host, TENANT_1.publishedProjectId)
    ).json()) as HostDetailBody;
    expect(detailBefore.visibilities.map((row) => row.partnerCompanyId)).toEqual([
      PARTNER_1_1.partnerCompanyId,
    ]);
    const listBefore = await getProjects(host);
    expect(
      listBefore.items.find((item) => item.id === TENANT_1.publishedProjectId)?.visibleToCount,
    ).toBe(1);

    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const detailAfter = (await (
      await getProject(host, TENANT_1.publishedProjectId)
    ).json()) as HostDetailBody;
    expect(detailAfter.visibilities).toHaveLength(0);
    const listAfter = await getProjects(host);
    expect(
      listAfter.items.find((item) => item.id === TENANT_1.publishedProjectId)?.visibleToCount,
    ).toBe(0);
  });

  it('🔴 解除は他の公開先に影響しない（残った相手にも他社の存在を教えない）', async () => {
    await publishDirectly(PARTNER_1_2.partnerCompanyId);
    const host = await ctxOf(HOST_1, 'SALES');

    // 1 社目だけを解除する（2 社目は維持）。
    await putVisibility(host, TENANT_1.publishedProjectId, [PARTNER_1_2.partnerCompanyId]);

    const revoked = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await getProject(revoked, TENANT_1.publishedProjectId)).status).toBe(404);

    const kept = await ctxOf(PARTNER_USER_2, 'PARTNER_SALES');
    expect((await getProject(kept, TENANT_1.publishedProjectId)).status).toBe(200);
    const list = await getProjects(kept);
    const item = only(list.items.filter((row) => row.id === TENANT_1.publishedProjectId));
    // 🔴 残った相手の応答に、公開先の社数に相当する項目が**存在しない**（`F-014 AC-4` / `BR-07`）。
    //    「1 社解除されて自社だけになった」ことすら伝わってはならない。
    expect(Object.keys(item)).not.toContain('visibleToCount');
  });

  it('🔴 解除した相手を再び選んでも行は復活せず、ゲートを通り直す', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    await putVisibility(host, TENANT_1.publishedProjectId, []);

    const response = await putVisibility(host, TENANT_1.publishedProjectId, [
      PARTNER_1_1.partnerCompanyId,
    ]);

    // 🔴 再公開も「境界を広げる操作」であり、ゲートを通るまで行にならない（`F-014 AC-3`）。
    expect(((await response.json()) as VisibilityBody).verdict).toBe('PENDING_GATE');
    const rows = await visibilityRows(TENANT_1.publishedProjectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
    // 🔴 SP-07 がゲート通過後に行を作るときは、`@@unique([tenantId, projectId, partnerCompanyId])`
    //    があるため **既存行の `revoked_at` を戻す UPDATE** で行う（INSERT は一意制約に当たる）。
    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await getProject(partner, TENANT_1.publishedProjectId)).status).toBe(404);
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
