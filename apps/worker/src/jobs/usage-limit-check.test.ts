// apps/worker/src/jobs/usage-limit-check.test.ts
// 🔴 `usage.limit-check`（毎 10 分。docs/02 `F-027` 処理①〜⑤ / docs/05 §5.8）の検証。
//
// 固定するのは 7 点である:
//   ① 🔴 停止判定は**予約と同じ見積り・同じモデル解決**を通る（`probeAiDailyCostLevel` に
//      `gate-inspector` の下限とモデル ID を渡す）
//   ② 🔴 3 種の区別が `syncUsageLimitStates` に渡る評価結果に現れる（停止 / 従量 / アップロード停止）
//   ③ 🔴 通知の契機が無ければ宛先を引かず、1 通も積まない
//   ④ 契機があれば管理者全員ぶん `email.dispatch` を積む（宛先の分類は `packages/db` の値のまま）
//   ⑤ 🔴 上限値は deps（`packages/config` 由来）から渡り、ジョブの中に数値が無い
//   ⑥ 🔴 戻り値に金額（USD）が無い
//   ⑦ payload が不正なら DB に触れない / スケジュール宣言
//
// 🔴 LLM を 1 回も呼ばない（deps に AI クライアントの口が無い）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeAiDailyCostLevel = vi.fn();
const readTenantUsageSnapshot = vi.fn();
const syncUsageLimitStates = vi.fn();
const readTenantAdminRecipients = vi.fn();
const reserveEmailDispatch = vi.fn();

vi.mock('@ses/db', () => ({
  probeAiDailyCostLevel,
  readTenantUsageSnapshot,
  syncUsageLimitStates,
  readTenantAdminRecipients,
  reserveEmailDispatch,
  emailDispatchDedupeKey: (input: { templateKey: string; targetId: string; recipientEmail: string }) =>
    `${input.templateKey}:${input.targetId}:${input.recipientEmail}`,
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

const { createUsageLimitCheckHandler, parseUsageLimitCheckPayload, USAGE_LIMIT_CHECK_JOB, USAGE_LIMIT_CHECK_SCHEDULE } =
  await import('./usage-limit-check.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { SCHEDULED_JOBS } = await import('./index.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-16T03:00:00.000Z');
const SONNET = 'claude-sonnet-5';
const GB = 1024n * 1024n * 1024n;

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    dayKey: '2026-09-16',
    monthKey: '2026-09',
    aiUnits: { AI_UNIT_SHEET_PARSE: 10, AI_UNIT_MATCH_RATIONALE: 100, AI_UNIT_PROPOSAL_DRAFT: 5, AI_UNIT_RENEWAL_SUMMARY: 1 },
    emailToday: 12,
    emailLastMinute: 0,
    storageBytes: 2n * GB,
    seatsUsed: 8,
    ...overrides,
  };
}

function makeHandler(overrides: Record<string, unknown> = {}) {
  const enqueued: unknown[] = [];
  const resolve = vi.fn(async () => SONNET);
  const deps = {
    now: () => NOW,
    models: { resolve },
    aiDailyCostLimitUsd: '5.000000',
    usageLimits: {
      warnPercent: 80,
      aiUnitQuotas: { AI_UNIT_SHEET_PARSE: 180, AI_UNIT_MATCH_RATIONALE: 6_200, AI_UNIT_PROPOSAL_DRAFT: 180, AI_UNIT_RENEWAL_SUMMARY: 20 },
      emailDailyLimit: 500,
      storageLimitBytes: 50n * GB,
    },
    enqueueEmailDispatch: async (job: unknown) => {
      enqueued.push(job);
    },
    ...overrides,
  };
  return {
    handler: createUsageLimitCheckHandler(deps as unknown as Parameters<typeof createUsageLimitCheckHandler>[0]),
    enqueued,
    resolve,
  };
}

let dispatchSeq: number;

beforeEach(() => {
  dispatchSeq = 0;
  probeAiDailyCostLevel.mockReset();
  readTenantUsageSnapshot.mockReset();
  syncUsageLimitStates.mockReset();
  readTenantAdminRecipients.mockReset();
  reserveEmailDispatch.mockReset();
  probeAiDailyCostLevel.mockResolvedValue({
    stopped: false,
    consumedMicros: 1_000_000n,
    limitMicros: 5_000_000n,
    periodKey: '2026-09-16',
    resetAt: new Date('2026-09-16T15:00:00.000Z'),
  });
  readTenantUsageSnapshot.mockResolvedValue(snapshot());
  syncUsageLimitStates.mockResolvedValue({ changed: 0, toNotify: [], audited: 0 });
  readTenantAdminRecipients.mockResolvedValue([]);
  reserveEmailDispatch.mockImplementation(async (_ctx: unknown, input: Record<string, unknown>) => {
    dispatchSeq += 1;
    return {
      dispatchId: `01930000-0000-7000-8000-00000000e00${dispatchSeq}`,
      dedupeKey: input.dedupeKey,
      created: true,
      status: 'QUEUED',
      recipientClass: input.recipientClass,
      recipientEmail: input.recipientEmail,
      templateKey: input.templateKey,
    };
  });
});

describe('① 停止判定は予約と同じ見積り・同じモデル解決を通る', () => {
  it('gate-inspector の下限（入力 > 0 / 出力上限）と解決したモデル ID・日次上限・now を probe に渡す', async () => {
    const { handler, resolve } = makeHandler();
    await handler({ tenantId: TENANT_ID }, 'job-1');

    expect(resolve).toHaveBeenCalledWith({ tenantId: TENANT_ID, role: 'gate-inspector', tier: expect.any(String) });
    expect(probeAiDailyCostLevel).toHaveBeenCalledTimes(1);
    const [ctx, input] = probeAiDailyCostLevel.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx.tenantId).toBe(TENANT_ID);
    expect(ctx.job).toEqual({ queue: USAGE_LIMIT_CHECK_JOB, jobId: 'job-1' });
    expect(input.modelId).toBe(SONNET);
    expect(input.limitUsd).toBe('5.000000');
    expect(input.now).toBe(NOW);
    expect(input.estimatedInputTokens).toBeGreaterThan(0);
    expect(input.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe('② 3 種の区別が評価結果に現れる', () => {
  it('🔴 AI 停止（stopped）→ AI_COST_USD = REACHED / STOP_AI。件数・ストレージは独立', async () => {
    probeAiDailyCostLevel.mockResolvedValue({
      stopped: true,
      consumedMicros: 4_990_000n,
      limitMicros: 5_000_000n,
      periodKey: '2026-09-16',
      resetAt: new Date('2026-09-16T15:00:00.000Z'),
    });
    readTenantUsageSnapshot.mockResolvedValue(
      snapshot({
        aiUnits: { AI_UNIT_SHEET_PARSE: 180, AI_UNIT_MATCH_RATIONALE: 100, AI_UNIT_PROPOSAL_DRAFT: 5, AI_UNIT_RENEWAL_SUMMARY: 1 },
        storageBytes: 50n * GB,
        emailToday: 400,
      }),
    );
    const { handler } = makeHandler();
    const outcome = await handler({ tenantId: TENANT_ID }, 'job-1');

    const [, sync] = syncUsageLimitStates.mock.calls[0] as [unknown, { assessment: Record<string, { level: string; effect: string }>; periodKeys: unknown; now: Date }];
    expect(sync.assessment.AI_COST_USD).toEqual({ level: 'REACHED', effect: 'STOP_AI' });
    expect(sync.assessment.AI_UNIT_SHEET_PARSE).toEqual({ level: 'REACHED', effect: 'METERED' });
    expect(sync.assessment.AI_UNIT_MATCH_RATIONALE).toEqual({ level: 'BELOW', effect: 'METERED' });
    expect(sync.assessment.STORAGE_BYTES).toEqual({ level: 'REACHED', effect: 'STOP_UPLOAD' });
    expect(sync.assessment.EMAIL_COUNT).toEqual({ level: 'NEARING', effect: 'STOP_EMAIL_DAILY' });
    expect(sync.periodKeys).toEqual({ dayKey: '2026-09-16', monthKey: '2026-09' });
    expect(sync.now).toBe(NOW);
    expect(outcome.aiStopped).toBe(true);
  });
});

describe('③④ 通知', () => {
  it('🔴 契機が無ければ宛先を引かず、1 通も積まない', async () => {
    const { handler, enqueued } = makeHandler();
    const outcome = await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(readTenantAdminRecipients).not.toHaveBeenCalled();
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
    expect(outcome).toEqual({ changed: 0, audited: 0, notices: 0, queued: 0, aiStopped: false });
  });

  it('契機があれば管理者全員ぶん積む（分類は packages/db の値のまま。dedupeKey に暦日）', async () => {
    syncUsageLimitStates.mockResolvedValue({
      changed: 2,
      audited: 2,
      toNotify: [
        { metric: 'STORAGE_BYTES', level: 'NEARING', effect: 'STOP_UPLOAD', dayKey: '2026-09-16' },
        { metric: 'AI_COST_USD', level: 'REACHED', effect: 'STOP_AI', dayKey: '2026-09-16' },
      ],
    });
    readTenantAdminRecipients.mockResolvedValue([
      { userId: 'u1', email: 'owner@example.com', recipientClass: 'HOST_MEMBER' },
      { userId: 'u2', email: 'admin@example.com', recipientClass: 'HOST_MEMBER' },
    ]);
    const { handler, enqueued } = makeHandler();
    const outcome = await handler({ tenantId: TENANT_ID }, 'job-1');

    expect(readTenantAdminRecipients).toHaveBeenCalledTimes(1);
    expect(reserveEmailDispatch).toHaveBeenCalledTimes(4);
    const inputs = reserveEmailDispatch.mock.calls.map(([, input]) => input as Record<string, unknown>);
    expect(inputs.map((input) => input.templateKey)).toEqual([
      'USAGE_LIMIT_NEARING',
      'USAGE_LIMIT_NEARING',
      'USAGE_LIMIT_REACHED',
      'USAGE_LIMIT_REACHED',
    ]);
    expect(inputs[0]?.dedupeKey).toBe('USAGE_LIMIT_NEARING:STORAGE_BYTES#NEARING#2026-09-16:owner@example.com');
    expect(inputs.every((input) => input.recipientClass === 'HOST_MEMBER')).toBe(true);
    expect(enqueued).toHaveLength(4);
    expect(enqueued[0]).toEqual({ dispatchId: expect.any(String), tenantId: TENANT_ID, recipientClass: 'HOST_MEMBER' });
    expect(outcome).toEqual({ changed: 2, audited: 2, notices: 2, queued: 4, aiStopped: false });
  });

  it('既に QUEUED でない行（送信済み等）は積み直さない', async () => {
    syncUsageLimitStates.mockResolvedValue({
      changed: 1,
      audited: 1,
      toNotify: [{ metric: 'EMAIL_COUNT', level: 'REACHED', effect: 'STOP_EMAIL_DAILY', dayKey: '2026-09-16' }],
    });
    readTenantAdminRecipients.mockResolvedValue([{ userId: 'u1', email: 'owner@example.com', recipientClass: 'HOST_MEMBER' }]);
    reserveEmailDispatch.mockResolvedValue({
      dispatchId: '01930000-0000-7000-8000-00000000e001',
      dedupeKey: 'x',
      created: false,
      status: 'SENT',
      recipientClass: 'HOST_MEMBER',
      recipientEmail: 'owner@example.com',
      templateKey: 'USAGE_LIMIT_REACHED',
    });
    const { handler, enqueued } = makeHandler();
    const outcome = await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(enqueued).toEqual([]);
    expect(outcome.queued).toBe(0);
  });
});

describe('⑤⑥ 上限値の出所と金額の不在', () => {
  it('🔴 上限値は deps から渡る（別の値を渡せば評価が変わる）', async () => {
    readTenantUsageSnapshot.mockResolvedValue(snapshot({ emailToday: 12 }));
    const { handler } = makeHandler({
      usageLimits: {
        warnPercent: 80,
        aiUnitQuotas: { AI_UNIT_SHEET_PARSE: 180, AI_UNIT_MATCH_RATIONALE: 6_200, AI_UNIT_PROPOSAL_DRAFT: 180, AI_UNIT_RENEWAL_SUMMARY: 20 },
        emailDailyLimit: 12,
        storageLimitBytes: 50n * GB,
      },
    });
    await handler({ tenantId: TENANT_ID }, 'job-1');
    const [, sync] = syncUsageLimitStates.mock.calls[0] as [unknown, { assessment: Record<string, { level: string }> }];
    expect(sync.assessment.EMAIL_COUNT.level).toBe('REACHED');
  });

  it('🔴 戻り値に金額（USD）の項目が無い', async () => {
    const { handler } = makeHandler();
    const outcome = await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(Object.keys(outcome).join(',')).not.toMatch(/usd|cost|price/i);
  });
});

describe('⑦ payload とスケジュール', () => {
  it('🔴 payload が不正なら DB に触れない', async () => {
    const { handler } = makeHandler();
    await expect(handler({}, 'job-1')).rejects.toThrow(InvalidJobPayloadError);
    await expect(handler({ tenantId: 'not-a-uuid' }, 'job-1')).rejects.toThrow(InvalidJobPayloadError);
    expect(probeAiDailyCostLevel).not.toHaveBeenCalled();
    expect(readTenantUsageSnapshot).not.toHaveBeenCalled();
    expect(syncUsageLimitStates).not.toHaveBeenCalled();
  });

  it('parse は tenantId だけを受け付ける', () => {
    expect(parseUsageLimitCheckPayload({ tenantId: TENANT_ID })).toEqual({ tenantId: TENANT_ID });
  });

  it('🔴 毎 10 分（Asia/Tokyo）で、SCHEDULED_JOBS に登録されている（登録漏れ = 一度も走らない）', () => {
    expect(USAGE_LIMIT_CHECK_SCHEDULE).toEqual({ cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' });
    const declaration = SCHEDULED_JOBS.find((job) => job.name === USAGE_LIMIT_CHECK_JOB);
    expect(declaration).toBeDefined();
    expect(declaration?.cron).toBe(USAGE_LIMIT_CHECK_SCHEDULE.cron);
    expect(declaration?.timeZone).toBe('Asia/Tokyo');
  });
});
