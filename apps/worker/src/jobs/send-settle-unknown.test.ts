// apps/worker/src/jobs/send-settle-unknown.test.ts
// 🔴 `send.settle-unknown`（毎 10 分。docs/05 §10.6「T-09-07 の実装の決着」/ `F-022 AC-2`）の検証。T-09-07。
//
// 固定するのは 5 点である:
//   ① payload の `tenantId` からジョブ文脈（`systemTenantCtx`）を組み立て、**その ctx で** `packages/db` の
//      `settleStalledProposalSubmissions` を呼ぶ（テナント横断のクエリをワーカーが書かない。母集団は RLS）
//   ② 閾値は deps の `submittingStallMinutes`（`SUBMITTING_STALL_ALERT_MINUTES`）、基準時刻は deps の `now()`
//   ③ 🔴 payload が不正なら**実行しない**（既定値で補完しない。別テナントの提案を確定させる事故を作らない）
//   ④ スケジュールは毎 10 分、キュー名は `QUEUE_DEFINITIONS` にあり `attempts: 3`（外部を呼ばないから許される）
//   ⑤ 🔴 deps に `EmailSender` が無い / `@ses/db` の他の関数（予約・採番・`APPROVED` へ戻す）を呼ばない —— **自動リトライではない**
//
// 🔴 DB を触らない（`@ses/db` はモック）。CAS・履歴・監査・`A-005` との整合の実測は `tests/isolation/send-proposal-unknown.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settleStalledProposalSubmissions = vi.fn();

vi.mock('@ses/db', () => ({
  settleStalledProposalSubmissions,
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

const {
  createSendSettleUnknownHandler,
  parseSendSettleUnknownPayload,
  SEND_SETTLE_UNKNOWN_JOB,
  SEND_SETTLE_UNKNOWN_SCHEDULE,
} = await import('./send-settle-unknown.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { isQueueName, QUEUE_DEFINITIONS, EXTERNAL_SEND_JOB_NAMES, INTERNAL_JOB_NAMES } = await import('@ses/connectors');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-16T00:40:00.000Z');

beforeEach(() => {
  settleStalledProposalSubmissions.mockReset();
  settleStalledProposalSubmissions.mockResolvedValue({ scanned: 1, settled: [{ proposalId: 'p1', settledAttemptSeqs: [1] }] });
});

describe('🔴 send.settle-unknown: 宣言とキュー定義', () => {
  it('キュー名は QUEUE_DEFINITIONS にあり、内部ジョブ（外部送信ではない）で attempts: 3、removeOnComplete を持たない', () => {
    expect(SEND_SETTLE_UNKNOWN_JOB).toBe('send.settle-unknown');
    expect(isQueueName(SEND_SETTLE_UNKNOWN_JOB)).toBe(true);
    expect(QUEUE_DEFINITIONS['send.settle-unknown'].defaultJobOptions).toEqual({ attempts: 3 });
    expect(INTERNAL_JOB_NAMES as readonly string[]).toContain(SEND_SETTLE_UNKNOWN_JOB);
    // 🔴 `send.` 接頭辞だが外部送信ではない（`EXTERNAL_SEND_JOB_NAMES` に無い = `attempts: 1` の対象外）。
    expect(EXTERNAL_SEND_JOB_NAMES as readonly string[]).not.toContain(SEND_SETTLE_UNKNOWN_JOB);
  });

  it('毎 10 分（send.hold-release と同じ周期。閾値 30 分 + 最大 10 分で確定する）', () => {
    expect(SEND_SETTLE_UNKNOWN_SCHEDULE).toEqual({ cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' });
  });
});

describe('🔴 ハンドラ: ジョブ文脈で packages/db の 1 関数を呼ぶだけ（送らない・戻さない・採番しない）', () => {
  it('payload の tenantId から systemTenantCtx を組み立て、閾値と deps.now() を渡す', async () => {
    const handler = createSendSettleUnknownHandler({ now: () => NOW, submittingStallMinutes: 30 });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:send.settle-unknown:1');
    expect(outcome).toEqual({ scanned: 1, settled: [{ proposalId: 'p1', settledAttemptSeqs: [1] }] });
    expect(settleStalledProposalSubmissions).toHaveBeenCalledTimes(1);
    const [ctx, input] = settleStalledProposalSubmissions.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx['tenantId']).toBe(TENANT_ID);
    expect(ctx['partnerCompanyId']).toBeNull();
    expect(ctx['job']).toEqual({ queue: 'send.settle-unknown', jobId: 'repeat:send.settle-unknown:1' });
    expect(input).toEqual({ stallThresholdMinutes: 30, now: NOW });
  });

  it('settleStallScanLimit を渡したときだけ limit が付く', async () => {
    const handler = createSendSettleUnknownHandler({ now: () => NOW, submittingStallMinutes: 45, settleStallScanLimit: 10 });
    await handler({ tenantId: TENANT_ID }, 'repeat:send.settle-unknown:2');
    expect(settleStalledProposalSubmissions.mock.calls[0]?.[1]).toEqual({ stallThresholdMinutes: 45, now: NOW, limit: 10 });
  });

  it.each([
    ['オブジェクトでない', 'not-an-object'],
    ['tenantId が無い', {}],
    ['tenantId が UUID でない', { tenantId: 'tenant-a' }],
    ['null', null],
  ])('🔴 payload が不正（%s）なら InvalidJobPayloadError で、DB の関数は呼ばれない', async (_label, payload) => {
    const handler = createSendSettleUnknownHandler({ now: () => NOW, submittingStallMinutes: 30 });
    await expect(handler(payload, 'repeat:send.settle-unknown:3')).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(settleStalledProposalSubmissions).not.toHaveBeenCalled();
  });

  it('parseSendSettleUnknownPayload は tenantId だけを写す（余分な項目を通さない）', () => {
    expect(parseSendSettleUnknownPayload({ tenantId: TENANT_ID, proposalId: 'x' })).toEqual({ tenantId: TENANT_ID });
  });

  it('🔴 deps は now と閾値だけ（EmailSender / enqueue 口 / 採番を型として持たない = 外部を呼ばず、再送も起こせない）', () => {
    // 型レベルの表明: 余分な deps を渡すとコンパイルエラーになる。
    // @ts-expect-error emailSender は SendSettleUnknownDeps に無い
    createSendSettleUnknownHandler({ now: () => NOW, submittingStallMinutes: 30, emailSender: {} });
    // @ts-expect-error enqueueSendProposal は SendSettleUnknownDeps に無い
    createSendSettleUnknownHandler({ now: () => NOW, submittingStallMinutes: 30, enqueueSendProposal: () => undefined });
    expect(true).toBe(true);
  });
});
