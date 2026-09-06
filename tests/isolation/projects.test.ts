// tests/isolation/projects.test.ts
// 🔴 SP-06 T-06-01 / T-06-02 の完了判定を **DB + RLS 付きで**実証する（`F-013 AC-1`〜`AC-3`）:
//
//   AC-1 🔴 **必須要件と尚可要件が別の区分として保持され、後続（`F-020` の整合層 /
//        `F-029` の足切り）が区分を参照できる**
//        → `project_requirements.kind` で `MUST` / `NICE` を**区分ごとに取得できる**ことを
//          DB の行で確かめる（本ファイルの中心）
//   AC-2 🔴 **エンド企業名と内部単価が、公開範囲に含まれる相手の画面・エクスポート・通知の
//        いずれにも表示されない**（T-06-02）
//        → `GET /api/projects/{id}`（#27）の**取引先向け応答にフィールドが存在しない**ことを、
//          実 DB + RLS を通した応答ボディで確かめる（型の担保は
//          `apps/web/lib/projects/detail-view.types.test.ts`。**片方だけにしない**）
//   AC-3 案件（詳細相当）の閲覧が `AuditLog` に記録される
//        → `S-012`（編集フォーム）の初期値読み取りが `project.view` を残す（`via=EDIT_FORM`）。
//          `S-011` / `#27` の詳細閲覧も同じ action を残す（`via=DETAIL`。T-06-02）。
//          🔴 **境界外（404）では記録が残らない**（起きなかった閲覧を記録しない）
//
// 併せて次を固定する:
//   - 🔴 `F-014 AC-4` / `BR-07`: 2 社に公開した案件で、**A 社の応答に B 社の存在が 0 件**。
//   - 🔴 `docs/04` §10.1 `S-011`: 公開が**解除された**取引先だけが「公開されていません」を受け取り、
//     一度も公開されていない取引先・他テナントは**素の 404 と区別できない**。
//   - 🔴 `F-004 AC-6` / `AC-8`: `VIEWER` も `CLOSING` のテナントも**詳細を閲覧できる**。
//   - 認可（docs/05 §6.4 #26 / `docs/04` §S-012）: **パートナーと `VIEWER` は案件を作れない**。
//     🔴 パートナーは `requireRole` の 403 だけでなく、RLS の C2（`app_is_host()`）でも止まる。
//   - 境界（docs/05 §4.8）: 他テナントの案件 ID を直接叩いても **404**（不存在と区別しない）。
//   - `originAssignmentId`（`F-045` の生成元）が **PATCH で消えない**
//     （docs/05 §6.4「#26 の実装の決着（T-06-01）」の担保②）。
//   - 監査ログの `summary` に**エンド企業名・単価が 1 文字も入らない**（docs/05 §16.2）。
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`engineers.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけで、
//    その戻り値も `buildTenantCtx` が実 DB から確定した ctx である。
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
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  GLOBAL_SKILL_IDS,
  isolationSeedProjectNames,
  ISOLATION_FORBIDDEN_MARKERS,
  ISOLATION_SEED_IDS,
  runSeed,
} from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-06T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.20' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { NotFoundError, ProjectNotSharedError } = await import('../../apps/web/lib/api/errors');
const { PROJECT_DETAIL_SELECT_KEYS, readProjectDetail, readProjectForEdit } = await import(
  '../../apps/web/lib/projects/service'
);
const projectsRoute = await import('../../apps/web/app/api/(main)/projects/route');
const projectRoute = await import('../../apps/web/app/api/(main)/projects/[id]/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const HOST_2: TenantIdentity = {
  tenantId: TENANT_2.tenantId,
  partnerCompanyId: null,
  userId: TENANT_2.hostUserId,
};
const PARTNER_USER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};
/** 🔴 2 社目。**同じテナントの別パートナー**であり、経路 1 の越境が社ごとに閉じることの対照。 */
const PARTNER_USER_2: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_2.partnerCompanyId,
  userId: PARTNER_1_2.userId,
};

/** 実在しない ID（境界外の ID と応答が一致することの比較対象。docs/05 §4.8）。 */
const NONEXISTENT_ID = '01930000-0000-7000-8000-00000000fee1';

/** 🔴 テストが作った行だけを片付けるための目印。 */
const MARKER = 'T0601-';

/** seed が作った公開範囲の行（テストが足した行だけを消すための基準）。 */
const SEED_VISIBILITY_IDS = [TENANT_1.visibilityId, TENANT_2.visibilityId];

const SKILL_JAVA = GLOBAL_SKILL_IDS['Java'] ?? '';
const SKILL_AWS = GLOBAL_SKILL_IDS['AWS'] ?? '';

const PROJECT_AUDIT_ACTIONS = ['project.create', 'project.update', 'project.view'];

type CreatedBody = { readonly id: string };
type ErrorBody = { readonly error: { readonly code: string } };

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

/** 🔴 ロール・テナント状態・取引先の停止状態をすべて DB から確定した ctx を作る。 */
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

async function patchProject(
  ctx: AuthenticatedTenantCtx,
  id: string,
  body: unknown,
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectRoute.PATCH(
    new Request(`https://app.test/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** `GET /api/projects/{id}`（#27。T-06-02）を**実物の Route Handler**で叩く。 */
async function getProject(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectRoute.GET(new Request(`https://app.test/api/projects/${id}`), {
    params: Promise.resolve({ id }),
  });
}

/** `GET /api/projects`（#25。T-06-03）を**実物の Route Handler**で叩く。 */
async function getProjects(ctx: AuthenticatedTenantCtx, search = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectsRoute.GET(new Request(`https://app.test/api/projects${search}`));
}

async function createdIdOf(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function projectRow(id: string) {
  const row = await admin.project.findUnique({ where: { id } });
  if (row === null) throw new Error(`projects(${id}) が見つかりません（前提の破綻）。`);
  return row;
}

/** 🔴 `F-013 AC-1` の中心: **区分ごとに要件を取り出す**（後続が参照する形そのもの）。 */
async function requirementsOfKind(projectId: string, kind: 'MUST' | 'NICE') {
  return admin.projectRequirement.findMany({
    where: { projectId, kind },
    orderBy: [{ id: 'asc' }],
  });
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** 監査ログ 1 件の `summary` を素のオブジェクトとして読む。 */
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
  await enrollTwoFactor(TENANT_2.hostUserId, TENANT_2.tenantId);
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
  // 🔴 テスト間で前提を持ち越さない。
  await setLifecycle(TENANT_1.tenantId, 'ACTIVE');
  await setRole(HOST_1, 'SALES');
  await setRole(HOST_2, 'SALES');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await setRole(PARTNER_USER_2, 'PARTNER_SALES');
  await admin.partnerCompany.updateMany({ data: { suspendedAt: null } });
  // 🔴 T-06-02: 公開範囲は seed の 1 行（パートナー 1 社目）だけに戻す
  //    （公開解除・2 社公開のテストが seed の前提を書き換えるため）。
  await admin.projectVisibility.deleteMany({ where: { id: { notIn: SEED_VISIBILITY_IDS } } });
  await admin.projectVisibility.updateMany({ data: { revokedAt: null } });
  // 🔴 `project_requirements` は `ON DELETE CASCADE`（migration 20260903010000）。
  await admin.project.deleteMany({ where: { name: { startsWith: MARKER } } });
  await admin.auditLog.deleteMany({ where: { action: { in: PROJECT_AUDIT_ACTIONS } } });
});

describe('🔴 F-013 AC-1: 必須要件と尚可要件が別区分として保持される', () => {
  it('登録した要件が kind ごとに取り出せる（後続が区分を参照できる形）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}区分の切り分け`,
        requirements: [
          { kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 },
          { kind: 'MUST', skillId: null, freeText: '要件定義の経験', requiredYears: null },
          { kind: 'NICE', skillId: SKILL_AWS, freeText: null, requiredYears: 1 },
        ],
      }),
    );

    const must = await requirementsOfKind(id, 'MUST');
    const nice = await requirementsOfKind(id, 'NICE');

    expect(must).toHaveLength(2);
    expect(nice).toHaveLength(1);
    // 🔴 必須の側にはスキル ID と必要年数が残る（`F-029` の足切りが読む値）。
    expect(must.map((row) => row.skillId).sort()).toEqual([SKILL_JAVA, null].sort());
    expect(must.find((row) => row.skillId === SKILL_JAVA)?.requiredYears?.toString()).toBe('3');
    // 🔴 尚可の側に必須が混ざらない（区分が入れ替わっていない）。
    expect(nice[0]?.skillId).toBe(SKILL_AWS);
  });

  it('🔴 要件 0 件でも保存できる（docs/04 §S-012「保存は許す」）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const id = await createdIdOf(await postProject(ctx, { name: `${MARKER}要件なし` }));

    expect(await requirementsOfKind(id, 'MUST')).toHaveLength(0);
    expect(await requirementsOfKind(id, 'NICE')).toHaveLength(0);
    // 既定値（DB の @default と一致）。
    const row = await projectRow(id);
    expect(row.status).toBe('OPEN');
    expect(row.headcount).toBe(1);
  });

  it('PATCH は要件集合を置き換える（画面から消した行が残らない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}置換`,
        requirements: [
          { kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 },
          { kind: 'NICE', skillId: SKILL_AWS, freeText: null, requiredYears: null },
        ],
      }),
    );

    const response = await patchProject(ctx, id, {
      requirements: [{ kind: 'NICE', skillId: SKILL_JAVA, freeText: null, requiredYears: 1 }],
    });

    expect(response.status).toBe(200);
    expect(await requirementsOfKind(id, 'MUST')).toHaveLength(0);
    const nice = await requirementsOfKind(id, 'NICE');
    expect(nice).toHaveLength(1);
    // 🔴 同じスキルでも区分が変われば別の意味になる（必須 → 尚可への移動が成立する）。
    expect(nice[0]?.skillId).toBe(SKILL_JAVA);
  });

  it('PATCH で requirements を指定しなければ要件は変わらない（未指定 = 変更しない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}未指定`,
        requirements: [{ kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 }],
      }),
    );

    expect((await patchProject(ctx, id, { name: `${MARKER}未指定（改）` })).status).toBe(200);

    expect(await requirementsOfKind(id, 'MUST')).toHaveLength(1);
  });

  it('🔴 スキルも自由記述も無い要件は 400（満たしようのない必須要件を作らない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await postProject(ctx, {
      name: `${MARKER}空要件`,
      requirements: [{ kind: 'MUST', skillId: null, freeText: null, requiredYears: 2 }],
    });

    expect(response.status).toBe(400);
    expect(await admin.project.count({ where: { name: `${MARKER}空要件` } })).toBe(0);
  });

  it('🔴 同じスキルを必須と尚可の両方に置けない（400。区分の意味が壊れるため）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await postProject(ctx, {
      name: `${MARKER}重複`,
      requirements: [
        { kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 },
        { kind: 'NICE', skillId: SKILL_JAVA, freeText: null, requiredYears: null },
      ],
    });

    expect(response.status).toBe(400);
    expect(await admin.project.count({ where: { name: `${MARKER}重複` } })).toBe(0);
  });

  it('辞書に無いスキル ID は 400（FK 違反を 500 にしない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await postProject(ctx, {
      name: `${MARKER}辞書外`,
      requirements: [
        { kind: 'MUST', skillId: NONEXISTENT_ID, freeText: null, requiredYears: null },
      ],
    });

    expect(response.status).toBe(400);
  });
});

describe('🔴 案件の状態（募集中 / 充足 / 後任募集）と F-045 の生成元', () => {
  it('後任募集（SUCCESSOR_WANTED）を登録できる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const id = await createdIdOf(
      await postProject(ctx, { name: `${MARKER}後任募集`, status: 'SUCCESSOR_WANTED' }),
    );

    expect((await projectRow(id)).status).toBe('SUCCESSOR_WANTED');
  });

  it('🔴 PATCH は `origin_assignment_id` を書かない（還流が付けた生成元が人手の編集で消えない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(ctx, { name: `${MARKER}生成元` }));
    // 🔴 `F-045` の還流ジョブ（SP-16）が書くのと同じ形を、特権接続で先に作る。
    await admin.project.update({
      where: { id },
      data: { status: 'SUCCESSOR_WANTED', originAssignmentId: TENANT_1.hostAssignmentId },
    });

    // 入力に混ぜても届かない（Zod の strip）。かつ他の列の更新でも消えない。
    const response = await patchProject(ctx, id, {
      name: `${MARKER}生成元（改）`,
      status: 'OPEN',
      originAssignmentId: null,
    });

    expect(response.status).toBe(200);
    const row = await projectRow(id);
    expect(row.name).toBe(`${MARKER}生成元（改）`);
    expect(row.status).toBe('OPEN');
    expect(row.originAssignmentId).toBe(TENANT_1.hostAssignmentId);
  });

  it('🔴 作成時に `origin_assignment_id` を入力から書けない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}生成元の偽装`,
        originAssignmentId: TENANT_1.hostAssignmentId,
      }),
    );

    expect((await projectRow(id)).originAssignmentId).toBeNull();
  });
});

describe('🔴 F-014 AC-2: 作成しただけでは誰にも公開されない', () => {
  it('新規登録で `project_visibilities` の行が 1 件も作られない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const id = await createdIdOf(await postProject(ctx, { name: `${MARKER}非公開の既定` }));

    expect(await admin.projectVisibility.count({ where: { projectId: id } })).toBe(0);
  });
});

describe('🔴 認可（docs/05 §6.4 #26 / docs/04 §S-012 権限差分）', () => {
  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '🔴 パートナー（%s）は API を直接叩いても案件を作れない',
    async (role) => {
      const ctx = await ctxOf(PARTNER_USER_1, role);

      const response = await postProject(ctx, { name: `${MARKER}取引先の登録` });

      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
      expect(await admin.project.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
    },
  );

  it('🔴 パートナーはホストの案件を編集できない（403。RLS の C2 でも止まる）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(hostCtx, { name: `${MARKER}ホストの案件` }));
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');

    const response = await patchProject(partnerCtx, id, { name: `${MARKER}書き換え` });

    expect(response.status).toBe(403);
    expect((await projectRow(id)).name).toBe(`${MARKER}ホストの案件`);
  });

  it('🔴 `VIEWER` は案件を作れない（BR-31）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const response = await postProject(ctx, { name: `${MARKER}閲覧者の登録` });

    expect(response.status).toBe(403);
    expect(await admin.project.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
  });

  it.each(['OWNER', 'ADMIN', 'SALES'] as const)('%s は案件を登録できる', async (role) => {
    const ctx = await ctxOf(HOST_1, role);

    const response = await postProject(ctx, { name: `${MARKER}${role}` });

    expect(response.status).toBe(201);
  });

  it('🔴 `CLOSING` のテナントでは案件を作れない（F-004 AC-7 / AC-8）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await postProject(ctx, { name: `${MARKER}解約手続き中` });

    expect(response.status).toBe(409);
    expect(await admin.project.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
  });
});

describe('🔴 境界（docs/05 §4.8「見えない ＝ 存在しない」）', () => {
  it('他テナントの案件 ID を PATCH しても 404（不存在と区別しない）', async () => {
    const ctx = await ctxOf(HOST_2, 'SALES');

    const foreign = await patchProject(ctx, TENANT_1.publishedProjectId, {
      name: `${MARKER}越境`,
    });
    const missing = await patchProject(ctx, NONEXISTENT_ID, { name: `${MARKER}越境` });

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(((await foreign.json()) as ErrorBody).error.code).toBe(
      ((await missing.json()) as ErrorBody).error.code,
    );
    // 🔴 他テナントの行は 1 バイトも動いていない。
    const row = await admin.project.findUniqueOrThrow({
      where: { id: TENANT_1.publishedProjectId },
    });
    expect(row.name.startsWith(MARKER)).toBe(false);
  });

  it('🔴 他テナントの案件は編集フォームからも読めない（404）', async () => {
    const ctx = await ctxOf(HOST_2, 'SALES');

    await expect(
      readProjectForEdit(ctx, TENANT_1.publishedProjectId, { ipAddress: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('🔴 公開済みの案件でも、パートナー文脈は編集用の読み取りに到達できない（商流情報を含むため）', async () => {
    // 🔴 前提: この案件は PARTNER_1_1 に**公開済み**である（seed の `visibilityId`）。
    //    つまり `projects` の RLS（C4）は行を通す —— **RLS だけでは守れない**ことの実証であり、
    //    `readProjectForEdit` の `requireHost` がここで効く（`HostOnlyContextError` → 404）。
    expect(
      await admin.projectVisibility.count({
        where: {
          projectId: TENANT_1.publishedProjectId,
          partnerCompanyId: PARTNER_1_1.partnerCompanyId,
          revokedAt: null,
        },
      }),
    ).toBe(1);
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');

    await expect(
      readProjectForEdit(ctx, TENANT_1.publishedProjectId, { ipAddress: null }),
    ).rejects.toBeInstanceOf(HostOnlyContextError);
    // 🔴 到達していないので閲覧の記録も残らない。
    expect(await auditRows('project.view')).toHaveLength(0);
  });
});

describe('🔴 F-013 AC-3 / BR-27: 監査ログ', () => {
  it('作成が `project.create` として残る（summary は件数と列挙値だけ）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}監査`,
        endClientName: '架空エンド株式会社',
        internalUnitPrice: 900_000,
        requirements: [
          { kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 },
          { kind: 'NICE', skillId: SKILL_AWS, freeText: null, requiredYears: null },
        ],
      }),
    );

    const rows = await auditRows('project.create');
    expect(rows).toHaveLength(1);
    const summary = summaryOf(rows[0]!);
    expect(summary['mustCount']).toBe(1);
    expect(summary['niceCount']).toBe(1);
    expect(summary['status']).toBe('OPEN');
    // 🔴 docs/05 §16.2: 単価・エンド企業名を入れない（運営者の横断検索に出るため）。
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('架空エンド株式会社');
    expect(serialized).not.toContain('900000');
    expect(serialized).not.toContain(`${MARKER}監査`);
  });

  it('更新が `project.update` として残る（変更したキー名だけを残す）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(ctx, { name: `${MARKER}更新監査` }));

    expect(
      (await patchProject(ctx, id, { endClientName: '架空エンド株式会社', status: 'FILLED' }))
        .status,
    ).toBe(200);

    const rows = await auditRows('project.update');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(id);
    const summary = summaryOf(rows[0]!);
    // キー名としては現れるが、値は 1 文字も残らない。
    expect(summary['fields']).toBe('endClientName,status');
    expect(JSON.stringify(summary)).not.toContain('架空エンド株式会社');
  });

  it('🔴 編集フォームの読み取りが `project.view` を残す（S-012 経路で記録が漏れない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}閲覧`,
        endClientName: '架空エンド株式会社',
        internalUnitPrice: 900_000,
        requirements: [{ kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 3 }],
      }),
    );

    const view = await readProjectForEdit(ctx, id, { ipAddress: META.ipAddress });

    // ホスト専用の view であり、商流情報を含む（出さないのは T-06-02 の射影の責務）。
    expect(view.endClientName).toBe('架空エンド株式会社');
    expect(view.internalUnitPrice).toBe(900_000);
    expect(view.requirements.map((requirement) => requirement.kind)).toEqual(['MUST']);
    expect(view.requirements[0]?.skillName).toBe('Java');

    const rows = await auditRows('project.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('Project');
    expect(rows[0]?.targetId).toBe(id);
    expect(summaryOf(rows[0]!)['via']).toBe('EDIT_FORM');
    // 🔴 `CLAUDE.md` §13.3: デバイス種別を必ず残す。
    expect(rows[0]?.deviceKind).toBe('api');
  });

  it('🔴 見えない案件の「閲覧」は記録されない（起きなかった閲覧を残さない）', async () => {
    const ctx = await ctxOf(HOST_2, 'SALES');

    await expect(
      readProjectForEdit(ctx, TENANT_1.publishedProjectId, { ipAddress: META.ipAddress }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await auditRows('project.view')).toHaveLength(0);
  });
});

describe('単価レンジの整合（docs/04 §S-012 セクション 4）', () => {
  it('下限 > 上限は 400', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await postProject(ctx, {
      name: `${MARKER}レンジ`,
      unitPriceMin: 900_000,
      unitPriceMax: 700_000,
    });

    expect(response.status).toBe(400);
  });

  it('🔴 PATCH は既存値と合成して判定する（片方だけ更新しても逆転しない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}レンジ合成`,
        unitPriceMin: 600_000,
        unitPriceMax: 800_000,
      }),
    );

    const response = await patchProject(ctx, id, { unitPriceMax: 500_000 });

    expect(response.status).toBe(400);
    expect((await projectRow(id)).unitPriceMax?.toString()).toBe('800000');
  });
});

// ===========================================================================
// T-06-02: 案件詳細と商流情報の射影（`GET /api/projects/{id}` = #27 / `S-011`）
// ===========================================================================

/** 応答ボディを素のオブジェクトとして読む（🔴 **キーの有無**を数えるため型を付けない）。 */
type DetailBody = Record<string, unknown>;

async function detailBodyOf(response: Response): Promise<DetailBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as DetailBody;
}

/** 公開範囲の行を足す（🔴 経路 1 の唯一の根拠。ゲート結果は seed の 1 件を使い回す）。 */
async function publishTo(partnerCompanyId: string): Promise<void> {
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

/** 公開解除（`revoked_at` を入れる。RLS の C4 が `revoked_at IS NULL` を見る）。 */
async function revokeVisibilityOf(partnerCompanyId: string): Promise<void> {
  const updated = await admin.projectVisibility.updateMany({
    where: { projectId: TENANT_1.publishedProjectId, partnerCompanyId },
    data: { revokedAt: NOW },
  });
  if (updated.count !== 1) throw new Error('公開範囲の行が 1 件ではありません（前提の破綻）。');
}

describe('🔴 F-013 AC-2: 商流情報の射影（取得時に分ける）', () => {
  it('ホストの応答には商流情報が含まれる（対照）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    expect(body['audience']).toBe('HOST');
    expect(String(body['endClientName'])).toContain(ISOLATION_FORBIDDEN_MARKERS.endClientName);
    expect(body['internalUnitPrice']).toBe(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice);
  });

  it('🔴 取引先の応答に `endClientName` / `internalUnitPrice` の**キーが存在しない**', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    expect(body['audience']).toBe('PARTNER');
    // 🔴 `undefined` で返しているのではなく、キーそのものが無い。
    expect(Object.keys(body)).not.toContain('endClientName');
    expect(Object.keys(body)).not.toContain('internalUnitPrice');
    // 🔴 値も 1 文字も現れない（別のキー名に紛れ込んでいないことの確認）。
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.endClientName);
    expect(serialized).not.toContain(String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice));
  });

  it('🔴 取引先にも判断材料（要件・外部公開用のレンジ・公開用の記載）は届く', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    expect(body['publicSummary']).toBe('公開用の概要（合成データ）');
    expect(body['remoteMode']).toBe('PARTIAL_REMOTE');
    const requirements = body['requirements'] as readonly Record<string, unknown>[];
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.['kind']).toBe('MUST');
    expect(requirements[0]?.['freeText']).toBe('TypeScript 3 年');
  });

  it('🔴 取引先向けの `select` に商流情報の列が 1 つも無い（SQL としても取得していない）', () => {
    expect(PROJECT_DETAIL_SELECT_KEYS.partner).not.toContain('endClientName');
    expect(PROJECT_DETAIL_SELECT_KEYS.partner).not.toContain('internalUnitPrice');
    // 対照: ホスト側は読んでいる（＝ 列の存在ではなく **読む／読まない** で分かれている）。
    expect(PROJECT_DETAIL_SELECT_KEYS.host).toContain('endClientName');
    expect(PROJECT_DETAIL_SELECT_KEYS.host).toContain('internalUnitPrice');
  });
});

describe('🔴 F-014 AC-4 / BR-07: 他のパートナーの存在が現れない', () => {
  it('2 社に公開した案件で、A 社の応答に B 社の社名・件数が 0 件', async () => {
    await publishTo(PARTNER_1_2.partnerCompanyId);
    const partnerB = await admin.partnerCompany.findUniqueOrThrow({
      where: { id: PARTNER_1_2.partnerCompanyId },
      select: { name: true },
    });
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));
    const serialized = JSON.stringify(body);

    expect(Object.keys(body)).not.toContain('visibilities');
    expect(Object.keys(body)).not.toContain('visibleToCount');
    expect(serialized).not.toContain(partnerB.name);
    expect(serialized).not.toContain(PARTNER_1_2.partnerCompanyId);
  });

  it('ホストには公開先が見える（対照。2 社が決定的な順序で並ぶ）', async () => {
    await publishTo(PARTNER_1_2.partnerCompanyId);
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    const visibilities = body['visibilities'] as readonly Record<string, unknown>[];
    expect(visibilities).toHaveLength(2);
    const names = visibilities.map((row) => String(row['partnerCompanyName']));
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('🔴 解除済みの公開先はホストの「現在の公開先」に出ない', async () => {
    await revokeVisibilityOf(PARTNER_1_1.partnerCompanyId);
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    expect(body['visibilities']).toEqual([]);
  });
});

describe('🔴 案件詳細の境界（docs/05 §4.8 / docs/04 §10.1 S-011）', () => {
  it('公開されていない案件・他テナント・不存在は取引先からすべて同じ 404', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const unpublished = await getProject(ctx, TENANT_1.privateProjectId);
    const missing = await getProject(ctx, NONEXISTENT_ID);
    const foreign = await getProject(ctx, TENANT_2.publishedProjectId);

    for (const response of [unpublished, missing, foreign]) {
      expect(response.status).toBe(404);
      expect(((await response.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    }
  });

  it('🔴 1 社目に公開中の案件でも、2 社目には 404（社ごとに閉じている）', async () => {
    const ctx = await ctxOf(PARTNER_USER_2, 'PARTNER_SALES');

    const response = await getProject(ctx, TENANT_1.publishedProjectId);

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('🔴 公開が解除された取引先だけが「公開されていません」を受け取る（HTTP は 404 のまま）', async () => {
    await revokeVisibilityOf(PARTNER_1_1.partnerCompanyId);
    const revokedCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const neverSharedCtx = await ctxOf(PARTNER_USER_2, 'PARTNER_SALES');

    const revoked = await getProject(revokedCtx, TENANT_1.publishedProjectId);
    const neverShared = await getProject(neverSharedCtx, TENANT_1.publishedProjectId);

    // 🔴 HTTP は 404 のまま（docs/05 §6.4 #27）。変わるのは文言を選ぶためのコードだけである。
    expect(revoked.status).toBe(404);
    expect(((await revoked.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_SHARED');
    // 🔴 一度も公開されていない相手には**この区別が漏れない**（素の 404）。
    expect(neverShared.status).toBe(404);
    expect(((await neverShared.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('🔴 画面が受け取る例外も同じ（`ProjectNotSharedError` は `NotFoundError` の派生）', async () => {
    await revokeVisibilityOf(PARTNER_1_1.partnerCompanyId);
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const error = await readProjectDetail(ctx, TENANT_1.publishedProjectId, {
      ipAddress: null,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProjectNotSharedError);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it('🔴 ホストが他テナントの案件を叩いても 404', async () => {
    const ctx = await ctxOf(HOST_2, 'SALES');

    const response = await getProject(ctx, TENANT_1.publishedProjectId);

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });
});

describe('🔴 F-013 AC-3 / BR-27: 詳細閲覧の監査ログ', () => {
  it('ホストの詳細閲覧が `project.view`（`via=DETAIL`）を残す', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    const rows = await auditRows('project.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('Project');
    expect(rows[0]?.targetId).toBe(TENANT_1.publishedProjectId);
    expect(summaryOf(rows[0]!)['via']).toBe('DETAIL');
    // 🔴 `CLAUDE.md` §13.3: デバイス種別を必ず残す（モバイルだけ漏れる実装にしない）。
    expect(rows[0]?.deviceKind).toBe('api');
    // 🔴 docs/05 §16.2: 案件名・エンド企業名・単価を `summary` に載せない。
    const serialized = JSON.stringify(summaryOf(rows[0]!));
    expect(serialized).not.toContain(ISOLATION_FORBIDDEN_MARKERS.endClientName);
    expect(serialized).not.toContain(String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice));
  });

  it('🔴 取引先の詳細閲覧も同じ action で残る（記録が視点で漏れない）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    const rows = await auditRows('project.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(PARTNER_1_1.userId);
    expect(summaryOf(rows[0]!)['via']).toBe('DETAIL');
  });

  it('🔴 404 でも「公開解除」でも閲覧は記録されない（起きなかった閲覧を残さない）', async () => {
    const ctx1 = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await getProject(ctx1, TENANT_1.privateProjectId)).status).toBe(404);

    await revokeVisibilityOf(PARTNER_1_1.partnerCompanyId);
    const ctx2 = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await getProject(ctx2, TENANT_1.publishedProjectId)).status).toBe(404);

    expect(await auditRows('project.view')).toHaveLength(0);
  });
});

describe('🔴 F-004 AC-6 / AC-8: 案件詳細の閲覧は止めない', () => {
  it('`VIEWER` も案件詳細を読める（閲覧のみ可）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    expect(body['audience']).toBe('HOST');
  });

  it('`CLOSING` のテナントでも案件詳細を読める（実行系だけを止める）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getProject(ctx, TENANT_1.publishedProjectId)).status).toBe(200);
  });
});

// ===========================================================================
// T-06-03: 案件の検索と一覧（`GET /api/projects` = #25 / `S-010`）
// ===========================================================================
//
// 🔴 `F-015 AC-1`「パートナーの検索結果は、自社に公開された案件のみで構成される。
//    **総件数の表示も同じ母集団から算出される**」と
//    `F-015 AC-3`「同一条件・同一データで並び順が常に同じ」を、実 DB + RLS（C4）で実証する。
//
// 前提（`packages/db/seed/presets/isolation.ts`）: テナント 1 には
//   ①`publishedProjectId`（パートナー 1 社目にだけ公開されている）
//   ②`privateProjectId`（誰にも公開されていない）
// が**実在する**。したがって「母集団の外に実在する案件がある」状態で件数を検証できる
// （0 件同士の比較では、境界が効いているのかデータが無いのか区別できない）。

/** 一覧の 1 件（🔴 **キーの有無**を数えるため、値は緩く受ける）。 */
type ListItem = Record<string, unknown> & { readonly id: string };
type ListBody = {
  readonly items: readonly ListItem[];
  readonly total: number;
  readonly nextCursor: string | null;
};

async function listBodyOf(response: Response): Promise<ListBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

function idsOf(body: ListBody): readonly string[] {
  return body.items.map((item) => item.id);
}

describe('🔴 F-015 AC-1: 一覧の母集団は境界適用後のみ（件数にも現れない）', () => {
  it('🔴 パートナーの一覧は自社に公開された案件だけで構成される（`items` も `total` も）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await listBodyOf(await getProjects(ctx));

    expect(idsOf(body)).toEqual([TENANT_1.publishedProjectId]);
    // 🔴 未公開の案件は 1 件も現れない（存在自体が母集団の外）。
    expect(idsOf(body)).not.toContain(TENANT_1.privateProjectId);
    // 🔴 **件数にも現れない**（`total` は一覧と同じ `where` の `COUNT`。docs/05 §4.8）。
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(body.total);
  });

  it('🔴 同じテナントの 2 社目のパートナーには 1 件も見えない（`F-014 AC-1`）', async () => {
    const ctx = await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN');

    const body = await listBodyOf(await getProjects(ctx));

    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('ホストの一覧には自社の案件が公開・未公開ともに出る（対照）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getProjects(ctx));

    expect(idsOf(body)).toContain(TENANT_1.publishedProjectId);
    expect(idsOf(body)).toContain(TENANT_1.privateProjectId);
    expect(body.total).toBe(2);
  });

  it('🔴 他テナントの案件は ID にも件数にも現れない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getProjects(ctx));

    expect(idsOf(body)).not.toContain(TENANT_2.publishedProjectId);
    expect(idsOf(body)).not.toContain(TENANT_2.privateProjectId);
  });

  it('🔴 他テナント・自社に公開されていない案件の名前が応答本文に 1 バイトも現れない', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const raw = await (await getProjects(ctx)).text();

    expect(raw).not.toContain(isolationSeedProjectNames(2).published);
    expect(raw).not.toContain(isolationSeedProjectNames(1).private);
  });

  it('🔴 公開を解除するとパートナーの一覧と件数から即座に消える（`F-014 AC-5` の一覧側）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await listBodyOf(await getProjects(ctx))).total).toBe(1);

    await revokeVisibilityOf(PARTNER_1_1.partnerCompanyId);

    const body = await listBodyOf(await getProjects(ctx));
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('公開すると、その相手の一覧と件数にだけ増える', async () => {
    const partner2 = await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN');
    expect((await listBodyOf(await getProjects(partner2))).total).toBe(0);

    await publishTo(PARTNER_1_2.partnerCompanyId);

    expect(idsOf(await listBodyOf(await getProjects(partner2)))).toEqual([
      TENANT_1.publishedProjectId,
    ]);
    // 🔴 1 社目の母集団は変わらない（他社への公開が件数に現れない）。
    const partner1 = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    expect((await listBodyOf(await getProjects(partner1))).total).toBe(1);
  });

  it('🔴 `CLOSING` のテナントでも一覧は読める（`F-004 AC-8`。実行系だけを止める）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getProjects(ctx)).status).toBe(200);
  });

  it('🔴 `VIEWER` も一覧を読める（`F-004 AC-6` / `BR-31`。閲覧のみ可）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    expect((await getProjects(ctx)).status).toBe(200);
  });
});

describe('🔴 F-014 AC-4 / BR-07: 一覧に他社の存在が 1 つも現れない', () => {
  it('ホストの行には公開先の社数が入る（対照）', async () => {
    await publishTo(PARTNER_1_2.partnerCompanyId);
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getProjects(ctx));
    const published = body.items.find((item) => item.id === TENANT_1.publishedProjectId);
    const notPublished = body.items.find((item) => item.id === TENANT_1.privateProjectId);

    expect(published?.['audience']).toBe('HOST');
    // seed の 1 社 + ここで足した 1 社。
    expect(published?.['visibleToCount']).toBe(2);
    // 🔴 誰にも公開していない案件は 0（画面では `未設定`。`F-014 AC-2` の既定）。
    expect(notPublished?.['visibleToCount']).toBe(0);
  });

  it('🔴 2 社に公開した案件でも、A 社の応答に B 社の存在が 0 件（社数のフィールドごと無い）', async () => {
    await publishTo(PARTNER_1_2.partnerCompanyId);
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await listBodyOf(await getProjects(ctx));
    const item = body.items[0];

    expect(item?.['audience']).toBe('PARTNER');
    expect(item).not.toHaveProperty('visibleToCount');
    expect(item).not.toHaveProperty('visibilities');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('visibleToCount');
    expect(raw).not.toContain(PARTNER_1_2.partnerCompanyId);
  });

  it('🔴 一覧の応答は `items` / `total` / `nextCursor` だけである（「他に N 件」を持たない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getProjects(ctx));

    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor', 'total']);
  });
});

describe('🔴 F-013 AC-2: 一覧にも商流情報が現れない', () => {
  it('🔴 パートナーの応答にエンド企業名・内部単価が 1 バイトも無い', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const raw = await (await getProjects(ctx)).text();

    expect(raw).not.toContain(ISOLATION_FORBIDDEN_MARKERS.endClientName);
    expect(raw).not.toContain(String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice));
    expect(raw).not.toContain('endClientName');
    expect(raw).not.toContain('internalUnitPrice');
  });

  it('🔴 ホストの一覧にも商流情報が出ない（一覧は 2 列を取得しない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const raw = await (await getProjects(ctx)).text();

    expect(raw).not.toContain(ISOLATION_FORBIDDEN_MARKERS.endClientName);
    expect(raw).not.toContain('endClientName');
  });

  it('🔴 フリーワードでエンド企業名を検索しても当たらない（検索対象が 2 列だけ）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(
      await getProjects(ctx, `?q=${encodeURIComponent(ISOLATION_FORBIDDEN_MARKERS.endClientName)}`),
    );

    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('一覧の 1 件が持つキーは `docs/04` §S-010 の列だけである', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getProjects(ctx));

    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      'audience',
      'headcount',
      'id',
      'moreMustRequirementCount',
      'mustRequirements',
      'name',
      'prefecture',
      'remoteMode',
      'startDate',
      'status',
      'unitPriceMax',
      'unitPriceMin',
      'updatedOn',
      'visibleToCount',
    ]);
  });

  it('🔴 更新日は日単位に丸めて返す（時刻を返さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getProjects(ctx));

    expect(String(body.items[0]?.['updatedOn'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('🔴 F-015 AC-3: 並び順が決定的である', () => {
  /** seed の 2 件 + ここで作る 4 件 = ホストの母集団 6 件。 */
  const EXTRA = 4;
  /**
   * 🔴 **このブロックで作った案件だけを並べ替えの対象にする。** seed の 2 件（`publishedProjectId` /
   *    `privateProjectId`）の状態や更新日時を書き換えると、`afterEach` は名前で消す作りなので
   *    元に戻らず、**後続のテストの前提（母集団・並び）が静かに壊れる**（実際に一度壊した）。
   */
  let created: string[] = [];

  beforeEach(async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    created = [];
    for (let index = 0; index < EXTRA; index += 1) {
      created.push(await createdIdOf(await postProject(ctx, { name: `${MARKER}並び${String(index)}` })));
    }
  });

  it('🔴 同じ条件を 10 回実行しても並び順が変わらない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const first = idsOf(await listBodyOf(await getProjects(ctx)));
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(idsOf(await listBodyOf(await getProjects(ctx)))).toEqual(first);
    }
  });

  it('🔴 後任募集が先頭に来る（`docs/04` §S-010。`F-045` の還流を埋もれさせない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    // 🔴 **最初に作った行**（＝ 更新日順では母集団の最後尾）を後任募集にする。状態が第 1 キーで
    //    なければ先頭に来ない ＝ この 1 本で「状態が更新日より優先される」ことが証明できる。
    const target = created[0] ?? '';
    await admin.project.update({
      where: { id: target },
      data: { status: 'SUCCESSOR_WANTED', updatedAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    const body = await listBodyOf(await getProjects(ctx));

    expect(body.items[0]?.id).toBe(target);
    expect(body.items[0]?.['status']).toBe('SUCCESSOR_WANTED');
  });

  it('🔴 充足は同じ更新日でも募集中より後に来る（状態の優先順位が DB の照合順序と一致する）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const sameMoment = new Date('2026-09-06T12:00:00.000Z');
    const filled = created[0] ?? '';
    const open = created[1] ?? '';
    await admin.project.update({
      where: { id: filled },
      data: { status: 'FILLED', updatedAt: sameMoment },
    });
    await admin.project.update({
      where: { id: open },
      data: { status: 'OPEN', updatedAt: sameMoment },
    });

    const after = idsOf(await listBodyOf(await getProjects(ctx)));

    expect(after.indexOf(open)).toBeLessThan(after.indexOf(filled));
  });

  it('同じ状態のなかでは更新日の新しい順（更新した行が上がる）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    // 🔴 母集団の中で**最も古い**行（このブロックが最初に作った行）を更新する。
    const target = created[0] ?? '';
    expect(idsOf(await listBodyOf(await getProjects(ctx))).indexOf(target)).toBeGreaterThan(0);

    expect((await patchProject(ctx, target, { headcount: 3 })).status).toBe(200);

    const body = await listBodyOf(await getProjects(ctx));
    expect(body.items[0]?.id).toBe(target);
    // 🔴 並びが変わっても母集団の件数は変わらない。
    expect(body.total).toBe(EXTRA + 2);
  });

  it('`limit` で区切り、カーソルで続きを読める（重複も欠落もしない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const first = await listBodyOf(await getProjects(ctx, '?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    // 🔴 `total` はページの件数ではなく母集団の件数である（同じ `where` の `COUNT`）。
    expect(first.total).toBe(EXTRA + 2);

    const seen = new Set(idsOf(first));
    let cursor = first.nextCursor;
    let guard = 0;
    while (cursor !== null && guard < 10) {
      const page = await listBodyOf(await getProjects(ctx, `?limit=2&cursor=${cursor}`));
      for (const id of idsOf(page)) {
        expect(seen.has(id), `${id} が 2 度現れた`).toBe(false);
        seen.add(id);
      }
      expect(page.total).toBe(EXTRA + 2);
      cursor = page.nextCursor;
      guard += 1;
    }

    expect(seen.size).toBe(EXTRA + 2);
  });

  it('🔴 境界外の ID をカーソルに指定しても他社の案件に到達できない', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    // 形は妥当だがパートナーの母集団に無い ID（未公開案件）。
    const response = await getProjects(ctx, `?cursor=${TENANT_1.privateProjectId}`);

    // Prisma は母集団の中でカーソル行を探すため、見つからなければ 0 件になる。**500 にはしない。**
    expect(response.status).toBe(200);
    expect(idsOf(await listBodyOf(response))).not.toContain(TENANT_1.privateProjectId);
  });
});

describe('検索条件（docs/05 §6.4 #25 / `F-015` の入力）', () => {
  it('状態で絞れる（`total` も絞り込み後の母集団）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, { name: `${MARKER}後任`, status: 'SUCCESSOR_WANTED' }),
    );

    const body = await listBodyOf(await getProjects(ctx, '?status=SUCCESSOR_WANTED'));

    expect(idsOf(body)).toEqual([id]);
    expect(body.total).toBe(1);
  });

  it('フリーワードで案件名を絞れる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postProject(ctx, { name: `${MARKER}保険基幹系` }));

    const body = await listBodyOf(await getProjects(ctx, `?q=${encodeURIComponent('保険基幹系')}`));

    expect(idsOf(body)).toEqual([id]);
    expect(body.total).toBe(1);
  });

  it('フリーワードは外部公開用の記載も見る', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, { name: `${MARKER}概要一致`, publicSummary: '大規模な物流の刷新' }),
    );

    const body = await listBodyOf(await getProjects(ctx, `?q=${encodeURIComponent('物流の刷新')}`));

    expect(idsOf(body)).toEqual([id]);
  });

  it('開始日は「この日以降」で絞る', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const soon = await createdIdOf(
      await postProject(ctx, { name: `${MARKER}近い`, startDate: '2026-12-01' }),
    );
    await createdIdOf(await postProject(ctx, { name: `${MARKER}遠い`, startDate: '2026-01-01' }));

    const body = await listBodyOf(await getProjects(ctx, '?startFrom=2026-11-01'));

    expect(idsOf(body)).toEqual([soon]);
  });

  it('勤務地で絞れる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, { name: `${MARKER}東京`, prefecture: '13' }),
    );

    const body = await listBodyOf(await getProjects(ctx, '?prefecture=13'));

    expect(idsOf(body)).toContain(id);
  });

  it('🔴 パートナーが条件を指定しても母集団は広がらない（条件は絞るだけ）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    await createdIdOf(
      await postProject(hostCtx, { name: `${MARKER}非公開の東京`, prefecture: '13' }),
    );
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await listBodyOf(await getProjects(ctx, '?prefecture=13'));

    expect(idsOf(body)).not.toContain(TENANT_1.privateProjectId);
    expect(body.total).toBeLessThanOrEqual(1);
  });

  it('🔴 検索条件を空で送っても 400 にならない（素の `<form method="get">` の送信）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await getProjects(ctx, '?q=&status=&startFrom=&prefecture=');

    expect(response.status).toBe(200);
    expect((await listBodyOf(response)).total).toBe(2);
  });

  it('🔴 未知の状態は 400（黙って無視しない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await getProjects(ctx, '?status=UNKNOWN');

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe('VALIDATION');
  });

  it('🔴 UUID でないカーソルは 400（Prisma の `cursor` まで届かせない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getProjects(ctx, '?cursor=not-a-uuid')).status).toBe(400);
  });

  it('🔴 `limit` の上限超過は黙って丸めず 400（docs/05 §6.1）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getProjects(ctx, '?limit=201')).status).toBe(400);
  });
});

describe('必須要件の要約（docs/04 §S-010 の 3 列目）', () => {
  it('必須要件だけが要約に載る（尚可要件は混ざらない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}要約`,
        requirements: [
          { kind: 'MUST', skillId: SKILL_JAVA, freeText: null, requiredYears: 5 },
          { kind: 'NICE', skillId: SKILL_AWS, freeText: null, requiredYears: 1 },
        ],
      }),
    );

    const body = await listBodyOf(await getProjects(ctx));
    const item = body.items.find((row) => row.id === id);
    const requirements = item?.['mustRequirements'] as readonly Record<string, unknown>[];

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.['skillName']).toBe('Java');
    expect(requirements[0]?.['requiredYears']).toBe(5);
    expect(item?.['moreMustRequirementCount']).toBe(0);
  });

  it('4 件以上の必須要件は上位 3 件 + 超過件数になる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postProject(ctx, {
        name: `${MARKER}要約4件`,
        requirements: [1, 2, 3, 4].map((index) => ({
          kind: 'MUST',
          skillId: null,
          freeText: `条件${String(index)}`,
          requiredYears: null,
        })),
      }),
    );

    const body = await listBodyOf(await getProjects(ctx));
    const item = body.items.find((row) => row.id === id);

    expect(item?.['mustRequirements']).toHaveLength(3);
    expect(item?.['moreMustRequirementCount']).toBe(1);
  });

  it('🔴 要約はパートナーからも読める（要件は公開範囲の相手に見せる情報である）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await listBodyOf(await getProjects(ctx));
    const requirements = body.items[0]?.['mustRequirements'] as readonly Record<string, unknown>[];

    // seed の公開案件には必須要件が 1 件ある（`TypeScript 3 年`）。
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.['freeText']).toBe('TypeScript 3 年');
  });
});

describe('🔴 一覧の閲覧は監査ログに記録しない（記録は詳細が持つ。`BR-27` / docs/05 §16.1）', () => {
  it('一覧を読んでも `project.view` が 1 件も増えない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getProjects(ctx)).status).toBe(200);

    expect(await auditRows('project.view')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 🔴 `F-015 AC-2`（案件 1 万件で p95 1 秒）の**前提**の確認
// ---------------------------------------------------------------------------
// 🔴 本タスクの射程は「インデックスと実行計画の確認まで」である（`docs/sprints/SP-06` T-06-03。
//    p95 の判定は `seed:perf` を作る **SP-12 の T-12-02**）。
// 🔴 `EXPLAIN` は**特権接続（`admin`）ではなく `app_tenant`** で実行する —— RLS のポリシー式
//    （C4）が計画に含まれることを見たいため。
// ⚠️ seed の行数（数十行）では Postgres が Seq Scan を選ぶのが**正しい**。ここで
//    「Index Scan が選ばれること」を固定すると、SP-12 の実測とは違う計画を強制することになる。
//    したがって固定するのは ①索引の定義（先頭列が `tenant_id`）②計画が `projects` に閉じており、
//    RLS の述語が効いていること の 2 点である。

/** 一覧の既定の並びの SQL（`PROJECT_LIST_ORDER_BY` と 1 対 1）。 */
const LIST_ORDER_BY_SQL =
  'ORDER BY status DESC, updated_at DESC, start_date ASC NULLS LAST, id DESC';

/**
 * `listProjects` が発行するのと同じ形の SELECT を `app_tenant` で `EXPLAIN` する。
 * 🔴 `where` を書かない（母集団を絞るのは RLS の C4 だけ）。列と並びは実装と一致させる。
 * 🔴 `forceIndex` は `enable_seqscan` を切る。**「いま索引が選ばれるか」ではなく「この
 *    `ORDER BY` を索引で供給できるか」**を見たいためである —— seed の行数（数十行）では
 *    Seq Scan + 全体ソートの方が安いこともあり、そこで計画を固定すると SP-12 の実測
 *    （1 万件）とは違う形を要求してしまう。
 */
async function explainProjectList(
  identity: TenantIdentity,
  options: { readonly forceIndex?: boolean } = {},
): Promise<string> {
  const client = createUnextendedClient(database.tenantUrl);
  try {
    return await runUnextended(
      client,
      {
        tenantId: identity.tenantId,
        partnerCompanyId: identity.partnerCompanyId,
        actorUserId: identity.userId,
      },
      async (tx) => {
        if (options.forceIndex === true) {
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        }
        const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
          `EXPLAIN SELECT id, name, status, headcount, start_date, unit_price_min, unit_price_max,
                          prefecture, remote_mode, updated_at
             FROM projects
            ${LIST_ORDER_BY_SQL}
            LIMIT 51`,
        );
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      },
    );
  } finally {
    await client.$disconnect();
  }
}

describe('🔴 F-015 AC-2 の前提: 索引と実行計画（判定は SP-12 / T-12-02）', () => {
  it('🔴 `projects` の複合索引はいずれも `tenant_id` を先頭列に持つ（docs/03 §3.7.2）', async () => {
    const rows = await admin.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'projects' ORDER BY indexname`;

    for (const row of rows) {
      if (row.indexname === 'projects_pkey') continue;
      expect(row.indexdef, row.indexname).toMatch(/\(tenant_id[,)]/);
    }
    const defs = rows.map((row) => row.indexdef).join('\n');
    // 既定の並び（状態 → 更新日時）と、開始日の絞り込みに対応する索引。
    expect(defs).toContain('(tenant_id, status, updated_at)');
    expect(defs).toContain('(tenant_id, start_date)');
  });

  it('🔴 既定の並びを複合索引が供給できる（`(tenant_id, status, updated_at)` の後方走査）', async () => {
    const plan = await explainProjectList(HOST_1, { forceIndex: true });

    // 🔴 索引の先頭 2 キーが並びの先頭 2 キーと一致するので、後方走査 + 増分ソートになる
    //    （`start_date` / `id` は同値グループの中だけを並べ替える）。
    expect(plan).toContain('Index Scan Backward using projects_tenant_id_status_updated_at_idx');
    expect(plan).toContain('Presorted Key: projects.status, projects.updated_at');
    expect(plan).toContain(
      'Sort Key: projects.status DESC, projects.updated_at DESC, projects.start_date, projects.id DESC',
    );
  });

  it('🔴 一覧の実行計画に RLS（C4）の述語が現れる —— 母集団を決めているのはアプリではない', async () => {
    const plan = await explainProjectList(PARTNER_USER_1);

    expect(plan).toContain('projects');
    // 🔴 第 1 防御（テナント）。`app_tenant_id()` は計画にインライン展開される。
    expect(plan).toContain("current_setting('app.tenant_id'");
    // 🔴 C4 の EXISTS（`project_visibilities` の行の有無）が計画に現れる ——
    //    **アプリの `where` ではなく RLS が母集団を決めている**ことの直接の証拠である。
    expect(plan).toContain('project_visibilities');
    expect(plan).toContain("current_setting('app.partner_company_id'");
    expect(plan).toContain('revoked_at IS NULL');
  });
});
