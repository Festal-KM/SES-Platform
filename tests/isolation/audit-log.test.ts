// tests/isolation/audit-log.test.ts
// T-03-05（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定:
//
//   🔴 `F-005 AC-1` `GET /api/audit-logs`（`listAuditLogs`）が期間・操作種別カテゴリ・主体 ID で
//      正しく絞り込み、`audit_logs` の SELECT が C2 HOST_ONLY（ホストのみ）であることに従う
//   🔴 `F-005 AC-2` 監査ログの書き込みに失敗した場合、**同一トランザクション内の業務書き込みが
//      ロールバックされる**（注入テスト）
//   🔴 `F-005 AC-3` `AuditLog` は利用者・運営者のいずれからも編集・削除できない
//      （`app_tenant` / `app_platform` / `app_platform_write` に対する `REVOKE` を、
//      特権接続（superuser）との対照で実測する）
//   🔴 `F-005 AC-4` `system` が主体の操作は `actorKind='SYSTEM'` として記録される
//
// 検証はアプリの実装（`apps/web/lib/audit-logs/service.ts`）をそのまま呼ぶ
// （`tests/isolation/invitations.test.ts` と同じ方針。HTTP 層の検証は E2E の範囲）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  withTenant,
  writeAuditLog,
  type AuditActorKind,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
} from '@ses/db';
import {
  createUnextendedClient,
  hasTablePrivilege,
  runUnextended,
  type UnextendedClient,
} from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { buildTenantCtx } from '../../apps/web/lib/auth/tenant-context';
import { listAuditLogs } from '../../apps/web/lib/audit-logs/service';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');
const OLD_DATE = new Date('2020-01-01T00:00:00.000Z');
const RANGE_FROM = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const RANGE_TO = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const PARTNER_1_1 = TENANT_1.partners[0];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

let database: IsolationDatabase;
/** 🔴 投入・前提づくり・「保存されている生の値」の確認、および AC-3 の対照検証にだけ使う特権接続。 */
let admin: UnextendedClient;
/** 🔴 `app_tenant` ロールの素の接続（AC-3 の実測: REVOKE の効果を拡張なしで直接見る）。 */
let rawTenant: UnextendedClient;

async function ctxOf(identity: TenantIdentity, role: string): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function setRole(identity: TenantIdentity, role: string): Promise<void> {
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
  rawTenant = createUnextendedClient(database.tenantUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await rawTenant?.$disconnect();
  await database?.stop();
});

describe('🔴 F-005 AC-1: GET /api/audit-logs（listAuditLogs）', () => {
  it('期間内の行のみを返し、期間外は除外される（境界の COUNT ではなく行そのもので確かめる）', async () => {
    const actorId = '00000000-0000-7000-8000-0000000000f1';
    await admin.auditLog.create({
      data: {
        tenantId: TENANT_1.tenantId,
        actorKind: 'USER',
        actorId,
        action: 'auth.login',
        summary: {},
        createdAt: OLD_DATE,
      },
    });
    await admin.auditLog.create({
      data: {
        tenantId: TENANT_1.tenantId,
        actorKind: 'USER',
        actorId,
        action: 'auth.login',
        summary: {},
        createdAt: NOW,
      },
    });

    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const page = await listAuditLogs(ctx, {
      from: RANGE_FROM,
      to: RANGE_TO,
      limit: 50,
      actorId,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.createdAt).toBe(NOW.toISOString());
  });

  it('🔴 audit_logs の SELECT は C2 HOST_ONLY: パートナー文脈からは同じ条件でも 0 件', async () => {
    const actorId = '00000000-0000-7000-8000-0000000000f1';
    const partnerCtx = await ctxOf(PARTNER_USER, 'PARTNER_ADMIN');

    const page = await listAuditLogs(partnerCtx, {
      from: RANGE_FROM,
      to: RANGE_TO,
      limit: 50,
      actorId,
    });

    expect(page.items).toHaveLength(0);
  });

  it('操作種別カテゴリで絞り込める（CREATE_UPDATE_DELETE はサフィックス一致）', async () => {
    const actorId = '00000000-0000-7000-8000-0000000000f2';
    await admin.auditLog.createMany({
      data: [
        {
          tenantId: TENANT_1.tenantId,
          actorKind: 'USER',
          actorId,
          action: 'invitation.create',
          summary: {},
          createdAt: NOW,
        },
        {
          tenantId: TENANT_1.tenantId,
          actorKind: 'USER',
          actorId,
          action: 'auth.login',
          summary: {},
          createdAt: NOW,
        },
      ],
    });

    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const page = await listAuditLogs(ctx, {
      from: RANGE_FROM,
      to: RANGE_TO,
      limit: 50,
      actorId,
      action: 'CREATE_UPDATE_DELETE',
    });

    expect(page.items.map((item) => item.action)).toEqual(['invitation.create']);
  });

  it('actorKind=USER の行は表示名を解決し、actorKind=SYSTEM は null のまま', async () => {
    const hostUser = await admin.user.findUniqueOrThrow({ where: { id: TENANT_1.hostUserId } });
    await admin.auditLog.create({
      data: {
        tenantId: TENANT_1.tenantId,
        actorKind: 'USER',
        actorId: TENANT_1.hostUserId,
        action: 'engineer.view',
        summary: {},
        createdAt: NOW,
      },
    });
    await admin.auditLog.create({
      data: {
        tenantId: TENANT_1.tenantId,
        actorKind: 'SYSTEM',
        actorId: null,
        action: 'retention.delete',
        summary: {},
        createdAt: NOW,
      },
    });

    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const page = await listAuditLogs(ctx, {
      from: RANGE_FROM,
      to: RANGE_TO,
      limit: 200,
    });

    const userRow = page.items.find(
      (item) => item.actorId === TENANT_1.hostUserId && item.action === 'engineer.view',
    );
    expect(userRow?.actorDisplayName).toBe(hostUser.displayName);

    const systemRow = page.items.find((item) => item.action === 'retention.delete');
    expect(systemRow?.actorKind).toBe('SYSTEM');
    expect(systemRow?.actorDisplayName).toBeNull();
  });

  it('🔴 カーソルページングで重複なく全件を辿れる（total を数え直さない）', async () => {
    const actorId = '00000000-0000-7000-8000-0000000000f3';
    await admin.auditLog.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        tenantId: TENANT_1.tenantId,
        actorKind: 'USER' as const,
        actorId,
        action: 'auth.login',
        summary: { seq: index },
        createdAt: new Date(NOW.getTime() + index * 1_000),
      })),
    });

    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page = await listAuditLogs(ctx, {
        from: RANGE_FROM,
        to: RANGE_TO,
        limit: 2,
        actorId,
        ...(cursor === null ? {} : { cursor }),
      });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      guard += 1;
    } while (cursor !== null && guard < 10);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5); // 重複なし
  });
});

describe('🔴 F-005 AC-4: system が主体の操作は actorKind=SYSTEM として記録される', () => {
  it('actorId 無しで書け、ホストからは actorKind=SYSTEM として読める', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');

    await withTenant(ctx, (db) =>
      writeAuditLog(db, {
        action: 'auth.2fa.throttled',
        actorKind: 'SYSTEM',
        summary: { reason: 'test' },
      }),
    );

    const rows = await withTenant(ctx, (db) =>
      db.auditLog.findMany({ where: { action: 'auth.2fa.throttled', actorKind: 'SYSTEM' } }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actorId === null)).toBe(true);
  });
});

describe('🔴 F-005 AC-2: 監査ログの書き込みに失敗したら対象操作を成立させない（注入テスト）', () => {
  it('同一トランザクション内の業務書き込みが、監査ログの CHECK 制約違反でロールバックされる', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const email = 'audit-rollback-check@seed-isolation.test';

    await expect(
      withTenant(ctx, async (db) => {
        await db.invitation.create({
          data: {
            tenantId: ctx.tenantId,
            email,
            role: 'VIEWER',
            partnerCompanyId: null,
            tokenHash: 'a'.repeat(64),
            expiresAt: new Date(NOW.getTime() + 60_000),
            invitedBy: ctx.userId,
          },
        });
        // 🔴 意図的に注入する失敗: actor_kind は 'USER'|'PLATFORM_USER'|'SYSTEM' の CHECK 制約のみ許す。
        await writeAuditLog(db, {
          action: 'invitation.create',
          actorKind: 'BOGUS' as unknown as AuditActorKind,
          actorId: ctx.userId,
          summary: {},
        });
      }),
    ).rejects.toThrow(/audit_logs_actor_kind_check/);

    // 🔴 特権接続で確認: invitation の作成は成立していない（トランザクション全体がロールバックされた）。
    const found = await admin.invitation.findFirst({ where: { email } });
    expect(found).toBeNull();
  });
});

describe('🔴 F-005 AC-3: AuditLog は利用者・運営者のいずれからも編集・削除できない', () => {
  it('app_tenant / app_platform / app_platform_write のいずれも UPDATE / DELETE 権限を持たない（GRANT メタデータ）', async () => {
    for (const role of ['app_tenant', 'app_platform', 'app_platform_write'] as const) {
      expect(
        await hasTablePrivilege(rawTenant, role, 'audit_logs', 'UPDATE'),
        `${role}: audit_logs に UPDATE 権限がある`,
      ).toBe(false);
      expect(
        await hasTablePrivilege(rawTenant, role, 'audit_logs', 'DELETE'),
        `${role}: audit_logs に DELETE 権限がある`,
      ).toBe(false);
    }
    // 🔴 対照（空振り防止）: app_tenant は SELECT / INSERT を持つ（REVOKE が全権限剥奪ではないことの確認）。
    expect(await hasTablePrivilege(rawTenant, 'app_tenant', 'audit_logs', 'SELECT')).toBe(true);
    expect(await hasTablePrivilege(rawTenant, 'app_tenant', 'audit_logs', 'INSERT')).toBe(true);
  });

  it('🔴 実測: app_tenant が UPDATE / DELETE を試みると permission denied。特権接続（superuser）では成立する（対照）', async () => {
    const seeded = await admin.auditLog.create({
      data: {
        tenantId: TENANT_1.tenantId,
        actorKind: 'SYSTEM',
        action: 'test.audit_log_revoke_check',
        summary: {},
      },
    });
    const scope = { tenantId: TENANT_1.tenantId, partnerCompanyId: null, actorUserId: TENANT_1.hostUserId };

    await expect(
      runUnextended(rawTenant, scope, (tx) =>
        tx.auditLog.updateMany({ where: { id: seeded.id }, data: { summary: { touched: true } } }),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      runUnextended(rawTenant, scope, (tx) => tx.auditLog.deleteMany({ where: { id: seeded.id } })),
    ).rejects.toThrow(/permission denied/i);

    // 🔴 対照: 特権接続（superuser）では同じ更新が成立する。
    //    REVOKE が「誰にも書けない」わけではなく、app_tenant / app_platform* に限定されていることの証明。
    const updated = await admin.auditLog.update({
      where: { id: seeded.id },
      data: { summary: { touched: true } },
    });
    expect(updated.summary).toEqual({ touched: true });
  });
});
