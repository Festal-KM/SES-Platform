// tests/isolation/scheduler-fanout.test.ts
// 🔴 T-07-11 の受け入れ基準 ②③ を**実 DB（RLS 付き）**で通す（docs/05 §9.1 / §4.4.2）。
//
//   ② ファンアウトの母集団 —— `SANDBOX` / `ACTIVE` だけに配り、
//      🔴 `SUSPENDED` / `CLOSING` / `PURGED` には配らない（`CLAUDE.md` §4.2 / §3.4）
//   ③ 🔴 二重起動しても `SchedulerRun.runKey` の UNIQUE によりハンドラは 1 回
//
// あわせて、限定経路そのものが fail-closed であること（テナント文脈からは呼べない /
// GUC が無ければ呼べない / 返るのは ID だけ）を、**実際のロールとポリシー**で確かめる。
//
// 🔴 モックを一切使わない。`app_list_scheduler_tenants()` は `app_scheduler_probe` が所有する
//    `SECURITY DEFINER` 関数であり、その挙動は Postgres の中にしか無い（型では担保できない）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimSchedulerRun,
  configureTenantDb,
  disconnectTenantDb,
  finishSchedulerRun,
  listSchedulerFanoutTenants,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { runScheduled } from '../../apps/worker/src/scheduler.js';
import { fanOutToTenants } from '../../apps/worker/src/runtime.js';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-10T03:00:00.000Z');
const now = (): Date => NOW;

/** 追加で作るテナント（5 つのライフサイクル状態を全部並べるため）。 */
const TENANT_SANDBOX = '01930000-0000-7000-8000-0000000000a2';
const TENANT_SUSPENDED = '01930000-0000-7000-8000-0000000000a3';
const TENANT_CLOSING = '01930000-0000-7000-8000-0000000000a4';
const TENANT_PURGED = '01930000-0000-7000-8000-0000000000a5';

let database: IsolationDatabase;
let admin: UnextendedClient;

async function insertTenant(id: string, lifecycleState: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, provisioning_request_id)
       VALUES ($1::uuid, $2, 'production', $3, now(), $4)
     ON CONFLICT (id) DO UPDATE SET lifecycle_state = EXCLUDED.lifecycle_state`,
    id,
    `Tenant ${lifecycleState}`,
    lifecycleState,
    `seed-provisioning-${lifecycleState.toLowerCase()}`,
  );
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  await insertTenant(TENANT_SANDBOX, 'SANDBOX');
  await insertTenant(TENANT_SUSPENDED, 'SUSPENDED');
  await insertTenant(TENANT_CLOSING, 'CLOSING');
  await insertTenant(TENANT_PURGED, 'PURGED');
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.$executeRawUnsafe('DELETE FROM scheduler_runs');
});

describe('🔴 ファンアウトの母集団（docs/05 §9.1 / migration 20260915000000 の判断事項 3）', () => {
  it('SANDBOX と ACTIVE のテナントだけを返す', async () => {
    const tenantIds = await listSchedulerFanoutTenants();

    expect([...tenantIds].sort()).toEqual([TENANT_A, TENANT_SANDBOX, TENANT_B].sort());
  });

  it('🔴 SUSPENDED / CLOSING / PURGED は 1 件も返さない（停止中に AI 原価を使わない）', async () => {
    const tenantIds = await listSchedulerFanoutTenants();

    expect(tenantIds).not.toContain(TENANT_SUSPENDED);
    expect(tenantIds).not.toContain(TENANT_CLOSING);
    expect(tenantIds).not.toContain(TENANT_PURGED);
  });

  it('🔴 停止 → 再開でそのまま母集団に戻る（状態を見るだけで、別の台帳を持たない）', async () => {
    await insertTenant(TENANT_SUSPENDED, 'ACTIVE');
    expect(await listSchedulerFanoutTenants()).toContain(TENANT_SUSPENDED);

    await insertTenant(TENANT_SUSPENDED, 'SUSPENDED');
    expect(await listSchedulerFanoutTenants()).not.toContain(TENANT_SUSPENDED);
  });

  it('🔴 返るのはテナント ID だけである（名前も環境も出ない）', async () => {
    const tenantIds = await listSchedulerFanoutTenants();

    for (const tenantId of tenantIds) {
      expect(typeof tenantId).toBe('string');
      expect(tenantId).toMatch(/^[0-9a-f-]{36}$/u);
    }
    expect(JSON.stringify(tenantIds)).not.toContain('Tenant A');
  });
});

describe('🔴 限定経路そのものが fail-closed である（docs/05 §4.4.2）', () => {
  it('app.scheduler_scope が立っていなければ例外になる（0 件で誤魔化さない）', async () => {
    await expect(
      admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '', true)`);
        return tx.$queryRawUnsafe('SELECT app_list_scheduler_tenants()');
      }),
    ).rejects.toThrow();
  });

  it('🔴 テナント文脈（app.tenant_id あり）からは呼べない', async () => {
    await expect(
      admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true), set_config('app.scheduler_scope', 'on', true)`,
          TENANT_A,
        );
        return tx.$queryRawUnsafe('SELECT app_list_scheduler_tenants()');
      }),
    ).rejects.toThrow();
  });

  it('app_scheduler_probe は tenants の 2 列しか読めない（列レベル GRANT）', async () => {
    const rows = await admin.$queryRawUnsafe<Array<{ table_name: string; column_name: string; privilege_type: string }>>(
      `SELECT table_name, column_name, privilege_type
         FROM information_schema.role_column_grants
        WHERE grantee = 'app_scheduler_probe'
        ORDER BY table_name, column_name, privilege_type`,
    );

    expect(rows).toEqual([
      { table_name: 'tenants', column_name: 'id', privilege_type: 'SELECT' },
      { table_name: 'tenants', column_name: 'lifecycle_state', privilege_type: 'SELECT' },
    ]);
  });

  it('app_scheduler_probe は NOLOGIN であり、スキーマの CREATE 権限を持たない', async () => {
    const rows = await admin.$queryRawUnsafe<Array<{ rolcanlogin: boolean; can_create: boolean }>>(
      `SELECT rolcanlogin, has_schema_privilege('app_scheduler_probe', 'public', 'CREATE') AS can_create
         FROM pg_roles WHERE rolname = 'app_scheduler_probe'`,
    );

    expect(rows[0]?.rolcanlogin).toBe(false);
    expect(rows[0]?.can_create).toBe(false);
  });
});

describe('🔴 二重起動でもハンドラは 1 回（SchedulerRun.runKey の UNIQUE。docs/05 §9.1）', () => {
  const jobName = 'gate.hold-release';
  const jobId = `repeat:${jobName}:${Date.UTC(2026, 8, 10, 3, 0, 0)}`;

  it('同じ slot を 2 つの実行が処理しても、handler は 1 回しか呼ばれない', async () => {
    let calls = 0;
    const handler = async (): Promise<Record<string, number>> => {
      calls += 1;
      return { tenants: 0, succeeded: 0, failed: 0 };
    };

    const [first, second] = await Promise.all([
      runScheduled({ jobName, jobId, now, handler }),
      runScheduled({ jobName, jobId, now, handler }),
    ]);

    expect(calls).toBe(1);
    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(['RAN', 'SKIPPED']);

    const rows = await admin.schedulerRun.findMany({ where: { jobName } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('OK');
    expect(rows[0]?.runKey).toBe(`${jobName}:2026-09-10T12:00:00.000+09:00`);
  });

  it('slot が変われば別の実行になる（10 分後の tick は走る）', async () => {
    const handler = async (): Promise<Record<string, number>> => ({ ran: 1 });
    await runScheduled({ jobName, jobId, now, handler });
    await runScheduled({
      jobName,
      jobId: `repeat:${jobName}:${Date.UTC(2026, 8, 10, 3, 10, 0)}`,
      now,
      handler,
    });

    const rows = await admin.schedulerRun.findMany({ where: { jobName } });
    expect(rows).toHaveLength(2);
  });

  it('🔴 失敗した slot は取り直せる（再試行が「何もせず成功」にならない）', async () => {
    let calls = 0;
    const failing = async (): Promise<Record<string, number>> => {
      calls += 1;
      throw new Error('boom');
    };

    await expect(runScheduled({ jobName, jobId, now, handler: failing })).rejects.toThrow('boom');
    await expect(runScheduled({ jobName, jobId, now, handler: failing })).rejects.toThrow('boom');

    expect(calls).toBe(2);
    const rows = await admin.schedulerRun.findMany({ where: { jobName } });
    // 🔴 行は 1 件のまま（`runKey` の UNIQUE）。状態は FAILED で残る（消さない = A-005 から追える）。
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.detail).toEqual({ error: 'Error' });
  });

  it('🔴 成功した slot は取り直せない（完了した tick を再実行しない）', async () => {
    let calls = 0;
    const handler = async (): Promise<Record<string, number>> => {
      calls += 1;
      return { ok: 1 };
    };

    await runScheduled({ jobName, jobId, now, handler });
    const second = await runScheduled({ jobName, jobId, now, handler });

    expect(calls).toBe(1);
    expect(second.kind).toBe('SKIPPED');
  });

  it('実行中（RUNNING）の slot も取り直せない', async () => {
    const runKey = `${jobName}:manual`;
    const claim = await claimSchedulerRun({ jobName, runKey, startedAt: NOW });
    expect(claim.kind).toBe('CLAIMED');

    const second = await claimSchedulerRun({ jobName, runKey, startedAt: NOW });
    expect(second.kind).toBe('ALREADY_RUNNING');

    if (claim.kind !== 'CLAIMED') throw new Error('unreachable');
    await finishSchedulerRun({
      runId: claim.runId,
      status: 'OK',
      finishedAt: NOW,
      detail: { ok: 1 },
    });
    expect((await claimSchedulerRun({ jobName, runKey, startedAt: NOW })).kind).toBe(
      'ALREADY_RUNNING',
    );
  });
});

describe('🔴 ファンアウトが実際の母集団を回す（受け入れ基準 ②）', () => {
  it('gate.hold-release の tick が、母集団の全社ぶん payload に tenantId を載せて実行される', async () => {
    const seen: string[] = [];
    const handler = async (payload: unknown): Promise<unknown> => {
      seen.push((payload as { tenantId: string }).tenantId);
      return undefined;
    };
    const jobName = 'gate.hold-release';
    const jobId = `repeat:${jobName}:${Date.UTC(2026, 8, 10, 4, 0, 0)}`;

    const outcome = await runScheduled({
      jobName,
      jobId,
      now,
      handler: () => fanOutToTenants(jobName, jobId, handler),
    });

    expect(seen.sort()).toEqual([TENANT_A, TENANT_SANDBOX, TENANT_B].sort());
    expect(outcome).toMatchObject({
      kind: 'RAN',
      detail: { tenants: 3, succeeded: 3, failed: 0 },
    });

    const rows = await admin.schedulerRun.findMany({ where: { jobName } });
    expect(rows[0]?.detail).toEqual({ tenants: 3, succeeded: 3, failed: 0 });
  });

  it('🔴 停止中のテナントには 1 度も配らない（実行系を動かさない）', async () => {
    const seen: string[] = [];
    const handler = async (payload: unknown): Promise<unknown> => {
      seen.push((payload as { tenantId: string }).tenantId);
      return undefined;
    };

    await fanOutToTenants('scan.poll', 'repeat:scan.poll:1789012800000', handler);

    expect(seen).not.toContain(TENANT_SUSPENDED);
    expect(seen).not.toContain(TENANT_CLOSING);
    expect(seen).not.toContain(TENANT_PURGED);
  });
});
