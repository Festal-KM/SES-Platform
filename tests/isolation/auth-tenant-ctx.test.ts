// tests/isolation/auth-tenant-ctx.test.ts
// T-03-01（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定:
//
//   🔴 `F-003 AC-1`「リクエストのボディ・クエリ・パスにテナント識別子やパートナー識別子を
//      含めても、参照範囲は変化しない」（= `F-004 AC-2`）を **DB 付きで**実証する。
//   🔴 `F-003 AC-3`「ログイン・ログアウト・認証失敗が監査ログに記録される」。
//   🔴 `F-004 AC-2` の裏返しとして、認証コンテキストの所属が食い違う場合に
//      **0 件ではなく ctx を作らせない**（fail-closed）ことを固定する。
//
// 検証はアプリの実装（`apps/web/lib/auth/**`）をそのまま呼ぶ。HTTP 層（Route Handler）を
// 通した検証は E2E（T-03-11）が行う —— ここで見たいのは「入力が境界に影響しないこと」であり、
// それを決めているのは `signInBodySchema` → `authenticateCredentials` → `buildTenantCtx` の
// 3 段であって、HTTP のフレーミングではない。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import {
  authenticateCredentials,
  recordSignOut,
  type AuthAttemptMeta,
} from '../../apps/web/lib/auth/credentials';
import { hashPassword } from '../../apps/web/lib/auth/password';
import { signInBodySchema } from '../../apps/web/lib/auth/schemas';
import { buildTenantCtx } from '../../apps/web/lib/auth/tenant-context';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');

const PASSWORD = 'T-03-01 integration passphrase';
const WRONG_PASSWORD = 'T-03-01 wrong passphrase';

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

/** 🔴 `packages/db/seed/presets/isolation.ts` の `seedEmail()` と同じ規則。 */
const EMAIL = {
  hostT1: 'host-t1@seed-isolation.test',
  hostT2: 'host-t2@seed-isolation.test',
  partnerT1P1: 'partner-t1-p1@seed-isolation.test',
  partnerT1P2: 'partner-t1-p2@seed-isolation.test',
} as const;

const META: AuthAttemptMeta = { deviceKind: 'api', ipAddress: '203.0.113.10' };

let database: IsolationDatabase;
/** 🔴 投入・前提づくりだけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

async function countAuditLogs(
  ctx: AuthenticatedTenantCtx,
  where: { readonly action: string; readonly actorId: string },
): Promise<number> {
  return withTenant(ctx, (db) => db.auditLog.count({ where }));
}

async function hostCtxOfTenant1(): Promise<AuthenticatedTenantCtx> {
  const ctx = await buildTenantCtx(
    {
      tenantId: TENANT_1.tenantId,
      partnerCompanyId: null,
      userId: TENANT_1.hostUserId,
    },
    { deviceKind: 'api' },
  );
  if (ctx === null) throw new Error('テナント 1 のホスト ctx を作れませんでした（前提の破綻）。');
  return ctx;
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
  // 🔴 シードは `passwordHash` にプレースホルダを入れる（実ハッシュを合成データに焼き込まない）。
  //    認証経路を通すため、このテストの中でだけ実際の Argon2id ハッシュに差し替える。
  await admin.user.updateMany({ data: { passwordHash: await hashPassword(PASSWORD) } });

  configureTenantDb({ datasourceUrl: database.tenantUrl });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

describe('🔴 F-003 AC-1: 入力を改変しても参照範囲が変わらない', () => {
  it('body に他テナント / 他パートナーの識別子を混ぜても、確定する所属が変わらない', async () => {
    const clean = signInBodySchema.parse({ email: EMAIL.partnerT1P1, password: PASSWORD });
    const polluted = signInBodySchema.parse({
      email: EMAIL.partnerT1P1,
      password: PASSWORD,
      // 🔴 他テナント・他パートナー・上位ロールを body で主張する。
      tenantId: TENANT_2.tenantId,
      partnerCompanyId: PARTNER_1_2.partnerCompanyId,
      ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
      role: 'OWNER',
      lifecycleState: 'ACTIVE',
    });

    const a = await authenticateCredentials(clean, META);
    const b = await authenticateCredentials(polluted, META);

    expect(a).toEqual({
      outcome: 'AUTHENTICATED',
      claims: {
        tenantId: TENANT_1.tenantId,
        partnerCompanyId: PARTNER_1_1.partnerCompanyId,
        userId: PARTNER_1_1.userId,
      },
    });
    expect(b).toEqual(a);
  });

  it('改変した body から作った ctx でも、見えるエンジニアの集合が同一である', async () => {
    const polluted = signInBodySchema.parse({
      email: EMAIL.partnerT1P1,
      password: PASSWORD,
      tenantId: TENANT_2.tenantId,
      partnerCompanyId: PARTNER_1_2.partnerCompanyId,
    });
    const result = await authenticateCredentials(polluted, META);
    if (result.outcome !== 'AUTHENTICATED') throw new Error('認証に失敗しました（前提の破綻）。');

    const ctx = await buildTenantCtx(result.claims, { deviceKind: 'api' });
    expect(ctx).not.toBeNull();
    if (ctx === null) return;

    expect(ctx.tenantId).toBe(TENANT_1.tenantId);
    expect(ctx.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    // 🔴 ロールも body の主張（OWNER）ではなく `memberships` の値になる。
    expect(ctx.role).toBe('PARTNER_SALES');

    const visible = await withTenant(ctx, (db) =>
      db.engineer.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    expect(visible.map((row) => row.id)).toEqual([PARTNER_1_1.engineerId]);
  });

  it('他テナントのエンジニアは ID を直接指定しても 0 件（F-004 AC-1）', async () => {
    const ctx = await hostCtxOfTenant1();
    const found = await withTenant(ctx, (db) =>
      db.engineer.findFirst({ where: { id: TENANT_2.hostEngineerId }, select: { id: true } }),
    );
    expect(found).toBeNull();
  });
});

describe('🔴 認証コンテキストの確定は DB の memberships が正（fail-closed）', () => {
  it('パートナー所属の利用者がホスト（partnerCompanyId=null）を主張しても ctx を作らせない', async () => {
    const ctx = await buildTenantCtx(
      {
        tenantId: TENANT_1.tenantId,
        partnerCompanyId: null,
        userId: PARTNER_1_1.userId,
      },
      { deviceKind: 'api' },
    );
    expect(ctx).toBeNull();
  });

  it('ホスト所属の利用者がパートナー所属を主張しても ctx を作らせない', async () => {
    const ctx = await buildTenantCtx(
      {
        tenantId: TENANT_1.tenantId,
        partnerCompanyId: PARTNER_1_1.partnerCompanyId,
        userId: TENANT_1.hostUserId,
      },
      { deviceKind: 'api' },
    );
    expect(ctx).toBeNull();
  });

  it('他テナントの利用者 ID を主張しても ctx を作らせない', async () => {
    const ctx = await buildTenantCtx(
      {
        tenantId: TENANT_1.tenantId,
        partnerCompanyId: null,
        userId: TENANT_2.hostUserId,
      },
      { deviceKind: 'api' },
    );
    expect(ctx).toBeNull();
  });

  it('Membership を失効させると、次の呼び出しから ctx を作れなくなる', async () => {
    await admin.membership.updateMany({
      where: { id: PARTNER_1_2.membershipId },
      data: { revokedAt: NOW },
    });
    try {
      const ctx = await buildTenantCtx(
        {
          tenantId: TENANT_1.tenantId,
          partnerCompanyId: PARTNER_1_2.partnerCompanyId,
          userId: PARTNER_1_2.userId,
        },
        { deviceKind: 'api' },
      );
      expect(ctx).toBeNull();
    } finally {
      await admin.membership.updateMany({
        where: { id: PARTNER_1_2.membershipId },
        data: { revokedAt: null },
      });
    }
  });

  it('ロールとライフサイクル状態は DB の値になる（セッションから来ない）', async () => {
    const ctx = await hostCtxOfTenant1();
    expect(ctx.role).toBe('SALES');
    // seed:isolation はテナント 1 を SANDBOX で開設し ACTIVE へ遷移させる。
    expect(ctx.lifecycleState).toBe('ACTIVE');
  });
});

describe('🔴 F-003 AC-3: ログイン・ログアウト・認証失敗が監査ログに記録される', () => {
  it('成功したログインが auth.login として記録される', async () => {
    const ctx = await hostCtxOfTenant1();
    const before = await countAuditLogs(ctx, {
      action: 'auth.login',
      actorId: TENANT_1.hostUserId,
    });

    const result = await authenticateCredentials(
      { email: EMAIL.hostT1, password: PASSWORD },
      META,
    );
    expect(result.outcome).toBe('AUTHENTICATED');

    const after = await countAuditLogs(ctx, {
      action: 'auth.login',
      actorId: TENANT_1.hostUserId,
    });
    expect(after).toBe(before + 1);
  });

  it('パスワード不一致が auth.login_failed として記録される（応答は成功と区別できる情報を持たない）', async () => {
    const ctx = await hostCtxOfTenant1();
    const before = await countAuditLogs(ctx, {
      action: 'auth.login_failed',
      actorId: TENANT_1.hostUserId,
    });

    const result = await authenticateCredentials(
      { email: EMAIL.hostT1, password: WRONG_PASSWORD },
      META,
    );
    // 🔴 失敗理由を返さない（docs/04 §S-001）。
    expect(result).toEqual({ outcome: 'REJECTED' });

    const rows = await withTenant(ctx, (db) =>
      db.auditLog.findMany({
        where: { action: 'auth.login_failed', actorId: TENANT_1.hostUserId },
        select: { summary: true, deviceKind: true, ipAddress: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toEqual({ reason: 'PASSWORD_MISMATCH' });
    expect(rows[0]?.deviceKind).toBe('api');
    expect(rows[0]?.ipAddress).toBe('203.0.113.10');

    const after = await countAuditLogs(ctx, {
      action: 'auth.login_failed',
      actorId: TENANT_1.hostUserId,
    });
    expect(after).toBe(before + 1);
  });

  it('無効化されたアカウントは USER_DISABLED として記録され、応答は同じ REJECTED', async () => {
    const ctx = await hostCtxOfTenant1();
    await admin.user.updateMany({
      where: { id: TENANT_1.hostUserId },
      data: { disabledAt: NOW },
    });
    try {
      const result = await authenticateCredentials(
        { email: EMAIL.hostT1, password: PASSWORD },
        META,
      );
      expect(result).toEqual({ outcome: 'REJECTED' });

      const rows = await withTenant(ctx, (db) =>
        db.auditLog.findMany({
          where: { action: 'auth.login_failed', actorId: TENANT_1.hostUserId },
          select: { summary: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        }),
      );
      expect(rows[0]?.summary).toEqual({ reason: 'USER_DISABLED' });
    } finally {
      await admin.user.updateMany({
        where: { id: TENANT_1.hostUserId },
        data: { disabledAt: null },
      });
    }
  });

  it('存在しないアカウントへの試行では AuditLog に行を作らない（テナントが確定しないため）', async () => {
    const ctx = await hostCtxOfTenant1();
    const before = await withTenant(ctx, (db) => db.auditLog.count());

    const result = await authenticateCredentials(
      { email: 'nobody@seed-isolation.test', password: PASSWORD },
      META,
    );
    expect(result).toEqual({ outcome: 'REJECTED' });

    const after = await withTenant(ctx, (db) => db.auditLog.count());
    expect(after).toBe(before);
  });

  it('🔴 パートナーのログインも記録され、その行を読めるのはホストだけである（C1 INSERT / C2 SELECT）', async () => {
    const hostCtx = await hostCtxOfTenant1();
    const before = await countAuditLogs(hostCtx, {
      action: 'auth.login',
      actorId: PARTNER_1_1.userId,
    });

    const result = await authenticateCredentials(
      { email: EMAIL.partnerT1P1, password: PASSWORD },
      META,
    );
    if (result.outcome !== 'AUTHENTICATED') throw new Error('認証に失敗しました（前提の破綻）。');

    // ホストからは増えて見える。
    const after = await countAuditLogs(hostCtx, {
      action: 'auth.login',
      actorId: PARTNER_1_1.userId,
    });
    expect(after).toBe(before + 1);

    // 🔴 パートナー自身からは監査ログが 1 件も見えない（audit_logs の SELECT は C2 HOST_ONLY）。
    const partnerCtx = await buildTenantCtx(result.claims, { deviceKind: 'api' });
    expect(partnerCtx).not.toBeNull();
    if (partnerCtx === null) return;
    const visibleToPartner = await withTenant(partnerCtx, (db) => db.auditLog.count());
    expect(visibleToPartner).toBe(0);
  });

  it('サインアウトが auth.logout として記録される', async () => {
    const ctx = await hostCtxOfTenant1();
    const before = await countAuditLogs(ctx, {
      action: 'auth.logout',
      actorId: TENANT_1.hostUserId,
    });

    await recordSignOut(
      {
        tenantId: TENANT_1.tenantId,
        partnerCompanyId: null,
        userId: TENANT_1.hostUserId,
      },
      META,
    );

    const after = await countAuditLogs(ctx, {
      action: 'auth.logout',
      actorId: TENANT_1.hostUserId,
    });
    expect(after).toBe(before + 1);
  });

  it('🔴 監査ログはテナント境界の内側にしか現れない（他テナントからは 0 件）', async () => {
    const otherTenantCtx = await buildTenantCtx(
      {
        tenantId: TENANT_2.tenantId,
        partnerCompanyId: null,
        userId: TENANT_2.hostUserId,
      },
      { deviceKind: 'api' },
    );
    expect(otherTenantCtx).not.toBeNull();
    if (otherTenantCtx === null) return;

    const leaked = await countAuditLogs(otherTenantCtx, {
      action: 'auth.login',
      actorId: TENANT_1.hostUserId,
    });
    expect(leaked).toBe(0);
  });
});

describe('🔴 sign-in の照合は該当 1 行のみを可視にする（docs/05 §4.4.2 withAuthLookup）', () => {
  it('別テナントの同種アカウント（host-t2）で認証しても、確定するのはそのテナントだけ', async () => {
    const result = await authenticateCredentials(
      // 🔴 body に「テナント 1」を主張しても無視される。
      signInBodySchema.parse({
        email: EMAIL.hostT2,
        password: PASSWORD,
        tenantId: TENANT_1.tenantId,
      }),
      META,
    );
    expect(result).toEqual({
      outcome: 'AUTHENTICATED',
      claims: {
        tenantId: TENANT_2.tenantId,
        partnerCompanyId: null,
        userId: TENANT_2.hostUserId,
      },
    });
  });

  it('パートナー 2 の利用者はパートナー 1 のエンジニアを 1 件も読めない（第二境界）', async () => {
    const result = await authenticateCredentials(
      { email: EMAIL.partnerT1P2, password: PASSWORD },
      META,
    );
    if (result.outcome !== 'AUTHENTICATED') throw new Error('認証に失敗しました（前提の破綻）。');
    const ctx = await buildTenantCtx(result.claims, { deviceKind: 'api' });
    if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');

    const visible = await withTenant(ctx, (db) =>
      db.engineer.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    expect(visible.map((row) => row.id)).toEqual([PARTNER_1_2.engineerId]);

    const other = await withTenant(ctx, (db) =>
      db.engineer.findFirst({
        where: { id: PARTNER_1_1.engineerId },
        select: { id: true },
      }),
    );
    expect(other).toBeNull();
  });
});
