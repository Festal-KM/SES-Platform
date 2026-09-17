// tests/isolation/engineer-careers.test.ts
// 🔴 T-09-12（`docs/sprints/SP-09-proposal-flow.md` §4 / Issue #35 = A）: `EngineerCareer` の新設と
//    `EngineerSnapshot.careers` の凍結を **実 DB（RLS + トリガ + CHECK）で**証明する。
//
//   ① DB 制約: 複合 FK `(tenant_id, engineer_id)` / `YYYY-MM` の CHECK / 期間の前後 / 出所の CHECK /
//      オーナー列の継承（行から直接は変えられない）/ RLS が C3 で有効 + FORCE
//   ② 二重防御 #11（docs/05 §4.7）: ホスト文脈で他パートナー所有の分 / パートナー文脈で他社の分 /
//      ホスト文脈で `app.shared_scope='on'` を立てたうえで —— **すべて 0 件**
//   ③ #16 / #17（実物の Route Handler）: 置き換え保存・サーバ側で確定する並び順・行ごとの監査
//      （3 行追加 + 1 行削除 → 4 件）・`summary` に本文が無い・0 行の保存・未知 id の 404・400
//   ④ 凍結（`F-008 AC-6` / `F-019 AC-5`）: 経歴を持つエンジニアで提案を作ると `EngineerSnapshot.careers` に
//      行単位で複製され、**その後に台帳を書き換えても提案の内容が変わらない**。0 行は `[]`（`null` にしない）
//
// 🔴 検証は `app_tenant`（BYPASSRLS 無し）で行う。superuser は前提づくりと事実確認だけに使う。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  createProposalDraft,
  disconnectTenantDb,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import {
  createUnextendedClient,
  readPolicies,
  readScopeSettings,
  readTableRlsStatus,
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import { ISOLATION_FORBIDDEN_MARKERS, ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-15T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.90' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
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

const SCOPE_HOST_1 = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  actorUserId: TENANT_1.hostUserId,
};

/** 🔴 テストが作った行だけを片付けるための目印。 */
const MARKER = 'T0912-';
const CAREER_ACTIONS = ['engineer_career.create', 'engineer_career.update', 'engineer_career.delete'];

type CareerRowBody = {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
  readonly source: string;
  readonly skillSheetExtractionId: string | null;
};
type SaveBody = { readonly id: string; readonly careers: readonly CareerRowBody[] };
type DetailBody = { readonly id: string; readonly careers: readonly CareerRowBody[] };
type ErrorBody = { readonly error: { readonly code: string } };

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let unextended: UnextendedClient;

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
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

async function patchEngineer(ctx: AuthenticatedTenantCtx, id: string, body: unknown): Promise<Response> {
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

async function getEngineer(ctx: AuthenticatedTenantCtx, id: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return engineerRoute.GET(new Request(`https://app.test/api/engineers/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function bodyOf<T>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function careerAudits() {
  return admin.auditLog.findMany({
    where: { action: { in: CAREER_ACTIONS } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

const ROW_A = { periodFrom: '2020-01', periodTo: '2020-12', role: 'PG', description: 'A 架空案件', technologies: 'Java' };
const ROW_B = { periodFrom: '2023-06', periodTo: null, role: 'PL', description: 'B 架空案件', technologies: 'Go' };
const ROW_C = { periodFrom: '2021-01', periodTo: '2023-05', role: 'SE', description: 'C 架空案件', technologies: 'TypeScript' };

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
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await unextended?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  await admin.membership.updateMany({ where: { userId: TENANT_1.hostUserId }, data: { role: 'SALES' } });
  await admin.membership.updateMany({ where: { userId: PARTNER_1_1.userId }, data: { role: 'PARTNER_SALES' } });
  await admin.membership.updateMany({ where: { userId: PARTNER_1_2.userId }, data: { role: 'PARTNER_SALES' } });
  // 🔴 テストが作った行だけを片付ける（seed の母集団は残す）。engineer_careers / snapshots は CASCADE。
  await admin.proposal.deleteMany({ where: { engineer: { displayName: { startsWith: MARKER } } } });
  await admin.engineer.deleteMany({ where: { displayName: { startsWith: MARKER } } });
  await admin.auditLog.deleteMany({
    where: { action: { in: [...CAREER_ACTIONS, 'engineer.create', 'engineer.update', 'engineer.view', 'proposal.create'] } },
  });
});

// ---------------------------------------------------------------------------
// ① DB 制約
// ---------------------------------------------------------------------------

describe('① DB 制約（docs/05 §3.4 / §3.4.1。migration 20260917000000）', () => {
  it('前提: seed に経歴が投入されている（ホスト 2 行 / 1 社目 4 行 / 2 社目 0 行）', async () => {
    expect(await admin.engineerCareer.count({ where: { engineerId: TENANT_1.hostEngineerId } })).toBe(2);
    expect(await admin.engineerCareer.count({ where: { engineerId: PARTNER_1_1.engineerId } })).toBe(4);
    expect(await admin.engineerCareer.count({ where: { engineerId: PARTNER_1_2.engineerId } })).toBe(0);
  });

  it('🔴 RLS が有効 + FORCE で、ポリシーは C3（親 engineers と同じ式）。共有スコープの追加ポリシーは無い。削除スコープ（T-10-09。`tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on()`）のポリシーは在る', async () => {
    const status = (await readTableRlsStatus(admin, ['engineer_careers']))[0];
    expect(status?.rlsEnabled).toBe(true);
    expect(status?.rlsForced).toBe(true);
    const policies = (await readPolicies(admin)).filter((policy) => policy.table === 'engineer_careers');
    const tenantPolicies = policies.filter((policy) => policy.roles.includes('app_tenant'));
    expect(tenantPolicies.map((policy) => policy.policy).sort()).toEqual([
      'engineer_careers_c3_delete',
      'engineer_careers_c3_insert',
      'engineer_careers_c3_select',
      'engineer_careers_c3_update',
      'engineer_careers_purge_scope_delete',
      'engineer_careers_purge_scope_select',
      'engineer_careers_purge_scope_update',
    ]);

    const c3Policies = tenantPolicies.filter((policy) => policy.policy.startsWith('engineer_careers_c3_'));
    for (const policy of c3Policies) {
      const expression = `${policy.using ?? ''} ${policy.withCheck ?? ''}`;
      expect(expression).toContain('app_tenant_id()');
      // `pg_get_expr` は `IS NOT DISTINCT FROM` を `NOT (... IS DISTINCT FROM ...)` に正規化して返す。
      expect(expression).toContain('NOT (owner_partner_company_id IS DISTINCT FROM app_partner_id())');
      expect(expression).not.toContain('shared_scope');
      expect(expression).not.toContain('app_engineer_is_shared');
    }

    // 🔴 T-10-09（migration 20260927000000 ④）: 削除スコープの追加ポリシー。C3 とは別の式（`app_purge_scope_on()`）で開く。
    const purgeScopePolicies = tenantPolicies.filter((policy) => policy.policy.startsWith('engineer_careers_purge_scope_'));
    for (const policy of purgeScopePolicies) {
      const expression = `${policy.using ?? ''} ${policy.withCheck ?? ''}`;
      expect(expression).toContain('app_tenant_id()');
      expect(expression).toContain('app_purge_scope_on()');
    }
  });

  it('🔴 engineers に UNIQUE(tenant_id, id) がある（複合 FK の参照先）', async () => {
    const rows = await admin.$queryRaw<Array<{ columns: string[] }>>`
      SELECT (SELECT array_agg(a.attname ORDER BY k.ord)
                FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum) AS columns
        FROM pg_index x
       WHERE x.indrelid = 'engineers'::regclass AND x.indisunique AND x.indpred IS NULL`;
    expect(rows.filter((row) => row.columns.join(',') === 'tenant_id,id')).toHaveLength(1);
  });

  it('🔴 複合 FK: tenant_id と engineer_id が別テナントの組み合わせは DB が拒む（単一列 FK なら通ってしまう行）', async () => {
    await expect(
      admin.engineerCareer.create({
        data: {
          tenantId: TENANT_1.tenantId,
          engineerId: TENANT_2.hostEngineerId, // 実在するが別テナントのエンジニア
          periodFrom: '2024-01',
          periodTo: null,
          role: 'x',
          description: 'x',
          technologies: '',
        },
      }),
    ).rejects.toThrow();
  });

  it.each([
    ['開始年月が日付', { periodFrom: '2024-01-01', periodTo: null }],
    ['開始年月が空文字', { periodFrom: '', periodTo: null }],
    ['月が 13', { periodFrom: '2024-13', periodTo: null }],
    ['終了年月が空文字（継続中は NULL で表す）', { periodFrom: '2024-01', periodTo: '' }],
    ['終了が開始より前', { periodFrom: '2024-06', periodTo: '2024-05' }],
  ])('🔴 CHECK: %s は INSERT できない', async (_label, period) => {
    await expect(
      admin.engineerCareer.create({
        data: {
          tenantId: TENANT_1.tenantId,
          engineerId: TENANT_1.hostEngineerId,
          ...period,
          role: 'x',
          description: 'x',
          technologies: '',
        },
      }),
    ).rejects.toThrow();
  });

  it('🔴 CHECK: 手入力（MANUAL）の行に抽出の出所は付けられない', async () => {
    const constraint = await admin.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'engineer_careers'::regclass AND conname = 'engineer_careers_extraction_source_check'`;
    expect(constraint).toHaveLength(1);
    await expect(
      admin.engineerCareer.create({
        data: {
          tenantId: TENANT_1.tenantId,
          engineerId: TENANT_1.hostEngineerId,
          periodFrom: '2024-01',
          periodTo: null,
          role: 'x',
          description: 'x',
          technologies: '',
          source: 'MANUAL',
          skillSheetExtractionId: '01930000-0000-7000-8000-00000000fff1',
        },
      }),
    ).rejects.toThrow();
  });

  it('🔴 オーナー列は親（engineers）から継承し、行から直接は変えられない（inherit トリガ）', async () => {
    const created = await admin.engineerCareer.create({
      data: {
        tenantId: TENANT_1.tenantId,
        engineerId: PARTNER_1_2.engineerId,
        // 🔴 偽装（ホスト所有 = null）を渡しても親の値で上書きされる。
        ownerPartnerCompanyId: null,
        periodFrom: '2024-01',
        periodTo: null,
        role: `${MARKER}x`,
        description: 'x',
        technologies: '',
      },
      select: { id: true, ownerPartnerCompanyId: true },
    });
    expect(created.ownerPartnerCompanyId).toBe(PARTNER_1_2.partnerCompanyId);

    await admin.engineerCareer.update({
      where: { id: created.id },
      data: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
    });
    const after = await admin.engineerCareer.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.ownerPartnerCompanyId).toBe(PARTNER_1_2.partnerCompanyId);
    await admin.engineerCareer.delete({ where: { id: created.id } });
  });
});

// ---------------------------------------------------------------------------
// ② 二重防御 #11（docs/05 §4.7）
// ---------------------------------------------------------------------------

describe('② 二重防御 #11: engineer_careers はホスト / 他社 / 共有スコープから 0 件（C3 / F-008 AC-7）', () => {
  it('ホスト文脈: 自社所有エンジニアの行だけ（取引先の経歴は ID 直指定でも 0 件）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const result = await withTenant(ctx, async (db) => ({
      rows: await db.engineerCareer.findMany({ select: { engineerId: true } }),
      total: await db.engineerCareer.count(),
      direct: await db.engineerCareer.findUnique({ where: { id: PARTNER_1_1.engineerCareerIds[0]! } }),
      byEngineer: await db.engineerCareer.count({ where: { engineerId: PARTNER_1_1.engineerId } }),
    }));
    expect(result.total).toBe(2);
    expect(new Set(result.rows.map((row) => row.engineerId))).toEqual(new Set([TENANT_1.hostEngineerId]));
    expect(result.direct).toBeNull();
    expect(result.byEngineer).toBe(0);
  });

  it('パートナー文脈: 自社の行だけ（他社の 4 行は存在も件数も見えない）', async () => {
    const ctx2 = await ctxOf(PARTNER_USER_2, 'PARTNER_SALES');
    const seenBy2 = await withTenant(ctx2, async (db) => ({
      total: await db.engineerCareer.count(),
      direct: await db.engineerCareer.findUnique({ where: { id: PARTNER_1_1.engineerCareerIds[0]! } }),
      hostRow: await db.engineerCareer.findUnique({ where: { id: TENANT_1.hostEngineerCareerIds[0]! } }),
    }));
    expect(seenBy2.total).toBe(0);
    expect(seenBy2.direct).toBeNull();
    expect(seenBy2.hostRow).toBeNull();

    // 対照: 1 社目からは自社の 4 行が見える（0 件が「行が無い」からではない）。
    const ctx1 = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');
    const seenBy1 = await withTenant(ctx1, (db) => db.engineerCareer.count());
    expect(seenBy1).toBe(4);
  });

  it('🔴 ホスト文脈で app.shared_scope=on を立てても取引先の経歴は 0 件（経路 4 の生成中と同じ条件。§4.5）', async () => {
    const result = await runUnextended(unextended, SCOPE_HOST_1, async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.shared_scope', 'on', true)`);
      return {
        settings: await readScopeSettings(tx),
        // 対照: 共有中のエンジニア本体は shared_candidate_read で見える（スコープが確かに効いている）。
        sharedEngineer: await tx.engineer.findUnique({ where: { id: PARTNER_1_1.engineerId }, select: { id: true } }),
        careersOfShared: await tx.engineerCareer.count({ where: { engineerId: PARTNER_1_1.engineerId } }),
        total: await tx.engineerCareer.count(),
        raw: await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM engineer_careers`,
      };
    });
    expect(result.settings.sharedScope).toBe('on');
    expect(result.sharedEngineer).not.toBeNull(); // 空振り防止
    expect(result.careersOfShared).toBe(0);
    expect(result.total).toBe(2); // ホスト所有の 2 行だけ
    expect(Number(result.raw[0]?.n)).toBe(2);
  });

  it('🔴 他テナントのホスト文脈からは 1 件も見えない（第一境界）', async () => {
    const ctx = await ctxOf(
      { tenantId: TENANT_2.tenantId, partnerCompanyId: null, userId: TENANT_2.hostUserId },
      'SALES',
    );
    const seen = await withTenant(ctx, async (db) => ({
      direct: await db.engineerCareer.findUnique({ where: { id: TENANT_1.hostEngineerCareerIds[0]! } }),
      byEngineer: await db.engineerCareer.count({ where: { engineerId: TENANT_1.hostEngineerId } }),
    }));
    expect(seen.direct).toBeNull();
    expect(seen.byEngineer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ #16 / #17（実物の Route Handler）
// ---------------------------------------------------------------------------

describe('③ #16 / #17: 置き換え保存・サーバ側の並び・行ごとの監査（F-008 AC-5）', () => {
  it('🔴 POST: 入力の配列順に関係なく period_from DESC で返り、行ごとに engineer_career.create が残る', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const body = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}経歴あり`, careers: [ROW_A, ROW_B, ROW_C] }),
      201,
    );
    expect(body.careers.map((row) => row.periodFrom)).toEqual(['2023-06', '2021-01', '2020-01']);
    expect(body.careers.map((row) => row.periodTo)).toEqual([null, '2023-05', '2020-12']);
    expect(body.careers.every((row) => row.source === 'MANUAL' && row.skillSheetExtractionId === null)).toBe(true);
    // 🔴 継続中は null（空文字ではない）。
    expect(body.careers[0]?.periodTo).toBeNull();

    const audits = await careerAudits();
    expect(audits.map((row) => row.action)).toEqual(['engineer_career.create', 'engineer_career.create', 'engineer_career.create']);
    for (const audit of audits) {
      expect(audit.targetType).toBe('EngineerCareer');
      expect(body.careers.map((row) => row.id)).toContain(audit.targetId);
      const summary = audit.summary as Record<string, unknown>;
      expect(Object.keys(summary).sort()).toEqual(['careerId', 'changedFields', 'periodFrom', 'periodTo', 'source'].sort());
      // 🔴 本文（役割・業務内容・使用技術）が 1 文字も載らない。
      const text = JSON.stringify(summary);
      for (const forbidden of ['架空案件', 'PG', 'PL', 'SE', 'Java', 'Go', 'TypeScript']) {
        expect(text).not.toContain(forbidden);
      }
      expect(audit.ipAddress).toBe(META.ipAddress);
      expect(audit.deviceKind).toBe('api');
    }
    // `engineer.create` の summary には件数だけ。
    const created = await admin.auditLog.findFirst({ where: { action: 'engineer.create' } });
    expect((created?.summary as Record<string, unknown>)['careerCount']).toBe(3);
  });

  it('🔴 GET: 同じデータに対して実行のたびに同じ順序（決定的。同期間は登録順）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}同期間`, careers: [ROW_A] }),
      201,
    );
    // 🔴 同じ開始年月の 2 行目を**別の保存**で足す（created_at が確実に後になる = 登録順の検証）。
    const second = await bodyOf<SaveBody>(
      await patchEngineer(ctx, created.id, {
        careers: [...created.careers, { ...ROW_A, role: 'テスター', description: 'A2 架空案件', technologies: 'JUnit' }],
      }),
      200,
    );
    expect(second.careers.map((row) => row.role)).toEqual(['PG', 'テスター']);

    const first = await bodyOf<DetailBody>(await getEngineer(ctx, created.id), 200);
    const again = await bodyOf<DetailBody>(await getEngineer(ctx, created.id), 200);
    expect(first.careers).toEqual(again.careers);
    expect(first.careers.map((row) => row.role)).toEqual(['PG', 'テスター']);
    expect(first.careers).toEqual(second.careers);
  });

  it('🔴 PATCH: 3 行追加 + 1 行削除 → AuditLog が 4 件（engineer.update 1 件にまとめない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}差分`, careers: [ROW_A, ROW_B] }),
      201,
    );
    await admin.auditLog.deleteMany({ where: { action: { in: CAREER_ACTIONS } } });
    const keep = created.careers.find((row) => row.periodFrom === ROW_B.periodFrom)!;
    const removed = created.careers.find((row) => row.periodFrom === ROW_A.periodFrom)!;

    const saved = await bodyOf<SaveBody>(
      await patchEngineer(ctx, created.id, {
        careers: [
          keep, // 変更なし
          { periodFrom: '2019-01', periodTo: '2019-06', role: 'PG', description: 'D', technologies: '' },
          { periodFrom: '2018-01', periodTo: '2018-12', role: 'PG', description: 'E', technologies: '' },
          { periodFrom: '2017-01', periodTo: '2017-12', role: 'PG', description: 'F', technologies: '' },
        ],
      }),
      200,
    );
    expect(saved.careers).toHaveLength(4);
    expect(saved.careers.map((row) => row.periodFrom)).toEqual(['2023-06', '2019-01', '2018-01', '2017-01']);
    expect(saved.careers.find((row) => row.id === keep.id)).toEqual(keep); // 変更なしの行は同じ id のまま

    const audits = await careerAudits();
    expect(audits.map((row) => row.action).sort()).toEqual([
      'engineer_career.create',
      'engineer_career.create',
      'engineer_career.create',
      'engineer_career.delete',
    ]);
    const deleted = audits.find((row) => row.action === 'engineer_career.delete');
    expect(deleted?.targetId).toBe(removed.id);
    expect(await admin.engineerCareer.findUnique({ where: { id: removed.id } })).toBeNull();
  });

  it('🔴 PATCH: 値が変わった行だけ engineer_career.update（changedFields は項目名。同じ値の再送信は 0 件）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}更新`, careers: [ROW_A, ROW_B] }),
      201,
    );
    await admin.auditLog.deleteMany({ where: { action: { in: CAREER_ACTIONS } } });

    // 同じ値の再送信 → 0 件。
    await bodyOf<SaveBody>(await patchEngineer(ctx, created.id, { careers: created.careers }), 200);
    expect(await careerAudits()).toHaveLength(0);

    const target = created.careers.find((row) => row.periodFrom === ROW_B.periodFrom)!;
    const saved = await bodyOf<SaveBody>(
      await patchEngineer(ctx, created.id, {
        careers: created.careers.map((row) =>
          row.id === target.id ? { ...row, periodTo: '2025-12', technologies: 'Go / gRPC' } : row,
        ),
      }),
      200,
    );
    // 🔴 他の行の内容は変わらない（AC-5「ある行の編集が他の行の内容を変えない」）。
    expect(saved.careers.find((row) => row.periodFrom === ROW_A.periodFrom)).toEqual(
      created.careers.find((row) => row.periodFrom === ROW_A.periodFrom),
    );
    const audits = await careerAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('engineer_career.update');
    expect(audits[0]?.targetId).toBe(target.id);
    expect((audits[0]?.summary as Record<string, unknown>)['changedFields']).toBe('periodTo,technologies');
    expect(JSON.stringify(audits[0]?.summary)).not.toContain('gRPC');
  });

  it('PATCH: careers 未指定は変更しない / [] は全行削除（undefined と [] を区別する）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}未指定`, careers: [ROW_A, ROW_B] }),
      201,
    );
    const untouched = await bodyOf<SaveBody>(await patchEngineer(ctx, created.id, { preferenceNote: 'x' }), 200);
    expect(untouched.careers).toEqual(created.careers);

    const cleared = await bodyOf<SaveBody>(await patchEngineer(ctx, created.id, { careers: [] }), 200);
    expect(cleared.careers).toEqual([]);
    expect(await admin.engineerCareer.count({ where: { engineerId: created.id } })).toBe(0);
    const deletes = (await careerAudits()).filter((row) => row.action === 'engineer_career.delete');
    expect(deletes).toHaveLength(2);
  });

  it('🔴 0 行のまま登録・更新できる（必須にしない）。応答は [] であり null ではない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(await postEngineer(ctx, { displayName: `${MARKER}0行` }), 201);
    expect(created.careers).toEqual([]);
    const detail = await bodyOf<DetailBody>(await getEngineer(ctx, created.id), 200);
    expect(detail.careers).toEqual([]);
    expect(Array.isArray(detail.careers)).toBe(true);
    expect(await careerAudits()).toHaveLength(0);
  });

  it('🔴 未知の id（他人の行 / 不存在）を付けた行は 404。何も書かれず監査も残らない', async () => {
    const host = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(host, { displayName: `${MARKER}404`, careers: [ROW_A] }),
      201,
    );
    await admin.auditLog.deleteMany({ where: { action: { in: CAREER_ACTIONS } } });

    // 不存在の id。
    const absent = await patchEngineer(host, created.id, {
      careers: [{ ...ROW_B, id: '01930000-0000-7000-8000-00000000fee1' }],
    });
    expect(absent.status).toBe(404);
    // 🔴 取引先 1 社目の行 id を、ホストが自社エンジニアの行として送る（境界外 = 不存在と同じ 404）。
    const foreign = await patchEngineer(host, created.id, {
      careers: [{ ...ROW_B, id: PARTNER_1_1.engineerCareerIds[0]! }],
    });
    expect(foreign.status).toBe(404);
    // 🔴 境界外と不存在で応答が同じ（区別すると他社の行の存在を教える。docs/05 §4.8）。
    expect(((await foreign.json()) as ErrorBody).error.code).toBe(((await absent.json()) as ErrorBody).error.code);

    // 何も変わっていない。
    expect(await admin.engineerCareer.count({ where: { engineerId: created.id } })).toBe(1);
    const partnerRow = await admin.engineerCareer.findUniqueOrThrow({ where: { id: PARTNER_1_1.engineerCareerIds[0]! } });
    expect(partnerRow.engineerId).toBe(PARTNER_1_1.engineerId);
    expect(partnerRow.periodFrom).toBe('2025-01');
    expect(await careerAudits()).toHaveLength(0);
  });

  it('🔴 パートナー文脈: 他社の行 id を自社エンジニアの行として送っても 404 で、他社の行は変わらない', async () => {
    const partner2 = await ctxOf(PARTNER_USER_2, 'PARTNER_SALES');
    const response = await patchEngineer(partner2, PARTNER_1_2.engineerId, {
      careers: [{ ...ROW_B, id: PARTNER_1_1.engineerCareerIds[1]! }],
    });
    expect(response.status).toBe(404);
    const row = await admin.engineerCareer.findUniqueOrThrow({ where: { id: PARTNER_1_1.engineerCareerIds[1]! } });
    expect(row.engineerId).toBe(PARTNER_1_1.engineerId);
    expect(row.periodTo).toBe('2024-12');
    expect(await admin.engineerCareer.count({ where: { engineerId: PARTNER_1_2.engineerId } })).toBe(0);
  });

  it('400: 終了が開始より前 / 終了年月の空文字 / 同じ id の重複', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}400`, careers: [ROW_A] }),
      201,
    );
    expect(
      (await patchEngineer(ctx, created.id, { careers: [{ ...ROW_A, periodFrom: '2021-01', periodTo: '2020-12' }] })).status,
    ).toBe(400);
    expect((await patchEngineer(ctx, created.id, { careers: [{ ...ROW_A, periodTo: '' }] })).status).toBe(400);
    const existing = created.careers[0]!;
    expect(
      (await patchEngineer(ctx, created.id, { careers: [existing, { ...existing, role: 'PM' }] })).status,
    ).toBe(400);
    // 何も変わっていない。
    expect(await bodyOf<DetailBody>(await getEngineer(ctx, created.id), 200)).toMatchObject({ careers: created.careers });
  });

  it('パートナー所属の利用者が自社エンジニアに経歴を保存でき、owner は自社に継承される', async () => {
    const partner2 = await ctxOf(PARTNER_USER_2, 'PARTNER_SALES');
    const saved = await bodyOf<SaveBody>(
      await patchEngineer(partner2, PARTNER_1_2.engineerId, { careers: [ROW_C] }),
      200,
    );
    expect(saved.careers).toHaveLength(1);
    const row = await admin.engineerCareer.findUniqueOrThrow({ where: { id: saved.careers[0]!.id } });
    expect(row.ownerPartnerCompanyId).toBe(PARTNER_1_2.partnerCompanyId);
    // 片付け（seed の 0 行に戻す）。
    await bodyOf<SaveBody>(await patchEngineer(partner2, PARTNER_1_2.engineerId, { careers: [] }), 200);
    expect(await admin.engineerCareer.count({ where: { engineerId: PARTNER_1_2.engineerId } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 凍結（F-008 AC-6 / F-019 AC-5）
// ---------------------------------------------------------------------------

describe('④ 凍結: EngineerSnapshot.careers は行単位の値の複製で、台帳の後変更で変わらない', () => {
  it('🔴 経歴 3 行のエンジニアで提案を作る → 3 行が台帳の並びのまま凍結され、台帳を書き換えても変わらない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(
      await postEngineer(ctx, { displayName: `${MARKER}凍結`, careers: [ROW_A, ROW_B, ROW_C] }),
      201,
    );
    const ledgerBefore = created.careers;

    const draft = await withTenant(ctx, (db) =>
      createProposalDraft(db, ctx, {
        projectId: TENANT_1.publishedProjectId,
        engineerId: created.id,
        proposalRequestId: null,
        recipient: { companyName: '架空エンド株式会社', email: 'recipient@seed-isolation.test' },
        frozenAt: NOW,
        ipAddress: META.ipAddress,
      }),
    );
    expect(draft.snapshot.careerCount).toBe(3);

    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: draft.id } });
    const frozen = snapshot.careers as Array<Record<string, unknown>>;
    expect(frozen).toHaveLength(3);
    // 🔴 凍結行は 5 項目だけ。台帳の行 ID・FK を持たない。
    for (const row of frozen) {
      expect(Object.keys(row).sort()).toEqual(['description', 'periodFrom', 'periodTo', 'role', 'technologies'].sort());
    }
    // 🔴 配列順 = 凍結時点の表示順（台帳の #17 と同じ並び）。
    expect(frozen.map((row) => row['periodFrom'])).toEqual(ledgerBefore.map((row) => row.periodFrom));
    expect(frozen.map((row) => row['description'])).toEqual(ledgerBefore.map((row) => row.description));
    const frozenBefore = JSON.stringify(frozen);

    // 台帳側で 1 行編集・1 行削除・1 行追加。
    const [head, middle] = ledgerBefore;
    await bodyOf<SaveBody>(
      await patchEngineer(ctx, created.id, {
        careers: [
          { ...head!, description: '編集後の業務内容', technologies: 'Rust' },
          middle!,
          { periodFrom: '2015-01', periodTo: '2016-12', role: '新人', description: '追加行', technologies: 'C' },
        ],
      }),
      200,
    );
    const ledgerAfter = await bodyOf<DetailBody>(await getEngineer(ctx, created.id), 200);
    expect(ledgerAfter.careers.map((row) => row.description)).toEqual(['編集後の業務内容', 'C 架空案件', '追加行']);

    // 🔴 提案の凍結は 1 文字も変わらない（行数も各行の項目も）。
    const after = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: draft.id } });
    expect(JSON.stringify(after.careers)).toBe(frozenBefore);
    expect((after.careers as unknown[]).length).toBe(3);
    expect(JSON.stringify(after.careers)).not.toContain('編集後の業務内容');
    expect(JSON.stringify(after.careers)).not.toContain('追加行');
  });

  it('🔴 経歴 0 行のエンジニアでも提案は作れ（422 にしない）、凍結は [] であり null ではない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await bodyOf<SaveBody>(await postEngineer(ctx, { displayName: `${MARKER}凍結0行` }), 201);
    const draft = await withTenant(ctx, (db) =>
      createProposalDraft(db, ctx, {
        projectId: TENANT_1.publishedProjectId,
        engineerId: created.id,
        proposalRequestId: null,
        recipient: { companyName: '架空エンド株式会社', email: 'recipient@seed-isolation.test' },
        frozenAt: NOW,
        ipAddress: null,
      }),
    );
    expect(draft.snapshot.careerCount).toBe(0);
    const snapshot = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: draft.id } });
    expect(snapshot.careers).toEqual([]);

    // 🔴 凍結は遡れない: 後から台帳に経歴を足しても、この提案の凍結は [] のまま。
    await bodyOf<SaveBody>(await patchEngineer(ctx, created.id, { careers: [ROW_A] }), 200);
    const after = await admin.engineerSnapshot.findUniqueOrThrow({ where: { proposalId: draft.id } });
    expect(after.careers).toEqual([]);
  });

  it('対照: seed の禁止マーカー（業務内容）は台帳にだけあり、匿名候補の母集団（MatchCandidate）には列が無い', async () => {
    const rows = await admin.engineerCareer.findMany({
      where: { engineerId: PARTNER_1_1.engineerId },
      select: { description: true },
    });
    expect(rows.every((row) => row.description.includes(ISOLATION_FORBIDDEN_MARKERS.careerDescription))).toBe(true);
    const candidate = await admin.matchCandidate.findUniqueOrThrow({ where: { id: PARTNER_1_1.matchCandidateId } });
    expect(JSON.stringify(candidate)).not.toContain(ISOLATION_FORBIDDEN_MARKERS.careerDescription);
  });
});
