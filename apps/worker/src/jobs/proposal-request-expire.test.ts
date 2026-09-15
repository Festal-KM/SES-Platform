// apps/worker/src/jobs/proposal-request-expire.test.ts
// 🔴 `proposal-request.expire`（毎日 03:20 JST。docs/05 §9.5 / `F-018` 処理⑤）の検証。T-08-07。
//
// 固定するのは 4 点である:
//   ① payload の `tenantId` からジョブ文脈（`systemTenantCtx`）を組み立て、**その ctx で** `packages/db` の
//      `expireProposalRequests` を呼ぶ（テナント横断のクエリをワーカーが書かない。母集団は RLS）
//   ② 判定の基準時刻は deps の `now()`（ジョブ側で `new Date()` を読まない）
//   ③ 🔴 payload が不正なら**実行しない**（既定値で補完しない。別テナントの依頼を失効させる事故を作らない）
//   ④ スケジュールは 03:20 JST の日次、キュー名は `QUEUE_DEFINITIONS` にある
//
// 🔴 DB を触らない（`@ses/db` はモック）。CAS・監査・遷移表の実測は `tests/isolation/proposal-request-respond.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const expireProposalRequests = vi.fn();

vi.mock('@ses/db', () => ({
  expireProposalRequests,
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
  createProposalRequestExpireHandler,
  parseProposalRequestExpirePayload,
  PROPOSAL_REQUEST_EXPIRE_JOB,
  PROPOSAL_REQUEST_EXPIRE_SCHEDULE,
} = await import('./proposal-request-expire.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { isQueueName, QUEUE_DEFINITIONS } = await import('@ses/connectors');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-16T18:20:00.000Z'); // 03:20 JST

beforeEach(() => {
  expireProposalRequests.mockReset();
  expireProposalRequests.mockResolvedValue({ scanned: 2, expired: 1 });
});

describe('🔴 proposal-request.expire: 宣言とキュー定義', () => {
  it('キュー名は QUEUE_DEFINITIONS にあり、attempts: 3（外部 API を呼ばない）で removeOnComplete を持たない', () => {
    expect(PROPOSAL_REQUEST_EXPIRE_JOB).toBe('proposal-request.expire');
    expect(isQueueName(PROPOSAL_REQUEST_EXPIRE_JOB)).toBe(true);
    expect(QUEUE_DEFINITIONS['proposal-request.expire'].defaultJobOptions).toEqual({ attempts: 3 });
  });

  it('毎日 03:20 JST（docs/05 §9.5）', () => {
    expect(PROPOSAL_REQUEST_EXPIRE_SCHEDULE).toEqual({ cron: '20 3 * * *', timeZone: 'Asia/Tokyo' });
  });
});

describe('🔴 ハンドラ: ジョブ文脈で packages/db の 1 関数を呼ぶだけ', () => {
  it('payload の tenantId から systemTenantCtx を組み立て、deps.now() を基準時刻として渡す', async () => {
    const handler = createProposalRequestExpireHandler({ now: () => NOW });
    const outcome = await handler({ tenantId: TENANT_ID }, 'repeat:proposal-request.expire:1');
    expect(outcome).toEqual({ scanned: 2, expired: 1 });
    expect(expireProposalRequests).toHaveBeenCalledTimes(1);
    const [ctx, input] = expireProposalRequests.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx['tenantId']).toBe(TENANT_ID);
    expect(ctx['partnerCompanyId']).toBeNull();
    expect(ctx['job']).toEqual({ queue: 'proposal-request.expire', jobId: 'repeat:proposal-request.expire:1' });
    expect(input).toEqual({ now: NOW });
  });

  it('expireScanLimit を渡したときだけ limit が付く', async () => {
    const handler = createProposalRequestExpireHandler({ now: () => NOW, expireScanLimit: 10 });
    await handler({ tenantId: TENANT_ID }, 'repeat:proposal-request.expire:2');
    expect(expireProposalRequests.mock.calls[0]?.[1]).toEqual({ now: NOW, limit: 10 });
  });

  it.each([
    ['オブジェクトでない', 'not-an-object'],
    ['tenantId が無い', {}],
    ['tenantId が UUID でない', { tenantId: 'tenant-a' }],
  ])('🔴 payload が不正（%s）なら InvalidJobPayloadError で、DB を 1 度も呼ばない', async (_label, payload) => {
    const handler = createProposalRequestExpireHandler({ now: () => NOW });
    await expect(handler(payload, 'repeat:proposal-request.expire:3')).rejects.toBeInstanceOf(InvalidJobPayloadError);
    expect(() => parseProposalRequestExpirePayload(payload)).toThrow(InvalidJobPayloadError);
    expect(expireProposalRequests).not.toHaveBeenCalled();
  });
});
