// tests/isolation/engineer-shares.test.ts
// 🔴 SP-08 T-08-02 の完了判定を **DB + RLS 付きで**実証する（`F-016 AC-1`〜`AC-5`）。
//    → 🔴 T-11-11（`S-015` の検索・ページング。docs/05 §6.4「#29 の改訂」）の結合テスト 6 件を**末尾に追加**した
//      （既存の `it` は変えていない。`getShares` に任意の query 引数を足しただけ）。
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

async function getShares(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineerSharesRoute.GET(new Request(`https://app.test/api/engineer-shares${query}`));
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
type ShareListBody = { readonly items: readonly ShareItem[]; readonly nextCursor: string | null };
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

// ---------------------------------------------------------------------------
// 🔴 T-11-11: 検索 3 条件 + カーソルページング（docs/05 §6.4「#29 の改訂」の「結合テストの追加点」①〜⑥）
// ---------------------------------------------------------------------------
//
// 台帳 250 件のパートナー（`PARTNER_1_1`）で、**201 件目以降も検索とページングで到達でき、共有可 / 解除ができる**
// （`T-11-11` 完了判定 ②）。母集団は RLS C3 の自社行であり、他社の行は `q` に一致しても 0 件（③）。
// 応答は `{ items, nextCursor }` の 2 キーで総件数を返さない（②）。カーソルはキーセットで、境目の行が
// 解除されても次ページが空にならない（④）。

/** 台帳の基準時刻。`updated_at` は `NNN` 秒ずつ過去に置く（001 が最新 = `updated_at DESC` で 1 件目）。 */
const LEDGER_BASE = new Date('2026-09-01T00:00:00.000Z');
const LEDGER_PREFIX = `${MARKER}台帳 `;
/** `q` に渡す語（末尾の空白は `trim` されるので、接頭辞の空白を除いた語で探す）。 */
const LEDGER_TERM = encodeURIComponent(LEDGER_PREFIX.trim());

function ledgerName(seq: number): string {
  return `${LEDGER_PREFIX}${String(seq).padStart(3, '0')}`;
}

/**
 * 🔴 台帳 N 件を `PARTNER_1_1` の所有として直接挿入する（`POST /api/engineers` を 250 回叩くのは前提づくりであり、
 *    検証の対象ではない）。`updated_at` を明示して並びを決定的にする。`available_from` は 3 通り
 *    （NULL / 2026-10-01 / 2026-12-01）を巡回させ、⑤の絞り込みを見られるようにする。
 *
 * @returns 作成した行の ID（`displayName` の昇順 = `台帳 001` から）。
 */
async function seedLedger(count: number): Promise<readonly string[]> {
  const rows = Array.from({ length: count }, (_, index) => {
    const seq = index + 1;
    const availableFrom =
      seq % 3 === 0
        ? null
        : seq % 3 === 1
          ? new Date('2026-10-01T00:00:00.000Z')
          : new Date('2026-12-01T00:00:00.000Z');
    return {
      tenantId: TENANT_1.tenantId,
      ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      displayName: ledgerName(seq),
      availability: 'STANDBY',
      availableFrom,
      prefecture: '13',
      updatedAt: new Date(LEDGER_BASE.getTime() - seq * 1000),
    };
  });
  await admin.engineer.createMany({ data: rows });
  const created = await admin.engineer.findMany({
    where: { displayName: { startsWith: LEDGER_PREFIX } },
    select: { id: true },
    orderBy: [{ displayName: 'asc' }],
  });
  return created.map((row) => row.id);
}

/** 共有中の行を直接立てる（前提づくり）。`shared_at` は `index + 1` 秒ずつ過去（先頭が最新）。 */
async function seedShares(engineerIds: readonly string[]): Promise<void> {
  await admin.engineerShare.createMany({
    data: engineerIds.map((engineerId, index) => ({
      tenantId: TENANT_1.tenantId,
      engineerId,
      partnerCompanyId: PARTNER_1_1.partnerCompanyId,
      sharedAt: new Date(LEDGER_BASE.getTime() - (index + 1) * 1000),
      revokedAt: null,
      sharedBy: PARTNER_1_1.userId,
    })),
  });
}

/** `nextCursor` を辿って全件を集める（ページごとの応答も返す）。`baseQuery` は `?` から始まる。 */
async function walkPages(
  ctx: AuthenticatedTenantCtx,
  baseQuery: string,
  startCursor: string | null = null,
): Promise<{ readonly pages: readonly ShareListBody[]; readonly items: readonly ShareItem[] }> {
  const pages: ShareListBody[] = [];
  let cursor: string | null = startCursor;
  for (let guard = 0; guard < 50; guard += 1) {
    const query = cursor === null ? baseQuery : `${baseQuery}&cursor=${encodeURIComponent(cursor)}`;
    const body = await shareListOf(await getShares(ctx, query));
    pages.push(body);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  return { pages, items: pages.flatMap((page) => page.items) };
}

async function errorCodeOf(response: Response): Promise<string> {
  return ((await response.json()) as { readonly error: { readonly code: string } }).error.code;
}

describe('🔴 T-11-11 ①: 台帳 250 件で 201 件目を氏名で見つけて共有 → 解除できる（F-016 AC-2 が台帳の規模で破れない）', () => {
  it('`q` で 201 件目が 1 件だけ見つかり、共有すると `shared=true` の 1 ページ目に出、解除すると消える', async () => {
    const ids = await seedLedger(250);
    expect(ids).toHaveLength(250);
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    // 検索なしの `すべて` は 50 件で切れ、201 件目は 1 ページ目に居ない（旧実装の上限 200 でも到達できなかった位置）。
    const firstPage = await shareListOf(await getShares(ctx));
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.items.map((row) => row.displayName)).not.toContain(ledgerName(201));

    // 氏名で探す（部分一致。`台帳 201` は 1 件だけ）。
    const found = await shareListOf(await getShares(ctx, `?q=${encodeURIComponent('台帳 201')}`));
    expect(found.items.map((row) => row.displayName)).toEqual([ledgerName(201)]);
    const target = found.items[0] as ShareItem;
    expect(target.shared).toBe(false);

    // 共有可にする → `shared=true` の 1 ページ目に出る（最近共有した人が先）。
    expect((await putShare(ctx, target.engineerId, { shared: true })).status).toBe(200);
    const shared = await shareListOf(await getShares(ctx, '?shared=true'));
    expect(shared.items[0]?.engineerId).toBe(target.engineerId);
    expect(shared.items[0]?.shared).toBe(true);
    expect(shared.items[0]?.sharedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 解除する → `shared=true` から消え、`shared=false` に（氏名で）出る。
    expect((await putShare(ctx, target.engineerId, { shared: false })).status).toBe(200);
    const afterRevoke = await walkPages(ctx, '?shared=true&limit=200');
    expect(afterRevoke.items.map((row) => row.engineerId)).not.toContain(target.engineerId);
    const notShared = await shareListOf(
      await getShares(ctx, `?shared=false&q=${encodeURIComponent('台帳 201')}`),
    );
    expect(notShared.items.map((row) => row.engineerId)).toEqual([target.engineerId]);
    expect(notShared.items[0]?.shared).toBe(false);
    expect(notShared.items[0]?.sharedOn).toBeNull();
  });
});

describe('🔴 T-11-11 ②: `shared=false` の母集団 = 台帳 − 共有中。応答は 2 キーで総件数を返さない', () => {
  it('`nextCursor` を辿った合計が「自社の台帳 − 共有中」と一致し、`Object.keys(body)` は `[items, nextCursor]`', async () => {
    const ids = await seedLedger(250);
    await seedShares(ids.slice(0, 7));
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const expected = await admin.engineer.count({
      where: {
        ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
        engineerShares: { none: { revokedAt: null } },
      },
    });
    const { pages, items } = await walkPages(ctx, '?shared=false&limit=100');

    expect(items).toHaveLength(expected);
    expect(items.every((row) => !row.shared && row.sharedOn === null)).toBe(true);
    expect(new Set(items.map((row) => row.engineerId)).size).toBe(expected);
    // 🔴 応答のトップレベルは 2 キーだけ（`total` / `remaining` / `ledgerEmpty` が無い）。
    for (const page of pages) {
      expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor']);
    }
    expect(pages.length).toBe(Math.ceil(expected / 100));
  });
});

describe('🔴 T-11-11 ③: 他社の行は `q` に一致しても 0 件（RLS C3。F-016 AC-5）', () => {
  it('同じ氏名を A1 / A2 / ホストに作り、A1 の検索には A1 の行だけが出る', async () => {
    const name = `${MARKER}同名 山田`;
    await admin.engineer.createMany({
      data: [
        {
          tenantId: TENANT_1.tenantId,
          ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
          displayName: name,
          availability: 'STANDBY',
        },
        {
          tenantId: TENANT_1.tenantId,
          ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
          displayName: name,
          availability: 'STANDBY',
        },
        // ホスト所有の同名も混ぜる（パートナーからはホストの台帳も見えない）。
        {
          tenantId: TENANT_1.tenantId,
          ownerPartnerCompanyId: null,
          displayName: name,
          availability: 'STANDBY',
        },
      ],
    });
    const own = await admin.engineer.findFirst({
      where: { displayName: name, ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      select: { id: true },
    });
    const other = await admin.engineer.findFirst({
      where: { displayName: name, ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId },
      select: { id: true },
    });
    const term = encodeURIComponent('同名');

    const asA1 = await shareListOf(await getShares(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'), `?q=${term}`));
    expect(asA1.items.map((row) => row.engineerId)).toEqual([own?.id]);
    expect(asA1.nextCursor).toBeNull();

    // 対照: A2 からは A2 の行だけ（0 件が「行が無い」からではない）。
    const asA2 = await shareListOf(await getShares(await ctxOf(PARTNER_USER_2, 'PARTNER_SALES'), `?q=${term}`));
    expect(asA2.items.map((row) => row.engineerId)).toEqual([other?.id]);

    // `shared=false` / `shared=true` でも同じ（駆動表が違っても母集団は同じ RLS）。
    const a1Ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const asA1NotShared = await shareListOf(await getShares(a1Ctx, `?shared=false&q=${term}`));
    expect(asA1NotShared.items.map((row) => row.engineerId)).toEqual([own?.id]);
    expect((await putShare(a1Ctx, own?.id ?? '', { shared: true })).status).toBe(200);
    const asA1Shared = await shareListOf(await getShares(a1Ctx, `?shared=true&q=${term}`));
    expect(asA1Shared.items.map((row) => row.engineerId)).toEqual([own?.id]);
    // A2 の共有中の一覧に A1 の共有は現れない。
    const asA2Shared = await shareListOf(
      await getShares(await ctxOf(PARTNER_USER_2, 'PARTNER_SALES'), `?shared=true&q=${term}`),
    );
    expect(asA2Shared.items).toHaveLength(0);
  });
});

describe('🔴 T-11-11 ④: カーソル（キーセット。重複・欠落なし / 形・組み合わせの拒否 / 境目の行が消えても次ページが空にならない）', () => {
  it('`limit=50` で全ページを辿って重複・欠落が無い（`shared=false` と `すべて`）', async () => {
    const ids = await seedLedger(250);
    await seedShares(ids.slice(10, 20));
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const all = await walkPages(ctx, '?limit=50');
    const expectedAll = await admin.engineer.count({
      where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
    });
    expect(all.items).toHaveLength(expectedAll);
    expect(new Set(all.items.map((row) => row.engineerId)).size).toBe(expectedAll);
    expect(all.pages.length).toBeGreaterThanOrEqual(5);
    for (const page of all.pages.slice(0, -1)) expect(page.items).toHaveLength(50);

    // 共有中はシードの 1 件（`PARTNER_1_1.engineerId`）+ ここで立てた 10 件。
    const expectedNotShared = await admin.engineer.count({
      where: {
        ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
        engineerShares: { none: { revokedAt: null } },
      },
    });
    expect(expectedNotShared).toBeLessThanOrEqual(expectedAll - 10);
    const notShared = await walkPages(ctx, '?shared=false&limit=50');
    expect(notShared.items).toHaveLength(expectedNotShared);
    expect(new Set(notShared.items.map((row) => row.engineerId)).size).toBe(expectedNotShared);
  });

  it('形が違うカーソルは 400（UUID 単体 / 並びのキー / ごみ）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    for (const cursor of [
      '01930000-0000-7000-8000-0000000000a1',
      '0:2026-09-08:AAAAAAAAAAAAAAAAAAAAAA',
      'garbage',
      "s:0001757000000000:' OR 1=1 --",
    ]) {
      const response = await getShares(ctx, `?shared=true&cursor=${encodeURIComponent(cursor)}`);
      expect(response.status, cursor).toBe(400);
    }
  });

  it('🔴 `mode` と `shared` の組み合わせが合わないカーソルは 400 `CURSOR_MODE_MISMATCH`（黙って先頭に戻さない）', async () => {
    const ids = await seedLedger(120);
    await seedShares(ids.slice(0, 60));
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const sharedPage = await shareListOf(await getShares(ctx, '?shared=true&limit=50'));
    const sCursor = sharedPage.nextCursor as string;
    expect(sCursor.startsWith('s:')).toBe(true);
    const ledgerPage = await shareListOf(await getShares(ctx, '?shared=false&limit=50'));
    const uCursor = ledgerPage.nextCursor as string;
    expect(uCursor.startsWith('u:')).toBe(true);

    // `shared=true` に `u:` / `shared=false`・省略 に `s:`。
    const mismatches = [
      `?shared=true&cursor=${encodeURIComponent(uCursor)}`,
      `?shared=false&cursor=${encodeURIComponent(sCursor)}`,
      `?cursor=${encodeURIComponent(sCursor)}`,
    ];
    for (const query of mismatches) {
      const response = await getShares(ctx, query);
      expect(response.status, query).toBe(400);
      expect(await errorCodeOf(response), query).toBe('CURSOR_MODE_MISMATCH');
    }
    // 対照: 合う組み合わせは 200。
    expect((await getShares(ctx, `?shared=true&cursor=${encodeURIComponent(sCursor)}`)).status).toBe(200);
    expect((await getShares(ctx, `?shared=false&cursor=${encodeURIComponent(uCursor)}`)).status).toBe(200);
  });

  it('🔴 2 ページ目を読む前に境目の行（1 ページ目の最後）を解除しても、次ページが空にならず重複もしない', async () => {
    const ids = await seedLedger(120);
    await seedShares(ids.slice(0, 110));
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const first = await shareListOf(await getShares(ctx, '?shared=true&limit=50'));
    expect(first.items).toHaveLength(50);
    const boundary = first.items[49] as ShareItem;

    // 境目の行を解除する（1 件ずつ解除する画面では通常動作）。
    expect((await putShare(ctx, boundary.engineerId, { shared: false })).status).toBe(200);

    const rest = await walkPages(ctx, '?shared=true&limit=50', first.nextCursor);
    const second = rest.pages[0] as ShareListBody;
    expect(second.items).toHaveLength(50);
    const firstIds = new Set(first.items.map((row) => row.engineerId));
    expect(second.items.some((row) => firstIds.has(row.engineerId))).toBe(false);
    expect(rest.items.map((row) => row.engineerId)).not.toContain(boundary.engineerId);

    // 1 ページ目（解除した境目の行を除く）+ 残りで、共有中の全件にちょうど到達する（欠落なし）。
    const seen = new Set([...first.items, ...rest.items].map((row) => row.engineerId));
    seen.delete(boundary.engineerId);
    const expected = await admin.engineerShare.count({
      where: { partnerCompanyId: PARTNER_1_1.partnerCompanyId, revokedAt: null },
    });
    expect(seen.size).toBe(expected);
  });
});

describe('🔴 T-11-11 ⑤: `availableBy` は `available_from <= 日付` で絞り、NULL の行を落とす', () => {
  it('2026-11-01 までに稼働可能 = `available_from` が 10/01 の行だけ（12/01 と NULL は落ちる）', async () => {
    await seedLedger(30);
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const { items } = await walkPages(ctx, `?availableBy=2026-11-01&q=${LEDGER_TERM}&limit=100`);
    const names = items.map((row) => row.displayName).sort();
    const expected = Array.from({ length: 30 }, (_, i) => i + 1)
      .filter((seq) => seq % 3 === 1)
      .map(ledgerName)
      .sort();
    expect(names).toEqual(expected);

    // 対照: 12/31 まで広げると 12/01 の行も入るが、NULL は依然として落ちる。
    const wider = await walkPages(ctx, `?availableBy=2026-12-31&q=${LEDGER_TERM}&limit=100`);
    expect(wider.items).toHaveLength(20);
    expect(wider.items.map((row) => row.displayName)).not.toContain(ledgerName(3));
  });
});

describe('🔴 T-11-11 ⑥: 並びはサーバで確定する（`shared=true` = 共有開始日時の降順 / それ以外 = 更新日時の降順 → id 降順）', () => {
  it('`shared=true` は `shared_at` 降順で、共有し直した行が先頭に来る', async () => {
    const ids = await seedLedger(10);
    await seedShares(ids.slice(0, 5));
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const before = await shareListOf(await getShares(ctx, `?shared=true&q=${LEDGER_TERM}`));
    // seedShares は index 0 が最新なので、台帳 001 → 005 の順。
    expect(before.items.map((row) => row.displayName)).toEqual([1, 2, 3, 4, 5].map(ledgerName));

    // 台帳 004 を解除 → 共有し直す（`shared_at` が更新される）→ 先頭に来る。
    const target = before.items[3] as ShareItem;
    expect((await putShare(ctx, target.engineerId, { shared: false })).status).toBe(200);
    expect((await putShare(ctx, target.engineerId, { shared: true })).status).toBe(200);
    const after = await shareListOf(await getShares(ctx, `?shared=true&q=${LEDGER_TERM}`));
    expect(after.items.map((row) => row.displayName)).toEqual([4, 1, 2, 3, 5].map(ledgerName));
  });

  it('`shared=false` / `すべて` は `updated_at` 降順 → `id` 降順（`ENGINEER_LIST_ORDER_BY`）', async () => {
    await seedLedger(10);
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const notShared = await shareListOf(await getShares(ctx, `?shared=false&q=${LEDGER_TERM}`));
    expect(notShared.items.map((row) => row.displayName)).toEqual(
      Array.from({ length: 10 }, (_, i) => ledgerName(i + 1)),
    );

    // 同じ `updated_at` の 2 行は `id` の降順で決まる。
    const tiedRows = await admin.engineer.findMany({
      where: { displayName: { in: [ledgerName(1), ledgerName(2)] } },
      select: { id: true },
      orderBy: [{ id: 'desc' }],
    });
    await admin.engineer.updateMany({
      where: { displayName: { in: [ledgerName(1), ledgerName(2)] } },
      data: { updatedAt: new Date('2026-09-02T00:00:00.000Z') },
    });
    const tied = await shareListOf(await getShares(ctx, `?q=${LEDGER_TERM}`));
    expect(tied.items.slice(0, 2).map((row) => row.engineerId)).toEqual(tiedRows.map((row) => row.id));
  });
});
