// tests/isolation/admin-deletion-status.test.ts
// API-A12 `GET /api/admin/tenants/{id}/deletion-status`（`readDeletionStatus`。docs/05 §6.9 / `F-062 AC-7` / `F-064 AC-2` /
// `BR-40` / `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーであって内容ではない」）。T-10-10。
//
// 🔴 ここで実証するのは次の 9 点である（`admin-tenant-health.test.ts` / `platform-plane.test.ts` の作法。**実 DB（RLS 付き）**）:
//   ① `TenantPurgeRun` を `RUNNING` / `COMPLETED` / `FAILED` で仕込むと、`cause='TENANT_PURGED'` の行が**新しい順**に返り、
//      各行のキー集合は `{ cause, status, startedAt, completedAt, counts }` に固定される（`failureReason` は**キーとして存在しない**）
//   ② `counts` は表ごとの件数（`Record<table, number>`）で、`COMPLETED` で埋まり `RUNNING` / `FAILED` は `{}`
//   ③ `RETENTION`（`F-046`。Phase 2）の行は Phase 1 の応答に**載らない**（仕込んだ件数が JSON に 1 バイトも現れない）
//   ④ 🔴 仕込んだ `failure_reason` の値が応答の JSON に現れない（`A-005` にも出さない自由文。列は `app_platform` から REVOKE 済み）
//   ⑤ 存在しないテナントは `null`（404）。呼び出しても業務データは 1 行も変わらない
//   ⑥ `PLATFORM_SUPPORT` でも同じ応答（`F-062 AC-7`「閲覧は PLATFORM_SUPPORT にも許される」）
//   ⑦ 読み取りが `AuditLog(admin.deletion_status.view)` に**対象テナントに閉じて**記録され、呼び出しごとに 1 行増える
//   ⑧ 🔴 `failureReason` を select すると DB が `permission denied`（型を破っても読めない。docs/05 §5.5 第 1 層）
//   ⑨ 🔴 `A-003`（API-A3 `getPlatformTenantDetail`）と `A-005` 項目 7（`readPurgeJobFailures`）の応答に削除完了の確認
//      （`counts` / `purgeRuns` / 完了日時）が無い —— 仕込んだ件数が JSON に現れず、項目 7 は失敗の件数だけを返し、
//      同じテナント × 原因で後に `COMPLETED` があれば対応済みとして落ちる（docs/05 §6.9「API-A12 以外に…作らない」）
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configurePlatformReadDb, resolvePlatformCtx, type AuthenticatedPlatformCtx } from '@ses/db';
import { getPlatformTenantDetail, readDeletionStatus, readPurgeJobFailures, withPlatformRead } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const DAY = 86_400_000;

const NOW = new Date('2026-09-30T02:30:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const OWNER_USER_ID = '01930000-0000-7000-8000-00000010100a';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-00000010100b';

/** 仕込むテナント（fixtures の A / B はどちらも `ACTIVE` で実行なし）。 */
const TENANT_PURGED = '01930000-0000-7000-8000-000000101001';
const TENANT_CLOSING = '01930000-0000-7000-8000-000000101002';
const TENANT_MISSING = '01930000-0000-7000-8000-0000001010ff';

const RUN_FAILED = '01930000-0000-7000-8000-000000101011';
const RUN_COMPLETED = '01930000-0000-7000-8000-000000101012';
const RUN_RETENTION = '01930000-0000-7000-8000-000000101013';
const RUN_RUNNING = '01930000-0000-7000-8000-000000101021';

/** 🔴 応答に 1 バイトも現れてはならない値。 */
const FAILURE_REASON_MARKER = 'COLUMN_ERASE:T1010ForbiddenError';
const RETENTION_COUNT_MARKER = 101099;
/** `COMPLETED` の件数（`A-003` / `A-005` の応答に現れてはならない）。 */
const COMPLETED_COUNTS = { engineers: 101042, skill_sheets: 7, messages: 3 } as const;

const META = { ipAddress: '203.0.113.110' } as const;

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

async function insertTenant(input: {
  readonly id: string;
  readonly name: string;
  readonly lifecycleState: 'CLOSING' | 'PURGED';
  readonly closingEnteredAt: Date | null;
}): Promise<void> {
  await superuser.$executeRaw`
    INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, closing_entered_at,
                         provisioning_request_id, created_at)
    VALUES (${input.id}::uuid, ${input.name}, 'production', ${input.lifecycleState}, ${daysAgo(1)},
            ${input.closingEnteredAt}, ${`t-10-10-${input.id}`}, ${daysAgo(200)})`;
}

async function insertRun(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly cause: 'TENANT_PURGED' | 'RETENTION';
  readonly status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly counts: Record<string, number>;
  readonly failureReason: string | null;
}): Promise<void> {
  await superuser.$executeRaw`
    INSERT INTO tenant_purge_runs (id, tenant_id, cause, status, started_at, completed_at, counts, failure_reason)
    VALUES (${input.id}::uuid, ${input.tenantId}::uuid, ${input.cause}, ${input.status}, ${input.startedAt},
            ${input.completedAt}, ${JSON.stringify(input.counts)}::jsonb, ${input.failureReason})`;
}

async function countAudit(actorId: string): Promise<number> {
  const rows = await superuser.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM audit_logs
     WHERE action = 'admin.deletion_status.view' AND actor_id = ${actorId}::uuid`;
  return Number(rows[0]?.count ?? 0n);
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // --- PURGED: 1 回目は FAILED（失敗理由あり）→ 再試行で COMPLETED（件数あり）。加えて Phase 2 の RETENTION（FAILED）を 1 行 ---
  await insertTenant({ id: TENANT_PURGED, name: 'Deletion Purged', lifecycleState: 'PURGED', closingEnteredAt: daysAgo(40) });
  await insertRun({
    id: RUN_FAILED, tenantId: TENANT_PURGED, cause: 'TENANT_PURGED', status: 'FAILED',
    startedAt: daysAgo(2), completedAt: null, counts: {}, failureReason: FAILURE_REASON_MARKER,
  });
  await insertRun({
    id: RUN_COMPLETED, tenantId: TENANT_PURGED, cause: 'TENANT_PURGED', status: 'COMPLETED',
    startedAt: daysAgo(1), completedAt: new Date(daysAgo(1).getTime() + 5 * 60_000), counts: { ...COMPLETED_COUNTS }, failureReason: null,
  });
  await insertRun({
    id: RUN_RETENTION, tenantId: TENANT_PURGED, cause: 'RETENTION', status: 'FAILED',
    startedAt: daysAgo(3), completedAt: null, counts: { engineers: RETENTION_COUNT_MARKER }, failureReason: FAILURE_REASON_MARKER,
  });

  // --- CLOSING: RUNNING が残った行（④ の CAS 成功後に ⑤ で落ちた形。counts は {}）---
  await insertTenant({ id: TENANT_CLOSING, name: 'Deletion Running', lifecycleState: 'CLOSING', closingEnteredAt: daysAgo(31) });
  await insertRun({
    id: RUN_RUNNING, tenantId: TENANT_CLOSING, cause: 'TENANT_PURGED', status: 'RUNNING',
    startedAt: daysAgo(0.5), completedAt: null, counts: {}, failureReason: null,
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① ② ③ ④ 応答の形（docs/05 §6.9 API-A12）', () => {
  it('🔴 TENANT_PURGED の実行が新しい順に返り、各行のキー集合が固定される（failureReason はキーとして存在しない）', async () => {
    const view = await readDeletionStatus(ownerCtx, TENANT_PURGED, META);
    expect(view).not.toBeNull();
    expect(Object.keys(view!).sort()).toEqual(['lifecycleState', 'purgeRuns', 'tenantId']);
    expect(view!.tenantId).toBe(TENANT_PURGED);
    expect(view!.lifecycleState).toBe('PURGED');
    expect(view!.purgeRuns.map((run) => run.status)).toEqual(['COMPLETED', 'FAILED']);
    for (const run of view!.purgeRuns) {
      expect(Object.keys(run).sort()).toEqual(['cause', 'completedAt', 'counts', 'startedAt', 'status']);
      expect(run.cause).toBe('TENANT_PURGED');
      expect('failureReason' in run).toBe(false);
    }
  });

  it('② counts は表ごとの件数。COMPLETED で埋まり、FAILED は {}。completedAt は COMPLETED だけ', async () => {
    const view = await readDeletionStatus(ownerCtx, TENANT_PURGED, META);
    const [completed, failed] = view!.purgeRuns;
    expect(completed?.counts).toEqual({ engineers: 101042, messages: 3, skill_sheets: 7 });
    expect(completed?.completedAt).toBe(new Date(daysAgo(1).getTime() + 5 * 60_000).toISOString());
    expect(completed?.startedAt).toBe(daysAgo(1).toISOString());
    expect(failed?.counts).toEqual({});
    expect(failed?.completedAt).toBeNull();
  });

  it('RUNNING が残った行は status=RUNNING / counts={} / completedAt=null として返る（未完了。CLOSING のまま）', async () => {
    const view = await readDeletionStatus(ownerCtx, TENANT_CLOSING, META);
    expect(view?.lifecycleState).toBe('CLOSING');
    expect(view?.purgeRuns).toEqual([
      { cause: 'TENANT_PURGED', status: 'RUNNING', startedAt: daysAgo(0.5).toISOString(), completedAt: null, counts: {} },
    ]);
  });

  it('実行の無いテナント（ACTIVE）は purgeRuns が空', async () => {
    const view = await readDeletionStatus(ownerCtx, TENANT_A, META);
    expect(view).toEqual({ tenantId: TENANT_A, lifecycleState: 'ACTIVE', purgeRuns: [] });
  });

  it('🔴 ③ ④ RETENTION の行と failure_reason の値が応答の JSON に 1 バイトも現れない', async () => {
    const json = JSON.stringify(await readDeletionStatus(ownerCtx, TENANT_PURGED, META));
    expect(json).not.toContain(String(RETENTION_COUNT_MARKER));
    expect(json).not.toContain('RETENTION');
    expect(json).not.toContain(FAILURE_REASON_MARKER);
    expect(json).not.toContain('T1010');
    expect(json).not.toContain('failureReason');
  });
});

describe('⑤ ⑥ ⑦ 404・ロール・監査', () => {
  it('存在しないテナントは null（404 への写像は呼び出し側）', async () => {
    expect(await readDeletionStatus(ownerCtx, TENANT_MISSING, META)).toBeNull();
  });

  it('PLATFORM_SUPPORT でも PLATFORM_OWNER と同じ応答（F-062 AC-7）', async () => {
    const owner = await readDeletionStatus(ownerCtx, TENANT_PURGED, META);
    const support = await readDeletionStatus(supportCtx, TENANT_PURGED, META);
    expect(support).toEqual(owner);
  });

  it('🔴 読み取りが admin.deletion_status.view として対象テナントに閉じて記録され、呼び出しごとに 1 行増える', async () => {
    const before = await countAudit(SUPPORT_USER_ID);
    await readDeletionStatus(supportCtx, TENANT_PURGED, META);
    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; actor_kind: string; target_type: string | null; target_id: string | null; ip_address: string | null }>
    >`
      SELECT tenant_id, actor_kind, target_type, target_id, ip_address FROM audit_logs
       WHERE action = 'admin.deletion_status.view' AND actor_id = ${SUPPORT_USER_ID}::uuid
       ORDER BY created_at DESC`;
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toEqual({
      tenant_id: TENANT_PURGED,
      actor_kind: 'PLATFORM_USER',
      target_type: 'Tenant',
      target_id: TENANT_PURGED,
      ip_address: META.ipAddress,
    });
  });

  it('🔴 読み取りが業務データを 1 行も書いていない（tenants / tenant_purge_runs の行数が仕込みのまま）', async () => {
    const snapshot = () => superuser.$queryRaw<Array<{ tenants: bigint; runs: bigint }>>`
      SELECT (SELECT count(*) FROM tenants)::bigint AS tenants, (SELECT count(*) FROM tenant_purge_runs)::bigint AS runs`;
    const before = await snapshot();
    await readDeletionStatus(ownerCtx, TENANT_PURGED, META);
    await readDeletionStatus(ownerCtx, TENANT_MISSING, META);
    expect(await snapshot()).toEqual(before);
  });
});

describe('⑧ failure_reason は DB 権限で読めない（docs/05 §5.5 第 1 層）', () => {
  it('🔴 型を破って failureReason を select しても permission denied', async () => {
    await expect(
      withPlatformRead({ ctx: ownerCtx, action: 'admin.deletion_status.view', targetTenantId: TENANT_PURGED }, async (db) => {
        const delegate = db.tenantPurgeRun as unknown as { findMany: (args: unknown) => Promise<unknown> };
        return delegate.findMany({ select: { id: true, failureReason: true } });
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('対照: counts を含む開示列だけの読み取りは成功する（上が「クエリ全体の失敗」ではない）', async () => {
    const rows = await withPlatformRead(
      { ctx: ownerCtx, action: 'admin.deletion_status.view', targetTenantId: TENANT_PURGED },
      async (db) => db.tenantPurgeRun.findMany({ select: { id: true, status: true, counts: true } }),
    );
    expect(rows.map((row) => row.id).sort()).toEqual([RUN_FAILED, RUN_COMPLETED, RUN_RETENTION].sort());
  });
});

describe('⑨ A-003 / A-005 に削除完了の確認が無い（API-A12 が唯一の経路）', () => {
  it('🔴 API-A3（getPlatformTenantDetail）の PURGED の応答はライフサイクル状態のみで、counts / purgeRuns も仕込んだ件数も無い', async () => {
    const detail = await getPlatformTenantDetail(ownerCtx, TENANT_PURGED, META);
    expect(detail?.lifecycleState).toBe('PURGED');
    const keys = Object.keys(detail ?? {});
    expect(keys).not.toContain('counts');
    expect(keys).not.toContain('purgeRuns');
    expect(keys).not.toContain('deletionCounts');
    const json = JSON.stringify(detail);
    expect(json).not.toContain(String(COMPLETED_COUNTS.engineers));
    expect(json).not.toContain(FAILURE_REASON_MARKER);
  });

  it('🔴 A-005 項目 7（readPurgeJobFailures）は失敗の件数だけ。後に COMPLETED がある TENANT_PURGED の失敗は対応済みとして落ち、完了日時・件数は無い', async () => {
    const failures = await readPurgeJobFailures(ownerCtx, { ...META, now: NOW });
    const mine = failures.rows.filter((row) => row.tenantId === TENANT_PURGED);
    // TENANT_PURGED の FAILED は再試行の COMPLETED で対応済み → 落ちる。RETENTION の FAILED だけが残る。
    expect(mine.map((row) => row.cause)).toEqual(['RETENTION']);
    for (const row of mine) {
      expect(Object.keys(row).sort()).toEqual(['cause', 'failedCount', 'lastFailedAt', 'tenantId']);
    }
    const json = JSON.stringify(failures);
    expect(json).not.toContain(String(COMPLETED_COUNTS.engineers));
    expect(json).not.toContain(String(RETENTION_COUNT_MARKER));
    expect(json).not.toContain(FAILURE_REASON_MARKER);
    expect(json).not.toContain('completedAt');
    expect(json).not.toContain('counts');
  });
});
