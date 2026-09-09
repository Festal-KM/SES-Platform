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
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import type { GateRunJob } from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
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

/** 🔴 **積まれたジョブをそのまま**実行する（payload を作り直さない）。 */
async function runEnqueuedGate(index = 0): Promise<GateRunOutcome> {
  const job = enqueued[index];
  if (job === undefined) throw new Error('gate.run が積まれていません（前提の破綻）。');
  const handler = createGateRunHandler({
    now: () => NOW,
    aiClient: createAiClient('mock', { mock: { script: [{ kind: 'output', output: CLEAN_OUTPUT }] } }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
    aiDailyCostLimitUsd: DAILY_LIMIT_USD,
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
