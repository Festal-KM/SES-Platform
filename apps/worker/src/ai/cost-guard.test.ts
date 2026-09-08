// apps/worker/src/ai/cost-guard.test.ts
// 🔴 ポート（`packages/ai` の `AiCostGuard`）と実装（`packages/db`）の配線の検証。T-07-04。
//
// DB を要する部分（原子性・並行実行・日またぎ）は `tests/isolation/ai-cost-guard.test.ts` が
// 実証する。ここで固定するのは 5 点:
//   ① ctx が `systemTenantCtx`（ホスト文脈 + ジョブ識別）で組み立てられる
//   ② 🔴 `tenantId` は**呼び出しの引数**から取られる（別テナントの枠を消費しない）
//   ③ 🔴 上限到達を `AiCostLimitExceededError` へ写像する（＝ `runRole` が LLM を呼ばない）
//   ④ 🔴 `settle` に**失敗した試行も含む全試行**が渡る（原価は発生している）
//   ⑤ 🔴 金額（上限値）を `packages/ai` 側に持たせない（証だけを返す）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reserveAiCost = vi.fn();
const settleAiCost = vi.fn();

vi.mock('@ses/db', () => ({
  reserveAiCost,
  settleAiCost,
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

const { AiCostLimitExceededError } = await import('@ses/ai');
const { createAiCostGuard } = await import('./cost-guard.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const JOB = { queue: 'gate.run', jobId: 'gate.run:PROPOSAL:1:hash' } as const;
const NOW = new Date('2026-09-07T16:00:00.000Z');
const RESET_AT = new Date('2026-09-08T15:00:00.000Z');
const DAILY_LIMIT_USD = '1.500000';

const TOKENS = {
  inputTokens: 5_000,
  outputTokens: 1_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
} as const;

function guard() {
  return createAiCostGuard({ job: JOB, dailyLimitUsd: DAILY_LIMIT_USD });
}

function reserveInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    role: 'gate-inspector',
    modelId: 'claude-sonnet-5',
    estimatedInputTokens: 4_000,
    maxOutputTokens: 2_000,
    now: NOW,
    ...overrides,
  } as Parameters<ReturnType<typeof createAiCostGuard>['reserve']>[0];
}

beforeEach(() => {
  reserveAiCost.mockReset();
  reserveAiCost.mockResolvedValue({
    kind: 'RESERVED',
    handle: 'v1:2026-09-08:31500',
    reservedUsd: '0.031500',
    periodKey: '2026-09-08',
  });
  settleAiCost.mockReset();
  settleAiCost.mockResolvedValue({
    actualUsd: '0.020000',
    valueUsd: '0.020000',
    reservedUsd: '0.000000',
    periodKey: '2026-09-08',
  });
});

describe('createAiCostGuard.reserve', () => {
  it('ctx をジョブ識別つきのホスト文脈で組み立て、上限をテナントの設定値として渡す', async () => {
    const reservation = await guard().reserve(reserveInput());

    expect(reservation).toEqual({ handle: 'v1:2026-09-08:31500' });
    const [ctx, input] = reserveAiCost.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ctx).toMatchObject({ tenantId: TENANT_ID, partnerCompanyId: null, job: JOB });
    expect(input).toEqual({
      modelId: 'claude-sonnet-5',
      estimatedInputTokens: 4_000,
      maxOutputTokens: 2_000,
      limitUsd: DAILY_LIMIT_USD,
      now: NOW,
    });
  });

  it('🔴 tenantId は入力の値から取る（固定のテナントの枠を消費しない）', async () => {
    const other = '01930000-0000-7000-8000-0000000000a2';
    await guard().reserve(reserveInput({ tenantId: other }));
    const [ctx] = reserveAiCost.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.tenantId).toBe(other);
  });

  it('🔴 上限到達は AiCostLimitExceededError になる（呼ばなかった = HELD の入口）', async () => {
    reserveAiCost.mockResolvedValue({
      kind: 'LIMIT_REACHED',
      limitUsd: DAILY_LIMIT_USD,
      headroomUsd: '0.010000',
      resetAt: RESET_AT,
      periodKey: '2026-09-08',
    });

    const error = await guard()
      .reserve(reserveInput())
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(AiCostLimitExceededError);
    const limitError = error as InstanceType<typeof AiCostLimitExceededError>;
    expect(limitError.resetAt).toEqual(RESET_AT);
    expect(limitError.limitUsd).toBe(DAILY_LIMIT_USD);
    expect(limitError.remainingUsd).toBe('0.010000');
  });

  it('🔴 予約の証以外を packages/ai へ渡さない（金額を持たせない。docs/05 §7.9 ④）', async () => {
    const reservation = await guard().reserve(reserveInput());
    expect(Object.keys(reservation)).toEqual(['handle']);
  });

  it('🔴 DB 側の例外（単価未登録など）を握り潰さない', async () => {
    reserveAiCost.mockRejectedValue(new Error('モデル x の単価が未登録です'));
    await expect(guard().reserve(reserveInput())).rejects.toThrow('モデル x の単価が未登録です');
  });
});

describe('createAiCostGuard.settle', () => {
  it('🔴 失敗した試行も含む全試行を、予約の証とともに渡す', async () => {
    const attempts = [
      { modelId: 'claude-sonnet-5', tokens: TOKENS },
      { modelId: 'claude-sonnet-5', tokens: { ...TOKENS, outputTokens: 0 } },
    ] as const;

    await guard().settle({
      tenantId: TENANT_ID,
      reservation: { handle: 'v1:2026-09-08:31500' },
      attempts,
      now: NOW,
    });

    const [ctx, input] = settleAiCost.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ctx).toMatchObject({ tenantId: TENANT_ID, job: JOB });
    expect(input).toEqual({ handle: 'v1:2026-09-08:31500', attempts, now: NOW });
  });

  it('🔴 補正の失敗を握り潰さない（枠だけ空いて原価が積まれない状態を作らない）', async () => {
    settleAiCost.mockRejectedValue(new Error('AI コストの予約を補正できませんでした'));
    await expect(
      guard().settle({
        tenantId: TENANT_ID,
        reservation: { handle: 'v1:2026-09-08:31500' },
        attempts: [{ modelId: 'claude-sonnet-5', tokens: TOKENS }],
        now: NOW,
      }),
    ).rejects.toThrow('AI コストの予約を補正できませんでした');
  });
});
