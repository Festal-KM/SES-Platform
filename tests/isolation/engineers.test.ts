// tests/isolation/engineers.test.ts
// 🔴 SP-05 T-05-01 の完了判定を **DB + RLS + トリガ付きで**実証する（`F-008 AC-1`〜`AC-3`）:
//
//   AC-1 本籍・家族構成・健康情報・信条にあたる入力項目が存在しない（`BR-52`）
//        → 送っても**列に到達しない**ことを DB の行で確かめる
//   AC-2 パートナー所属の利用者が登録したエンジニアの所有パートナーは**認証コンテキストから決まる**。
//        🔴 **リクエスト入力で他社を指定しても変更されない**（アプリ・RLS・トリガの三重）
//   AC-3 ホスト所属の利用者は、他パートナーが登録したエンジニアに到達できない（境界外は 404）
//
// 🔴 T-05-09（`GET /api/engineers`。#15 / `S-005`）を追加した。中心は `F-004 AC-3` /
//    `F-009 AC-3`「パートナーが実行した一覧に他パートナーのエンジニアが 1 件も含まれない
//    （**件数にも現れない**）」であり、`total` が一覧と同じ `where` の `COUNT` であること
//    （docs/05 §4.8）を、母集団の外に他社の行が実在する状態で確かめる。
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`partner-companies.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけで、
//    その戻り値も `buildTenantCtx` が実 DB から確定した ctx である。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { GLOBAL_SKILL_IDS, ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
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
const { NotFoundError } = await import('../../apps/web/lib/api/errors');
const { readEngineerDetail, readEngineerForEdit } = await import(
  '../../apps/web/lib/engineers/service'
);
const engineersRoute = await import('../../apps/web/app/api/(main)/engineers/route');
const engineerRoute = await import('../../apps/web/app/api/(main)/engineers/[id]/route');

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

/** 実在しない ID（境界外の ID と応答が一致することの比較対象。docs/05 §4.8）。 */
const NONEXISTENT_ID = '01930000-0000-7000-8000-00000000fee1';

/** 🔴 テストが作った行だけを片付けるための目印。 */
const MARKER = 'T0501-';

const SKILL_JAVA = GLOBAL_SKILL_IDS['Java'] ?? '';
const SKILL_AWS = GLOBAL_SKILL_IDS['AWS'] ?? '';

type CreatedBody = { readonly id: string };
type ErrorBody = { readonly error: { readonly code: string } };
/** `OwnEngineerDetailView`（docs/05 §6.4 #17）。🔴 連絡先を持たない型である。 */
type DetailBody = {
  readonly id: string;
  readonly displayName: string;
  readonly ownership: 'HOST' | 'PARTNER';
  readonly skills: readonly { readonly skillId: string; readonly name: string }[];
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

/** テナントのライフサイクル状態（`F-004 AC-7`〜`AC-9`。閲覧と実行系の差を確かめるため）。 */
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

async function patchEngineer(
  ctx: AuthenticatedTenantCtx,
  id: string,
  body: unknown,
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineerRoute.PATCH(
    new Request(`https://app.test/api/engineers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** `GET /api/engineers/{id}`（docs/05 §6.4 #17）。T-05-02。 */
async function getEngineer(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineerRoute.GET(new Request(`https://app.test/api/engineers/${id}`), {
    params: Promise.resolve({ id }),
  });
}

/** `GET /api/engineers`（docs/05 §6.4 #15 / `S-005`）。T-05-09。 */
async function getEngineers(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineersRoute.GET(new Request(`https://app.test/api/engineers${query}`));
}

/** `OwnEngineerView` の一覧（docs/05 §6.4 #15）。 */
type ListBody = {
  readonly items: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly ownership: 'HOST' | 'PARTNER';
    readonly primarySkills: readonly { readonly skillId: string; readonly name: string }[];
    readonly moreSkillCount: number;
    readonly updatedOn: string;
  }[];
  readonly total: number;
  readonly nextCursor: string | null;
};

async function listBodyOf(response: Response): Promise<ListBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

async function createdIdOf(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as CreatedBody).id;
}

async function engineerRow(id: string) {
  const row = await admin.engineer.findUnique({ where: { id } });
  if (row === null) throw new Error(`engineers(${id}) が見つかりません（前提の破綻）。`);
  return row;
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await setRole(PARTNER_USER_2, 'PARTNER_SALES');
  await admin.partnerCompany.updateMany({ data: { suspendedAt: null } });
  await admin.engineer.deleteMany({ where: { displayName: { startsWith: MARKER } } });
  await admin.skillAlias.deleteMany({ where: { alias: { startsWith: MARKER } } });
  await admin.auditLog.deleteMany({
    where: { action: { in: ['engineer.create', 'engineer.update', 'engineer.view'] } },
  });
});

describe('🔴 F-008 AC-2: 所有パートナーは認証コンテキストから決まる', () => {
  it('パートナー所属の利用者が登録したエンジニアは、自社所有になる', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const id = await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}自社登録` }));

    const row = await engineerRow(id);
    expect(row.ownerPartnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(row.tenantId).toBe(TENANT_1.tenantId);
  });

  it('ホスト所属の利用者が登録したエンジニアは、ホスト所有（null）になる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}ホスト登録` }));

    expect((await engineerRow(id)).ownerPartnerCompanyId).toBeNull();
  });

  it('🔴 body で他社を指定しても所有パートナーが変わらない（パートナー → 他パートナー）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}偽装1`,
        // 🔴 分離キーそのもの。Zod の strip でハンドラに届かない。
        ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
        owner_partner_company_id: PARTNER_1_2.partnerCompanyId,
        partnerCompanyId: PARTNER_1_2.partnerCompanyId,
        tenantId: TENANT_2.tenantId,
      }),
    );

    const row = await engineerRow(id);
    expect(row.ownerPartnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(row.tenantId).toBe(TENANT_1.tenantId);
  });

  it('🔴 body で他社を指定しても所有パートナーが変わらない（ホスト → パートナー）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}偽装2`,
        ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      }),
    );

    expect((await engineerRow(id)).ownerPartnerCompanyId).toBeNull();
  });

  it('🔴 PATCH でも所有パートナーを動かせない（body に載せても列が変わらない）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const id = await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}更新対象` }));

    const response = await patchEngineer(ctx, id, {
      displayName: `${MARKER}更新後`,
      ownerPartnerCompanyId: null,
    });

    expect(response.status).toBe(200);
    const row = await engineerRow(id);
    expect(row.displayName).toBe(`${MARKER}更新後`);
    expect(row.ownerPartnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
  });
});

describe('🔴 F-008 AC-2 の DB 側の担保（アプリを迂回しても変わらない）', () => {
  it('RLS の C3: パートナー文脈から他社所有のエンジニアを INSERT できない', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    await expect(
      withTenant(ctx, (db) =>
        db.engineer.create({
          data: {
            tenantId: TENANT_1.tenantId,
            // 🔴 第 2 防御（Prisma 拡張）はオーナー列を検査しない（意図的な非対称。
            //    migration 20260903070000 の「判断事項 1」）。ここを止めるのは RLS である。
            ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
            displayName: `${MARKER}RLS`,
          },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow();

    expect(await admin.engineer.count({ where: { displayName: `${MARKER}RLS` } })).toBe(0);
  });

  it('RLS の C3: ホスト文脈からパートナー所有のエンジニアを INSERT できない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    await expect(
      withTenant(ctx, (db) =>
        db.engineer.create({
          data: {
            tenantId: TENANT_1.tenantId,
            ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
            displayName: `${MARKER}RLS-host`,
          },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow();
  });

  it('🔴 freeze トリガ（`engineers_freeze_owner`）が実在する', async () => {
    const rows = await admin.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'engineers'::regclass AND NOT tgisinternal AND tgname = 'engineers_freeze_owner'`;
    expect(rows.map((row) => row.tgname)).toEqual(['engineers_freeze_owner']);
  });

  it('🔴 freeze トリガ: 特権接続で直接 UPDATE しても所有パートナーを変えられない', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const id = await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}freeze` }));

    // 🔴 superuser（RLS を素通りする接続）でも変更できないこと ＝ 担保が RLS ではなく
    //    トリガにあることの実証。
    await expect(
      admin.engineer.update({
        where: { id },
        data: { ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId },
      }),
    ).rejects.toThrow(/freeze_owner_partner_company/);

    expect((await engineerRow(id)).ownerPartnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
  });

  it('🔴 継承トリガ: `engineer_skills` の所有パートナーは親（engineers）から入る', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}スキル継承`,
        skills: [{ skillId: SKILL_JAVA, yearsOfExperience: 8, level: 4 }],
      }),
    );

    const rows = await admin.engineerSkill.findMany({ where: { engineerId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerPartnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(rows[0]?.source).toBe('MANUAL');
    expect(Number(rows[0]?.yearsOfExperience)).toBe(8);
  });
});

describe('🔴 F-008 AC-1 / BR-52: 収集範囲外の情報は列に到達しない', () => {
  it('`birthDate` などを body に混ぜても DB の列が埋まらない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}BR52`,
        birthDate: '1990-01-01',
        healthCondition: '良好',
        familyStructure: '既婚',
        creed: '無宗教',
        affiliationLabel: '架空システム株式会社',
      }),
    );

    const row = await engineerRow(id);
    expect(row.birthDate).toBeNull();
    // 🔴 現所属会社名も本画面の入力ではない（`F-032` の抽出が埋める列）。
    expect(row.affiliationLabel).toBeNull();
  });

  it('BR-52 の範囲内の項目は保存される（対照：欄が無いのではなく、範囲を絞っている）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}範囲内`,
        availability: 'STANDBY_SCHEDULED',
        availableFrom: '2026-11-01',
        unitPriceMin: 600000,
        unitPriceMax: 750000,
        prefecture: '13',
        remoteMode: 'PARTIAL_REMOTE',
        preferenceNote: 'リモート中心を希望',
        contactEmail: 'engineer@example.test',
        contactPhone: '03-1234-5678',
      }),
    );

    const row = await engineerRow(id);
    expect(row.availability).toBe('STANDBY_SCHEDULED');
    expect(row.availableFrom?.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(Number(row.unitPriceMin)).toBe(600000);
    expect(Number(row.unitPriceMax)).toBe(750000);
    expect(row.prefecture).toBe('13');
    expect(row.remoteMode).toBe('PARTIAL_REMOTE');
    expect(row.contactEmail).toBe('engineer@example.test');
  });

  it('単価レンジの大小が逆なら 400（保存しない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const response = await postEngineer(ctx, {
      displayName: `${MARKER}逆レンジ`,
      unitPriceMin: 800000,
      unitPriceMax: 700000,
    });

    expect(response.status).toBe(400);
    expect(await admin.engineer.count({ where: { displayName: `${MARKER}逆レンジ` } })).toBe(0);
  });
});

describe('🔴 F-008 AC-3: 境界外のエンジニアには到達できない', () => {
  let partnerEngineerId: string;

  beforeEach(async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    partnerEngineerId = await createdIdOf(
      await postEngineer(ctx, { displayName: `${MARKER}パートナー所有` }),
    );
  });

  it('ホストは他パートナーのエンジニアを PATCH できない（404。存在しない ID と同じ応答）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const outOfBoundary = await patchEngineer(ctx, partnerEngineerId, { displayName: 'X' });
    const nonexistent = await patchEngineer(ctx, NONEXISTENT_ID, { displayName: 'X' });

    expect(outOfBoundary.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(((await outOfBoundary.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    expect(((await nonexistent.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
    // 🔴 名前が更新されていない（404 が「見えないだけで書けた」ではない）。
    expect((await engineerRow(partnerEngineerId)).displayName).toBe(`${MARKER}パートナー所有`);
  });

  it('🔴 ホストは他パートナーのエンジニアの実名に到達できない（編集フォームの読み取りも 404）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    await expect(
      readEngineerForEdit(ctx, partnerEngineerId, { ipAddress: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('🔴 他パートナー（2 社目）も 1 社目のエンジニアに到達できない（パートナー間の相互参照 0 件）', async () => {
    const ctx = await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN');

    const response = await patchEngineer(ctx, partnerEngineerId, { displayName: 'X' });
    expect(response.status).toBe(404);
    await expect(
      readEngineerForEdit(ctx, partnerEngineerId, { ipAddress: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('対照: 所有者本人は編集フォームを読める（`engineer.view` が記録される）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const view = await readEngineerForEdit(ctx, partnerEngineerId, { ipAddress: '203.0.113.20' });
    expect(view.displayName).toBe(`${MARKER}パートナー所有`);
    expect(view.ownership).toBe('PARTNER');

    const rows = await auditRows('engineer.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(partnerEngineerId);
    // 🔴 PII を summary に載せない。
    expect(JSON.stringify(rows[0]?.summary)).not.toContain(MARKER);
  });

  // --- #17 `GET /api/engineers/{id}`（T-05-02）-------------------------------
  it('🔴 ホストは他パートナーのエンジニアの詳細に到達できない（404。実名が本文に無い）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const outOfBoundary = await getEngineer(ctx, partnerEngineerId);
    const nonexistent = await getEngineer(ctx, NONEXISTENT_ID);

    expect(outOfBoundary.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    // 🔴 境界外と不存在で応答が 1 バイトも変わらない（docs/05 §4.8「見えない ＝ 存在しない」）。
    const outOfBoundaryBody = await outOfBoundary.text();
    expect(outOfBoundaryBody).toBe(await nonexistent.text());
    expect(outOfBoundaryBody).not.toContain(MARKER);
  });

  it('🔴 到達できなかった閲覧は `AuditLog` に残らない（見えない行の閲覧は無い）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    expect((await getEngineer(ctx, partnerEngineerId)).status).toBe(404);

    expect(await auditRows('engineer.view')).toHaveLength(0);
  });

  it('🔴 他パートナー（2 社目）も詳細に到達できない（パートナー間の相互参照 0 件）', async () => {
    const ctx = await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN');

    const response = await getEngineer(ctx, partnerEngineerId);

    expect(response.status).toBe(404);
    await expect(
      readEngineerDetail(ctx, partnerEngineerId, { ipAddress: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditRows('engineer.view')).toHaveLength(0);
  });
});

describe('🔴 F-008 AC-4: 詳細の閲覧が AuditLog に記録される（docs/05 §6.4 #17）', () => {
  let engineerId: string;

  beforeEach(async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    engineerId = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}詳細対象`,
        availability: 'STANDBY_SCHEDULED',
        availableFrom: '2026-11-01',
        unitPriceMin: 650000,
        unitPriceMax: 750000,
        prefecture: '13',
        remoteMode: 'PARTIAL_REMOTE',
        preferenceNote: '長期案件を希望',
        contactEmail: 'engineer@example.test',
        contactPhone: '03-1234-5678',
        skills: [{ skillId: SKILL_JAVA, yearsOfExperience: 8, level: 4 }],
      }),
    );
    // 🔴 登録（`engineer.create`）の記録と混ざらないようにしてから閲覧を検証する。
    await admin.auditLog.deleteMany({ where: { action: 'engineer.create' } });
  });

  it('API 経由の閲覧が 1 件記録される（`via=DETAIL` / 端末と IP も残る）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await getEngineer(ctx, engineerId);
    expect(response.status).toBe(200);

    const rows = await auditRows('engineer.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorKind).toBe('USER');
    expect(rows[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(rows[0]?.targetType).toBe('Engineer');
    expect(rows[0]?.targetId).toBe(engineerId);
    expect(rows[0]?.summary).toEqual({ via: 'DETAIL' });
    expect(rows[0]?.ipAddress).toBe(META.ipAddress);
    expect(rows[0]?.deviceKind).toBe('api');
    // 🔴 PII を summary に載せない（`F-058` で運営者に見えるため。docs/05 §16.2）。
    expect(JSON.stringify(rows[0]?.summary)).not.toContain('詳細対象');
  });

  it('🔴 画面（サーバコンポーネント）経由でも同じ記録が残る（経路で漏れない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    // `S-006` は Route Handler を通らず、この関数を直接呼ぶ（`page.tsx`）。
    const view = await readEngineerDetail(ctx, engineerId, { ipAddress: '203.0.113.44' });
    expect(view.displayName).toBe(`${MARKER}詳細対象`);

    const rows = await auditRows('engineer.view');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toEqual({ via: 'DETAIL' });
    expect(rows[0]?.ipAddress).toBe('203.0.113.44');
  });

  it('詳細 → 編集の 2 経路は 2 件記録され、`via` で区別できる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getEngineer(ctx, engineerId)).status).toBe(200);
    await readEngineerForEdit(ctx, engineerId, { ipAddress: null });

    const rows = await auditRows('engineer.view');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => (row.summary as { via: string }).via)).toEqual([
      'DETAIL',
      'EDIT_FORM',
    ]);
  });

  it('🔴 応答に連絡先が含まれない（画面が出さない PII を API が返さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await getEngineer(ctx, engineerId);
    const raw = await response.text();
    const body = JSON.parse(raw) as DetailBody;

    expect(body.id).toBe(engineerId);
    expect(body.ownership).toBe('HOST');
    expect(body.skills.map((skill) => skill.skillId)).toEqual([SKILL_JAVA]);
    expect(raw).not.toContain('engineer@example.test');
    expect(raw).not.toContain('03-1234-5678');
    expect(raw).not.toContain('contactEmail');
  });

  it('🔴 `VIEWER` も閲覧できる（`F-012 AC-3`。記録は同じように残る）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const response = await getEngineer(ctx, engineerId);

    expect(response.status).toBe(200);
    expect(await auditRows('engineer.view')).toHaveLength(1);
  });

  it('🔴 `CLOSING` のテナントでも閲覧できる（`F-004 AC-8`。実行系だけを止める）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'SALES');
    expect(ctx.lifecycleState).toBe('CLOSING');

    const detail = await getEngineer(ctx, engineerId);
    const update = await patchEngineer(ctx, engineerId, { displayName: `${MARKER}更新` });

    expect(detail.status).toBe(200);
    // 対照: 実行系（更新）は 409 のままである。
    expect(update.status).toBe(409);
    expect(await auditRows('engineer.view')).toHaveLength(1);
  });

  it('パートナーは自社エンジニアの詳細を読める（対照。母集団は所属で決まる）', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const partnerEngineerId = await createdIdOf(
      await postEngineer(partnerCtx, { displayName: `${MARKER}自社詳細` }),
    );
    await admin.auditLog.deleteMany({ where: { action: 'engineer.create' } });

    const response = await getEngineer(partnerCtx, partnerEngineerId);

    expect(response.status).toBe(200);
    expect(((await response.json()) as DetailBody).ownership).toBe('PARTNER');
    expect(await auditRows('engineer.view')).toHaveLength(1);
  });
});

describe('🔴 F-008 処理④: 作成・更新が AuditLog に残る（PII を含めない）', () => {
  it('`engineer.create` が 1 件記録され、氏名が summary に無い', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}監査`,
        skills: [{ skillId: SKILL_JAVA, yearsOfExperience: 3, level: null }],
        newSkillLabels: [`${MARKER}Java8`],
      }),
    );

    const rows = await auditRows('engineer.create');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(rows[0]?.targetType).toBe('Engineer');
    expect(rows[0]?.summary).toEqual({ skillCount: 1, newSkillLabelCount: 1 });
    expect(JSON.stringify(rows[0]?.summary)).not.toContain('監査');
  });

  it('`engineer.update` が 1 件記録され、対象 ID と更新項目名が残る', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}監査2` }));

    const response = await patchEngineer(ctx, id, { availability: 'STANDBY' });
    expect(response.status).toBe(200);

    const rows = await auditRows('engineer.update');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(id);
    expect(rows[0]?.summary).toEqual({
      fields: 'availability',
      skillCount: null,
      newSkillLabelCount: 0,
    });
  });
});

describe('🔴 F-010: スキルは辞書から選び、辞書に無い表記は候補として起票するだけ', () => {
  it('辞書に無い `skillId` は 400（エンジニアも作られない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const response = await postEngineer(ctx, {
      displayName: `${MARKER}未知スキル`,
      skills: [{ skillId: NONEXISTENT_ID, yearsOfExperience: 1, level: null }],
    });

    expect(response.status).toBe(400);
    expect(await admin.engineer.count({ where: { displayName: `${MARKER}未知スキル` } })).toBe(0);
  });

  it('🔴 新語候補は `SkillAlias(PROPOSED)` として起票され、辞書（`Skill`）は増えない', async () => {
    const before = await admin.skill.count();
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}新語`,
        newSkillLabels: [`${MARKER}Java8`, `${MARKER}JavaSE`],
      }),
    );

    expect(await admin.skill.count()).toBe(before);
    const aliases = await admin.skillAlias.findMany({
      where: { alias: { startsWith: MARKER } },
      orderBy: { alias: 'asc' },
    });
    expect(aliases).toHaveLength(2);
    for (const alias of aliases) {
      expect(alias.status).toBe('PROPOSED');
      expect(alias.origin).toBe('HUMAN');
      // 🔴 採用されるまで正規化先を持たない（＝ 検索の正規化に使われない）。
      expect(alias.skillId).toBeNull();
      expect(alias.tenantId).toBe(TENANT_1.tenantId);
      expect(alias.proposedBy).toBe(PARTNER_1_1.userId);
    }
  });

  it('同じ表記を 2 度起票しても候補は 1 件のまま（重複を失敗にしない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    await createdIdOf(
      await postEngineer(ctx, { displayName: `${MARKER}新語A`, newSkillLabels: [`${MARKER}Kotlin2`] }),
    );
    await createdIdOf(
      await postEngineer(ctx, { displayName: `${MARKER}新語B`, newSkillLabels: [`${MARKER}Kotlin2`] }),
    );

    expect(await admin.skillAlias.count({ where: { alias: `${MARKER}Kotlin2` } })).toBe(1);
  });

  it('PATCH の `skills` は置き換えである（画面から消した行が残らない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}置換`,
        skills: [
          { skillId: SKILL_JAVA, yearsOfExperience: 5, level: 3 },
          { skillId: SKILL_AWS, yearsOfExperience: 2, level: null },
        ],
      }),
    );

    const response = await patchEngineer(ctx, id, {
      skills: [{ skillId: SKILL_AWS, yearsOfExperience: 3, level: 4 }],
    });
    expect(response.status).toBe(200);

    const rows = await admin.engineerSkill.findMany({ where: { engineerId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.skillId).toBe(SKILL_AWS);
    expect(rows[0]?.level).toBe(4);
  });

  it('同じスキルを 2 回指定したら 400（片方が黙って消えない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const response = await postEngineer(ctx, {
      displayName: `${MARKER}重複スキル`,
      skills: [
        { skillId: SKILL_JAVA, yearsOfExperience: 5, level: null },
        { skillId: SKILL_JAVA, yearsOfExperience: 3, level: null },
      ],
    });

    expect(response.status).toBe(400);
  });

  it('🔴 F-010 AC-2: テナントからグローバル辞書に書けない（GRANT は SELECT のみ）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    await expect(
      withTenant(ctx, (db) =>
        db.skill.create({ data: { name: `${MARKER}NewSkill`, category: 'LANGUAGE', sortKey: 999 } }),
      ),
    ).rejects.toThrow();

    expect(await admin.skill.count({ where: { name: `${MARKER}NewSkill` } })).toBe(0);
  });

  it('対照: 辞書は読める（`S-007` のスキル選択が成立する）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const skills = await withTenant(ctx, (db) =>
      db.skill.findMany({ select: { id: true, name: true }, orderBy: { sortKey: 'asc' } }),
    );

    expect(skills.length).toBeGreaterThan(0);
    expect(skills.map((skill) => skill.id)).toContain(SKILL_JAVA);
  });
});

describe('認可（docs/05 §6.4 #16 / F-004）', () => {
  it('🔴 `VIEWER` は登録できない（403。API を直接呼んでも拒否される）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const response = await postEngineer(ctx, { displayName: `${MARKER}VIEWER` });

    expect(response.status).toBe(403);
    expect(await admin.engineer.count({ where: { displayName: `${MARKER}VIEWER` } })).toBe(0);
  });

  it('🔴 停止中の取引先の配下アカウントは登録できない（409。F-007 AC-2）', async () => {
    await admin.partnerCompany.update({
      where: { id: PARTNER_1_1.partnerCompanyId },
      data: { suspendedAt: NOW },
    });
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');

    const response = await postEngineer(ctx, { displayName: `${MARKER}停止中` });

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('PARTNER_COMPANY_SUSPENDED');
    expect(await admin.engineer.count({ where: { displayName: `${MARKER}停止中` } })).toBe(0);
  });

  it('🔴 監査に失敗したら登録も成立しない、の対照: 記録と行が 1 対 1 で増える', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}対照1` }));
    await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}対照2` }));

    expect(await auditRows('engineer.create')).toHaveLength(2);
    expect(await admin.engineer.count({ where: { displayName: { startsWith: MARKER } } })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 🔴 T-05-09: `GET /api/engineers`（#15 / `S-005`）の一覧の骨格
// ---------------------------------------------------------------------------
//
// 前提（`packages/db/seed/presets/isolation.ts`）: テナント 1 には
//   ①ホスト所有のエンジニア 1 件（`hostEngineerId`）
//   ②パートナー 1 社目が所有するエンジニア 1 件
//   ③パートナー 2 社目が所有するエンジニア 1 件
// が**実在する**。したがって「母集団の外に他社の行が実在する」状態で件数を検証できる
// （0 件同士の比較では、境界が効いているのかデータが無いのか区別できない）。

describe('🔴 F-004 AC-3 / F-009 AC-3: 一覧の母集団は境界適用後のみ（件数にも現れない）', () => {
  it('🔴 パートナーの一覧に他社のエンジニアが 1 件も含まれない（`items` にも `total` にも）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const body = await listBodyOf(await getEngineers(ctx));
    const ids = body.items.map((item) => item.id);

    // 自社の 1 件だけ（seed）。
    expect(ids).toEqual([PARTNER_1_1.engineerId]);
    // 🔴 他パートナーの行も、ホスト所有の行も、母集団に無い。
    expect(ids).not.toContain(PARTNER_1_2.engineerId);
    expect(ids).not.toContain(TENANT_1.hostEngineerId);
    // 🔴 **件数にも現れない**（`total` は一覧と同じ `where` の `COUNT`。docs/05 §4.8）。
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(body.total);
  });

  it('🔴 2 社目のパートナーからも 1 社目のエンジニアが見えない（相互参照 0 件）', async () => {
    const ctx = await ctxOf(PARTNER_USER_2, 'PARTNER_ADMIN');

    const body = await listBodyOf(await getEngineers(ctx));

    expect(body.items.map((item) => item.id)).toEqual([PARTNER_1_2.engineerId]);
    expect(body.total).toBe(1);
  });

  it('🔴 ホストの一覧にパートナー所有のエンジニアが 1 件も含まれない（`F-008 AC-3`）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getEngineers(ctx));
    const ids = body.items.map((item) => item.id);

    expect(ids).toEqual([TENANT_1.hostEngineerId]);
    expect(ids).not.toContain(PARTNER_1_1.engineerId);
    expect(ids).not.toContain(PARTNER_1_2.engineerId);
    expect(body.total).toBe(1);
    expect(body.items[0]?.ownership).toBe('HOST');
  });

  it('🔴 他社のエンジニアの実名が応答本文に 1 バイトも現れない', async () => {
    const partnerName = (await engineerRow(PARTNER_1_2.engineerId)).displayName;
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const raw = await (await getEngineers(ctx)).text();

    expect(raw).not.toContain(partnerName);
  });

  it('登録した行は自分の一覧にだけ増える（件数も 1 増える）', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const hostCtx = await ctxOf(HOST_1, 'SALES');

    const created = await createdIdOf(
      await postEngineer(partnerCtx, { displayName: `${MARKER}一覧` }),
    );

    const partnerBody = await listBodyOf(await getEngineers(partnerCtx));
    const hostBody = await listBodyOf(await getEngineers(hostCtx));

    expect(partnerBody.total).toBe(2);
    expect(partnerBody.items.map((item) => item.id)).toContain(created);
    // 🔴 ホストの母集団は 1 件のまま（パートナーが登録した行は件数にも現れない）。
    expect(hostBody.total).toBe(1);
    expect(hostBody.items.map((item) => item.id)).not.toContain(created);
  });

  it('🔴 `CLOSING` のテナントでも一覧は読める（`F-004 AC-8`。実行系だけを止める）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getEngineers(ctx)).status).toBe(200);
  });

  it('🔴 `VIEWER` も一覧を読める（`F-012 AC-3` / `BR-31`。閲覧のみ可）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    expect((await getEngineers(ctx)).status).toBe(200);
  });
});

describe('🔴 一覧の応答（docs/05 §6.4 #15 / §4.8）', () => {
  it('🔴 連絡先・生年月日・現所属会社名を返さない（画面が出さない PII を API が返さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}応答`,
        contactEmail: 'engineer@example.test',
        contactPhone: '03-1234-5678',
      }),
    );

    const raw = await (await getEngineers(ctx)).text();

    expect(raw).toContain(id);
    expect(raw).not.toContain('engineer@example.test');
    expect(raw).not.toContain('03-1234-5678');
    expect(raw).not.toContain('contactEmail');
    expect(raw).not.toContain('birthDate');
    expect(raw).not.toContain('affiliationLabel');
  });

  it('🔴 「他に N 件」「順位」に相当するフィールドを持たない（docs/05 §4.8 / `F-009 AC-2`）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getEngineers(ctx));

    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor', 'total']);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      'availability',
      'availableFrom',
      'displayName',
      'id',
      'moreSkillCount',
      'ownership',
      'prefecture',
      'primarySkills',
      'remoteMode',
      'unitPriceMax',
      'unitPriceMin',
      'updatedOn',
    ]);
  });

  it('🔴 更新日は日単位に丸めて返す（`docs/04` `U-06`。時刻を返さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = await listBodyOf(await getEngineers(ctx));

    expect(body.items[0]?.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('主要スキルは上位 3 件 + 超過件数（`docs/04` §S-005）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    // 🔴 seed の辞書から 4 件取り、経験年数をばらして登録する。
    const dictionary = await admin.skill.findMany({ select: { id: true }, orderBy: { sortKey: 'asc' }, take: 4 });
    expect(dictionary).toHaveLength(4);
    const id = await createdIdOf(
      await postEngineer(ctx, {
        displayName: `${MARKER}スキル4件`,
        skills: dictionary.map((skill, index) => ({
          skillId: skill.id,
          yearsOfExperience: 10 - index,
          level: null,
        })),
      }),
    );

    const body = await listBodyOf(await getEngineers(ctx));
    const item = body.items.find((row) => row.id === id);

    expect(item?.primarySkills).toHaveLength(3);
    expect(item?.moreSkillCount).toBe(1);
    // 🔴 経験年数の降順（決定的。`F-009 AC-1`）。
    expect(item?.primarySkills.map((skill) => skill.skillId)).toEqual(
      dictionary.slice(0, 3).map((skill) => skill.id),
    );
  });

  it('🔴 一覧の閲覧は `engineer.view` に記録されない（記録は詳細が持つ。`BR-27` / docs/05 §16.1）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getEngineers(ctx)).status).toBe(200);

    expect(await auditRows('engineer.view')).toHaveLength(0);
  });
});

describe('🔴 ページングと決定的順序（docs/05 §6.1 / §4.8 / `F-009 AC-1`）', () => {
  /** seed の 1 件 + ここで作る 4 件 = ホストの母集団 5 件。 */
  const EXTRA = 4;

  beforeEach(async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    for (let index = 0; index < EXTRA; index += 1) {
      await createdIdOf(await postEngineer(ctx, { displayName: `${MARKER}ページ${index}` }));
    }
  });

  it('`limit` で区切り、カーソルで続きを読める（重複も欠落もしない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const first = await listBodyOf(await getEngineers(ctx, '?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    // 🔴 `total` はページの件数ではなく母集団の件数である（同じ `where` の `COUNT`）。
    expect(first.total).toBe(EXTRA + 1);

    const seen = new Set(first.items.map((item) => item.id));
    let cursor = first.nextCursor;
    let guard = 0;
    while (cursor !== null && guard < 10) {
      const page = await listBodyOf(await getEngineers(ctx, `?limit=2&cursor=${cursor}`));
      for (const item of page.items) {
        expect(seen.has(item.id), `${item.id} が 2 度現れた`).toBe(false);
        seen.add(item.id);
      }
      expect(page.total).toBe(EXTRA + 1);
      cursor = page.nextCursor;
      guard += 1;
    }

    expect(seen.size).toBe(EXTRA + 1);
  });

  it('🔴 同じ条件を 10 回実行しても並び順が変わらない（`F-009 AC-1`）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const first = (await listBodyOf(await getEngineers(ctx))).items.map((item) => item.id);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const again = (await listBodyOf(await getEngineers(ctx))).items.map((item) => item.id);
      expect(again).toEqual(first);
    }
  });

  it('更新した行が先頭に来る（既定順序は更新日の降順）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const oldest = (await listBodyOf(await getEngineers(ctx))).items.at(-1);
    expect(oldest).toBeDefined();

    expect(
      (await patchEngineer(ctx, oldest?.id ?? '', { availability: 'STANDBY' })).status,
    ).toBe(200);

    const after = await listBodyOf(await getEngineers(ctx));
    expect(after.items[0]?.id).toBe(oldest?.id);
    // 🔴 並びが変わっても母集団の件数は変わらない。
    expect(after.total).toBe(EXTRA + 1);
  });

  it('🔴 UUID でないカーソルは 400（Prisma の `cursor` まで届かせない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await getEngineers(ctx, '?cursor=not-a-uuid');

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe('VALIDATION');
  });

  it('🔴 `limit` の上限超過は黙って丸めず 400（docs/05 §6.1）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await getEngineers(ctx, '?limit=201')).status).toBe(400);
  });

  it('境界外の ID をカーソルに指定しても他社の行に到達できない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    // 🔴 形は妥当だがホストの母集団に無い ID（他パートナー所有）。
    const response = await getEngineers(ctx, `?cursor=${PARTNER_1_1.engineerId}`);

    // Prisma は母集団の中でカーソル行を探すため、見つからなければ 0 件になる
    //（他社の行を起点にページを開けない）。**500 にはしない。**
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody;
    expect(body.items.map((item) => item.id)).not.toContain(PARTNER_1_1.engineerId);
  });
});
