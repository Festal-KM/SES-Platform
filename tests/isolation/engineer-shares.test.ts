// tests/isolation/engineer-shares.test.ts
// 🔴 SP-08 T-08-02 の完了判定を **DB + RLS 付きで**実証する（`F-016 AC-1`〜`AC-5`）。
//
//   AC-1 エンジニア新規登録直後の共有設定は必ずオフ。**一括で全件をオンにする既定操作が無い**
//   AC-2 🔴 **共有停止の直後にホストが検索しても、その候補が結果に含まれない**
//        （キャッシュ等による遅延表示も含めて現れない）
//   AC-3 共有中でもホストから実名・所属会社名・社内 ID・スキルシートに到達できない
//   AC-4 共有の開始・停止が、実施者・対象・日時とともに監査ログに残る
//   AC-5 🔴 **他のパートナーは、あるパートナーが共有している候補の存在・件数を知れない**
//
// ============================================================================
// 🔴 AC-2 の射程について（本タスクで証明できること / できないこと）
// ============================================================================
// 本タスク（T-08-02）は**共有設定の on / off までである**。ホストが匿名候補を得る経路
// （`app_engineer_is_shared()` / `withSharedCandidateScope` / `AnonymousCandidateView` /
// 検索への混在）は **T-08-03 / T-08-04 / T-08-05** が作る。したがってここで確かめるのは、
// **現時点で存在するホストの読み取り経路のすべてで 0 件であること**である:
//
//   ①`GET /api/engineers`（#15。ホストが実行できる唯一の人材検索）に、共有中でも
//     共有停止後でも、そのパートナーのエンジニアが **1 件も現れない**（件数にも現れない）
//   ②ホスト文脈で `engineer_shares` を直接 `SELECT` しても **0 件**（C3。`BR-56`）
//   ③解除は**同期のトランザクションで確定する**（`revoked_at` が応答の時点で入っている）。
//     ジョブもキューも介さないので、次の読み取りは必ず解除後の状態を読む
//   ④応答に `cache-control: no-store` が付いており、経路上のキャッシュが挟まらない
//
// 🔴 **「匿名候補の一覧から消える」までを通した証明は T-08-09 の E2E #8 が受け持つ**
//    （`docs/sprints/SP-08-anonymous-share.md` §5 T-08-09 のシナリオ 8）。本ファイルは
//    その手前までを固定し、**共有の状態が即時に確定していること**を DB の行で示す。
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`engineers.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけである。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import {
  createUnextendedClient,
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-11T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.44' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const engineersRoute = await import('../../apps/web/app/api/(main)/engineers/route');
const engineerSharesRoute = await import('../../apps/web/app/api/(main)/engineer-shares/route');
const shareRoute = await import('../../apps/web/app/api/(main)/engineers/[id]/share/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
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
const MARKER = 'T0802-';

const SHARE_AUDIT_ACTIONS = ['engineer_share.create', 'engineer_share.update'];

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
/** 🔴 第 1 防御（RLS）単体を見るための素のクライアント（`app_tenant` ロール）。 */
let unextended: UnextendedClient;

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
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

async function postEngineer(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineersRoute.POST(
    new Request('https://app.test/api/engineers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** ホストが実行できる唯一の人材検索（#15 / `S-005`）。 */
async function getEngineers(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineersRoute.GET(new Request(`https://app.test/api/engineers${query}`));
}

async function getShares(ctx: AuthenticatedTenantCtx): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineerSharesRoute.GET(new Request('https://app.test/api/engineer-shares'));
}

async function putShare(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  body: unknown,
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return shareRoute.PUT(
    new Request(`https://app.test/api/engineers/${engineerId}/share`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: engineerId }) },
  );
}

type ShareItem = {
  readonly engineerId: string;
  readonly displayName: string;
  readonly shared: boolean;
  readonly sharedOn: string | null;
  readonly proposalRequestCount: number;
  readonly previewedFields: Record<string, unknown>;
};
type ShareListBody = { readonly items: readonly ShareItem[] };
type ShareUpdateBody = {
  readonly engineerId: string;
  readonly shared: boolean;
  readonly sharedOn: string | null;
  readonly previewedFields: Record<string, unknown>;
};
type EngineerListBody = {
  readonly items: readonly { readonly id: string; readonly displayName: string }[];
  readonly total: number;
};

async function shareListOf(response: Response): Promise<ShareListBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as ShareListBody;
}

async function createdIdOf(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as { readonly id: string }).id;
}

/** 共有中（`revoked_at IS NULL`）の行だけを数える（`app_engineer_is_shared()` と同じ述語）。 */
async function activeShareCount(engineerId: string): Promise<number> {
  return admin.engineerShare.count({ where: { engineerId, revokedAt: null } });
}

async function shareRow(engineerId: string) {
  return admin.engineerShare.findFirst({ where: { engineerId } });
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** パートナー A1 が自社エンジニアを 1 件登録する（共有は付けない）。 */
async function createOwnEngineer(label: string): Promise<string> {
  const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
  return createdIdOf(
    await postEngineer(ctx, {
      displayName: `${MARKER}${label}`,
      availability: 'STANDBY',
      availableFrom: '2026-10-05',
      unitPriceMin: 650000,
      unitPriceMax: 650000,
      prefecture: '13',
      remoteMode: 'PARTIAL_REMOTE',
    }),
  );
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
  unextended = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await unextended?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  await setRole(HOST_1, 'SALES');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await setRole(PARTNER_USER_2, 'PARTNER_SALES');
  // 🔴 テストが作ったエンジニアだけを消す（共有行は FK の CASCADE で一緒に消える）。
  await admin.engineerShare.deleteMany({
    where: { engineer: { displayName: { startsWith: MARKER } } },
  });
  await admin.engineer.deleteMany({ where: { displayName: { startsWith: MARKER } } });
  await admin.auditLog.deleteMany({
    where: { action: { in: [...SHARE_AUDIT_ACTIONS, 'engineer.create'] } },
  });
});

// ---------------------------------------------------------------------------
// AC-1 既定オフ / 一括オンが無い
// ---------------------------------------------------------------------------

describe('🔴 F-016 AC-1: 新規登録直後の共有設定は必ずオフ', () => {
  it('`POST /api/engineers` の直後、`engineer_shares` に行が 1 つも無い', async () => {
    const engineerId = await createOwnEngineer('既定オフ');

    // 🔴 既定オフは「行の非存在」で表現される（docs/05 §3.5 の `EngineerShare` の注記）。
    expect(await admin.engineerShare.count({ where: { engineerId } })).toBe(0);
  });

  it('`GET /api/engineer-shares` に `shared: false` で現れる（一覧からは見える）', async () => {
    const engineerId = await createOwnEngineer('既定オフ一覧');

    const body = await shareListOf(await getShares(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES')));
    const item = body.items.find((row) => row.engineerId === engineerId);
    expect(item).toBeDefined();
    expect(item?.shared).toBe(false);
    expect(item?.sharedOn).toBeNull();
  });

  it('🔴 一括で全件をオンにする経路が存在しない（コレクションに書き込みメソッドが無い）', () => {
    // 🔴 `/api/engineer-shares` は GET だけを export する。POST / PUT / PATCH / DELETE が
    //    生えた瞬間にここが落ちる（「全部共有する」を API 側から作れない）。
    expect(Object.keys(engineerSharesRoute).filter((key) => key === key.toUpperCase()).sort()).toEqual(
      ['GET'],
    );
    // 対象を 1 件に固定しているのは path の `{id}` である（body に配列が無いことは
    // `apps/web/lib/engineer-shares/schemas.test.ts` が固定する）。
    expect(Object.keys(shareRoute).filter((key) => key === key.toUpperCase()).sort()).toEqual(['PUT']);
  });
});

// ---------------------------------------------------------------------------
// 権限（`F-016` 関連ロール / `docs/05` §6.4 #29「ホストは 403」）
// ---------------------------------------------------------------------------

describe('🔴 主導権はパートナーにある（ホスト側ロールは変更できない）', () => {
  it.each<TenantRole>(['OWNER', 'ADMIN', 'SALES'])('ホストの %s は一覧で 403', async (role) => {
    const response = await getShares(await ctxOf(HOST_1, role));
    expect(response.status).toBe(403);
  });

  it('ホストは `PUT /api/engineers/{id}/share` でも 403（行は 1 つもできない）', async () => {
    const engineerId = await createOwnEngineer('ホスト拒否');

    const response = await putShare(await ctxOf(HOST_1, 'ADMIN'), engineerId, { shared: true });

    expect(response.status).toBe(403);
    expect(await admin.engineerShare.count({ where: { engineerId } })).toBe(0);
  });

  /**
   * 🔴 `VIEWER` は読み書きとも 403（`BR-31` / `F-004 AC-6` / `docs/04` §S-015 権限差分
   *    「`VIEWER` は共有設定を変更できない」）。
   *
   * ⚠️ **現時点で「パートナー所属の `VIEWER`」は存在しない。** `CLAUDE.md` §10.1 は
   *    `VIEWER` を**ホスト所属専用**と定め、`memberships_partner_role_check`
   *    （migration 20260903000000）が
   *    `role IN ('PARTNER_ADMIN','PARTNER_SALES') = (partner_company_id IS NOT NULL)` を
   *    DB で強制している（実測: パートナー所属の membership を `VIEWER` にすると
   *    CHECK 違反で INSERT / UPDATE が落ちる）。したがって `docs/04` の当該記述は
   *    現時点では自動的に満たされる。ここでは到達しうる唯一の形（ホスト所属の `VIEWER`）で
   *    403 を固定する。パートナー閲覧専用は `PARTNER_VIEWER`（Phase 2 の `T-16-12`）。
   */
  it('VIEWER は読み書きとも 403（ロール一覧に無い）', async () => {
    const engineerId = await createOwnEngineer('VIEWER 拒否');

    const viewerCtx = await ctxOf(HOST_1, 'VIEWER');
    expect((await getShares(viewerCtx)).status).toBe(403);
    expect((await putShare(viewerCtx, engineerId, { shared: true })).status).toBe(403);
    expect(await admin.engineerShare.count({ where: { engineerId } })).toBe(0);
  });

  it('🔴 他パートナーのエンジニアは共有可にできない（境界外は 404。行もできない）', async () => {
    const engineerId = await createOwnEngineer('他社対象');

    const response = await putShare(
      await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN'),
      engineerId,
      { shared: true },
    );

    expect(response.status).toBe(404);
    expect(await admin.engineerShare.count({ where: { engineerId } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-4 監査ログ
// ---------------------------------------------------------------------------

describe('🔴 F-016 AC-4: 共有の開始・停止が監査ログに残る', () => {
  it('開始は `engineer_share.create`、停止は `engineer_share.update`（実施者・対象・日時つき）', async () => {
    const engineerId = await createOwnEngineer('監査');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    expect((await putShare(ctx, engineerId, { shared: true })).status).toBe(200);
    const created = await auditRows('engineer_share.create');
    expect(created).toHaveLength(1);
    expect(created[0]?.actorKind).toBe('USER');
    expect(created[0]?.actorId).toBe(PARTNER_1_1.userId);
    expect(created[0]?.targetType).toBe('EngineerShare');
    expect(created[0]?.targetId).toBe(engineerId);
    expect(created[0]?.summary).toMatchObject({ operation: 'SHARE', engineerId });
    expect(created[0]?.createdAt).toBeInstanceOf(Date);
    expect(created[0]?.deviceKind).toBe('api');

    expect((await putShare(ctx, engineerId, { shared: false })).status).toBe(200);
    const updated = await auditRows('engineer_share.update');
    expect(updated).toHaveLength(1);
    expect(updated[0]?.summary).toMatchObject({ operation: 'REVOKE', engineerId });
  });

  it('🔴 `summary` に氏名・単価・スキルを載せない（§16.2 の規約）', async () => {
    const engineerId = await createOwnEngineer('監査PII');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    await putShare(ctx, engineerId, { shared: true });

    const [row] = await auditRows('engineer_share.create');
    expect(Object.keys(row?.summary as Record<string, unknown>).sort()).toEqual([
      'engineerId',
      'operation',
    ]);
    expect(JSON.stringify(row?.summary)).not.toContain(MARKER);
  });

  it('🔴 冪等な no-op は記録しない（起きなかった操作を残さない）', async () => {
    const engineerId = await createOwnEngineer('冪等');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    await putShare(ctx, engineerId, { shared: true });
    const again = await putShare(ctx, engineerId, { shared: true });
    expect(again.status).toBe(200);

    expect(await auditRows('engineer_share.create')).toHaveLength(1);
    expect(await auditRows('engineer_share.update')).toHaveLength(0);
    // 行も 1 行のまま（`@@unique(tenant_id, engineer_id)` に衝突しない）。
    expect(await admin.engineerShare.count({ where: { engineerId } })).toBe(1);
  });

  it('解除したエンジニアを共有し直すと `engineer_share.update`（SHARE）が積まれる', async () => {
    const engineerId = await createOwnEngineer('再共有');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    await putShare(ctx, engineerId, { shared: true });
    await putShare(ctx, engineerId, { shared: false });
    expect((await putShare(ctx, engineerId, { shared: true })).status).toBe(200);

    const updated = await auditRows('engineer_share.update');
    expect(updated.map((row) => (row.summary as { operation?: string }).operation)).toEqual([
      'REVOKE',
      'SHARE',
    ]);
    expect((await shareRow(engineerId))?.revokedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-5 他パートナーからの不可視 / AC-3 ホストからの不可視
// ---------------------------------------------------------------------------

describe('🔴 F-016 AC-5 / BR-56: 他のパートナーは共有の存在・件数を知れない', () => {
  it('A1 が共有しても、A2 の一覧には 1 件も現れず件数も動かない', async () => {
    const engineerId = await createOwnEngineer('A2 不可視');
    const partner2Ctx = await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN');
    const before = await shareListOf(await getShares(partner2Ctx));

    await putShare(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'), engineerId, { shared: true });

    const after = await shareListOf(await getShares(partner2Ctx));
    expect(after.items.map((row) => row.engineerId)).not.toContain(engineerId);
    // 🔴 件数にも現れない（存在の示唆を残さない。docs/05 §4.8）。
    expect(after.items).toHaveLength(before.items.length);
    // 対照: A2 自身の共有（シードの opt-in）は見えている ＝ 空振りではない。
    expect(after.items.some((row) => row.engineerId === PARTNER_1_2.engineerId && row.shared)).toBe(
      true,
    );
  });

  it('🔴 ホスト文脈からは `engineer_shares` の行が 1 件も読めない（C3）', async () => {
    await putShare(
      await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'),
      await createOwnEngineer('ホスト直読み'),
      { shared: true },
    );

    const asHost = await runUnextended(
      unextended,
      { tenantId: TENANT_1.tenantId, partnerCompanyId: null, actorUserId: TENANT_1.hostUserId },
      (tx) => tx.engineerShare.findMany(),
    );
    expect(asHost).toHaveLength(0);

    // 対照: 共有元のパートナーからは見える（0 件が「行が無い」からではない）。
    const asPartner = await runUnextended(
      unextended,
      {
        tenantId: TENANT_1.tenantId,
        partnerCompanyId: PARTNER_1_1.partnerCompanyId,
        actorUserId: PARTNER_1_1.userId,
      },
      (tx) => tx.engineerShare.findMany(),
    );
    expect(asPartner.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-2 共有停止の即時反映（🔴 「共有停止の直後にホストが検索して 0 件」）
// ---------------------------------------------------------------------------

describe('🔴 F-016 AC-2: 共有停止は即時に反映される', () => {
  it('共有中でも停止直後でも、ホストの検索にそのエンジニアは 1 件も現れない（件数にも）', async () => {
    const engineerId = await createOwnEngineer('ホスト検索');
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const hostCtx = await ctxOf(HOST_1, 'SALES');

    // --- 共有する -------------------------------------------------------
    expect((await putShare(partnerCtx, engineerId, { shared: true })).status).toBe(200);
    expect(await activeShareCount(engineerId)).toBe(1);

    const whileShared = (await getEngineers(hostCtx).then((r) => r.json())) as EngineerListBody;
    // 🔴 共有しても**実名の行はホストの母集団に入らない**（`F-016 AC-3` / `F-017 AC-1`）。
    //    ホストが到達できるのは T-08-03 以降の匿名候補だけである。
    expect(whileShared.items.map((row) => row.id)).not.toContain(engineerId);
    expect(JSON.stringify(whileShared)).not.toContain(MARKER);

    // --- 停止する（ジョブもキューも介さない）-----------------------------
    const revoke = await putShare(partnerCtx, engineerId, { shared: false });
    expect(revoke.status).toBe(200);
    // 🔴 応答が返った時点で `revoked_at` が入っている ＝ 反映待ちの猶予が存在しない。
    expect(await activeShareCount(engineerId)).toBe(0);
    expect((await shareRow(engineerId))?.revokedAt).not.toBeNull();

    // --- 停止の「直後」にホストが検索する --------------------------------
    const afterRevoke = (await getEngineers(hostCtx).then((r) => r.json())) as EngineerListBody;
    expect(afterRevoke.items.map((row) => row.id)).not.toContain(engineerId);
    expect(afterRevoke.total).toBe(whileShared.total);
    expect(JSON.stringify(afterRevoke)).not.toContain(MARKER);

    // 🔴 ホスト文脈で `engineer_shares` を直接読んでも 0 件のまま（C3）。
    const asHost = await runUnextended(
      unextended,
      { tenantId: TENANT_1.tenantId, partnerCompanyId: null, actorUserId: TENANT_1.hostUserId },
      (tx) => tx.engineerShare.count(),
    );
    expect(asHost).toBe(0);
  });

  it('🔴 応答をキャッシュさせない（`cache-control: no-store`）', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const engineerId = await createOwnEngineer('キャッシュ');

    expect((await getShares(partnerCtx)).headers.get('cache-control')).toBe('no-store');
    expect(
      (await putShare(partnerCtx, engineerId, { shared: true })).headers.get('cache-control'),
    ).toBe('no-store');
  });

  it('パートナー自身の一覧も、停止の直後に `shared: false` へ変わる', async () => {
    const engineerId = await createOwnEngineer('自社反映');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    await putShare(ctx, engineerId, { shared: true });
    const shared = await shareListOf(await getShares(ctx));
    expect(shared.items.find((row) => row.engineerId === engineerId)?.shared).toBe(true);

    await putShare(ctx, engineerId, { shared: false });
    const revoked = await shareListOf(await getShares(ctx));
    const item = revoked.items.find((row) => row.engineerId === engineerId);
    expect(item?.shared).toBe(false);
    expect(item?.sharedOn).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 応答の形（🔴 開示を増やさない）
// ---------------------------------------------------------------------------

describe('🔴 応答が 5 項目 + 更新日を超えない（`BR-54` / `F-017 AC-3`）', () => {
  it('`previewedFields` のキーが固定されている（増えたらここが落ちる）', async () => {
    const engineerId = await createOwnEngineer('プレビュー');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = (await (await putShare(ctx, engineerId, { shared: true })).json()) as ShareUpdateBody;

    expect(Object.keys(body).sort()).toEqual([
      'engineerId',
      'previewedFields',
      'shared',
      'sharedOn',
    ]);
    // 🔴 `RoundedAnonymousAttributes` の 7 フィールド（5 項目 + 更新日。勤務地は
    //    都道府県 + リモート可否の 2 フィールドで 1 項目である）。
    expect(Object.keys(body.previewedFields).sort()).toEqual([
      'availabilityBand',
      'prefecture',
      'priceBand',
      'remoteMode',
      'skills',
      'updatedOn',
      'yearsBand',
    ]);
  });

  it('🔴 丸める前の値（単価 65 万円 / 稼働可能日 / 市区町村）が応答に現れない', async () => {
    const engineerId = await createOwnEngineer('丸め');
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    // 市区町村は `S-007` の入力に無いため、台帳側に直接入れて「落ちる」ことを見る。
    await admin.engineer.update({ where: { id: engineerId }, data: { city: '渋谷区' } });

    const body = (await (await putShare(ctx, engineerId, { shared: true })).json()) as ShareUpdateBody;
    const json = JSON.stringify(body.previewedFields);

    expect(json).not.toContain('渋谷区');
    expect(json).not.toContain('650000');
    expect(json).not.toContain('2026-10-05');
    // 代わりに丸めた区分が入る（空振り防止）。
    expect(body.previewedFields['priceBand']).toEqual({
      kind: 'RANGE',
      fromManYen: 60,
      toManYen: 70,
    });
  });
});
