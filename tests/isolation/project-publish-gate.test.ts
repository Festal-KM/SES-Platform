// tests/isolation/project-publish-gate.test.ts
// 🔴 T-07-09 の完了判定を **実 DB + RLS 付きで**、しかも**本番と同じ 2 つの経路をつないで**実証する:
//    `F-014 AC-3`（公開された案件の表示にエンド企業名・内部単価・他社名が含まれる内容は
//    商流層 FAIL となり**公開できない**）と `F-020 AC-1`（テナント外へ共有される対象は、
//    **ゲートを経ずに共有状態へ進めない**）。
//
// 🔴 通す経路は本番と同じである。近道を 1 つも作らない:
//    ①`PUT /api/projects/{id}/visibility`（#28。実物の Route Handler）
//      → `ProjectPublishRequest` を置き、`gate.run` を積む
//    ②`gate.run`（実物のジョブハンドラ）
//      → `loadGateInput` → 3 層 → `ReviewGate` 保存 → `settleProjectPublish`
//    ③公開されたかどうかは **パートナーの文脈で `GET /api/projects`**（C4 の RLS）で見る
//      —— 「行があるか」ではなく「**相手に見えるか**」が `F-014` の要件だからである。
//
// 🔴 実 Anthropic API には接続しない（`createAiClient('mock', …)`。docs/05 §17.5 /
//    `CLAUDE.md` §11.1）。**モックは `MockAnthropicClient` の 1 実装だけ**であり、
//    テスト専用の別モックを書かない。
// 🔴 `gate-inspector`（AI）は常に「何も見つけなかった」と答える。**それでも FAIL になる**ことが
//    重要である —— `F-014 AC-3` の判定は機械的照合（`forbiddenTerms` との完全一致）で決まり、
//    LLM の応答のゆらぎに依存しない（docs/05 §11.9 ③）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRoleModelResolver, createAiClient, type MockAnthropicStep } from '@ses/ai';
import type { GateRunJob } from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  settleProjectPublish,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type DeviceKind,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ISOLATION_SEED_IDS,
  isolationSeedCompanyNames,
  runSeed,
} from '@ses/db/seed';
import { createGateRunHandler, type GateRunOutcome } from '../../apps/worker/src/jobs/gate-run.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-09T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.21' } as const;
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const DAILY_LIMIT_USD = '5.000000';

/** 案件の内部限定情報（公開表示に出れば商流層 FAIL。`F-014 AC-3`）。 */
const END_CLIENT = '株式会社エンドクライアント';
const INTERNAL_UNIT_PRICE = '950000';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const projectsRoute = await import('../../apps/web/app/api/(main)/projects/route');
const projectRoute = await import('../../apps/web/app/api/(main)/projects/[id]/route');
const visibilityRoute = await import(
  '../../apps/web/app/api/(main)/projects/[id]/visibility/route'
);
const { configureGateRunJobQueue, resetGateRunJobQueue } = await import(
  '../../apps/web/lib/jobs/gate-run-queue'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
/** 🔴 低-1（レビュー申し送り）: `settleProjectPublish` の越境を実 DB + RLS で確かめるためだけの参照。 */
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1 = TENANT_1.partners[0];
const PARTNER_2 = TENANT_1.partners[1];
const COMPANY_NAMES = isolationSeedCompanyNames(1);

const HOST: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_USER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1.partnerCompanyId,
  userId: PARTNER_1.userId,
};
const PARTNER_USER_2: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_2.partnerCompanyId,
  userId: PARTNER_2.userId,
};

const MARKER = 'T0709-';

/** `gate-inspector` が「何も見つけなかった」ときの応答（スキーマ適合）。 */
const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

type CreatedBody = { readonly id: string };
type VisibilityBody = {
  readonly reviewGateId: string | null;
  readonly verdict: 'PENDING_GATE' | 'NO_PUBLISH_REQUESTED';
};
type ListBody = { readonly items: readonly { readonly id: string }[]; readonly total: number };

let database: IsolationDatabase;
let admin: UnextendedClient;
/** 🔴 `#28` が積んだジョブ。**テストはこれをそのままワーカーへ渡す**（payload を作り直さない）。 */
const enqueued: GateRunJob[] = [];

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
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

async function postProject(ctx: AuthenticatedTenantCtx, name: string): Promise<string> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await projectsRoute.POST(
    new Request('https://app.test/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, headcount: 1 }),
    }),
  );
  if (response.status !== 201) throw new Error(`案件を作れませんでした（${response.status}）。`);
  return ((await response.json()) as CreatedBody).id;
}

async function putVisibility(
  ctx: AuthenticatedTenantCtx,
  id: string,
  partnerCompanyIds: readonly string[],
): Promise<VisibilityBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await visibilityRoute.PUT(
    new Request(`https://app.test/api/projects/${id}/visibility`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partnerCompanyIds }),
    }),
    { params: Promise.resolve({ id }) },
  );
  if (response.status !== 200) throw new Error(`公開範囲を設定できませんでした（${response.status}）。`);
  return (await response.json()) as VisibilityBody;
}

/** 🔴 パートナーの文脈で「その案件が見えるか」を確かめる（C4 の RLS を通した事実）。 */
async function visibleToPartner(identity: TenantIdentity, projectId: string): Promise<boolean> {
  const ctx = await ctxOf(identity, 'PARTNER_SALES');
  requireTenantCtxMock.mockResolvedValue(ctx);
  const detail = await projectRoute.GET(new Request(`https://app.test/api/projects/${projectId}`), {
    params: Promise.resolve({ id: projectId }),
  });
  requireTenantCtxMock.mockResolvedValue(ctx);
  const list = await projectsRoute.GET(new Request('https://app.test/api/projects'));
  const body = (await list.json()) as ListBody;
  const inList = body.items.some((item) => item.id === projectId);
  // 🔴 詳細と一覧は同じ母集団（C4）を見る。食い違ったら前提が壊れている。
  expect(detail.status === 200).toBe(inList);
  return inList;
}

/**
 * 🔴 **積まれたジョブをそのまま**実行する（payload を作り直さない）。
 *
 * 🔴 T-12-10 で任意引数を足した（既定の挙動は 1 ビットも変わらない）:
 *    - `script` … AI の応答（判定不能 = 「呼んで失敗した」の再現）
 *    - `dailyLimitUsd` … AI の日次コスト上限（保留 = 「呼べなかった」の再現）
 *    **この 2 つを混同しない**（`CLAUDE.md` §4.2 / `F-014 AC-12`）。
 */
async function runEnqueuedGate(
  index = 0,
  options: {
    readonly script?: readonly MockAnthropicStep[];
    readonly dailyLimitUsd?: string;
    /**
     * 🔴 実行時刻。既定は `NOW`（既存の 16 本の挙動は 1 ビットも変わらない）。
     *    **2 回目以降の実行では必ず後ろへずらす** —— `review_gates` の並びは
     *    `COALESCE(executed_at, held_since) DESC, id DESC` であり（`listReviewGateResults`）、
     *    同じ時刻だと「直近の実行」が uuidv7 の乱数部で決まってしまう。
     */
    readonly now?: Date;
  } = {},
): Promise<GateRunOutcome> {
  const job = enqueued[index];
  if (job === undefined) throw new Error('gate.run が積まれていません（前提の破綻）。');
  const handler = createGateRunHandler({
    now: () => options.now ?? NOW,
    aiClient: createAiClient('mock', {
      mock: { script: options.script ?? [{ kind: 'output', output: CLEAN_OUTPUT }] },
    }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
    aiDailyCostLimitUsd: options.dailyLimitUsd ?? DAILY_LIMIT_USD,
  });
  return handler(job, `gate.run.${job.targetType}.${job.targetId}.${job.contentHash}`);
}

/** 案件の内部限定情報と公開用の記載を整える（前提づくり。特権接続）。 */
async function prepareProject(id: string, publicSummary: string): Promise<void> {
  await admin.project.update({
    where: { id },
    data: { publicSummary, endClientName: END_CLIENT, internalUnitPrice: INTERNAL_UNIT_PRICE },
  });
}

/** 要件のフリーテキストを 1 件足す（🔴 公開先が読む欄。docs/05 §11.11 ⑧）。 */
async function addRequirement(projectId: string, freeText: string): Promise<void> {
  await admin.projectRequirement.create({
    data: { tenantId: TENANT_1.tenantId, projectId, kind: 'MUST', freeText },
  });
}

async function visibilityRows(projectId: string) {
  return admin.projectVisibility.findMany({
    where: { projectId },
    select: { partnerCompanyId: true, revokedAt: true, reviewGateId: true, publishedBy: true },
  });
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
      enqueued.push(job);
      return 'ENQUEUED';
    },
    removeFailedJob: async () => 'NOT_FOUND',
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  resetGateRunJobQueue();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  enqueued.length = 0;
});

afterEach(async () => {
  await admin.projectPublishRequest.deleteMany({});
  // 🔴 消す順序が固定である（`project_visibilities.review_gate_id` は `review_gates` への
  //    `ON DELETE RESTRICT` の FK）。テストが作った案件の行だけを、公開範囲 → ゲート結果の順に消す。
  const marked = await admin.project.findMany({
    where: { name: { startsWith: MARKER } },
    select: { id: true },
  });
  const projectIds = marked.map((row) => row.id);
  await admin.projectVisibility.deleteMany({ where: { projectId: { in: projectIds } } });
  await admin.reviewGate.deleteMany({
    where: { targetType: 'PROJECT_PUBLISH', targetId: { in: projectIds } },
  });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_' } } });
  await admin.auditLog.deleteMany({ where: { action: 'project.visibility_change' } });
  await admin.project.deleteMany({ where: { id: { in: projectIds } } });
  await setRole(HOST, 'SALES');
});

/** 公開を要求してゲートまで走らせる（本番の 2 経路をそのまま順に通す）。 */
async function requestAndRunGate(input: {
  readonly name: string;
  readonly publicSummary: string;
  readonly to: readonly string[];
  /** 🔴 案件名そのものを検査対象にするケース用（既定は `MARKER` 付きの無害な名前）。 */
  readonly projectName?: string;
  /** 🔴 要件のフリーテキストを検査対象にするケース用。 */
  readonly requirementText?: string;
}): Promise<{ readonly projectId: string; readonly outcome: GateRunOutcome }> {
  const host = await ctxOf(HOST, 'SALES');
  const projectId = await postProject(host, `${MARKER}${input.projectName ?? input.name}`);
  await prepareProject(projectId, input.publicSummary);
  if (input.requirementText !== undefined) await addRequirement(projectId, input.requirementText);
  const view = await putVisibility(host, projectId, input.to);
  expect(view.verdict).toBe('PENDING_GATE');
  // 🔴 `PUT` の時点では 1 行も無い（同期的に公開が成立する枝が無い）。
  expect(await visibilityRows(projectId)).toHaveLength(0);
  return { projectId, outcome: await runEnqueuedGate() };
}

describe('🔴 F-020 AC-1: 案件の公開はゲートを経ずに成立しない', () => {
  it('`#28` は公開範囲の行を 1 件も作らない（作るのは全層 PASS を見たワーカーだけ）', async () => {
    const host = await ctxOf(HOST, 'SALES');
    const projectId = await postProject(host, `${MARKER}未実行`);
    await prepareProject(projectId, '清潔な公開用の記載です。');

    await putVisibility(host, projectId, [PARTNER_1.partnerCompanyId]);

    expect(await visibilityRows(projectId)).toHaveLength(0);
    // 🔴 ゲートを実行していないので、公開先にも案件は現れない。
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
    // 🔴 「ゲート結果が無いのに公開範囲の行を作る」ことは DB でも不可能である
    //    （`project_visibilities.review_gate_id` は NOT NULL + FK。docs/05 §3.5）。
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO project_visibilities (id, tenant_id, project_id, partner_company_id, published_at, published_by)
         VALUES (gen_random_uuid(), $1, $2, $3, now(), $4)`,
        TENANT_1.tenantId,
        projectId,
        PARTNER_1.partnerCompanyId,
        TENANT_1.hostUserId,
      ),
    ).rejects.toThrow();
  });

  it('🔴 「やっぱり誰にも公開しない」と操作したら、走行中のジョブでも公開されない', async () => {
    const host = await ctxOf(HOST, 'SALES');
    const projectId = await postProject(host, `${MARKER}取り下げ`);
    await prepareProject(projectId, '清潔な公開用の記載です。');

    await putVisibility(host, projectId, [PARTNER_1.partnerCompanyId]);
    // 🔴 ゲートが走る前に取り下げる（新しい公開先が 1 件も無い要求）。
    await putVisibility(host, projectId, []);
    expect(
      await admin.projectPublishRequest.findMany({ where: { projectId } }),
    ).toHaveLength(0);

    // 🔴 先に積まれていたジョブが後から走っても、消費する要求がもう無い。
    expect(await runEnqueuedGate(0)).toEqual({ kind: 'TARGET_NOT_FOUND' });
    expect(await visibilityRows(projectId)).toHaveLength(0);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });

  it('公開要求が差し替えられたら、古い内容の実行は 1 件も公開しない', async () => {
    const host = await ctxOf(HOST, 'SALES');
    const projectId = await postProject(host, `${MARKER}差し替え`);
    await prepareProject(projectId, '清潔な公開用の記載です。');

    await putVisibility(host, projectId, [PARTNER_1.partnerCompanyId]);
    // 公開先を変える ＝ 内容が変わる（別の `contentHash` / 別のジョブ）。
    await putVisibility(host, projectId, [PARTNER_2.partnerCompanyId]);
    expect(enqueued).toHaveLength(2);

    // 🔴 古いジョブ（1 本目）を実行しても、要求はもう存在しない ＝ 何も検査せず何も公開しない。
    expect(await runEnqueuedGate(0)).toEqual({ kind: 'TARGET_NOT_FOUND' });
    expect(await visibilityRows(projectId)).toHaveLength(0);

    // 対照: 新しいジョブは通り、**新しい公開先だけ**が公開される。
    expect(await runEnqueuedGate(1)).toMatchObject({ kind: 'COMPLETED', overall: 'PASS' });
    const rows = await visibilityRows(projectId);
    expect(rows.map((row) => row.partnerCompanyId)).toEqual([PARTNER_2.partnerCompanyId]);
  });
});

describe('🔴 F-014 AC-3: 内部限定の情報が公開文に出ていたら公開されない', () => {
  it('エンド企業名が含まれていれば商流層 FAIL となり、公開範囲の行が 1 件も作られない', async () => {
    const { projectId, outcome } = await requestAndRunGate({
      name: 'エンド企業名',
      publicSummary: `${END_CLIENT} 向けの基幹システム刷新案件です。`,
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({
      kind: 'COMPLETED',
      overall: 'FAIL',
      publish: { kind: 'BLOCKED' },
    });
    expect(await visibilityRows(projectId)).toHaveLength(0);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);

    const gate = await admin.reviewGate.findFirst({
      where: { targetType: 'PROJECT_PUBLISH', targetId: projectId },
    });
    expect(gate?.commerceVerdict).toBe('FAIL');
    expect((gate?.findings as { kind: string; field: string }[])[0]).toMatchObject({
      kind: 'END_CLIENT',
      field: 'public_summary',
    });
    // 🔴 指摘の抜粋にエンド企業名そのものを残さない（`ReviewGate.findings` は画面にも監査にも出る）。
    expect(JSON.stringify(gate?.findings)).not.toContain(END_CLIENT);
  });

  // 🔴 T-07-09 の是正（docs/05 §11.11 ⑧）: 検査する欄は公開文だけではない。
  //    公開先が読む自由入力の欄（案件名 / 公開文 / 要件のフリーテキスト）**すべて**を見なければ、
  //    `F-014 AC-3`「公開された案件の表示に…含まれない」は成立しない。
  it('🔴 案件名にエンド企業名が含まれていれば商流層 FAIL となり、公開されない', async () => {
    const { projectId, outcome } = await requestAndRunGate({
      name: '案件名',
      projectName: `${END_CLIENT} 向け基幹刷新`,
      publicSummary: '清潔な公開用の記載です。',
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'FAIL', publish: { kind: 'BLOCKED' } });
    const gate = await admin.reviewGate.findFirst({
      where: { targetType: 'PROJECT_PUBLISH', targetId: projectId },
    });
    expect((gate?.findings as { kind: string; field: string }[])[0]).toMatchObject({
      kind: 'END_CLIENT',
      field: 'project_name',
    });
    expect(await visibilityRows(projectId)).toHaveLength(0);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });

  it('🔴 要件のフリーテキストに内部単価が含まれていれば商流層 FAIL となり、公開されない', async () => {
    const { projectId, outcome } = await requestAndRunGate({
      name: '要件フリーテキスト',
      publicSummary: '清潔な公開用の記載です。',
      requirementText: `単価 ${INTERNAL_UNIT_PRICE} 円までなら調整可`,
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'FAIL', publish: { kind: 'BLOCKED' } });
    const gate = await admin.reviewGate.findFirst({
      where: { targetType: 'PROJECT_PUBLISH', targetId: projectId },
    });
    expect((gate?.findings as { kind: string; field: string }[])[0]).toMatchObject({
      kind: 'UNIT_PRICE',
      field: 'requirement',
    });
    expect(await visibilityRows(projectId)).toHaveLength(0);
  });

  it('内部単価が含まれていれば商流層 FAIL となり、公開されない', async () => {
    const { projectId, outcome } = await requestAndRunGate({
      name: '内部単価',
      publicSummary: `想定単価は ${INTERNAL_UNIT_PRICE} 円 / 月です。`,
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'FAIL', publish: { kind: 'BLOCKED' } });
    expect(await visibilityRows(projectId)).toHaveLength(0);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });

  it('🔴 公開先に含まれない取引先の社名が含まれていれば FAIL（パートナー間の相互参照 0 件）', async () => {
    const { projectId, outcome } = await requestAndRunGate({
      name: '他社名',
      // 🔴 公開するのは 1 社目だけなのに、2 社目の社名が公開文に書かれている。
      publicSummary: `${COMPANY_NAMES.partners[1]} も参画予定の案件です。`,
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'FAIL', publish: { kind: 'BLOCKED' } });
    const gate = await admin.reviewGate.findFirst({
      where: { targetType: 'PROJECT_PUBLISH', targetId: projectId },
    });
    expect((gate?.findings as { kind: string }[])[0]?.kind).toBe('OTHER_COMPANY');
    expect(await visibilityRows(projectId)).toHaveLength(0);
  });

  it('🔴 F-014 AC-4: 2 社へ公開するなら、**公開先どうしの社名も**出してはならない（BR-07）', async () => {
    // 🔴 同じ公開文が 2 社に届く以上、そこに書かれた 1 社目の社名は 2 社目にも届く ——
    //    それは「パートナー同士が相互に参照できる経路」そのものである（`CLAUDE.md` §3.1 の 🔴）。
    const { projectId, outcome } = await requestAndRunGate({
      name: '公開先どうし',
      publicSummary: `${COMPANY_NAMES.partners[0]} と共同で進める案件です。`,
      to: [PARTNER_1.partnerCompanyId, PARTNER_2.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'FAIL', publish: { kind: 'BLOCKED' } });
    const gate = await admin.reviewGate.findFirst({
      where: { targetType: 'PROJECT_PUBLISH', targetId: projectId },
    });
    expect(gate?.commerceVerdict).toBe('FAIL');
    expect((gate?.findings as { kind: string }[])[0]?.kind).toBe('OTHER_COMPANY');
    // 🔴 1 社も公開されない（2 社目にだけ見せない、という中途半端な成立をさせない）。
    expect(await visibilityRows(projectId)).toHaveLength(0);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
    expect(await visibleToPartner(PARTNER_USER_2, projectId)).toBe(false);
  });

  it('🔴 T-07-09（§11.9 ⑧-5 の解消）: 公開先が 1 社なら、その 1 社の社名は「他社名」ではない', async () => {
    // 🔴 これが中間テーブルを入れた理由そのものである。公開先の一覧に「これから公開する相手」が
    //    含まれていないと、**自分に公開する案件文に自分の社名が書かれているだけで FAIL** になる。
    // 🔴 許すのは**公開先がちょうど 1 社のとき**だけである（2 社以上は上のテストが FAIL を固定する）。
    const { projectId, outcome } = await requestAndRunGate({
      name: '公開先の社名',
      publicSummary: `${COMPANY_NAMES.partners[0]} 向けにご案内する案件です。`,
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'PASS', publish: { kind: 'PUBLISHED' } });
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);

    // 🔴 対照: **同じ公開文**を、その相手を公開先に含めずに要求すれば FAIL になる
    //    （＝ 上の PASS は「他社名の検出が壊れている」からではない）。
    const host = await ctxOf(HOST, 'SALES');
    const otherId = await postProject(host, `${MARKER}公開先の社名-対照`);
    await prepareProject(otherId, `${COMPANY_NAMES.partners[0]} 向けにご案内する案件です。`);
    await putVisibility(host, otherId, [PARTNER_2.partnerCompanyId]);
    expect(await runEnqueuedGate(1)).toMatchObject({ overall: 'FAIL' });
    expect(await visibilityRows(otherId)).toHaveLength(0);
  });

  it('清潔な公開文なら公開が成立し、公開先にだけ現れる（対照。空振りしていないこと）', async () => {
    const { projectId, outcome } = await requestAndRunGate({
      name: '清潔',
      publicSummary: '大手金融の基幹システム刷新。React / TypeScript の経験者を募集します。',
      to: [PARTNER_1.partnerCompanyId],
    });

    expect(outcome).toMatchObject({ overall: 'PASS', publish: { kind: 'PUBLISHED' } });
    const rows = await visibilityRows(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partnerCompanyId: PARTNER_1.partnerCompanyId,
      revokedAt: null,
      // 🔴 公開したのはワーカーではなく、公開範囲を決めた利用者である（`F-014 AC-5`）。
      publishedBy: TENANT_1.hostUserId,
    });
    // 🔴 ゲート結果の行を指している（「どの検査を通って公開されたか」が後から辿れる）。
    expect(rows[0]?.reviewGateId).toBe(
      (outcome as { readonly reviewGateId: string }).reviewGateId,
    );

    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);
    // 🔴 公開先に含まれない取引先には、依然として現れない（`F-014 AC-1` / `AC-4`）。
    expect(await visibleToPartner(PARTNER_USER_2, projectId)).toBe(false);
  });
});

describe('🔴 T-06-07 の決着との整合: 再公開は行を増やさず `revoked_at` を戻す', () => {
  it('公開 → 解除 → 再公開で、行は 1 つのまま `revoked_at` が NULL に戻る', async () => {
    const { projectId } = await requestAndRunGate({
      name: '再公開',
      publicSummary: '清潔な公開用の記載です。',
      to: [PARTNER_1.partnerCompanyId],
    });
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);

    // 解除（境界を狭める操作にゲートは要らない。`F-014` 処理④）。
    const host = await ctxOf(HOST, 'SALES');
    await putVisibility(host, projectId, []);
    expect((await visibilityRows(projectId))[0]?.revokedAt).not.toBeNull();
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);

    // 🔴 もう一度同じ相手へ公開する。**公開文も公開先も 1 文字も変わっていない**ので
    //    内容のハッシュは一致し、ジョブは確定済みの結果（キャッシュ）を引く。
    //    それでも**公開は成立しなければならない**（引き当てを理由に断ると、
    //    直す元データが無いのに再公開が永久にできなくなる。`BR-18`）。
    await putVisibility(host, projectId, [PARTNER_1.partnerCompanyId]);
    const outcome = await runEnqueuedGate(1);
    expect(outcome).toMatchObject({ kind: 'ALREADY_DONE', publish: { kind: 'PUBLISHED' } });

    const rows = await visibilityRows(projectId);
    expect(rows).toHaveLength(1); // 🔴 行が増えていない（@@unique に当たって落ちてもいない）
    expect(rows[0]?.revokedAt).toBeNull();
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);
  });

  it('🔴 ワーカーが確定した直後に「公開先ゼロ」の要求が届いたら、同じ要求の中で解除される', async () => {
    // 🔴 競合の順序そのものを再現する（docs/05 §11.11 ⑩）: ワーカーが公開要求を消費して
    //    公開を確定 → その後に `#28` が「誰にも公開しない」で到着する。
    //    `#28` は**公開要求を消費してから**公開範囲を読むので、ワーカーが作った行が必ず見えており、
    //    同じ要求の中で `revoked` として解除される（公開が残らない）。
    const { projectId } = await requestAndRunGate({
      name: '競合-確定が先',
      publicSummary: '清潔な公開用の記載です。',
      to: [PARTNER_1.partnerCompanyId],
    });
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);

    const host = await ctxOf(HOST, 'SALES');
    const view = await putVisibility(host, projectId, []);

    expect(view.verdict).toBe('NO_PUBLISH_REQUESTED');
    const rows = await visibilityRows(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull(); // 🔴 公開が残っていない
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });

  it('🔴 同じジョブを 2 回実行しても公開は 1 度しか動かない（消費は CAS）', async () => {
    const { projectId } = await requestAndRunGate({
      name: '二重実行',
      publicSummary: '清潔な公開用の記載です。',
      to: [PARTNER_1.partnerCompanyId],
    });

    // 2 回目は公開要求がもう無い ＝ `NOT_PENDING`（行を動かさない）。
    expect(await runEnqueuedGate(0)).toMatchObject({
      kind: 'ALREADY_DONE',
      publish: { kind: 'NOT_PENDING' },
    });
    expect(await visibilityRows(projectId)).toHaveLength(1);
  });
});

describe('🔴 F-014 AC-5: 公開の成立・不成立が監査ログに残る', () => {
  it('要求（保留）と確定（公開 / 阻止）が同じ action の 2 行として残る', async () => {
    const { projectId } = await requestAndRunGate({
      name: '監査',
      publicSummary: '清潔な公開用の記載です。',
      to: [PARTNER_1.partnerCompanyId],
    });

    const rows = await admin.auditLog.findMany({
      where: { action: 'project.visibility_change', targetId: projectId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    // ① 要求（利用者。まだ公開されていない ＝ `pending`）
    expect(rows[0]?.actorKind).toBe('USER');
    expect(rows[0]?.summary).toMatchObject({
      verdict: 'PENDING_GATE',
      pending: PARTNER_1.partnerCompanyId,
      after: '',
    });
    // ② 確定（ワーカー。3 層の判定と公開先が残る）
    expect(rows[1]?.actorKind).toBe('SYSTEM');
    expect(rows[1]?.summary).toMatchObject({
      operation: 'GATE_RESULT',
      verdict: 'PUBLISHED',
      published: PARTNER_1.partnerCompanyId,
      commerceVerdict: 'PASS',
    });
    // 🔴 社名・案件名・公開文を載せない（§16.2）。
    const serialized = JSON.stringify(rows.map((row) => row.summary));
    for (const name of [...COMPANY_NAMES.partners, COMPANY_NAMES.host, END_CLIENT]) {
      expect(serialized).not.toContain(name);
    }
  });

  it('🔴 FAIL のときも記録が残る（「起きなかった公開」を追える）', async () => {
    const { projectId } = await requestAndRunGate({
      name: '監査-阻止',
      publicSummary: `${END_CLIENT} 向けの案件です。`,
      to: [PARTNER_1.partnerCompanyId],
    });

    const rows = await admin.auditLog.findMany({
      where: { action: 'project.visibility_change', targetId: projectId, actorKind: 'SYSTEM' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toMatchObject({
      verdict: 'BLOCKED',
      published: '',
      blocked: PARTNER_1.partnerCompanyId,
      commerceVerdict: 'FAIL',
    });
  });
});

// ============================================================================
// 🔴 T-12-10: 公開後の公開欄の編集と再検査（Issue #42 = 回答②）
//    docs/02 `F-014 AC-6`〜`AC-13` / `UC-26` / A-26、docs/05 §11.11「T-12-10 の実装の決着」⑫ の (a)〜(k)
// ============================================================================
// 🔴 **守るべき 1 行**: 公開の瞬間に検査を通した内容が、後から商流情報を含む状態で取引先に
//    見え続ける経路を塞ぐ。ここで通す経路も本番と同じである（`#26` → `gate.run` →
//    `settleProjectPublish` → パートナー文脈の `#25` / `#27`）。
// 🔴 **上の 16 本は 1 行も変えていない**（`PUBLISH` の挙動は 1 ビットも変わらない。§11.11 ②）。

/** 🔴 2 回目以降の実行の時刻（直近の実行を一意に決めるため。`runEnqueuedGate` の注記）。 */
const LATER = new Date('2026-09-09T06:00:00.000Z');

type PatchBody = {
  readonly id: string;
  readonly recheck: { readonly queued: boolean; readonly reason?: string };
};

/** `PATCH /api/projects/{id}`（#26）。🔴 実物の Route Handler を通す。 */
async function patchProject(
  ctx: AuthenticatedTenantCtx,
  id: string,
  body: Record<string, unknown>,
): Promise<{ readonly status: number; readonly body: PatchBody; readonly raw: string }> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await projectRoute.PATCH(
    new Request(`https://app.test/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw) as PatchBody, raw };
}

/** 🔴 解除の原因まで読む（`revoked_reason` / `revoked_review_gate_id`）。 */
async function visibilityRowsFull(projectId: string) {
  return admin.projectVisibility.findMany({
    where: { projectId },
    select: {
      partnerCompanyId: true,
      revokedAt: true,
      revokedReason: true,
      revokedReviewGateId: true,
    },
  });
}

/** ホスト文脈の `#27`（公開の状態を読む）。 */
async function hostDetail(projectId: string): Promise<Record<string, unknown>> {
  const ctx = await ctxOf(HOST, 'SALES');
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await projectRoute.GET(
    new Request(`https://app.test/api/projects/${projectId}`),
    { params: Promise.resolve({ id: projectId }) },
  );
  return (await response.json()) as Record<string, unknown>;
}

/** ホスト文脈の `#25` の当該行。 */
async function hostListRow(projectId: string): Promise<Record<string, unknown> | undefined> {
  const ctx = await ctxOf(HOST, 'SALES');
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await projectsRoute.GET(new Request('https://app.test/api/projects'));
  const body = (await response.json()) as { readonly items: readonly Record<string, unknown>[] };
  return body.items.find((item) => item.id === projectId);
}

/** 公開中の案件を 1 件作る（本番と同じ 2 経路。以降のテストの前提）。 */
async function publishedProject(name: string): Promise<string> {
  // 🔴 `requestAndRunGate` は**先頭のジョブ**を実行する。1 つのテストで複数の案件を公開するため、
  //    公開のたびにキューを空にして「公開のジョブ = index 0」を保つ。
  enqueued.length = 0;
  const { projectId, outcome } = await requestAndRunGate({
    name,
    publicSummary: '清潔な公開用の記載です。',
    to: [PARTNER_1.partnerCompanyId],
  });
  expect(outcome).toMatchObject({ overall: 'PASS', publish: { kind: 'PUBLISHED' } });
  expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);
  return projectId;
}

describe('🔴 T-12-10 (a)(b): 3 欄の編集で再検査が走り、FAIL なら公開が解除される（AC-6 / AC-7）', () => {
  it('(a) 公開文にエンド企業名を入れて保存すると、再検査 FAIL で公開が落ちる', async () => {
    const projectId = await publishedProject('再検査-公開文');
    const host = await ctxOf(HOST, 'SALES');

    const saved = await patchProject(host, projectId, {
      publicSummary: `${END_CLIENT} 向けの基幹システム刷新案件です。`,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.recheck).toEqual({ queued: true });

    const outcome = await runEnqueuedGate(1);
    expect(outcome).toMatchObject({
      kind: 'COMPLETED',
      overall: 'FAIL',
      publish: { kind: 'REVOKED_BY_RECHECK', partnerCompanyIds: [PARTNER_1.partnerCompanyId] },
    });

    const rows = await visibilityRowsFull(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[0]?.revokedReason).toBe('GATE_RECHECK');
    expect(rows[0]?.revokedReviewGateId).toBe(
      (outcome as { readonly reviewGateId: string }).reviewGateId,
    );

    // 🔴 「見えない = 存在しない」（404・件数 0・並びに痕跡なし。F-004 AC-3）。
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });

  it('(b) 🔴 3 欄それぞれで落ちる（案件名 / 要件のフリーテキスト / 非公開先の社名）', async () => {
    const cases = [
      { label: '案件名', patch: { name: `${MARKER}${END_CLIENT} 向け基幹刷新` } },
      {
        label: '要件のフリーテキスト',
        patch: {
          requirements: [
            {
              kind: 'MUST',
              skillId: null,
              freeText: `単価 ${INTERNAL_UNIT_PRICE} 円まで調整可`,
              requiredYears: null,
            },
          ],
        },
      },
      {
        label: '非公開先の社名',
        patch: { publicSummary: `${COMPANY_NAMES.partners[1]} も参画予定です。` },
      },
    ] as const;

    for (const [index, entry] of cases.entries()) {
      const projectId = await publishedProject(`再検査-3欄-${String(index)}`);
      const host = await ctxOf(HOST, 'SALES');
      const saved = await patchProject(host, projectId, entry.patch);
      expect(saved.body.recheck, entry.label).toEqual({ queued: true });

      const outcome = await runEnqueuedGate(enqueued.length - 1);
      expect(outcome, entry.label).toMatchObject({
        overall: 'FAIL',
        publish: { kind: 'REVOKED_BY_RECHECK' },
      });
      expect(await visibleToPartner(PARTNER_USER_1, projectId), entry.label).toBe(false);
      enqueued.length = 0;
    }
  });
});

describe('🔴 T-12-10 (c)(d): ホストには理由が出て、取引先には 1 バイトも出ない（AC-9 / AC-10）', () => {
  it('(c) #27 の publishState が自動解除と原因の欄を返し、#25 の行が AUTO_REVOKED になる', async () => {
    const projectId = await publishedProject('再検査-理由');
    const host = await ctxOf(HOST, 'SALES');
    await patchProject(host, projectId, { publicSummary: `${END_CLIENT} 向けです。` });
    await runEnqueuedGate(1);

    const detail = await hostDetail(projectId);
    expect(detail.publishState).toMatchObject({
      state: 'AUTO_REVOKED',
      visibleToCount: 0,
      revocation: {
        revokedPartnerCount: 1,
        cause: { kind: 'GATE_FINDINGS', fields: ['publicSummary'] },
      },
    });

    // 🔴 応答に指摘の本文・エンド企業名・取引先の社名が 1 バイトも現れない。
    const serialized = JSON.stringify(detail.publishState);
    expect(serialized).not.toContain(END_CLIENT);
    for (const name of COMPANY_NAMES.partners) expect(serialized).not.toContain(name);
    expect(serialized).not.toContain('excerpt');

    expect(await hostListRow(projectId)).toMatchObject({ publishStatus: 'AUTO_REVOKED' });
  });

  it('(d) 🔴 取引先向けの応答が、人の解除のときと完全に一致する', async () => {
    // ① 人が #28 で解除した案件
    const manualId = await publishedProject('再検査-対照-人の解除');
    const host = await ctxOf(HOST, 'SALES');
    await putVisibility(host, manualId, []);

    // ② 再検査で自動解除された案件
    const autoId = await publishedProject('再検査-対照-自動解除');
    await patchProject(await ctxOf(HOST, 'SALES'), autoId, {
      publicSummary: `${END_CLIENT} 向けです。`,
    });
    await runEnqueuedGate(enqueued.length - 1);

    const partner = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const detailOf = async (id: string): Promise<{ status: number; body: string }> => {
      requireTenantCtxMock.mockResolvedValue(partner);
      const response = await projectRoute.GET(new Request(`https://app.test/api/projects/${id}`), {
        params: Promise.resolve({ id }),
      });
      // 🔴 ID は当然違うので、応答本文から ID を除いて比較する（違いは ID だけであること）。
      return { status: response.status, body: (await response.text()).replaceAll(id, '{id}') };
    };
    const manual = await detailOf(manualId);
    const auto = await detailOf(autoId);
    expect(auto.status).toBe(manual.status);
    expect(auto.body).toBe(manual.body);

    // 🔴 解除を示す語が 1 つも現れない。
    for (const word of ['revoked', 'GATE_RECHECK', 'recheck', 'publishState']) {
      expect(auto.body).not.toContain(word);
    }

    // 🔴 一覧の items / total も同じ（件数・並びに痕跡を残さない）。
    requireTenantCtxMock.mockResolvedValue(partner);
    const list = await projectsRoute.GET(new Request('https://app.test/api/projects'));
    const listBody = (await list.json()) as ListBody;
    expect(listBody.items.some((item) => item.id === manualId)).toBe(false);
    expect(listBody.items.some((item) => item.id === autoId)).toBe(false);
  });
});

describe('🔴 T-12-10 (e): 自動解除が監査に残り、人の解除と区別できる（AC-11）', () => {
  it('SYSTEM / verdict=REVOKED_BY_RECHECK / revoked = 落とした相手', async () => {
    const projectId = await publishedProject('再検査-監査');
    const host = await ctxOf(HOST, 'SALES');
    await patchProject(host, projectId, { publicSummary: `${END_CLIENT} 向けです。` });
    await runEnqueuedGate(1);

    const rows = await admin.auditLog.findMany({
      where: { action: 'project.visibility_change', targetId: projectId, actorKind: 'SYSTEM' },
      orderBy: { createdAt: 'asc' },
    });
    // ①公開の確定（PUBLISHED）②再検査による自動解除（REVOKED_BY_RECHECK）。
    expect(rows).toHaveLength(2);
    const revoke = rows[1]?.summary as Record<string, unknown>;
    expect(revoke).toMatchObject({
      operation: 'GATE_RESULT',
      verdict: 'REVOKED_BY_RECHECK',
      revoked: PARTNER_1.partnerCompanyId,
      published: '',
      blocked: '',
    });
    // 🔴 原因の欄・指摘の本文・契機を summary に書かない（§16.2。監査ログを第 2 の露出面にしない）。
    for (const key of ['fields', 'excerpt', 'runTrigger', 'findings']) {
      expect(Object.keys(revoke)).not.toContain(key);
    }
    expect(JSON.stringify(revoke)).not.toContain(END_CLIENT);

    // 🔴 人の解除（USER）と主体で区別できる。
    const userRows = await admin.auditLog.findMany({
      where: { action: 'project.visibility_change', targetId: projectId, actorKind: 'USER' },
    });
    expect(userRows.length).toBeGreaterThanOrEqual(1);
    expect(
      userRows.every(
        (row) => (row.summary as Record<string, unknown>).verdict !== 'REVOKED_BY_RECHECK',
      ),
    ).toBe(true);
  });
});

describe('🔴 T-12-10 (f): PASS の再検査では行が 1 つも動かない（AC-8）', () => {
  it('公開範囲の行が保存前と同一で、publishState は PUBLISHED（契機は RECHECK）', async () => {
    const projectId = await publishedProject('再検査-PASS');
    const before = await admin.projectVisibility.findMany({
      where: { projectId },
      select: {
        id: true,
        publishedAt: true,
        publishedBy: true,
        reviewGateId: true,
        revokedAt: true,
      },
    });

    const host = await ctxOf(HOST, 'SALES');
    const saved = await patchProject(host, projectId, {
      publicSummary: '清潔なまま、表現だけを変えた公開用の記載です。',
    });
    expect(saved.body.recheck).toEqual({ queued: true });
    expect(await runEnqueuedGate(1, { now: LATER })).toMatchObject({
      overall: 'PASS',
      publish: { kind: 'RECHECK_PASSED', partnerCompanyIds: [] },
    });

    const after = await admin.projectVisibility.findMany({
      where: { projectId },
      select: {
        id: true,
        publishedAt: true,
        publishedBy: true,
        reviewGateId: true,
        revokedAt: true,
      },
    });
    // 🔴 解除 → 再公開の往復が起きていない（review_gate_id の差し替えも無い）。
    expect(after).toEqual(before);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);

    const detail = await hostDetail(projectId);
    expect(detail.publishState).toMatchObject({
      state: 'PUBLISHED',
      visibleToCount: 1,
      recheckRunning: false,
      latestGate: { runTrigger: 'RECHECK', execution: 'DONE' },
    });
  });
});

describe('🔴 T-12-10 (g): 上限到達では公開を解除しない（AC-12）', () => {
  it('保留のまま公開が維持され、復帰後に確定する', async () => {
    const projectId = await publishedProject('再検査-保留');
    const host = await ctxOf(HOST, 'SALES');
    await patchProject(host, projectId, { publicSummary: `${END_CLIENT} 向けです。` });

    // 🔴 日次上限を使い切った状態で実行する（＝ 呼べなかった。呼んで失敗したのではない）。
    const held = await runEnqueuedGate(1, { dailyLimitUsd: '0.000001', now: LATER });
    expect(held.kind).toBe('HELD_AI_COST_LIMIT');

    // 🔴 公開中の行がそのまま（要求も消費されていない）。
    const rows = await visibilityRowsFull(projectId);
    expect(rows[0]?.revokedAt).toBeNull();
    expect(rows[0]?.revokedReason).toBeNull();
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'RECHECK' } })).toBe(1);

    const detail = await hostDetail(projectId);
    expect(detail.publishState).toMatchObject({
      state: 'PUBLISHED_RECHECK_HELD',
      held: { heldReasonKey: 'gate.held.aiCostLimit', limitRaise: 'PLATFORM_OPERATOR' },
    });
    // 🔴 usageHref（S-038 への導線）を足していない（docs/04 U-19）。
    expect(JSON.stringify(detail.publishState)).not.toContain('usageHref');
    // 🔴 保留はゲート FAIL 率の分母・分子に入らない（集計は execution='DONE' のみ）。
    expect(
      await admin.reviewGate.count({
        where: { targetType: 'PROJECT_PUBLISH', targetId: projectId, execution: 'DONE' },
      }),
    ).toBe(1);

    // 🔴 復帰（gate.hold-release は同じ payload・同じ jobId で積み直す）→ ここで初めて確定する。
    expect(await runEnqueuedGate(1, { now: LATER })).toMatchObject({
      overall: 'FAIL',
      publish: { kind: 'REVOKED_BY_RECHECK' },
    });
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });
});

describe('🔴 低-2（レビュー申し送り）: 手順 5-② の復帰経路（要求だけ残ってジョブが積まれない窓）', () => {
  it('保留のまま 3 欄以外だけを保存すると、未消費の RECHECK 要求により gate.run が積み直される', async () => {
    const projectId = await publishedProject('低2-復帰経路');
    const host = await ctxOf(HOST, 'SALES');

    // 🔴 3 欄を変えて RECHECK 要求を作る（index 1 のジョブ）。
    const first = await patchProject(host, projectId, {
      publicSummary: '復帰経路の確認のための変更です。',
    });
    expect(first.body.recheck).toEqual({ queued: true });
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'RECHECK' } })).toBe(1);

    // 🔴 「commit 後の enqueue がプロセス断で失われた」窓を模す —— 要求行は DB に残ったまま、
    //    積まれた記録（`enqueued`）だけを失わせる。
    enqueued.length = 0;
    const usageBefore = await admin.aiUsage.count();

    // 🔴 手順 5-②: ①3 欄は変わっていないが、②未消費の RECHECK 要求が残っているので積み直される。
    const second = await patchProject(host, projectId, { headcount: 4 });
    expect(second.body.recheck).toEqual({ queued: true });
    expect(enqueued).toHaveLength(1);
    // 🔴 積むだけで実行していないので、AI 利用量は増えない（`F-026` の件数を消費しない）。
    expect(await admin.aiUsage.count()).toBe(usageBefore);
  });
});

describe('🔴 T-12-10 (h): 走らない 3 ケース + 公開先の増減（AC-6）', () => {
  it('①未公開の案件の保存 → NOT_PUBLISHED（ジョブも AiUsage も増えない）', async () => {
    const host = await ctxOf(HOST, 'SALES');
    const projectId = await postProject(host, `${MARKER}未公開の保存`);
    enqueued.length = 0;

    const saved = await patchProject(host, projectId, { publicSummary: '公開前の下書きです。' });
    expect(saved.body.recheck).toEqual({ queued: false, reason: 'NOT_PUBLISHED' });
    expect(enqueued).toHaveLength(0);
    expect(await admin.aiUsage.count()).toBe(0);
  });

  it('②3 欄以外だけの保存 → PUBLIC_FIELDS_UNCHANGED', async () => {
    const projectId = await publishedProject('再検査-3欄以外');
    const host = await ctxOf(HOST, 'SALES');
    enqueued.length = 0;
    const usageBefore = await admin.aiUsage.count();

    const saved = await patchProject(host, projectId, {
      headcount: 3,
      startDate: '2026-11-01',
      status: 'FILLED',
      endClientName: END_CLIENT,
      internalUnitPrice: 900000,
      unitPriceMin: 600000,
      unitPriceMax: 800000,
    });
    expect(saved.body.recheck).toEqual({ queued: false, reason: 'PUBLIC_FIELDS_UNCHANGED' });
    expect(enqueued).toHaveLength(0);
    expect(await admin.aiUsage.count()).toBe(usageBefore);
    expect(await admin.projectPublishRequest.count({ where: { projectId } })).toBe(0);
  });

  it('③3 欄を同じ値で再保存 → PUBLIC_FIELDS_UNCHANGED（F-026 も増えない）', async () => {
    const projectId = await publishedProject('再検査-同一値');
    const host = await ctxOf(HOST, 'SALES');
    enqueued.length = 0;
    const usageBefore = await admin.aiUsage.count();

    const current = await admin.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { name: true, publicSummary: true },
    });
    const saved = await patchProject(host, projectId, {
      name: current.name,
      publicSummary: current.publicSummary,
    });
    expect(saved.body.recheck).toEqual({ queued: false, reason: 'PUBLIC_FIELDS_UNCHANGED' });
    expect(enqueued).toHaveLength(0);
    expect(await admin.aiUsage.count()).toBe(usageBefore);
  });

  it('④🔴 #28 で公開先を 1 社追加しても RECHECK の要求は 1 行も作られない', async () => {
    const projectId = await publishedProject('再検査-公開先追加');
    const host = await ctxOf(HOST, 'SALES');

    await putVisibility(host, projectId, [
      PARTNER_1.partnerCompanyId,
      PARTNER_2.partnerCompanyId,
    ]);
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'RECHECK' } })).toBe(0);
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'PUBLISH' } })).toBe(1);
  });
});

describe('🔴 T-12-10 (i): 判定不能は保留ではなく FAIL（A-26 の既定①）', () => {
  it('AI が失敗したら公開が解除され、原因の欄を出さない', async () => {
    const projectId = await publishedProject('再検査-判定不能');
    const host = await ctxOf(HOST, 'SALES');
    await patchProject(host, projectId, { publicSummary: '清潔なまま表現を変えた記載です。' });

    // 🔴 呼んで失敗した（上限で呼べなかったのではない）。
    const outcome = await runEnqueuedGate(1, { script: [{ kind: 'error', error: 'TIMEOUT' }] });
    expect(outcome).toMatchObject({
      kind: 'COMPLETED',
      overall: 'FAIL',
      aiFailed: true,
      publish: { kind: 'REVOKED_BY_RECHECK' },
    });
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);

    const detail = await hostDetail(projectId);
    expect(detail.publishState).toMatchObject({
      state: 'AUTO_REVOKED',
      revocation: { cause: { kind: 'GATE_INCONCLUSIVE' } },
    });
    // 🔴 保留と混ぜない（前者は「呼んで失敗した」、後者は「呼べていない」）。
    expect((detail.publishState as { state: string }).state).not.toBe('PUBLISHED_RECHECK_HELD');
    expect(JSON.stringify(detail.publishState)).not.toContain('fields');
  });
});

describe('🔴 T-12-10 (j): 2 種類の要求が共存し、PUBLISH の PASS が RECHECK を消す（②④）', () => {
  it('編集 → 公開先の追加 で 2 行あり、PUBLISHED で RECHECK が消える', async () => {
    const projectId = await publishedProject('再検査-要求の共存');
    const host = await ctxOf(HOST, 'SALES');

    // ① 編集（RECHECK の行）
    await patchProject(host, projectId, { publicSummary: '清潔なまま表現を変えた記載です。' });
    // ② #28 で 2 社目を追加（PUBLISH の行）
    await putVisibility(host, projectId, [PARTNER_1.partnerCompanyId, PARTNER_2.partnerCompanyId]);

    const requests = await admin.projectPublishRequest.findMany({
      where: { projectId },
      select: { kind: true },
      orderBy: { kind: 'asc' },
    });
    expect(requests.map((row) => row.kind)).toEqual(['PUBLISH', 'RECHECK']);

    // 🔴 PUBLISH を PASS で確定 → 2 社目が公開され、同じトランザクションで RECHECK が消える。
    const publishJob = enqueued.length - 1;
    expect(await runEnqueuedGate(publishJob)).toMatchObject({ publish: { kind: 'PUBLISHED' } });
    expect(await admin.projectPublishRequest.count({ where: { projectId } })).toBe(0);
    expect(await visibleToPartner(PARTNER_USER_2, projectId)).toBe(true);
  });

  it('🔴 BLOCKED のときは RECHECK の行が残る（再検査はまだ要る）', async () => {
    const projectId = await publishedProject('再検査-共存-BLOCKED');
    const host = await ctxOf(HOST, 'SALES');

    // 公開文に 1 社目の社名を入れる（2 社に公開すると「他社名」になり FAIL する。§11.11 ⑨）。
    await patchProject(host, projectId, {
      publicSummary: `${COMPANY_NAMES.partners[0]} と共同で進める案件です。`,
    });
    await putVisibility(host, projectId, [PARTNER_1.partnerCompanyId, PARTNER_2.partnerCompanyId]);

    const publishJob = enqueued.length - 1;
    expect(await runEnqueuedGate(publishJob)).toMatchObject({ publish: { kind: 'BLOCKED' } });
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'RECHECK' } })).toBe(1);
    // 🔴 PUBLISH の FAIL では公開中の行は落ちない（判定は audience に対する相対である）。
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(true);
  });

  it('🔴 #28 の取り下げが RECHECK の行を消さない（残った公開先に未検査の内容を見せない）', async () => {
    const projectId = await publishedProject('再検査-取り下げと共存');
    const host = await ctxOf(HOST, 'SALES');
    await patchProject(host, projectId, { publicSummary: '清潔なまま表現を変えた記載です。' });

    // 公開先を 1 社解除する（#28 は kind='PUBLISH' の行しか触らない）。
    await putVisibility(host, projectId, []);
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'RECHECK' } })).toBe(1);
  });
});

describe('🔴 T-12-10 (k): 迂回の入口が存在しない（AC-9 / AC-13）', () => {
  it('#26 に force / skipGate / keepPublished を渡しても応答が 1 バイトも変わらない', async () => {
    const projectId = await publishedProject('再検査-迂回');
    const host = await ctxOf(HOST, 'SALES');

    const plain = await patchProject(host, projectId, { headcount: 2 });
    const withFlags = await patchProject(host, projectId, {
      headcount: 2,
      force: true,
      skipGate: true,
      keepPublished: true,
      ignoreFindings: true,
    });
    expect(withFlags.status).toBe(plain.status);
    expect(withFlags.raw).toBe(plain.raw);
    expect(withFlags.body.recheck).toEqual({ queued: false, reason: 'PUBLIC_FIELDS_UNCHANGED' });
  });

  it('🔴 FAIL の後に同じ内容で保存し直しても公開は戻らない（直せるのは元データだけ）', async () => {
    const projectId = await publishedProject('再検査-復帰は元データのみ');
    const host = await ctxOf(HOST, 'SALES');
    await patchProject(host, projectId, { publicSummary: `${END_CLIENT} 向けです。` });
    await runEnqueuedGate(1);
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);

    // 直さずに保存し直す（3 欄は変わらない）。公開は戻らない。
    const again = await patchProject(host, projectId, { headcount: 5 });
    expect(again.body.recheck).toEqual({ queued: false, reason: 'NOT_PUBLISHED' });
    expect(await visibleToPartner(PARTNER_USER_1, projectId)).toBe(false);
  });
});

describe('🔴 低-1（レビュー申し送り）: RECHECK の生 SQL はテナント越境で 1 行も動かさない', () => {
  it('テナント 2 の ctx でテナント 1 の案件 ID を渡すと NOT_PENDING になり、公開範囲の行が動かない', async () => {
    const projectId = await publishedProject('低1-越境確認');
    const host = await ctxOf(HOST, 'SALES');

    // 🔴 未消費の RECHECK 要求（`contentHash` 込み）をテナント 1 に作る。
    const patched = await patchProject(host, projectId, {
      publicSummary: '越境確認のための変更です。',
    });
    expect(patched.body.recheck).toEqual({ queued: true });
    const pendingRequest = await admin.projectPublishRequest.findFirstOrThrow({
      where: { projectId, kind: 'RECHECK' },
      select: { contentHash: true },
    });

    const before = await admin.projectVisibility.findMany({
      where: { projectId },
      select: { partnerCompanyId: true, revokedAt: true, revokedReason: true, revokedReviewGateId: true },
      orderBy: { partnerCompanyId: 'asc' },
    });

    // 🔴 テナント 2 の ctx で、テナント 1 の案件 ID + 実在する contentHash を渡して消費を試みる。
    const crossTenantCtx = systemTenantCtx(TENANT_2.tenantId, {
      queue: 'gate.run',
      jobId: 'low-1-cross-tenant-check',
    });
    const settlement = await settleProjectPublish(crossTenantCtx, {
      projectId,
      contentHash: pendingRequest.contentHash,
      reviewGateId: '00000000-0000-7000-8000-000000000000',
      piiVerdict: 'PASS',
      commerceVerdict: 'PASS',
      consistencyVerdict: 'PASS',
      now: NOW,
    });
    expect(settlement).toEqual({ kind: 'NOT_PENDING' });

    // 🔴 テナント 1 の要求も公開範囲の行も 1 つも動いていない
    //    （findFirst + CAS が第 2 防御として先にテナントを確定させ、生 SQL に到達しない）。
    expect(await admin.projectPublishRequest.count({ where: { projectId, kind: 'RECHECK' } })).toBe(1);
    const after = await admin.projectVisibility.findMany({
      where: { projectId },
      select: { partnerCompanyId: true, revokedAt: true, revokedReason: true, revokedReviewGateId: true },
      orderBy: { partnerCompanyId: 'asc' },
    });
    expect(after).toEqual(before);
  });
});
