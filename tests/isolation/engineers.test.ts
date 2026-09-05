// tests/isolation/engineers.test.ts
// 🔴 SP-05 T-05-01 の完了判定を **DB + RLS + トリガ付きで**実証する（`F-008 AC-1`〜`AC-3`）:
//
//   AC-1 本籍・家族構成・健康情報・信条にあたる入力項目が存在しない（`BR-52`）
//        → 送っても**列に到達しない**ことを DB の行で確かめる
//   AC-2 パートナー所属の利用者が登録したエンジニアの所有パートナーは**認証コンテキストから決まる**。
//        🔴 **リクエスト入力で他社を指定しても変更されない**（アプリ・RLS・トリガの三重）
//   AC-3 ホスト所属の利用者は、他パートナーが登録したエンジニアに到達できない（境界外は 404）
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
const { readEngineerForEdit } = await import('../../apps/web/lib/engineers/service');
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

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

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
