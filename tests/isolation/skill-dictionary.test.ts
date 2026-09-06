// tests/isolation/skill-dictionary.test.ts
// 🔴 SP-05 T-05-03 の完了判定を **DB + RLS + DB 権限付きで**実証する（`F-010 AC-1`〜`AC-3`）:
//
//   AC-1 新語候補は `ADMIN` または `SALES` が**明示的に採用するまで**検索の正規化に使われない
//        → 採用まで `status='PROPOSED'` かつ `skill_id IS NULL`（＝ 正規化先を持たない）ままであり、
//          パートナー・`VIEWER` は API を直接叩いても採否できない（`F-004 AC-9`）
//   AC-2 テナント固有の別名は他テナントに影響しない / グローバル辞書はテナントから編集できない
//        → ①`skills` への書き込みは **DB 権限**（`GRANT SELECT` のみ）が拒否する
//          ②グローバル別名（`tenant_id IS NULL`）は**読めるが書けない**（RLS / Prisma 拡張 / 判定の 3 層）
//          ③他テナントの別名は一覧に 1 行も現れず、採否でも動かない
//   AC-3 採用・却下が `AuditLog` に残る（🔴 **起きなかった採否は残らない**）
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`engineers.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけである。
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
const NOW = new Date('2026-09-06T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.20' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { listSkillAliases, listSkills } = await import('../../apps/web/lib/skills/service');
const skillsRoute = await import('../../apps/web/app/api/(main)/skills/route');
const aliasesRoute = await import('../../apps/web/app/api/(main)/skill-aliases/route');
const decideRoute = await import(
  '../../apps/web/app/api/(main)/skill-aliases/[id]/decide/route'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];

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

const NONEXISTENT_ID = '01930000-0000-7000-8000-00000000fee1';

/** 🔴 テストが作った行だけを片付けるための目印。 */
const MARKER = 'T0503-';

const SKILL_JAVA = GLOBAL_SKILL_IDS['Java'] ?? '';
const SKILL_AWS = GLOBAL_SKILL_IDS['AWS'] ?? '';

type ErrorBody = { readonly error: { readonly code: string } };
type AliasListBody = {
  readonly items: readonly {
    readonly id: string;
    readonly alias: string;
    readonly status: string;
    readonly scope: string;
    readonly skillId: string | null;
    readonly skillName: string | null;
    readonly proposedAt: string | null;
  }[];
};
type SkillListBody = { readonly items: readonly { readonly id: string; readonly name: string }[] };

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

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function getSkills(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return skillsRoute.GET(new Request(`https://app.test/api/skills${query}`));
}

async function getAliases(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return aliasesRoute.GET(new Request(`https://app.test/api/skill-aliases${query}`));
}

async function decide(
  ctx: AuthenticatedTenantCtx,
  id: string,
  body: unknown,
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return decideRoute.POST(
    new Request(`https://app.test/api/skill-aliases/${id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** 新語候補を 1 件起票する（`F-008` の `newSkillLabels` が作るのと同じ行）。 */
async function proposeAlias(options: {
  readonly tenantId: string | null;
  readonly alias: string;
  readonly proposedBy?: string;
  readonly status?: string;
  readonly skillId?: string | null;
}): Promise<string> {
  const row = await admin.skillAlias.create({
    data: {
      tenantId: options.tenantId,
      alias: options.alias,
      skillId: options.skillId ?? null,
      status: options.status ?? 'PROPOSED',
      origin: 'HUMAN',
      proposedBy: options.proposedBy ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

async function aliasRow(id: string) {
  const row = await admin.skillAlias.findUnique({ where: { id } });
  if (row === null) throw new Error(`skill_aliases(${id}) が見つかりません（前提の破綻）。`);
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
  await setLifecycle(TENANT_1.tenantId, 'ACTIVE');
  await setRole(HOST_1, 'SALES');
  await setRole(HOST_2, 'SALES');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await admin.partnerCompany.updateMany({ data: { suspendedAt: null } });
  await admin.skillAlias.deleteMany({ where: { alias: { startsWith: MARKER } } });
  await admin.auditLog.deleteMany({ where: { action: 'skill_alias.update' } });
});

describe('🔴 F-010 AC-1: 採用されるまで正規化に使われない', () => {
  let candidateId: string;

  beforeEach(async () => {
    candidateId = await proposeAlias({
      tenantId: TENANT_1.tenantId,
      alias: `${MARKER}Java8`,
      proposedBy: PARTNER_1_1.userId,
    });
  });

  it('起票された候補は正規化先を持たない（`PROPOSED` / `skill_id IS NULL`）', async () => {
    const row = await aliasRow(candidateId);
    expect(row.status).toBe('PROPOSED');
    expect(row.skillId).toBeNull();
    expect(row.decidedBy).toBeNull();
    expect(row.decidedAt).toBeNull();
  });

  it('ADMIN の採用で正規化先が確定する（決定者と決定時刻も残る）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA });

    expect(response.status).toBe(204);
    const row = await aliasRow(candidateId);
    expect(row.status).toBe('ACCEPTED');
    expect(row.skillId).toBe(SKILL_JAVA);
    expect(row.decidedBy).toBe(TENANT_1.hostUserId);
    expect(row.decidedAt).not.toBeNull();
  });

  it('SALES の却下で候補が閉じる（正規化先は付かない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await decide(ctx, candidateId, { decision: 'REJECT' });

    expect(response.status).toBe(204);
    const row = await aliasRow(candidateId);
    expect(row.status).toBe('REJECTED');
    expect(row.skillId).toBeNull();
  });

  it.each([
    ['PARTNER_ADMIN', 'PARTNER_ADMIN'],
    ['PARTNER_SALES', 'PARTNER_SALES'],
  ] as const)(
    '🔴 パートナー（%s）は API を直接叩いても採否できない（起票のみ）',
    async (_label, role) => {
      const ctx = await ctxOf(PARTNER_USER_1, role);

      const response = await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA });

      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
      // 🔴 拒否されただけでなく、行が 1 バイトも動いていない。
      const row = await aliasRow(candidateId);
      expect(row.status).toBe('PROPOSED');
      expect(row.skillId).toBeNull();
    },
  );

  it('🔴 `VIEWER` は採否できない（`BR-31`）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');

    const response = await decide(ctx, candidateId, { decision: 'REJECT' });

    expect(response.status).toBe(403);
    expect((await aliasRow(candidateId)).status).toBe('PROPOSED');
  });

  // 🔴 T-06-01（[Issue #36](https://github.com/Festal-KM/SES-Platform/issues/36) の既定 A）:
  //    このテストは T-05-03 の時点では「`OWNER` も採否できない（403）」を固定していた。
  //    `docs/02` `F-010 AC-1` → `docs/04` §S-009 → `docs/05` §6.4 #24 → 実装の順に
  //    `OWNER` を採否ロールへ追加したため、**同じ論点を正のケースとして固定し直す**
  //    （テストを消すと「`OWNER` が採否できること」を誰も守らなくなる）。
  it('⚠️ `OWNER` は採否できる（Issue #36 既定 A。暫定）', async () => {
    const ctx = await ctxOf(HOST_1, 'OWNER');

    const response = await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA });

    expect(response.status).toBe(204);
    const row = await aliasRow(candidateId);
    expect(row.status).toBe('ACCEPTED');
    expect(row.skillId).toBe(SKILL_JAVA);
    expect(row.decidedBy).toBe(TENANT_1.hostUserId);
  });

  it('🔴 正規化先を指定しない採用は 400（辞書に無い表記のまま採用されない）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await decide(ctx, candidateId, { decision: 'ACCEPT' });

    expect(response.status).toBe(400);
    const row = await aliasRow(candidateId);
    expect(row.status).toBe('PROPOSED');
    expect(row.skillId).toBeNull();
  });

  it('🔴 辞書に無い ID を正規化先にできない（400。FK 違反を 500 にしない）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await decide(ctx, candidateId, {
      decision: 'ACCEPT',
      skillId: NONEXISTENT_ID,
    });

    expect(response.status).toBe(400);
    expect((await aliasRow(candidateId)).status).toBe('PROPOSED');
  });

  it('却下に正規化先を付けたら 400（黙って捨てない）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const response = await decide(ctx, candidateId, { decision: 'REJECT', skillId: SKILL_JAVA });

    expect(response.status).toBe(400);
    expect((await aliasRow(candidateId)).status).toBe('PROPOSED');
  });

  it('🔴 二重の採否は 409（先に決まった内容が上書きされない）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    expect((await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA })).status).toBe(
      204,
    );

    const second = await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_AWS });

    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).error.code).toBe('SKILL_ALIAS_ALREADY_DECIDED');
    expect((await aliasRow(candidateId)).skillId).toBe(SKILL_JAVA);
  });

  it('🔴 `CLOSING` のテナントでは採否できないが、一覧は読める（`F-004 AC-8`）', async () => {
    await setLifecycle(TENANT_1.tenantId, 'CLOSING');
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const decided = await decide(ctx, candidateId, { decision: 'REJECT' });
    const listed = await getAliases(ctx);

    expect(decided.status).toBe(409);
    expect(listed.status).toBe(200);
    expect((await aliasRow(candidateId)).status).toBe('PROPOSED');
  });

  it('🔴 停止中の取引先の配下アカウントは採否経路に到達すらしない（403 が先）', async () => {
    await admin.partnerCompany.updateMany({
      where: { id: PARTNER_1_1.partnerCompanyId },
      data: { suspendedAt: NOW },
    });
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');

    const response = await decide(ctx, candidateId, { decision: 'REJECT' });

    // 🔴 ガードは `role` → `executable` の順（docs/05 §6.2）。パートナーはロールで先に落ちる。
    expect(response.status).toBe(403);
    expect((await aliasRow(candidateId)).status).toBe('PROPOSED');
  });

  it('境界外・不存在の候補はどちらも 404（区別しない。docs/05 §4.8）', async () => {
    const otherTenantAlias = await proposeAlias({
      tenantId: TENANT_2.tenantId,
      alias: `${MARKER}OtherTenant`,
    });
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const outOfBoundary = await decide(ctx, otherTenantAlias, { decision: 'REJECT' });
    const nonexistent = await decide(ctx, NONEXISTENT_ID, { decision: 'REJECT' });

    expect(outOfBoundary.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(await outOfBoundary.text()).toBe(await nonexistent.text());
    expect((await aliasRow(otherTenantAlias)).status).toBe('PROPOSED');
  });
});

describe('🔴 F-010 AC-2: グローバル辞書はテナントから編集できない', () => {
  it('🔴 `skills` への INSERT は DB 権限が拒否する（`GRANT SELECT` のみ）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    await expect(
      withTenant(ctx, (db) =>
        db.skill.create({
          data: { name: `${MARKER}NewSkill`, category: 'LANGUAGE', sortKey: 9999 },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow();

    expect(await admin.skill.count({ where: { name: `${MARKER}NewSkill` } })).toBe(0);
  });

  it('🔴 `skills` への UPDATE / DELETE も拒否される', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    await expect(
      withTenant(ctx, (db) =>
        db.skill.updateMany({ where: { id: SKILL_JAVA }, data: { name: `${MARKER}Renamed` } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(ctx, (db) => db.skill.deleteMany({ where: { id: SKILL_JAVA } })),
    ).rejects.toThrow();

    expect((await admin.skill.findUnique({ where: { id: SKILL_JAVA } }))?.name).toBe('Java');
  });

  it('対照: 読み取りはできる（辞書から選ぶために要る。`F-008` 処理②）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const response = await getSkills(ctx, '?q=Java');
    const body = (await response.json()) as SkillListBody;

    expect(response.status).toBe(200);
    expect(body.items.map((skill) => skill.name)).toContain('Java');
  });

  it('🔴 グローバル別名は読めるが、採否では動かせない（403）', async () => {
    const globalAliasId = await proposeAlias({ tenantId: null, alias: `${MARKER}GlobalJava` });
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    // 読める（RLS の C1 の SELECT が `OR tenant_id IS NULL` を許す）。
    const listed = (await (await getAliases(ctx)).json()) as AliasListBody;
    expect(listed.items.find((item) => item.id === globalAliasId)?.scope).toBe('GLOBAL');

    const response = await decide(ctx, globalAliasId, { decision: 'REJECT' });

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      'GLOBAL_SKILL_DICTIONARY_READ_ONLY',
    );
    expect((await aliasRow(globalAliasId)).status).toBe('PROPOSED');
  });

  it('🔴 アプリの判定を迂回してもグローバル別名は 0 件更新（RLS + 第 2 防御）', async () => {
    const globalAliasId = await proposeAlias({ tenantId: null, alias: `${MARKER}GlobalBypass` });
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    const updated = await withTenant(ctx, (db) =>
      db.skillAlias.updateMany({ where: { id: globalAliasId }, data: { status: 'REJECTED' } }),
    );

    expect(updated.count).toBe(0);
    expect((await aliasRow(globalAliasId)).status).toBe('PROPOSED');
  });

  it('🔴 グローバル別名は「どのテナントからも」読めるが、どちらからも書けない', async () => {
    const globalAliasId = await proposeAlias({ tenantId: null, alias: `${MARKER}GlobalShared` });
    const ctx1 = await ctxOf(HOST_1, 'ADMIN');
    const ctx2 = await ctxOf(HOST_2, 'ADMIN');

    const view1 = await listSkillAliases(ctx1, {});
    const view2 = await listSkillAliases(ctx2, {});

    expect(view1.items.map((item) => item.id)).toContain(globalAliasId);
    expect(view2.items.map((item) => item.id)).toContain(globalAliasId);
    expect((await decide(ctx2, globalAliasId, { decision: 'REJECT' })).status).toBe(403);
  });
});

describe('🔴 F-010 AC-2: テナント固有の別名は他テナントに影響しない', () => {
  it('同じ表記でもテナントごとに別の行であり、一方の採用が他方を動かさない', async () => {
    const alias1 = await proposeAlias({ tenantId: TENANT_1.tenantId, alias: `${MARKER}Shared` });
    const alias2 = await proposeAlias({ tenantId: TENANT_2.tenantId, alias: `${MARKER}Shared` });
    const ctx1 = await ctxOf(HOST_1, 'ADMIN');

    expect((await decide(ctx1, alias1, { decision: 'ACCEPT', skillId: SKILL_JAVA })).status).toBe(
      204,
    );

    expect((await aliasRow(alias1)).status).toBe('ACCEPTED');
    // 🔴 他テナントの同じ表記は 1 バイトも動いていない。
    expect((await aliasRow(alias2)).status).toBe('PROPOSED');
    expect((await aliasRow(alias2)).skillId).toBeNull();
  });

  it('🔴 一覧に他テナントの別名が 1 行も現れない（`F-004 AC-1`）', async () => {
    const alias1 = await proposeAlias({ tenantId: TENANT_1.tenantId, alias: `${MARKER}OnlyT1` });
    const alias2 = await proposeAlias({ tenantId: TENANT_2.tenantId, alias: `${MARKER}OnlyT2` });
    const ctx1 = await ctxOf(HOST_1, 'SALES');

    const response = await getAliases(ctx1);
    const raw = await response.text();
    const body = JSON.parse(raw) as AliasListBody;

    expect(body.items.map((item) => item.id)).toContain(alias1);
    expect(body.items.map((item) => item.id)).not.toContain(alias2);
    expect(raw).not.toContain(`${MARKER}OnlyT2`);
  });

  it('パートナー所属の利用者も自テナントの辞書・別名を読める（起票の前提。`docs/02` §4.2）', async () => {
    const aliasId = await proposeAlias({
      tenantId: TENANT_1.tenantId,
      alias: `${MARKER}PartnerRead`,
    });
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_SALES');

    const aliases = (await (await getAliases(ctx)).json()) as AliasListBody;
    const skills = (await (await getSkills(ctx)).json()) as SkillListBody;

    expect(aliases.items.map((item) => item.id)).toContain(aliasId);
    expect(skills.items.length).toBeGreaterThan(0);
  });

  it('🔴 一覧に起票者・決定者の情報が 1 つも含まれない（他社の人物を知る経路を作らない）', async () => {
    await proposeAlias({
      tenantId: TENANT_1.tenantId,
      alias: `${MARKER}NoActor`,
      proposedBy: PARTNER_1_1.userId,
    });
    const ctx = await ctxOf(HOST_1, 'SALES');

    const raw = await (await getAliases(ctx)).text();

    expect(raw).not.toContain('proposedBy');
    expect(raw).not.toContain('decidedBy');
    expect(raw).not.toContain(PARTNER_1_1.userId);
  });

  it('`?status=` と `?q=` は業務上の絞り込みであり、境界を広げない', async () => {
    const proposed = await proposeAlias({ tenantId: TENANT_1.tenantId, alias: `${MARKER}Filter1` });
    await proposeAlias({
      tenantId: TENANT_1.tenantId,
      alias: `${MARKER}Filter2`,
      status: 'ACCEPTED',
      skillId: SKILL_JAVA,
    });
    await proposeAlias({ tenantId: TENANT_2.tenantId, alias: `${MARKER}Filter3` });
    const ctx = await ctxOf(HOST_1, 'SALES');

    const body = (await (
      await getAliases(ctx, `?status=PROPOSED&q=${encodeURIComponent(MARKER)}`)
    ).json()) as AliasListBody;

    expect(body.items.map((item) => item.id)).toEqual([proposed]);
  });

  it('採用済みの別名は正規化先の名称を伴って返る（`skills` は射程外で境界を持たない）', async () => {
    const aliasId = await proposeAlias({
      tenantId: TENANT_1.tenantId,
      alias: `${MARKER}WithTarget`,
      status: 'ACCEPTED',
      skillId: SKILL_JAVA,
    });
    const ctx = await ctxOf(HOST_1, 'SALES');

    const view = await listSkillAliases(ctx, {});
    const item = view.items.find((entry) => entry.id === aliasId);

    expect(item?.skillName).toBe('Java');
    // 🔴 起票日は `id`（uuid v7）の採番時刻から読み替える（列が無いため。docs/05 §16.5 と同じ扱い）。
    expect(item?.proposedAt).not.toBeNull();
  });

  it('辞書の並びは `sortKey` 昇順で決定的である（docs/05 §4.8）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const first = await listSkills(ctx, {});
    const second = await listSkills(ctx, {});

    expect(first.items.map((skill) => skill.id)).toEqual(second.items.map((skill) => skill.id));
    expect(first.items[0]?.name).toBe('Java');
  });
});

describe('🔴 F-010 AC-3: 採用・却下が AuditLog に残る', () => {
  let candidateId: string;

  beforeEach(async () => {
    candidateId = await proposeAlias({
      tenantId: TENANT_1.tenantId,
      alias: `${MARKER}監査対象`,
      proposedBy: PARTNER_1_1.userId,
    });
  });

  it('採用が 1 件記録される（`skill_alias.update` / 決定内容 / 端末と IP）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    expect((await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA })).status).toBe(
      204,
    );

    const rows = await auditRows('skill_alias.update');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorKind).toBe('USER');
    expect(rows[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(rows[0]?.targetType).toBe('SkillAlias');
    expect(rows[0]?.targetId).toBe(candidateId);
    expect(rows[0]?.summary).toEqual({
      decision: 'ACCEPT',
      skillId: SKILL_JAVA,
      origin: 'HUMAN',
    });
    expect(rows[0]?.ipAddress).toBe(META.ipAddress);
    expect(rows[0]?.deviceKind).toBe('api');
  });

  it('却下も同じ action で記録され、`summary.decision` で区別できる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    expect((await decide(ctx, candidateId, { decision: 'REJECT' })).status).toBe(204);

    const rows = await auditRows('skill_alias.update');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toEqual({ decision: 'REJECT', skillId: null, origin: 'HUMAN' });
  });

  it('🔴 別名の表記（利用者の自由入力）が `summary` に載らない（docs/05 §16.2）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA });

    const rows = await auditRows('skill_alias.update');
    expect(JSON.stringify(rows[0]?.summary)).not.toContain('監査対象');
  });

  it('🔴 起きなかった採否は記録されない（403 / 409 / 404 / 400 のいずれでも 0 件）', async () => {
    const viewer = await ctxOf(HOST_1, 'VIEWER');
    expect((await decide(viewer, candidateId, { decision: 'REJECT' })).status).toBe(403);

    const admin1 = await ctxOf(HOST_1, 'ADMIN');
    expect((await decide(admin1, NONEXISTENT_ID, { decision: 'REJECT' })).status).toBe(404);
    expect((await decide(admin1, candidateId, { decision: 'ACCEPT' })).status).toBe(400);

    expect(await auditRows('skill_alias.update')).toHaveLength(0);

    // 対照: 実際に決めれば 1 件残る（規則が空振りしていない）。
    expect((await decide(admin1, candidateId, { decision: 'REJECT' })).status).toBe(204);
    expect(await auditRows('skill_alias.update')).toHaveLength(1);

    // 🔴 二重操作（409）でも件数が増えない。
    expect((await decide(admin1, candidateId, { decision: 'REJECT' })).status).toBe(409);
    expect(await auditRows('skill_alias.update')).toHaveLength(1);
  });

  it('🔴 `S-041` の操作種別フィルタ（`CREATE_UPDATE_DELETE`）で拾える action である', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await decide(ctx, candidateId, { decision: 'ACCEPT', skillId: SKILL_JAVA });

    const rows = await admin.auditLog.findMany({ where: { action: { endsWith: '.update' } } });
    expect(rows.map((row) => row.action)).toContain('skill_alias.update');
  });
});
