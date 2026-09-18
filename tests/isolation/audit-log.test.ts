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
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
import { REPO_ROOT, startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

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

// ============================================================================
// 🔴 T-12-13 ①（SP-09 T-09-09 ③-① の申し送り）: migration 20260929000000（`audit_logs.target_type` の表記統一）の再生
// ============================================================================
// `prisma migrate deploy` は起動時（`startIsolationDatabase`）に空の `audit_logs` へ本 migration を適用済みである。ここでは
// **旧表記の行がある状態**で、デプロイと同じロール（`app_migrator` = 所有者。`NOBYPASSRLS` + FORCE RLS）で同じ SQL を流し、
//   ① `target_type = 'PROPOSAL' AND action LIKE 'proposal.%'` の行だけが `'Proposal'` に移る（FORCE RLS の下で「0 件で成功」に
//      ならない —— migration が FORCE を一時解除しているから。対照の 2 本目が「解除しなければ 0 件」を実測する）
//   ② 移った行の他の列（`action` / `summary` / `actor_*` / `target_id` / `created_at`）は 1 バイトも変わらない（表記の統一であり改変ではない）
//   ③ 射程外の行（`proposal_request.*`〔下線〕/ `action` が提案でない `'PROPOSAL'` / 既に `'Proposal'`）と `review_gates.target_type`
//      （別の列）は不変
//   ④ 流し終えた後は FORCE ROW LEVEL SECURITY が戻っている
// をトランザクションの中で確かめ、最後にロールバックする（他のテストの母集団に影響させない）。

/** migration.sql を文ごとに分ける（`--` コメント / `$$ … $$` のドル引用 / `'…'` を尊重する。Prisma の `$executeRawUnsafe` は 1 文ずつ）。 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;
  let inSingleQuote = false;
  let dollarTag: string | null = null;
  while (index < sql.length) {
    const ch = sql[index] ?? '';
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        current += ch;
        index += 1;
      }
      continue;
    }
    if (inSingleQuote) {
      current += ch;
      if (ch === "'") inSingleQuote = false;
      index += 1;
      continue;
    }
    if (ch === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      index += 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (tag !== null) {
        dollarTag = tag[0];
        current += tag[0];
        index += tag[0].length;
        continue;
      }
    }
    if (ch === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      index += 1;
      continue;
    }
    current += ch;
    index += 1;
  }
  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

const TARGET_TYPE_MIGRATION = path.join(
  REPO_ROOT,
  'packages/db/prisma/migrations/20260929000000_audit_target_type_proposal/migration.sql',
);

/** ロールバック専用の印（`$transaction` の callback から投げて、観測値だけを持ち帰る）。 */
class ReplayRollback extends Error {
  constructor(readonly observed: unknown) {
    super('T-12-13 ①: 再生の観測が終わったのでロールバックする');
    this.name = 'ReplayRollback';
  }
}

type ReplayAuditRow = Record<string, unknown>;

type ReplayObserved = {
  readonly gatesBefore: number;
  readonly gatesAfter: number;
  readonly rows: readonly { readonly key: string; readonly before: ReplayAuditRow; readonly after: ReplayAuditRow | null }[];
  readonly forced: readonly { readonly relname: string; readonly relrowsecurity: boolean; readonly relforcerowsecurity: boolean }[];
  readonly remaining: number;
};

describe('🔴 T-12-13 ①: migration 20260929000000（audit_logs.target_type の表記統一）を app_migrator で再生する', () => {
  it("'PROPOSAL' + proposal.% の行だけが 'Proposal' に移り、他の列・射程外の行・review_gates は不変。FORCE RLS は戻る", async () => {
    const statements = splitSqlStatements(readFileSync(TARGET_TYPE_MIGRATION, 'utf8').replace(/\r\n/g, '\n'));
    // 対照（空振り防止）: 分割が FORCE の一時解除 / UPDATE / DO ブロック 2 つ / FORCE の復帰を 1 文ずつ取り出している。
    expect(statements.filter((statement) => statement.startsWith('UPDATE audit_logs'))).toHaveLength(1);
    expect(statements.filter((statement) => /^DO \$\$/.test(statement))).toHaveLength(2);
    expect(statements.filter((statement) => /NO FORCE ROW LEVEL SECURITY$/.test(statement))).toHaveLength(1);
    expect(statements.filter((statement) => /"audit_logs" FORCE ROW LEVEL SECURITY$/.test(statement))).toHaveLength(1);

    const createdAt = new Date('2026-09-10T01:02:03.456Z');
    const targetId = '01930000-0000-7000-8000-00000000d213';
    const marker = 'T1213-replay';
    const seedRows = [
      // 移る: 旧表記 + 提案の action（`gate.run` の `GATE_RESULT` / #39 の `GATE_REQUEST` が残していた形）。
      { key: 'legacy-gate-result', targetType: 'PROPOSAL', action: 'proposal.update', actorKind: 'SYSTEM', actorId: null, summary: { operation: 'GATE_RESULT', overall: 'PASS', marker } },
      { key: 'legacy-gate-request', targetType: 'PROPOSAL', action: 'proposal.update', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { operation: 'GATE_REQUEST', marker } },
      // 移らない: action が `proposal_request.*`（下線。`LIKE 'proposal.%'` に一致しない）。
      { key: 'request-underscore', targetType: 'PROPOSAL', action: 'proposal_request.create', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { marker } },
      // 移らない: action が提案でない。
      { key: 'other-action', targetType: 'PROPOSAL', action: 'project.view', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { marker } },
      // 移らない（既に統一済み）。
      { key: 'already-unified', targetType: 'Proposal', action: 'proposal.approve', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { operation: 'APPROVE', marker } },
    ] as const;

    const observed = await admin
      .$transaction(
        async (tx) => {
          // 1. 旧表記の行と対照の行を superuser で入れる（RLS を素通りする。`id` は既定の uuidv7）。
          const ids = new Map<string, string>();
          for (const row of seedRows) {
            const created = await tx.auditLog.create({
              data: {
                tenantId: TENANT_1.tenantId,
                actorKind: row.actorKind,
                actorId: row.actorId,
                action: row.action,
                targetType: row.targetType,
                targetId,
                summary: row.summary,
                ipAddress: '203.0.113.213',
                deviceKind: 'desktop',
                createdAt,
              },
              select: { id: true },
            });
            ids.set(row.key, created.id);
          }
          const select = {
            id: true,
            tenantId: true,
            actorKind: true,
            actorId: true,
            action: true,
            targetType: true,
            targetId: true,
            summary: true,
            ipAddress: true,
            deviceKind: true,
            createdAt: true,
          } as const;
          const before = new Map<string, ReplayAuditRow>();
          for (const [key, id] of ids) {
            before.set(key, await tx.auditLog.findUniqueOrThrow({ where: { id }, select }));
          }
          const gatesBefore = await tx.reviewGate.count({ where: { targetType: 'PROPOSAL' } });

          // 2. 🔴 デプロイと同じロールで流す（superuser ではない = FORCE RLS が効く側）。`SET LOCAL` はこのトランザクション限り。
          await tx.$executeRawUnsafe('SET LOCAL ROLE app_migrator');
          for (const statement of statements) {
            await tx.$executeRawUnsafe(statement);
          }
          await tx.$executeRawUnsafe('RESET ROLE');

          // 3. 観測（superuser に戻して全行を読む）。
          const rows: { key: string; before: ReplayAuditRow; after: ReplayAuditRow | null }[] = [];
          for (const [key, id] of ids) {
            rows.push({ key, before: before.get(key) ?? {}, after: await tx.auditLog.findUnique({ where: { id }, select }) });
          }
          const gatesAfter = await tx.reviewGate.count({ where: { targetType: 'PROPOSAL' } });
          const forced = await tx.$queryRawUnsafe<ReplayObserved['forced'][number][]>(
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'audit_logs'",
          );
          const remaining = await tx.auditLog.count({ where: { targetType: 'PROPOSAL', action: { startsWith: 'proposal.' } } });
          throw new ReplayRollback({ gatesBefore, gatesAfter, rows, forced, remaining } satisfies ReplayObserved);
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (error instanceof ReplayRollback) return error.observed as ReplayObserved;
        throw error;
      });

    // ① 移る 2 行は `'Proposal'` に、③ 射程外の 3 行は元のまま。
    const byKey = new Map(observed.rows.map((row) => [row.key, row]));
    expect(byKey.get('legacy-gate-result')?.after?.targetType).toBe('Proposal');
    expect(byKey.get('legacy-gate-request')?.after?.targetType).toBe('Proposal');
    expect(byKey.get('request-underscore')?.after?.targetType).toBe('PROPOSAL');
    expect(byKey.get('other-action')?.after?.targetType).toBe('PROPOSAL');
    expect(byKey.get('already-unified')?.after?.targetType).toBe('Proposal');
    expect(observed.remaining).toBe(0);
    // ② `target_type` 以外の列は 1 バイトも変わらない（誰が・いつ・何をしたか）。
    for (const row of observed.rows) {
      expect(row.after, row.key).not.toBeNull();
      const withoutTargetType = (values: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(values).filter(([column]) => column !== 'targetType'));
      expect(withoutTargetType(row.after ?? {}), row.key).toEqual(withoutTargetType(row.before));
      expect((row.after ?? {}).createdAt).toEqual(createdAt);
    }
    // ③ `review_gates.target_type`（別の列）は件数ごと不変（シードが `'PROPOSAL'` の行を持つので 0 件の空振りではない）。
    expect(observed.gatesBefore).toBeGreaterThan(0);
    expect(observed.gatesAfter).toBe(observed.gatesBefore);
    // ④ FORCE ROW LEVEL SECURITY が戻っている。
    expect(observed.forced).toEqual([{ relname: 'audit_logs', relrowsecurity: true, relforcerowsecurity: true }]);

    // 後始末の対照: ロールバックされたので、入れた行は残っていない（他のテストの母集団に影響しない）。
    expect(await admin.auditLog.count({ where: { targetId } })).toBe(0);
  });

  it('🔴 対照: FORCE を外さずに app_migrator が同じ UPDATE を流すと 0 件で「成功」する（migration が一時解除する理由）', async () => {
    const targetId = '01930000-0000-7000-8000-00000000d214';
    type Observed = { readonly updated: number; readonly after: { readonly targetType: string | null } | null };
    const observed = await admin
      .$transaction(async (tx) => {
        await tx.auditLog.create({
          data: { tenantId: TENANT_1.tenantId, actorKind: 'SYSTEM', action: 'proposal.update', targetType: 'PROPOSAL', targetId, summary: { operation: 'GATE_RESULT' } },
        });
        await tx.$executeRawUnsafe('SET LOCAL ROLE app_migrator');
        const updated = await tx.$executeRawUnsafe(
          "UPDATE audit_logs SET target_type = 'Proposal' WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%'",
        );
        await tx.$executeRawUnsafe('RESET ROLE');
        const after = await tx.auditLog.findFirst({ where: { targetId }, select: { targetType: true } });
        throw new ReplayRollback({ updated, after } satisfies Observed);
      })
      .catch((error: unknown) => {
        if (error instanceof ReplayRollback) return error.observed as Observed;
        throw error;
      });
    expect(observed.updated).toBe(0);
    expect(observed.after?.targetType).toBe('PROPOSAL');
  });
});
