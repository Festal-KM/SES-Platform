// apps/worker/src/jobs/tenant-purge.test.ts
// T-10-09: `tenant.purge-scan` / `tenant.purge` / `export.generate` のハンドラの判定と順序を、`@ses/db` をモックして固定する。
//
// 🔴 何を固定するか（docs/05 §9.7 / docs/02 `F-064 AC-1` / `AC-10`）:
//   ① `tenant.purge-scan`: 29 日目は `NOT_DUE`、30 日目に `ENQUEUED`。**期限判定の後**に配送確認を呼び、偽なら `NOTICE_PENDING`
//      で何も積まない。`COMPLETED` があれば `ALREADY_PURGED`。`CLOSING` 以外 / `closing_entered_at` 無しは `SKIPPED`
//   ② 🔴 `tenant.purge`: 直接 enqueue しても配送未確認なら **no-op**（`TenantPurgeRun` を作らず、S3 にも DB にも触れない）
//   ③ `tenant.purge`: 順序は S3 の削除 → 列の消去 → `CLOSING → PURGED` → `COMPLETED`。S3 で失敗したら列の消去に進まず `FAILED`
//      （段 = `OBJECT_DELETE`）にしてから例外を投げ直す
//   ④ `export.generate`: `QUEUED → RUNNING` の claim に失敗したら何もしない。成功時は `put` → `READY`（`expiresAt` = +7 日）。
//      失敗時は `FAILED` にしてから例外
// 実 DB での挙動（削除スコープ・CAS・二重境界）は `tests/isolation/tenant-purge.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readTenantClosingSchedule = vi.fn();
const readClosingNoticeDelivery = vi.fn();
const hasCompletedTenantPurge = vi.fn();
const startTenantPurgeRun = vi.fn();
const listPurgeObjectKeys = vi.fn();
const applyPurgeSpec = vi.fn();
const completeTenantPurge = vi.fn();
const finishTenantPurgeRun = vi.fn();
const claimDataExportRun = vi.fn();
const readClosingReturnDataset = vi.fn();
const settleDataExport = vi.fn();

vi.mock('@ses/db', () => ({
  readTenantClosingSchedule,
  readClosingNoticeDelivery,
  hasCompletedTenantPurge,
  startTenantPurgeRun,
  listPurgeObjectKeys,
  applyPurgeSpec,
  completeTenantPurge,
  finishTenantPurgeRun,
  claimDataExportRun,
  readClosingReturnDataset,
  settleDataExport,
  tenantPurgeFailureReason: (stage: string, error: unknown) => `${stage}:${error instanceof Error ? error.name : typeof error}`,
  systemTenantCtx: (tenantId: string, job: { queue: string; jobId: string }) => ({
    tenantId,
    partnerCompanyId: null,
    userId: '',
    role: 'SALES',
    lifecycleState: 'ACTIVE',
    deviceKind: 'api',
    job,
  }),
}));

const { createTenantPurgeScanHandler, TENANT_PURGE_SCAN_SCHEDULE, TENANT_PURGE_SCAN_POPULATION } = await import('./tenant-purge-scan.js');
const { createTenantPurgeHandler, TenantPurgeStageError } = await import('./tenant-purge.js');
const { createExportGenerateHandler } = await import('./export-generate.js');
const { SCHEDULED_JOBS } = await import('./index.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const EXPORT_ID = '01930000-0000-7000-8000-0000000000e1';
const CLOSING_ENTERED_AT = new Date('2026-09-01T00:00:00.000Z'); // JST 2026-09-01

function jstNoon(dayKey: string): Date {
  return new Date(`${dayKey}T03:00:00.000Z`);
}

const DELIVERED = { delivered: true, deliveredCount: 1, pendingCount: 0, mockedIgnoredCount: 0 };
const PENDING = { delivered: false, deliveredCount: 0, pendingCount: 1, mockedIgnoredCount: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  readTenantClosingSchedule.mockResolvedValue({ name: 'T', lifecycleState: 'CLOSING', closingEnteredAt: CLOSING_ENTERED_AT });
  readClosingNoticeDelivery.mockResolvedValue(DELIVERED);
  hasCompletedTenantPurge.mockResolvedValue(false);
});

describe('① tenant.purge-scan', () => {
  function scan(now: Date) {
    const enqueued: unknown[] = [];
    const handler = createTenantPurgeScanHandler({
      now: () => now,
      purgeGraceDays: 30,
      appEnv: 'development',
      enqueueTenantPurge: async (job) => {
        enqueued.push(job);
        return 'ENQUEUED';
      },
    });
    return { run: () => handler({ tenantId: TENANT_ID }, 'job-1'), enqueued };
  }

  it('29 日目は NOT_DUE（積まない・配送確認も呼ばない）', async () => {
    const { run, enqueued } = scan(jstNoon('2026-09-30'));
    await expect(run()).resolves.toEqual({ kind: 'NOT_DUE', todayKey: '2026-09-30', purgeScheduledOn: '2026-10-01' });
    expect(enqueued).toEqual([]);
    expect(readClosingNoticeDelivery).not.toHaveBeenCalled();
  });

  it('30 日目（予定日当日）に ENQUEUED。配送確認は期限判定の後に、起動時の appEnv で呼ばれる', async () => {
    const { run, enqueued } = scan(jstNoon('2026-10-01'));
    await expect(run()).resolves.toEqual({ kind: 'ENQUEUED', purgeScheduledOn: '2026-10-01', outcome: 'ENQUEUED' });
    expect(enqueued).toEqual([{ tenantId: TENANT_ID }]);
    expect(readClosingNoticeDelivery).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }), { appEnv: 'development' });
  });

  it('日付一致ではない: 予定日を過ぎた後の日でも積む（ジョブを止めた日があっても翌日に取り返す）', async () => {
    const { run, enqueued } = scan(jstNoon('2026-10-09'));
    await expect(run()).resolves.toMatchObject({ kind: 'ENQUEUED' });
    expect(enqueued).toHaveLength(1);
  });

  it('🔴 予告が配送済みでなければ NOTICE_PENDING（何も積まず、次回へ持ち越す）', async () => {
    readClosingNoticeDelivery.mockResolvedValue(PENDING);
    const { run, enqueued } = scan(jstNoon('2026-10-05'));
    await expect(run()).resolves.toEqual({ kind: 'NOTICE_PENDING', purgeScheduledOn: '2026-10-01', delivery: PENDING });
    expect(enqueued).toEqual([]);
  });

  it('COMPLETED があれば ALREADY_PURGED（積まない）', async () => {
    hasCompletedTenantPurge.mockResolvedValue(true);
    const { run, enqueued } = scan(jstNoon('2026-10-05'));
    await expect(run()).resolves.toEqual({ kind: 'ALREADY_PURGED' });
    expect(enqueued).toEqual([]);
  });

  it('CLOSING 以外 / closing_entered_at 無しは SKIPPED', async () => {
    readTenantClosingSchedule.mockResolvedValueOnce({ name: 'T', lifecycleState: 'ACTIVE', closingEnteredAt: null });
    await expect(scan(jstNoon('2026-10-05')).run()).resolves.toEqual({ kind: 'SKIPPED', reason: 'NOT_CLOSING' });
    readTenantClosingSchedule.mockResolvedValueOnce({ name: 'T', lifecycleState: 'CLOSING', closingEnteredAt: null });
    await expect(scan(jstNoon('2026-10-05')).run()).resolves.toEqual({ kind: 'SKIPPED', reason: 'NO_CLOSING_ENTERED_AT' });
  });

  it('宣言: 毎日 02:10 JST・母集団 CLOSING・SCHEDULED_JOBS に登録されている', () => {
    expect(TENANT_PURGE_SCAN_SCHEDULE).toEqual({ cron: '10 2 * * *', timeZone: 'Asia/Tokyo' });
    expect(TENANT_PURGE_SCAN_POPULATION).toBe('CLOSING');
    const declaration = SCHEDULED_JOBS.find((job) => job.name === 'tenant.purge-scan');
    expect(declaration?.population).toBe('CLOSING');
    expect(declaration?.cron).toBe('10 2 * * *');
  });
});

describe('②③ tenant.purge', () => {
  function purge(deleteImpl: (key: string) => Promise<void> = async () => undefined) {
    const deleted: string[] = [];
    const handler = createTenantPurgeHandler({
      now: () => jstNoon('2026-10-01'),
      appEnv: 'development',
      objectStore: {
        delete: async (key: string) => {
          deleted.push(key);
          await deleteImpl(key);
        },
      },
    });
    return { run: () => handler({ tenantId: TENANT_ID }, 'tenant.purge.x'), deleted };
  }

  it('🔴 ② 直接 enqueue しても配送未確認なら no-op（TenantPurgeRun を作らず、S3 にも DB にも触れない）', async () => {
    readClosingNoticeDelivery.mockResolvedValue(PENDING);
    const { run, deleted } = purge();
    await expect(run()).resolves.toEqual({ kind: 'NOOP', reason: 'NOTICE_PENDING', delivery: PENDING });
    expect(startTenantPurgeRun).not.toHaveBeenCalled();
    expect(listPurgeObjectKeys).not.toHaveBeenCalled();
    expect(applyPurgeSpec).not.toHaveBeenCalled();
    expect(completeTenantPurge).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('CLOSING 以外は no-op（配送確認より前に読む）', async () => {
    readTenantClosingSchedule.mockResolvedValue({ name: 'T', lifecycleState: 'PURGED', closingEnteredAt: CLOSING_ENTERED_AT });
    await expect(purge().run()).resolves.toEqual({ kind: 'NOOP', reason: 'NOT_CLOSING' });
    expect(readClosingNoticeDelivery).not.toHaveBeenCalled();
  });

  it('RUNNING / COMPLETED があれば no-op', async () => {
    startTenantPurgeRun.mockResolvedValueOnce({ kind: 'ALREADY_RUNNING' });
    await expect(purge().run()).resolves.toEqual({ kind: 'NOOP', reason: 'ALREADY_RUNNING' });
    startTenantPurgeRun.mockResolvedValueOnce({ kind: 'ALREADY_COMPLETED' });
    await expect(purge().run()).resolves.toEqual({ kind: 'NOOP', reason: 'ALREADY_COMPLETED' });
    expect(listPurgeObjectKeys).not.toHaveBeenCalled();
  });

  it('③ 順序: S3 の削除 → 列の消去 → CLOSING → PURGED → COMPLETED（counts と objectsDeleted / objectsSkipped）', async () => {
    const order: string[] = [];
    startTenantPurgeRun.mockResolvedValue({ kind: 'STARTED', runId: 'run-1' });
    listPurgeObjectKeys.mockImplementation(async () => {
      order.push('list');
      return {
        targets: [
          { table: 'skill_sheets', column: 'object_key', key: 'k1' },
          { table: 'messages', column: 'attachment_key', key: 'k2' },
        ],
        // 🔴 自テナントのプレフィックスでない値（出所だけ）。削除しに行かない。
        skipped: [{ table: 'proposal_events', column: 'attachment_key' }],
      };
    });
    applyPurgeSpec.mockImplementation(async () => {
      order.push('apply');
      return { engineers: 3, skill_sheets: 2 };
    });
    completeTenantPurge.mockImplementation(async () => {
      order.push('complete');
      return { kind: 'PURGED' };
    });
    finishTenantPurgeRun.mockImplementation(async () => {
      order.push('finish');
    });
    const { run, deleted } = purge(async () => {
      order.push('delete');
    });
    await expect(run()).resolves.toEqual({
      kind: 'PURGED',
      runId: 'run-1',
      counts: { engineers: 3, skill_sheets: 2 },
      objectsDeleted: 2,
      objectsSkipped: 1,
    });
    expect(deleted).toEqual(['k1', 'k2']);
    expect(order).toEqual(['list', 'delete', 'delete', 'apply', 'complete', 'finish']);
    expect(finishTenantPurgeRun).toHaveBeenCalledWith(expect.anything(), 'run-1', {
      status: 'COMPLETED',
      counts: { engineers: 3, skill_sheets: 2 },
      completedAt: jstNoon('2026-10-01'),
    });
  });

  it('🔴 ③ S3 の削除で失敗したら列の消去に進まず FAILED（OBJECT_DELETE + 例外名）にしてから例外を投げ直す', async () => {
    startTenantPurgeRun.mockResolvedValue({ kind: 'STARTED', runId: 'run-2' });
    listPurgeObjectKeys.mockResolvedValue({ targets: [{ table: 'skill_sheets', column: 'object_key', key: 'k1' }], skipped: [] });
    finishTenantPurgeRun.mockResolvedValue(undefined);
    const { run } = purge(async () => {
      const error = new Error('boom');
      error.name = 'S3ServiceException';
      throw error;
    });
    await expect(run()).rejects.toBeInstanceOf(TenantPurgeStageError);
    expect(applyPurgeSpec).not.toHaveBeenCalled();
    expect(completeTenantPurge).not.toHaveBeenCalled();
    expect(finishTenantPurgeRun).toHaveBeenCalledWith(expect.anything(), 'run-2', {
      status: 'FAILED',
      failureReason: 'OBJECT_DELETE:S3ServiceException',
      completedAt: jstNoon('2026-10-01'),
    });
  });

  it('CLOSING → PURGED の CAS が 0 件なら FAILED（STATE_TRANSITION）', async () => {
    startTenantPurgeRun.mockResolvedValue({ kind: 'STARTED', runId: 'run-3' });
    listPurgeObjectKeys.mockResolvedValue({ targets: [], skipped: [] });
    applyPurgeSpec.mockResolvedValue({});
    completeTenantPurge.mockResolvedValue({ kind: 'CAS_FAILED', lifecycleState: 'ACTIVE' });
    finishTenantPurgeRun.mockResolvedValue(undefined);
    await expect(purge().run()).rejects.toBeInstanceOf(TenantPurgeStageError);
    expect(finishTenantPurgeRun).toHaveBeenCalledWith(expect.anything(), 'run-3', expect.objectContaining({ status: 'FAILED', failureReason: 'STATE_TRANSITION:Error' }));
  });

  it('🔴 FAILED の確定自体が失敗しても元の段の例外を失わない（AggregateError に両方が入る）', async () => {
    startTenantPurgeRun.mockResolvedValue({ kind: 'STARTED', runId: 'run-4' });
    listPurgeObjectKeys.mockResolvedValue({ targets: [{ table: 'skill_sheets', column: 'object_key', key: 'k1' }], skipped: [] });
    const finishFailure = new Error('db down');
    finishTenantPurgeRun.mockRejectedValue(finishFailure);
    const { run } = purge(async () => {
      throw new Error('boom');
    });
    const thrown = await run().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(AggregateError);
    const errors = (thrown as AggregateError).errors;
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeInstanceOf(TenantPurgeStageError);
    expect((errors[0] as InstanceType<typeof TenantPurgeStageError>).stage).toBe('OBJECT_DELETE');
    expect(errors[1]).toBe(finishFailure);
    expect(applyPurgeSpec).not.toHaveBeenCalled();
  });

  it('skipped だけがある（targets 0 件）なら DeleteObject を 1 回も発行せず、objectsSkipped に件数だけ出る', async () => {
    startTenantPurgeRun.mockResolvedValue({ kind: 'STARTED', runId: 'run-5' });
    listPurgeObjectKeys.mockResolvedValue({ targets: [], skipped: [{ table: 'messages', column: 'attachment_key' }, { table: 'messages', column: 'attachment_key' }] });
    applyPurgeSpec.mockResolvedValue({});
    completeTenantPurge.mockResolvedValue({ kind: 'PURGED' });
    finishTenantPurgeRun.mockResolvedValue(undefined);
    const { run, deleted } = purge();
    await expect(run()).resolves.toMatchObject({ kind: 'PURGED', objectsDeleted: 0, objectsSkipped: 2 });
    expect(deleted).toEqual([]);
  });
});

describe('④ export.generate', () => {
  function generate() {
    const puts: { key: string; size: number; contentType: string }[] = [];
    const handler = createExportGenerateHandler({
      now: () => jstNoon('2026-09-20'),
      objectStore: {
        put: async (key: string, body: Uint8Array, contentType: string) => {
          puts.push({ key, size: body.byteLength, contentType });
        },
      },
      exportAvailableDays: 7,
    });
    return { run: () => handler({ tenantId: TENANT_ID, exportRequestId: EXPORT_ID }, 'export.generate.x'), puts };
  }

  const EMPTY_DATASET = {
    engineers: [], engineerSkills: [], engineerCareers: [], projects: [], projectRequirements: [], partnerCompanies: [],
    proposals: [], engineerSnapshots: [], engineerSnapshotSkills: [], engineerSnapshotCareers: [], proposalEvents: [], assignments: [],
  };

  it('claim に失敗（NOT_QUEUED / NOT_FOUND）したら何もしない（2 度目の試行で生成を繰り返さない）', async () => {
    claimDataExportRun.mockResolvedValueOnce({ kind: 'NOT_QUEUED', status: 'READY' });
    await expect(generate().run()).resolves.toEqual({ kind: 'SKIPPED', reason: 'NOT_QUEUED', status: 'READY' });
    claimDataExportRun.mockResolvedValueOnce({ kind: 'NOT_FOUND' });
    await expect(generate().run()).resolves.toEqual({ kind: 'SKIPPED', reason: 'NOT_FOUND' });
    expect(readClosingReturnDataset).not.toHaveBeenCalled();
  });

  it('成功: t/{tenantId}/exports/{exportRequestId}/{uuid}.zip に put → READY（expiresAt = readyAt + 7 日）', async () => {
    claimDataExportRun.mockResolvedValue({ kind: 'CLAIMED', exportKind: 'CLOSING_RETURN' });
    readClosingReturnDataset.mockResolvedValue(EMPTY_DATASET);
    settleDataExport.mockResolvedValue(undefined);
    const { run, puts } = generate();
    const outcome = await run();
    expect(outcome).toMatchObject({ kind: 'READY', exportRequestId: EXPORT_ID, fileCount: 12 });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toMatch(new RegExp(`^t/${TENANT_ID}/exports/${EXPORT_ID}/[0-9a-f-]{36}\\.zip$`));
    expect(puts[0]!.contentType).toBe('application/zip');
    expect(settleDataExport).toHaveBeenCalledWith(expect.anything(), EXPORT_ID, {
      status: 'READY',
      objectKey: puts[0]!.key,
      readyAt: jstNoon('2026-09-20'),
      expiresAt: jstNoon('2026-09-27'),
    });
  });

  it('失敗: FAILED にしてから例外を投げ直す', async () => {
    claimDataExportRun.mockResolvedValue({ kind: 'CLAIMED', exportKind: 'CLOSING_RETURN' });
    readClosingReturnDataset.mockRejectedValue(new Error('db down'));
    settleDataExport.mockResolvedValue(undefined);
    await expect(generate().run()).rejects.toThrow('db down');
    expect(settleDataExport).toHaveBeenCalledWith(expect.anything(), EXPORT_ID, { status: 'FAILED' });
  });
});
