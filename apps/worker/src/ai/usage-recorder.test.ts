// apps/worker/src/ai/usage-recorder.test.ts
// 🔴 ポート（`packages/ai` の `AiUsageRecorder`）と実装（`packages/db`）の配線の検証。T-07-03。
//
// DB を要する部分（原子性・RLS・件数の実加算）は `tests/isolation/ai-usage.test.ts` が実証する。
// ここで固定するのは 4 点:
//   ① ctx が `systemTenantCtx`（ホスト文脈 + ジョブ識別）で組み立てられる
//   ② 🔴 `tenantId` は **`AiUsageRecordInput` の値**から取られる（別テナントに積まない）
//   ③ 🔴 記録の失敗を握り潰さない（例外がそのまま `runRole` へ伝わる）
//   ④ マスキング要約（T-07-02 申し送り）が記録側へ渡る
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordAiUsage = vi.fn();
const countAiUnit = vi.fn();

vi.mock('@ses/db', () => ({
  recordAiUsage,
  countAiUnit,
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

const { createAiUsageRecorder } = await import('./usage-recorder.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const TARGET_ID = '01930000-0000-7000-8000-0000000000b1';
const JOB = { queue: 'gate.run', jobId: 'gate.run:PROPOSAL:1:hash' } as const;
const STARTED_AT = new Date('2026-09-08T01:00:00.000Z');
const FINISHED_AT = new Date('2026-09-08T01:00:03.000Z');

const TOKENS = {
  inputTokens: 5_000,
  outputTokens: 1_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
} as const;

function recordInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    role: 'gate-inspector',
    purpose: 'gate',
    modelId: 'claude-sonnet-5',
    promptVersion: 'gate-inspector.v1',
    targetType: 'PROPOSAL',
    targetId: TARGET_ID,
    tokens: TOKENS,
    attemptNo: 1,
    succeeded: true,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    ...overrides,
  } as Parameters<ReturnType<typeof createAiUsageRecorder>['record']>[0];
}

beforeEach(() => {
  recordAiUsage.mockReset();
  recordAiUsage.mockResolvedValue('01930000-0000-7000-8000-0000000000c1');
  countAiUnit.mockReset();
  countAiUnit.mockResolvedValue(null);
});

describe('createAiUsageRecorder.record', () => {
  it('ctx をジョブ識別つきのホスト文脈で組み立て、AiUsage.id を返す', async () => {
    const id = await createAiUsageRecorder(JOB).record(recordInput());

    expect(id).toBe('01930000-0000-7000-8000-0000000000c1');
    const [ctx, values] = recordAiUsage.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ctx).toMatchObject({ tenantId: TENANT_ID, partnerCompanyId: null, job: JOB });
    expect(values).toMatchObject({
      role: 'gate-inspector',
      purpose: 'gate',
      modelId: 'claude-sonnet-5',
      promptVersion: 'gate-inspector.v1',
      targetType: 'PROPOSAL',
      targetId: TARGET_ID,
      attemptNo: 1,
      succeeded: true,
    });
    // 🔴 金額は渡さない（記録側が単価表から算出する。docs/05 §7.9 ④）。
    expect(values).not.toHaveProperty('estimatedCostUsd');
    // 🔴 tenantId は ctx にのみ現れる（値として二重に運ばない）。
    expect(values).not.toHaveProperty('tenantId');
  });

  it('🔴 tenantId は入力の値から取る（固定のテナントに積まない）', async () => {
    const other = '01930000-0000-7000-8000-0000000000a2';
    await createAiUsageRecorder(JOB).record(recordInput({ tenantId: other }));
    const [ctx] = recordAiUsage.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.tenantId).toBe(other);
  });

  it('失敗した試行は failureKind つきで記録される（試行 1 回 = 1 行）', async () => {
    await createAiUsageRecorder(JOB).record(
      recordInput({ attemptNo: 2, succeeded: false, failureKind: 'SCHEMA' }),
    );
    const [, values] = recordAiUsage.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(values).toMatchObject({ attemptNo: 2, succeeded: false, failureKind: 'SCHEMA' });
  });

  it('🔴 パターン検出による追加マスキングの要約を記録側へ渡す（docs/03 §4.2）', async () => {
    const maskHits = [{ category: 'EMAIL', method: 'PATTERN', count: 2 }] as const;
    await createAiUsageRecorder(JOB).record(recordInput({ maskHits }));
    const [, values] = recordAiUsage.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(values.maskHits).toEqual(maskHits);
  });

  it('🔴 記録の失敗を握り潰さない（runRole が throw できるように伝播させる）', async () => {
    recordAiUsage.mockRejectedValue(new Error('ai_usage への INSERT に失敗'));
    await expect(createAiUsageRecorder(JOB).record(recordInput())).rejects.toThrow(
      'ai_usage への INSERT に失敗',
    );
  });
});

describe('createAiUsageRecorder.countUnit', () => {
  it('ロールと出力をそのまま渡す（何件と数えるかは記録側の写像表が決める）', async () => {
    const occurredAt = new Date('2026-09-08T01:00:04.000Z');
    const output = { rationales: [{ ref: 'a' }, { ref: 'b' }] };
    await createAiUsageRecorder(JOB).countUnit({
      tenantId: TENANT_ID,
      role: 'match-explainer',
      output,
      occurredAt,
    });

    const [ctx, values] = countAiUnit.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ctx).toMatchObject({ tenantId: TENANT_ID, job: JOB });
    expect(values).toEqual({ role: 'match-explainer', output, occurredAt });
  });

  it('🔴 件数の加算に失敗したら握り潰さない（使われたのに残量が減らない状態を作らない）', async () => {
    countAiUnit.mockRejectedValue(new Error('usage_counters を書き込めませんでした'));
    await expect(
      createAiUsageRecorder(JOB).countUnit({
        tenantId: TENANT_ID,
        role: 'sheet-parser',
        output: {},
        occurredAt: FINISHED_AT,
      }),
    ).rejects.toThrow('usage_counters を書き込めませんでした');
  });
});
