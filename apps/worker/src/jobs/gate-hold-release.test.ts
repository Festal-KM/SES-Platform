// apps/worker/src/jobs/gate-hold-release.test.ts
// 🔴 `gate.hold-release`（毎 10 分。docs/05 §9.3 / `F-027 AC-5`）の検証。
//
// 固定するのは 6 点である:
//   ① 🔴 **余地が無ければ何もしない**（`BLOCK` のとき保留行を 1 件も読みに行かない）
//   ② 🔴 **余地の件数（`capacity`）だけ**、`heldSince` の古い順に積み直す（残りは次回）
//   ③ 🔴 **同じ payload**（`tenantId` / `targetType` / `targetId` / `contentHash`）で積み直す
//      —— `jobId` は enqueue 側の 1 実装が組み立てるので、材料が同じなら同じ `jobId` になる
//   ④ 🔴 **保留行を書き換えない**（`DONE` にしない。完了 CAS が最後の防波堤。§11.9 ⑧-7）
//      —— ここでは `@ses/db` のモックが**読み取りの 2 関数しか持たない**ことで担保する
//      （書き込み関数を呼んだ瞬間に `undefined is not a function` で落ちる）。
//      identifier としての不在は `tests/static/gate-hold-release-enqueue.test.ts` が固定する。
//   ⑤ 判定は**時刻ではなくカウンタ**で行う（`probeAiCostHeadroom` を毎回通る）
//   ⑥ 見積りは `gate.run` と**同じモデル解決**を通る（別のモデルを見ない）
//
// 🔴 LLM を 1 回も呼ばない（deps に AI クライアントの口が無い）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPendingReviewGates = vi.fn();
const probeAiCostHeadroom = vi.fn();

vi.mock('@ses/db', () => ({
  listPendingReviewGates,
  probeAiCostHeadroom,
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

const { createGateHoldReleaseHandler, parseGateHoldReleasePayload, GATE_HOLD_RELEASE_JOB, GATE_HOLD_RELEASE_SCHEDULE } =
  await import('./gate-hold-release.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const PROPOSAL_ID = '01930000-0000-7000-8000-000000000111';
const PROJECT_ID = '01930000-0000-7000-8000-0000000000f1';
const NOW = new Date('2026-09-09T03:00:00.000Z');
const SONNET = 'claude-sonnet-5';

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: '01930000-0000-7000-8000-000000000201',
    targetType: 'PROPOSAL',
    targetId: PROPOSAL_ID,
    contentHash: 'hash-1',
    heldSince: NOW,
    consistencyVerdict: 'PASS',
    ...overrides,
  };
}

function makeHandler(overrides: Record<string, unknown> = {}) {
  const enqueueGateRun = vi.fn(async (job: unknown) => {
    void job;
    return 'ENQUEUED' as const;
  });
  const resolve = vi.fn(async () => SONNET);
  const deps = {
    now: () => NOW,
    models: { resolve },
    aiDailyCostLimitUsd: '5.000000',
    enqueueGateRun,
    ...overrides,
  };
  // 型は `GateHoldReleaseDeps`。テストの都合で上書きできるよう緩く受ける。
  return {
    handler: createGateHoldReleaseHandler(deps as unknown as Parameters<typeof createGateHoldReleaseHandler>[0]),
    enqueueGateRun,
    resolve,
  };
}

beforeEach(() => {
  listPendingReviewGates.mockReset();
  probeAiCostHeadroom.mockReset();
  probeAiCostHeadroom.mockResolvedValue({ kind: 'ALLOW', capacity: 10 });
  listPendingReviewGates.mockResolvedValue([]);
});

describe('payload', () => {
  it('tenantId（UUID）を要求する', () => {
    expect(parseGateHoldReleasePayload({ tenantId: TENANT_ID })).toEqual({ tenantId: TENANT_ID });
  });

  it.each([null, 'x', {}, { tenantId: 'not-a-uuid' }])('不正な payload は落とす: %s', (raw) => {
    expect(() => parseGateHoldReleasePayload(raw)).toThrow(InvalidJobPayloadError);
  });

  it('毎 10 分・Asia/Tokyo（docs/05 §9.3 / §9.1）', () => {
    expect(GATE_HOLD_RELEASE_SCHEDULE).toEqual({ cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' });
    expect(GATE_HOLD_RELEASE_JOB).toBe('gate.hold-release');
  });
});

describe('🔴 ① 上限に余地が無ければ何もしない（docs/05 §9.3）', () => {
  it('BLOCK なら保留行を読みに行かず、1 件も積まない', async () => {
    probeAiCostHeadroom.mockResolvedValue({ kind: 'BLOCK' });
    const { handler, enqueueGateRun } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');

    expect(outcome).toEqual({ scanned: 0, requeued: 0, blockedByFailedJob: 0, capacity: 0 });
    // 🔴 走査そのものを行わない（積み直しても `gate.run` がまた保留にするだけ）。
    expect(listPendingReviewGates).not.toHaveBeenCalled();
    expect(enqueueGateRun).not.toHaveBeenCalled();
  });

  it('🔴 判定は毎回行う（前回の結果を覚えない = 時刻で判定しない）', async () => {
    probeAiCostHeadroom.mockResolvedValue({ kind: 'BLOCK' });
    const { handler } = makeHandler();

    await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');
    await handler({ tenantId: TENANT_ID }, 'gate.hold-release:2');

    expect(probeAiCostHeadroom).toHaveBeenCalledTimes(2);
  });
});

describe('🔴 ②③ 余地の件数だけ、同じ payload で積み直す', () => {
  it('保留行と同じ材料（tenantId / targetType / targetId / contentHash）で gate.run を積む', async () => {
    listPendingReviewGates.mockResolvedValue([
      pending(),
      pending({ id: 'x', targetType: 'PROJECT_PUBLISH', targetId: PROJECT_ID, contentHash: 'hash-2' }),
    ]);
    const { handler, enqueueGateRun } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');

    expect(outcome).toEqual({ scanned: 2, requeued: 2, blockedByFailedJob: 0, capacity: 10 });
    expect(enqueueGateRun.mock.calls.map(([job]) => job)).toEqual([
      { tenantId: TENANT_ID, targetType: 'PROPOSAL', targetId: PROPOSAL_ID, contentHash: 'hash-1' },
      { tenantId: TENANT_ID, targetType: 'PROJECT_PUBLISH', targetId: PROJECT_ID, contentHash: 'hash-2' },
    ]);
  });

  it('🔴 capacity を超えた分は積まない（10 分後の実行が同じ順序で拾う）', async () => {
    probeAiCostHeadroom.mockResolvedValue({ kind: 'ALLOW', capacity: 1 });
    listPendingReviewGates.mockResolvedValue([
      pending({ contentHash: 'old' }),
      pending({ id: 'y', targetId: PROJECT_ID, contentHash: 'new' }),
    ]);
    const { handler, enqueueGateRun } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');

    expect(outcome).toEqual({ scanned: 2, requeued: 1, blockedByFailedJob: 0, capacity: 1 });
    // 🔴 走査の順序（`heldSince` 昇順）のまま先頭から配る = 古い保留が飢えない。
    expect(enqueueGateRun).toHaveBeenCalledTimes(1);
    expect(enqueueGateRun.mock.calls[0]?.[0]).toMatchObject({ contentHash: 'old' });
  });

  it('保留が 1 件も無ければ何も積まない（余地はあっても空振りしない）', async () => {
    const { handler, enqueueGateRun } = makeHandler();
    const outcome = await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');
    expect(outcome).toEqual({ scanned: 0, requeued: 0, blockedByFailedJob: 0, capacity: 10 });
    expect(enqueueGateRun).not.toHaveBeenCalled();
  });

  it('🔴 積めなかった（同 jobId の failed 記録が残っている）ものを requeued に数えない', async () => {
    // 🔴 BullMQ は同じ `jobId` の `failed` 記録がある間 `add` を静かに無視する（§9.1）。
    //    ここで「積んだ」ことにすると、10 分ごとに「復帰させた」と報告しながら
    //    実際には何も起きない（`CLAUDE.md` §11.1）。
    listPendingReviewGates.mockResolvedValue([
      pending({ contentHash: 'blocked' }),
      pending({ id: 'z', targetId: PROJECT_ID, contentHash: 'ok' }),
    ]);
    const enqueueGateRun = vi.fn(async (job: { contentHash: string }) =>
      job.contentHash === 'blocked' ? ('BLOCKED_BY_FAILED_JOB' as const) : ('ENQUEUED' as const),
    );
    const { handler } = makeHandler({ enqueueGateRun });

    const outcome = await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');

    expect(outcome).toEqual({ scanned: 2, requeued: 1, blockedByFailedJob: 1, capacity: 10 });
    // 🔴 積めなかった行でも走査は止めない（後続の保留は復帰できる）。
    expect(enqueueGateRun).toHaveBeenCalledTimes(2);
  });

  it('🔴 積めなかった行は枠（capacity）を消費しない', async () => {
    probeAiCostHeadroom.mockResolvedValue({ kind: 'ALLOW', capacity: 1 });
    listPendingReviewGates.mockResolvedValue([
      pending({ contentHash: 'blocked' }),
      pending({ id: 'z', targetId: PROJECT_ID, contentHash: 'ok' }),
    ]);
    const enqueueGateRun = vi.fn(async (job: { contentHash: string }) =>
      job.contentHash === 'blocked' ? ('BLOCKED_BY_FAILED_JOB' as const) : ('ENQUEUED' as const),
    );
    const { handler } = makeHandler({ enqueueGateRun });

    // 枠は 1 件ぶんしか無いが、消費したのは実際に積めた 1 件だけである
    //（積めなかった行が枠を食うと、後続の保留が理由も無く次回送りになる）。
    expect(await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1')).toEqual({
      scanned: 2,
      requeued: 1,
      blockedByFailedJob: 1,
      capacity: 1,
    });
  });

  it('走査の上限（ページサイズ）を渡す', async () => {
    const { handler } = makeHandler({ scanLimit: 7 });
    await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');
    expect(listPendingReviewGates).toHaveBeenCalledWith(expect.anything(), { limit: 7 });
  });
});

describe('🔴 ⑤⑥ 判定の材料', () => {
  it('gate-inspector のモデルを解決してから見積もる（gate.run と同じ解決器を通る）', async () => {
    const { handler, resolve } = makeHandler();
    await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');

    expect(resolve).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      role: 'gate-inspector',
      tier: 'DEFAULT',
    });
    const [, probe] = probeAiCostHeadroom.mock.calls[0] ?? [];
    expect(probe).toMatchObject({ modelId: SONNET, limitUsd: '5.000000', now: NOW });
    // 🔴 下限の見積り（出力は常に上限まで予約される / 入力は地の文が必ず載る）。
    expect((probe as { maxOutputTokens: number }).maxOutputTokens).toBeGreaterThan(0);
    expect((probe as { estimatedInputTokens: number }).estimatedInputTokens).toBeGreaterThan(0);
  });

  it('🔴 分離キーは payload の tenantId から組み立てた ctx である（走査も判定も同じ ctx）', async () => {
    listPendingReviewGates.mockResolvedValue([pending()]);
    const { handler } = makeHandler();
    await handler({ tenantId: TENANT_ID }, 'gate.hold-release:1');

    const probeCtx = probeAiCostHeadroom.mock.calls[0]?.[0] as { tenantId: string; partnerCompanyId: null };
    const scanCtx = listPendingReviewGates.mock.calls[0]?.[0] as { tenantId: string };
    expect(probeCtx.tenantId).toBe(TENANT_ID);
    expect(probeCtx.partnerCompanyId).toBeNull();
    expect(scanCtx.tenantId).toBe(TENANT_ID);
  });
});
