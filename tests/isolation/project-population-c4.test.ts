// tests/isolation/project-population-c4.test.ts
// 🔴 SP-06 T-06-08「パートナーの案件母集団（C4）の検証」。`F-014 AC-4` / `BR-07` /
//    `CLAUDE.md` §3.1（🔴 パートナー同士が相互に参照できる経路を 1 つも作らない）/ §7 の KPI
//    （パートナー間の相互参照 = **0 件**）。
//
// ============================================================================
// 🔴 このファイルは「実装を書く」タスクではなく「**すでにある C4 が実データで効いているか**」を
//    確かめるタスクの成果物である（SP-02 で入れたポリシーの実証）。
// ============================================================================
// したがって検証の順序を「**アプリの応答 → 母集団の定義 → 素の SQL**」の 3 段にしてある。
//   ①アプリの応答（`#25` / `#27` の実物の Route Handler）に他社の痕跡が無い
//   ②その母集団が「自社宛の**生きている** `ProjectVisibility` の行」と**完全に一致する**
//   ③その一致を作っているのがアプリの `where` ではなく **RLS（C4 / C5）**である
//      （Prisma 拡張を外した素のクライアントで同じ結果になることで示す）
// 🔴 ①だけだと「アプリがたまたま絞っていた」ことと区別できず、③だけだと「アプリが後から
//    足して返している」ことと区別できない。**3 段そろって初めて F-014 AC-4 の証明になる。**
//
// 🔴 本ファイルが引き受ける T-06-08 の観点（`docs/sprints/SP-06` §4）:
//   1. 2 社に公開した案件で、1 社目の詳細・一覧・`total` のどこにも 2 社目の存在が現れない
//      （社名・件数・ID のいずれも 0 件。加えて**応答が 1 バイトも変わらない**ことまで固定する）
//   2. 取引先向けの応答の**キー集合**が固定であり `visibilities` / `visibleToCount` が無い
//      （型の担保は `apps/web/lib/projects/detail-view.types.test.ts` /
//       `apps/web/lib/projects/list-view.types.test.ts`。**片方だけにしない**）
//   3. C4 / C5 が実データで効く（1 社目は自社宛の公開行しか読めず、他社行は `COUNT` でも 0 件）
//   4. 解除済み（`revoked_at` 非 NULL）の公開行が母集団から外れる（C4 の `revoked_at IS NULL`）
//   5. 検索（T-06-04 / T-06-05 の `packages/db/src/search/**`）を通しても母集団が同じ
//
// 🔴 母集団は `seed:isolation`（`packages/db/seed/presets/isolation.ts`）を使う
//    （docs/05 §17.5「DB のフィクスチャは使わない」）。テストが足すのは
//    「2 社目にも公開した行」と「2 社目にだけ公開した案件」の 2 つだけである。
//
// 🔴 **`tests/isolation/projects.test.ts` との分担**: あちらは `F-013` / `F-015` の**機能**
//    （区分の保持・射影・並び順・監査）を、その一部として「他社が見えないこと」を確かめる。
//    本ファイルは逆で、**ポリシー（C4 / C5）そのものが実データで成立していること**を確かめる。
//    したがって主張の形が違う —— あちらの「他社の社名が出ない」に対し、ここでは
//    **「他社の公開状態が変わっても応答のバイト列が変わらない」**まで踏み込む
//    （件数バッジ・並び順・示唆といった間接的な露出を、列挙せずにまとめて否定できる形）。
//    観点 4（解除）だけは T-06-08 の完了判定が明示的に求めるため、意図的に重ねてある。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  projectSearchWhere,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
} from '@ses/db';
import {
  createUnextendedClient,
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  isolationSeedCompanyNames,
  isolationSeedProjectNames,
  ISOLATION_SEED_IDS,
  runSeed,
} from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-06T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.28' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const projectsRoute = await import('../../apps/web/app/api/(main)/projects/route');
const projectRoute = await import('../../apps/web/app/api/(main)/projects/[id]/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
/** 公開されている取引先（seed が `publishedProjectId` を公開している唯一の相手）。 */
const PARTNER_1 = TENANT_1.partners[0];
/** 🔴 **同じテナントの別の取引先**。1 社目からその存在が見えてはならない相手である。 */
const PARTNER_2 = TENANT_1.partners[1];

const PARTNER_2_NAME = isolationSeedCompanyNames(1).partners[1];
const SEED_PROJECT_NAMES = isolationSeedProjectNames(1);

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

/** 素の（Prisma 拡張を適用しない）接続に渡す RLS の文脈（`SET LOCAL` 相当）。 */
const RAW_SCOPE = {
  host: {
    tenantId: TENANT_1.tenantId,
    partnerCompanyId: null,
    actorUserId: TENANT_1.hostUserId,
  },
  partner1: {
    tenantId: TENANT_1.tenantId,
    partnerCompanyId: PARTNER_1.partnerCompanyId,
    actorUserId: PARTNER_1.userId,
  },
  partner2: {
    tenantId: TENANT_1.tenantId,
    partnerCompanyId: PARTNER_2.partnerCompanyId,
    actorUserId: PARTNER_2.userId,
  },
} as const;

/** 🔴 テストが作った行だけを片付けるための目印。 */
const MARKER = 'T0608-';
/** 🔴 2 社目にだけ公開する案件の名前（検索で当たらないことを確かめる文字列でもある）。 */
const PARTNER_2_ONLY_PROJECT_NAME = `${MARKER}2 社目だけに公開した案件`;

/** seed が作った公開範囲の行（テストが足した行だけを消すための基準）。 */
const SEED_VISIBILITY_IDS = [TENANT_1.visibilityId, TENANT_2.visibilityId];

type ListItem = Record<string, unknown> & { readonly id: string };
type ListBody = {
  readonly items: readonly ListItem[];
  readonly total: number;
  readonly nextCursor: string | null;
};
type DetailBody = Record<string, unknown>;
type ErrorBody = { readonly error: { readonly code: string } };

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない（RLS を素通りするため）。 */
let admin: UnextendedClient;
/**
 * 🔴 **第 1 防御（RLS）単体**を見るための素のクライアント（`app_tenant` ロール）。
 *    Prisma 拡張（第 2 防御）を適用しないので、ここで 0 件になるものは
 *    **DB が止めている**ことになる（`rls-classes.test.ts` と同じ道具立て）。
 */
let raw: UnextendedClient;

async function ctxOf(identity: TenantIdentity): Promise<AuthenticatedTenantCtx> {
  const ctx = await buildTenantCtx(
    { ...identity, twoFactorVerified: true },
    { deviceKind: 'api' },
  );
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

/** `GET /api/projects`（#25）を**実物の Route Handler**で叩く。 */
async function getProjects(ctx: AuthenticatedTenantCtx, search = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectsRoute.GET(new Request(`https://app.test/api/projects${search}`));
}

/** `GET /api/projects/{id}`（#27）を**実物の Route Handler**で叩く。 */
async function getProject(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return projectRoute.GET(new Request(`https://app.test/api/projects/${id}`), {
    params: Promise.resolve({ id }),
  });
}

/**
 * 🔴 **200 であることを確かめてから**生テキストを返す。
 *    「前後で 1 バイトも変わらない」の比較は、**両方が 404 でも成立してしまう**
 *    （空振り）。比較の前に「見えている」ことを固定しておく。
 */
async function okTextOf(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  return response.text();
}

async function listBodyOf(response: Response): Promise<ListBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function detailBodyOf(response: Response): Promise<DetailBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as DetailBody;
}

function idsOf(body: ListBody): readonly string[] {
  return body.items.map((item) => item.id);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

/** 公開範囲の行を足す（🔴 経路 1 の唯一の根拠。ゲート結果は seed の 1 件を使い回す）。 */
async function publishTo(projectId: string, partnerCompanyId: string): Promise<void> {
  await admin.projectVisibility.create({
    data: {
      tenantId: TENANT_1.tenantId,
      projectId,
      partnerCompanyId,
      publishedAt: NOW,
      publishedBy: TENANT_1.hostUserId,
      reviewGateId: TENANT_1.publishGateId,
    },
  });
}

/** 公開解除（🔴 行を消さずに `revoked_at` を入れる。C4 が `revoked_at IS NULL` を見る）。 */
async function revokeVisibility(projectId: string, partnerCompanyId: string): Promise<void> {
  const updated = await admin.projectVisibility.updateMany({
    where: { projectId, partnerCompanyId, revokedAt: null },
    data: { revokedAt: NOW },
  });
  if (updated.count !== 1) throw new Error('解除対象の公開行が 1 件ではありません（前提の破綻）。');
}

/** 案件を 1 件作り、指定した取引先にだけ公開する（必須要件も 1 件付ける）。 */
async function createProjectPublishedTo(
  name: string,
  partnerCompanyIds: readonly string[],
): Promise<string> {
  const created = await admin.project.create({
    data: {
      tenantId: TENANT_1.tenantId,
      name,
      status: 'OPEN',
      headcount: 1,
      publicSummary: `${MARKER}公開用の概要`,
      // 🔴 商流情報も入れておく（万一パートナーの応答に混ざったら目印で気づける）。
      endClientName: `${MARKER}エンド企業`,
      internalUnitPrice: 950_000,
      prefecture: '13',
      remoteMode: 'PARTIAL_REMOTE',
    },
    select: { id: true },
  });
  await admin.projectRequirement.create({
    data: {
      tenantId: TENANT_1.tenantId,
      projectId: created.id,
      kind: 'MUST',
      freeText: `${MARKER}必須要件`,
    },
  });
  for (const partnerCompanyId of partnerCompanyIds) {
    await publishTo(created.id, partnerCompanyId);
  }
  return created.id;
}

/**
 * 🔴 **母集団の定義そのもの**（C4 の `USING` 式を、特権接続で人手に書き下したもの）。
 *    アプリの応答をこれと突き合わせることで、「アプリが独自の絞り込みをしていない」ことと
 *    「RLS が定義どおりに効いている」ことを**同時に**言える。
 */
async function livePopulationOf(partnerCompanyId: string): Promise<string[]> {
  const rows = await admin.projectVisibility.findMany({
    where: { tenantId: TENANT_1.tenantId, partnerCompanyId, revokedAt: null },
    select: { projectId: true },
  });
  return sorted(rows.map((row) => row.projectId));
}

/**
 * 🔴 1 社目の応答に**現れてはならない**文字列（`F-014 AC-4`「社名・件数を知る手段を持たない」）。
 *    社名だけでなく **ID と公開行の ID** も入れる —— ID が出れば、そこから件数も追跡もできる。
 */
async function partner2Traces(): Promise<readonly string[]> {
  const rows = await admin.projectVisibility.findMany({
    where: { tenantId: TENANT_1.tenantId, partnerCompanyId: PARTNER_2.partnerCompanyId },
    select: { id: true },
  });
  return [
    PARTNER_2_NAME,
    PARTNER_2.partnerCompanyId,
    PARTNER_2.userId,
    PARTNER_2_ONLY_PROJECT_NAME,
    ...rows.map((row) => row.id),
  ];
}

/** 応答の生テキストに、2 社目の痕跡が 1 つも無いことを確かめる。 */
async function expectNoTraceOfPartner2(serialized: string): Promise<void> {
  for (const trace of await partner2Traces()) {
    expect(serialized).not.toContain(trace);
  }
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
  raw = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await raw?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  // 🔴 テスト間で前提を持ち越さない（公開範囲は seed の 1 行だけに戻す）。
  await admin.project.deleteMany({ where: { name: { startsWith: MARKER } } });
  await admin.projectVisibility.deleteMany({ where: { id: { notIn: SEED_VISIBILITY_IDS } } });
  await admin.projectVisibility.updateMany({ data: { revokedAt: null } });
  await admin.auditLog.deleteMany({ where: { action: 'project.view' } });
});

// ===========================================================================
// ① アプリの応答（`#25` / `#27`）に他社の痕跡が無い
// ===========================================================================

describe('🔴 F-014 AC-4 / BR-07: 2 社に公開した案件で、1 社目の応答に 2 社目が 0 件', () => {
  it('🔴 詳細応答は 2 社目への公開の前後で **1 バイトも変わらない**', async () => {
    const ctx = await ctxOf(PARTNER_USER_1);

    const before = await okTextOf(await getProject(ctx, TENANT_1.publishedProjectId));
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const after = await okTextOf(await getProject(ctx, TENANT_1.publishedProjectId));

    // 🔴 「他社の名前が出ない」より強い主張である: **他社の公開状態が応答に影響しない**。
    //    件数バッジ・並び順・示唆のような「間接的な露出」（`F-004 AC-4`）も、
    //    バイト列が同一である以上まとめて存在しない。
    expect(after).toBe(before);
    await expectNoTraceOfPartner2(after);
  });

  it('🔴 一覧応答も 2 社目への公開の前後で 1 バイトも変わらない（`items` / `total` / `nextCursor`）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1);

    const before = await okTextOf(await getProjects(ctx));
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const after = await okTextOf(await getProjects(ctx));

    // 🔴 空振り防止: 比較しているのは「1 件見えている応答」どうしである。
    expect(before).toContain(TENANT_1.publishedProjectId);
    expect(after).toBe(before);
  });

  it('🔴 2 社目にだけ公開された案件が増えても、1 社目の `items` と `total` は変わらない', async () => {
    const ctx = await ctxOf(PARTNER_USER_1);
    const before = await listBodyOf(await getProjects(ctx));

    await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [PARTNER_2.partnerCompanyId]);

    const after = await listBodyOf(await getProjects(ctx));
    expect(idsOf(after)).toEqual(idsOf(before));
    // 🔴 `total` は一覧と同じ `where` の `COUNT`（docs/05 §4.8）。他社の分は数にも入らない。
    expect(after.total).toBe(before.total);
    await expectNoTraceOfPartner2(JSON.stringify(after));
  });

  it('🔴 詳細・一覧・検索のいずれの応答にも 2 社目の社名 / 会社 ID / 公開行 ID が現れない', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [PARTNER_2.partnerCompanyId]);
    const ctx = await ctxOf(PARTNER_USER_1);

    const responses = [
      await getProject(ctx, TENANT_1.publishedProjectId),
      await getProjects(ctx),
      await getProjects(ctx, `?q=${encodeURIComponent(MARKER)}`),
      await getProjects(ctx, '?status=OPEN'),
      await getProjects(ctx, '?limit=1'),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      await expectNoTraceOfPartner2(await response.text());
    }
  });

  it('ホストには 2 社の公開先が見える（🔴 対照。空振りでないことを示す）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const ctx = await ctxOf(HOST);

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    const visibilities = body['visibilities'] as readonly Record<string, unknown>[];
    expect(visibilities).toHaveLength(2);
    expect(visibilities.map((row) => String(row['partnerCompanyId']))).toContain(
      PARTNER_2.partnerCompanyId,
    );
  });
});

// ===========================================================================
// ② 母集団は「自社宛の生きている公開行」と完全に一致する
// ===========================================================================

describe('🔴 F-015 AC-1 / F-014 AC-1: 母集団は自社宛の生きた `ProjectVisibility` と一致する', () => {
  it('1 社目の一覧（`items` / `total`）が母集団の定義と完全に一致する', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [PARTNER_2.partnerCompanyId]);
    const bothProjectId = await createProjectPublishedTo(`${MARKER}両社に公開した案件`, [
      PARTNER_1.partnerCompanyId,
      PARTNER_2.partnerCompanyId,
    ]);
    const ctx = await ctxOf(PARTNER_USER_1);

    const body = await listBodyOf(await getProjects(ctx));

    const expected = await livePopulationOf(PARTNER_1.partnerCompanyId);
    expect(sorted(idsOf(body))).toEqual(expected);
    expect(expected).toEqual(sorted([TENANT_1.publishedProjectId, bothProjectId]));
    expect(body.total).toBe(expected.length);
  });

  it('2 社目の母集団も同じ規則で独立に決まる（🔴 社ごとに閉じている）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const partner2OnlyId = await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [
      PARTNER_2.partnerCompanyId,
    ]);
    const ctx = await ctxOf(PARTNER_USER_2);

    const body = await listBodyOf(await getProjects(ctx));

    expect(sorted(idsOf(body))).toEqual(await livePopulationOf(PARTNER_2.partnerCompanyId));
    expect(idsOf(body)).toContain(partner2OnlyId);
    // 🔴 未公開案件は誰の母集団にも入らない。
    expect(idsOf(body)).not.toContain(TENANT_1.privateProjectId);
  });

  it('ホストの母集団は公開の有無に依らない（🔴 対照）', async () => {
    const partner2OnlyId = await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [
      PARTNER_2.partnerCompanyId,
    ]);
    const ctx = await ctxOf(HOST);

    const body = await listBodyOf(await getProjects(ctx));

    expect(sorted(idsOf(body))).toEqual(
      sorted([TENANT_1.publishedProjectId, TENANT_1.privateProjectId, partner2OnlyId]),
    );
    expect(body.total).toBe(3);
  });

  it('🔴 母集団の外の案件は ID を直接叩いても 404（詳細も同じ母集団。docs/05 §4.8）', async () => {
    const partner2OnlyId = await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [
      PARTNER_2.partnerCompanyId,
    ]);
    const ctx = await ctxOf(PARTNER_USER_1);

    for (const id of [partner2OnlyId, TENANT_1.privateProjectId, TENANT_2.publishedProjectId]) {
      const response = await getProject(ctx, id);
      expect(response.status).toBe(404);
      // 🔴 「他社に公開されている」ことと「存在しない」ことが応答で区別できない。
      expect(((await response.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    }
  });
});

// ===========================================================================
// ③ 一致を作っているのは RLS である（アプリ経路を通さない素の SELECT）
// ===========================================================================

describe('🔴 C4 / C5 が実データで効く（Prisma 拡張を外した素の SELECT）', () => {
  it('🔴 1 社目の素の `projects` SELECT は自社に公開中の案件だけを返す（C4）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const partner2OnlyId = await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [
      PARTNER_2.partnerCompanyId,
    ]);

    const rows = await runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
      tx.project.findMany({ select: { id: true } }),
    );

    expect(sorted(rows.map((row) => row.id))).toEqual([TENANT_1.publishedProjectId]);
    expect(rows.map((row) => row.id)).not.toContain(partner2OnlyId);
    // 🔴 対照: ホスト文脈では同じ SQL が全件を返す（ポリシーが「何も見せない」壊れ方ではない）。
    const hostRows = await runUnextended(raw, RAW_SCOPE.host, (tx) =>
      tx.project.findMany({ select: { id: true } }),
    );
    expect(hostRows).toHaveLength(3);
  });

  it('`project_requirements` にも同じ C4 が効く（子表から案件の存在が漏れない）', async () => {
    const partner2OnlyId = await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [
      PARTNER_2.partnerCompanyId,
    ]);

    const rows = await runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
      tx.projectRequirement.findMany({ select: { projectId: true } }),
    );

    expect(sorted([...new Set(rows.map((row) => row.projectId))])).toEqual([
      TENANT_1.publishedProjectId,
    ]);
    expect(rows.map((row) => row.projectId)).not.toContain(partner2OnlyId);
  });

  it('🔴 `project_visibilities` は自社宛の行しか読めない（C5）—— 同じ案件の他社行が 0 件', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const partner2Row = await admin.projectVisibility.findFirstOrThrow({
      where: {
        projectId: TENANT_1.publishedProjectId,
        partnerCompanyId: PARTNER_2.partnerCompanyId,
      },
      select: { id: true },
    });

    const rows = await runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
      tx.projectVisibility.findMany({
        where: { projectId: TENANT_1.publishedProjectId },
        select: { id: true, partnerCompanyId: true },
      }),
    );
    const byId = await runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
      tx.projectVisibility.findUnique({ where: { id: partner2Row.id }, select: { id: true } }),
    );

    // 🔴 自社宛の 1 行だけ（この行が読めることが C4 の `EXISTS` の前提でもある。docs/05 §4.4）。
    expect(rows).toHaveLength(1);
    expect(rows[0]?.partnerCompanyId).toBe(PARTNER_1.partnerCompanyId);
    // 🔴 ID を知っていても他社の行には到達できない（推測・総当たりでも 0 件）。
    expect(byId).toBeNull();

    // 🔴 対照: 2 社目からも「自社宛の 1 行」だけが見える（規則が社ごとに対称に効いている）。
    const mirrored = await runUnextended(raw, RAW_SCOPE.partner2, (tx) =>
      tx.projectVisibility.findMany({
        where: { projectId: TENANT_1.publishedProjectId },
        select: { id: true, partnerCompanyId: true },
      }),
    );
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]?.id).toBe(partner2Row.id);
  });

  it('🔴 公開行を **数え上げても** 1 社目には 1 件しか見えない（`COUNT` からも他社に届かない）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);

    const [partnerCount, hostCount] = await Promise.all([
      runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
        tx.projectVisibility.count({ where: { projectId: TENANT_1.publishedProjectId } }),
      ),
      runUnextended(raw, RAW_SCOPE.host, (tx) =>
        tx.projectVisibility.count({ where: { projectId: TENANT_1.publishedProjectId } }),
      ),
    ]);

    // 🔴 「この案件は何社に公開されているか」を、パートナーは DB からも数えられない。
    expect(partnerCount).toBe(1);
    expect(hostCount).toBe(2);
  });

  it('🔴 `partner_companies` はパートナー文脈では自社 1 行だけ（社名の出所そのものが無い）', async () => {
    const rows = await runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
      tx.partnerCompany.findMany({ select: { id: true, name: true } }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(PARTNER_1.partnerCompanyId);
    expect(rows.map((row) => row.name)).not.toContain(PARTNER_2_NAME);
  });
});

// ===========================================================================
// ④ 解除（`revoked_at`）で母集団から外れる
// ===========================================================================

describe('🔴 F-014 処理④: 解除済みの公開行は母集団に入らない（C4 の `revoked_at IS NULL`）', () => {
  it('🔴 自社の公開を解除すると、素の SELECT でも案件と要件が 0 件になる', async () => {
    await revokeVisibility(TENANT_1.publishedProjectId, PARTNER_1.partnerCompanyId);

    const [projects, requirements] = await Promise.all([
      runUnextended(raw, RAW_SCOPE.partner1, (tx) => tx.project.findMany({ select: { id: true } })),
      runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
        tx.projectRequirement.findMany({ select: { id: true } }),
      ),
    ]);

    expect(projects).toEqual([]);
    expect(requirements).toEqual([]);
  });

  it('一覧・`total`・詳細からも即座に消える（詳細の HTTP は 404 のまま）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1);
    await revokeVisibility(TENANT_1.publishedProjectId, PARTNER_1.partnerCompanyId);

    const list = await listBodyOf(await getProjects(ctx));
    const detail = await getProject(ctx, TENANT_1.publishedProjectId);

    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
    expect(detail.status).toBe(404);
    // 🔴 「一度は公開されていた」ことは**自社の事実**なので文言だけが変わる（docs/04 §10.1 S-011）。
    expect(((await detail.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_SHARED');
  });

  it('🔴 2 社目の公開を解除しても、1 社目の応答は 1 バイトも変わらない', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const ctx = await ctxOf(PARTNER_USER_1);
    const before = await okTextOf(await getProjects(ctx));

    await revokeVisibility(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);

    // 🔴 他社への公開の**開始も解除も**、自社からは観測できない（`BR-07`）。
    expect(before).toContain(TENANT_1.publishedProjectId);
    expect(await okTextOf(await getProjects(ctx))).toBe(before);
  });

  it('解除された自社の公開行そのものは自社から読める（C5 は `revoked_at` を見ない）', async () => {
    await revokeVisibility(TENANT_1.publishedProjectId, PARTNER_1.partnerCompanyId);

    const rows = await runUnextended(raw, RAW_SCOPE.partner1, (tx) =>
      tx.projectVisibility.findMany({ select: { partnerCompanyId: true, revokedAt: true } }),
    );

    // 🔴 これは他社の事実ではなく**自社に対する公開の履歴**であり、C5 の射程内である。
    //    案件が見えるかどうかを決めるのは C4（`revoked_at IS NULL`）だけ、という分担を固定する。
    expect(rows).toHaveLength(1);
    expect(rows[0]?.partnerCompanyId).toBe(PARTNER_1.partnerCompanyId);
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});

// ===========================================================================
// ⑤ 検索（T-06-04 / T-06-05 の検索基盤）を通しても母集団は同じ
// ===========================================================================

describe('🔴 F-015 AC-1: 検索経由でも母集団は変わらない（条件は絞るだけ）', () => {
  it('🔴 2 社目にだけ公開された案件は、その名前で検索しても 0 件（`total` も 0）', async () => {
    const partner2OnlyId = await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [
      PARTNER_2.partnerCompanyId,
    ]);
    const search = `?q=${encodeURIComponent('2 社目だけに公開')}`;

    const partner1 = await listBodyOf(await getProjects(await ctxOf(PARTNER_USER_1), search));
    const partner2 = await listBodyOf(await getProjects(await ctxOf(PARTNER_USER_2), search));

    expect(partner1.items).toEqual([]);
    expect(partner1.total).toBe(0);
    // 🔴 対照: 同じ検索語が 2 社目には当たる（検索そのものが壊れているのではない）。
    expect(idsOf(partner2)).toEqual([partner2OnlyId]);
  });

  it('🔴 どの条件を指定しても母集団は広がらない（結果は常に母集団の部分集合）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    await createProjectPublishedTo(PARTNER_2_ONLY_PROJECT_NAME, [PARTNER_2.partnerCompanyId]);
    const ctx = await ctxOf(PARTNER_USER_1);
    const population = new Set(await livePopulationOf(PARTNER_1.partnerCompanyId));

    const searches = [
      '',
      '?status=OPEN',
      '?status=SUCCESSOR_WANTED',
      `?q=${encodeURIComponent('案件')}`,
      `?q=${encodeURIComponent(MARKER)}`,
      '?prefecture=13',
      '?startFrom=2000-01-01',
      '?limit=1',
    ];

    for (const search of searches) {
      const body = await listBodyOf(await getProjects(ctx, search));
      for (const id of idsOf(body)) {
        expect(population.has(id)).toBe(true);
      }
      expect(body.total).toBeLessThanOrEqual(population.size);
      await expectNoTraceOfPartner2(JSON.stringify(body));
    }
  });

  it('🔴 `projectSearchWhere` の述語に境界の条件が 1 つも現れない（絞るのは RLS の役目）', () => {
    const where = JSON.stringify(
      projectSearchWhere({
        status: 'OPEN',
        startFrom: '2026-01-01',
        prefecture: '13',
        q: '案件',
      }),
    );

    // 🔴 検索基盤が境界を「持てる」形になっていたら、条件を消した日に母集団が広がる。
    for (const key of ['tenantId', 'partnerCompanyId', 'visibilit', 'revoked']) {
      expect(where).not.toContain(key);
    }
  });
});

// ===========================================================================
// ⑥ 応答のキー集合（型の担保の実行時の対）
// ===========================================================================
//
// 🔴 型の担保は `apps/web/lib/projects/detail-view.types.test.ts` /
//    `list-view.types.test.ts`（`visibilities?: never` / `visibleToCount?: never`）である。
//    ここで数えるのは**実際に JSON へ出たキー**であり、`not.toContain` ではなく
//    **完全一致**にしてある —— 将来「他社の存在を示す新しいキー」が足された場合、
//    禁止リストに載っていなくてもこのテストが落ちる。

describe('🔴 F-014 AC-4: 取引先向けの応答のキー集合が固定である', () => {
  it('詳細（#27）の取引先向け応答は 12 キーちょうど（`visibilities` / `visibleToCount` が無い）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const ctx = await ctxOf(PARTNER_USER_1);

    const body = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));

    expect(sorted(Object.keys(body))).toEqual(
      sorted([
        'audience',
        'id',
        'name',
        'status',
        'headcount',
        'startDate',
        'unitPriceMin',
        'unitPriceMax',
        'prefecture',
        'remoteMode',
        'publicSummary',
        'requirements',
      ]),
    );
    expect(body['audience']).toBe('PARTNER');
  });

  it('一覧（#25）の取引先向けの 1 件は 13 キーちょうど（公開先の社数を持たない）', async () => {
    await publishTo(TENANT_1.publishedProjectId, PARTNER_2.partnerCompanyId);
    const ctx = await ctxOf(PARTNER_USER_1);

    const body = await listBodyOf(await getProjects(ctx));

    const item = body.items[0];
    expect(item).toBeDefined();
    expect(sorted(Object.keys(item ?? {}))).toEqual(
      sorted([
        'audience',
        'id',
        'name',
        'status',
        'headcount',
        'startDate',
        'unitPriceMin',
        'unitPriceMax',
        'prefecture',
        'remoteMode',
        'mustRequirements',
        'moreMustRequirementCount',
        'updatedOn',
      ]),
    );
    expect(sorted(Object.keys(body))).toEqual(sorted(['items', 'total', 'nextCursor']));
  });

  it('ホストの応答だけが公開先を持つ（🔴 対照。射影がロールで分かれている）', async () => {
    const ctx = await ctxOf(HOST);

    const detail = await detailBodyOf(await getProject(ctx, TENANT_1.publishedProjectId));
    const list = await listBodyOf(await getProjects(ctx));

    expect(Object.keys(detail)).toContain('visibilities');
    expect(Object.keys(list.items[0] ?? {})).toContain('visibleToCount');
    // 🔴 案件名だけは両者に出る（公開範囲の相手に見せてよい情報である）。
    expect(String(detail['name'])).toBe(SEED_PROJECT_NAMES.published);
  });
});
