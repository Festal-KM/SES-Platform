// apps/worker/src/jobs/send-proposal.test.ts
// 🔴 `send.proposal`（docs/05 §10.2 / §10.4 / §10.5 / §10.6 / `F-022`）の**順序**をユニットで固定する。T-09-06。
//
// 固定するのは:
//   ① 遷移の所有者（`APPROVED → SUBMITTING` / `SUBMITTING → SUBMITTED` / `→ SUBMIT_FAILED` = `SEND_JOB`。#48 の `MANUAL` と重ならない）
//   ② payload の門番（`attemptSeq >= 2` は `requestedBy` 必須。③ の後に `SendAttemptOriginError` を出さない）
//   ③ 🔴 事前判定 ①② が **CAS（`castProposalToSubmitting`）より前**で止まり、外部を呼ばない（保留は `APPROVED` のまま）
//   ④ `DEFER` は保留ではなく待機（`deferJob`）。状態も保留列も動かさない
//   ⑤ 成功 → `SUBMITTED`、明示的失敗 / 応答不明 → `SUBMIT_FAILED`（再試行しない）、④ の競合 → 外部を呼ばず `SUBMIT_FAILED`
//
// 実 DB での検証（同一提案に 2 回起動して外部 1 回 / RLS / CAS）は `tests/isolation/send-proposal.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readProposalForSend = vi.fn();
const readProposalGateFreshness = vi.fn();
const readEmailDailyCount = vi.fn();
const readSendAttempt = vi.fn();
const reserveEmailDailyQuota = vi.fn();
const castProposalToSubmitting = vi.fn();
const reserveSendAttempt = vi.fn();
const settleProposalSubmission = vi.fn();
const failProposalSubmissionWithoutAttempt = vi.fn();
const holdProposalSend = vi.fn();
const resolveRecipientClass = vi.fn();
const withTenant = vi.fn();

vi.mock('@ses/db', () => ({
  readProposalForSend,
  readProposalGateFreshness,
  readEmailDailyCount,
  readSendAttempt,
  reserveEmailDailyQuota,
  castProposalToSubmitting,
  reserveSendAttempt,
  settleProposalSubmission,
  failProposalSubmissionWithoutAttempt,
  holdProposalSend,
  resolveRecipientClass,
  resolveVerifiedSendingDomain: vi.fn(),
  withTenant,
  PROPOSAL_SEND_ENTITY_TYPE: 'PROPOSAL',
  systemTenantCtx: (tenantId: string, job: { queue: string; jobId: string }) => ({
    tenantId,
    partnerCompanyId: null,
    userId: '',
    role: 'SALES',
    lifecycleState: 'ACTIVE',
    partnerSuspendedAt: null,
    deviceKind: 'api',
    job,
  }),
}));

const { ExternalSendError, InMemoryMinuteWindowCounter, InMemoryProviderSendCounter, isJobDeferral, ProviderQuotaExceededError } =
  await import('@ses/connectors');
const { proposalTransitionOwner, isManualProposalTransition } = await import('@ses/domain');
const { createSendProposalHandler, parseSendProposalPayload, PROPOSAL_SEND_TRANSITIONS, sendAttemptOriginOf } =
  await import('./send-proposal.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const PROPOSAL_ID = '01930000-0000-7000-8000-000000000b01';
const USER_ID = '01930000-0000-7000-8000-0000000000c1';
const NOW = new Date('2026-09-16T09:00:00.000Z');
const VERIFIED_DOMAIN = { domain: 'example.co.jp', mailFromDomain: 'mail.example.co.jp', verifiedAt: NOW };
const TOKEN = { idempotencyKey: `proposal:${PROPOSAL_ID}:1`, attemptSeq: 1, entityType: 'PROPOSAL', entityId: PROPOSAL_ID };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    proposalId: PROPOSAL_ID,
    attemptSeq: 1,
    requestedBy: null,
    enqueuedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    ...overrides,
  };
}

function approvedProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    state: 'APPROVED',
    recipientCompanyName: '架空エンド株式会社',
    recipientEmail: 'recipient@example.test',
    subject: 'ご提案',
    body: '本文',
    sendHoldReasonKey: null,
    sendHoldSince: null,
    snapshotPresent: true,
    attachment: null,
    tenantLifecycleState: 'ACTIVE',
    ...overrides,
  };
}

function makeHandler(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(async (input: unknown) => ({ externalId: input === undefined ? 'mock-0' : 'mock-1' }));
  const emailSender = { send, callCount: () => send.mock.calls.length, getQuota: async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW }) };
  const deps = {
    emailSender,
    emailImplementationKind: 'mock',
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    providerDailyQuota: 200,
    providerSentCounter: new InMemoryProviderSendCounter(),
    resolveSendingDomain: vi.fn(async () => VERIFIED_DOMAIN),
    staleThresholdMinutes: 30,
    now: () => NOW,
    ...overrides,
  };
  return { handler: createSendProposalHandler(deps as never), send, deps };
}

beforeEach(() => {
  for (const mock of [
    readProposalForSend,
    readProposalGateFreshness,
    readEmailDailyCount,
    readSendAttempt,
    reserveEmailDailyQuota,
    castProposalToSubmitting,
    reserveSendAttempt,
    settleProposalSubmission,
    failProposalSubmissionWithoutAttempt,
    holdProposalSend,
    resolveRecipientClass,
    withTenant,
  ]) {
    mock.mockReset();
  }
  readProposalForSend.mockResolvedValue(approvedProposal());
  readProposalGateFreshness.mockResolvedValue({ state: 'APPROVED', storedHash: 'h', currentHash: 'h', reviewGateId: 'g', gateFresh: true });
  readEmailDailyCount.mockResolvedValue(0);
  readSendAttempt.mockResolvedValue(null);
  reserveEmailDailyQuota.mockResolvedValue({ allowed: true, value: 1 });
  castProposalToSubmitting.mockResolvedValue({ kind: 'SUBMITTING', contentHash: 'h' });
  reserveSendAttempt.mockResolvedValue({ outcome: 'RESERVED', token: TOKEN });
  settleProposalSubmission.mockResolvedValue({ kind: 'SETTLED', state: 'SUBMITTED' });
  failProposalSubmissionWithoutAttempt.mockResolvedValue(true);
  holdProposalSend.mockResolvedValue({ kind: 'HELD', since: NOW });
  resolveRecipientClass.mockResolvedValue('CLIENT');
  withTenant.mockImplementation(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn({}));
});

describe('① 遷移の所有者（docs/05 §6.5「#48 の実装の決着」の表）', () => {
  it.each(PROPOSAL_SEND_TRANSITIONS.map((t) => [t.from, t.to] as const))('%s → %s の所有者は SEND_JOB で、#48 の MANUAL ではない', (from, to) => {
    expect(proposalTransitionOwner(from, to)).toBe('SEND_JOB');
    expect(isManualProposalTransition(from, to)).toBe(false);
  });
});

describe('② payload の門番（docs/05 §9.1 / §10.6。T-09-05 申し送り 9）', () => {
  it('正しい payload を受け付け、enqueuedAt を Date にする', () => {
    const parsed = parseSendProposalPayload(payload());
    expect(parsed.attemptSeq).toBe(1);
    expect(parsed.enqueuedAt).toBeInstanceOf(Date);
    expect(sendAttemptOriginOf(parsed)).toEqual({ kind: 'INITIAL' });
  });

  it('🔴 attemptSeq >= 2 なのに requestedBy が無い payload は入口で落とす（③ の後に SendAttemptOriginError を出さない）', () => {
    expect(() => parseSendProposalPayload(payload({ attemptSeq: 2 }))).toThrow(InvalidJobPayloadError);
    const parsed = parseSendProposalPayload(payload({ attemptSeq: 2, requestedBy: USER_ID }));
    expect(sendAttemptOriginOf(parsed)).toEqual({ kind: 'RESEND', attemptSeq: 2, requestedBy: USER_ID });
  });

  it('attemptSeq が 0 / 小数 / 文字列、enqueuedAt が不正、UUID でない ID は落とす', () => {
    expect(() => parseSendProposalPayload(payload({ attemptSeq: 0 }))).toThrow(InvalidJobPayloadError);
    expect(() => parseSendProposalPayload(payload({ attemptSeq: 1.5 }))).toThrow(InvalidJobPayloadError);
    expect(() => parseSendProposalPayload(payload({ attemptSeq: '1' }))).toThrow(InvalidJobPayloadError);
    expect(() => parseSendProposalPayload(payload({ enqueuedAt: 'yesterday' }))).toThrow(InvalidJobPayloadError);
    expect(() => parseSendProposalPayload(payload({ proposalId: 'p1' }))).toThrow(InvalidJobPayloadError);
    expect(() => parseSendProposalPayload(payload({ requestedBy: 'someone' }))).toThrow(InvalidJobPayloadError);
    expect(() => parseSendProposalPayload(null)).toThrow(InvalidJobPayloadError);
  });
});

describe('③ 事前判定・遅延判定は CAS より前で止まり、外部を呼ばない（docs/05 §10.2 ①②）', () => {
  it.each([
    ['①-a TENANT_SUSPENDED', approvedProposal({ tenantLifecycleState: 'SUSPENDED' }), 'TENANT_SUSPENDED'],
    ['①-a CLOSING も実行不可', approvedProposal({ tenantLifecycleState: 'CLOSING' }), 'TENANT_SUSPENDED'],
    ['②-c 凍結が無い', approvedProposal({ snapshotPresent: false }), 'GATE_STALE'],
    ['②-c 提案先が空', approvedProposal({ recipientEmail: '' }), 'GATE_STALE'],
  ] as const)('%s → 保留（APPROVED のまま）。castProposalToSubmitting も send も呼ばれない', async (_label, row, reasonKey) => {
    readProposalForSend.mockResolvedValue(row);
    const { handler, send } = makeHandler();

    const outcome = await handler(payload(), 'j-1');

    expect(outcome).toEqual({ kind: 'HELD', reasonKey, applied: true });
    expect(holdProposalSend).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ proposalId: PROPOSAL_ID, reasonKey }));
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(reserveSendAttempt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('①-b APPROVED でなければ外部を呼ばずに終了（保留も書かない）', async () => {
    readProposalForSend.mockResolvedValue(approvedProposal({ state: 'APPROVAL_PENDING' }));
    const { handler, send } = makeHandler();

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'SKIPPED', reason: 'NOT_APPROVED', detail: 'APPROVAL_PENDING' });
    expect(holdProposalSend).not.toHaveBeenCalled();
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('①-c ゲートが現在の内容に対して有効でなければ GATE_STALE（承認 CAS と同じ述語の読み取り）', async () => {
    readProposalGateFreshness.mockResolvedValue({ state: 'APPROVED', storedHash: 'h1', currentHash: 'h2', reviewGateId: null, gateFresh: false });
    const { handler, send } = makeHandler();

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 ①-d ドメイン未検証は DOMAIN_UNVERIFIED の保留（SUBMIT_FAILED ではない。共通ドメインへ倒さない）', async () => {
    const { handler, send } = makeHandler({ resolveSendingDomain: vi.fn(async () => null) });

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'HELD', reasonKey: 'DOMAIN_UNVERIFIED', applied: true });
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(settleProposalSubmission).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('①-e テナントの日次上限 BLOCK は RATE_LIMIT の保留（PROVIDER_QUOTA ではない）', async () => {
    readEmailDailyCount.mockResolvedValue(500);
    const { handler, send } = makeHandler({ dailyLimit: 500 });

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'HELD', reasonKey: 'RATE_LIMIT', applied: true });
    expect(reserveEmailDailyQuota).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 ①-e 分次上限 DEFER は保留ではなく待機（deferJob）。状態・保留列・カウンタを動かさない', async () => {
    const minuteWindow = new InMemoryMinuteWindowCounter();
    for (let i = 0; i < 30; i += 1) await minuteWindow.record(TENANT_ID, new Date(NOW.getTime() - 10_000));
    const { handler, send } = makeHandler({ minuteWindow, minuteLimit: 30 });

    const outcome = await handler(payload(), 'j-1');

    expect(isJobDeferral(outcome)).toBe(true);
    if (!isJobDeferral(outcome)) throw new Error('unreachable');
    // 最も古い記録から 60 秒後 = 50 秒後に 1 枠空く。
    expect(outcome.retryAfterMs).toBe(50_000);
    expect(holdProposalSend).not.toHaveBeenCalled();
    expect(reserveEmailDailyQuota).not.toHaveBeenCalled();
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 ①-e 送信基盤の枠 HOLD は PROVIDER_QUOTA の保留（RATE_LIMIT と別の値。テナントの残量は使わない）', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW);
    const { handler, send } = makeHandler({ providerDailyQuota: 1, providerSentCounter });

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'HELD', reasonKey: 'PROVIDER_QUOTA', applied: true });
    expect(reserveEmailDailyQuota).not.toHaveBeenCalled();
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 ②-a enqueue から閾値を超えていたら GATE_STALE（時間が経ったものを黙って送らない）', async () => {
    const { handler, send } = makeHandler({ staleThresholdMinutes: 30 });

    const outcome = await handler(payload({ enqueuedAt: new Date(NOW.getTime() - 31 * 60_000).toISOString() }), 'j-1');

    expect(outcome).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 ②-d 同じ attemptSeq の SendAttempt が既にあれば CAS の前に終了する（T-09-05 申し送り 3）', async () => {
    readSendAttempt.mockResolvedValue({ attemptSeq: 1, status: 'SUCCEEDED' });
    const { handler, send } = makeHandler();

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'SKIPPED', reason: 'ATTEMPT_EXISTS', detail: 'SUCCEEDED' });
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(reserveSendAttempt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('日次枠の原子的な予約に負けたら RATE_LIMIT の保留（CAS の前）', async () => {
    reserveEmailDailyQuota.mockResolvedValue({ allowed: false, value: 500 });
    const { handler, send } = makeHandler();

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'HELD', reasonKey: 'RATE_LIMIT', applied: true });
    expect(castProposalToSubmitting).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('③ CAS で負けたら（NOT_APPROVED）外部を呼ばずに終了 / GATE_STALE なら保留', async () => {
    castProposalToSubmitting.mockResolvedValue({ kind: 'NOT_APPROVED', state: 'SUBMITTING' });
    const lost = makeHandler();
    expect(await lost.handler(payload(), 'j-1')).toEqual({ kind: 'SKIPPED', reason: 'CAS_LOST', detail: 'SUBMITTING' });
    expect(lost.send).not.toHaveBeenCalled();

    castProposalToSubmitting.mockResolvedValue({ kind: 'GATE_STALE' });
    const stale = makeHandler();
    expect(await stale.handler(payload(), 'j-2')).toEqual({ kind: 'HELD', reasonKey: 'GATE_STALE', applied: true });
    expect(stale.send).not.toHaveBeenCalled();
    expect(reserveSendAttempt).not.toHaveBeenCalled();
  });
});

describe('④⑤⑥ 予約 → 外部呼び出し → 確定（docs/05 §10.2 / §10.6）', () => {
  it('成功: 予約 → send 1 回 → settleProposalSubmission（SUCCEEDED）→ SENT。分類は resolveRecipientClass が決める（CLIENT）', async () => {
    const { handler, send } = makeHandler();

    const outcome = await handler(payload(), 'j-1');

    expect(outcome).toEqual({ kind: 'SENT', attemptSeq: 1, externalId: 'mock-1', mocked: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      recipientClass: 'CLIENT',
      to: 'recipient@example.test',
      fromDomain: VERIFIED_DOMAIN,
      token: TOKEN,
      tenantId: TENANT_ID,
    });
    expect(resolveRecipientClass).toHaveBeenCalledWith(expect.anything(), null, 'CLIENT');
    expect(settleProposalSubmission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ proposalId: PROPOSAL_ID, token: TOKEN, settlement: { status: 'SUCCEEDED', externalId: 'mock-1' }, requestedBy: null }),
    );
    // 順序: 予約が send より前、確定が send より後。
    expect(reserveSendAttempt.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0] ?? 0);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(settleProposalSubmission.mock.invocationCallOrder[0] ?? 0);
  });

  it('🔴 ④ ALREADY_RESERVED（稀な競合）は外部を呼ばず、③ で入れた SUBMITTING を SUBMIT_FAILED(RESERVATION_CONFLICT) に確定する', async () => {
    reserveSendAttempt.mockResolvedValue({ outcome: 'ALREADY_RESERVED', existing: { attemptSeq: 1, status: 'RESERVED' } });
    const { handler, send } = makeHandler();

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'RESERVATION_CONFLICT', attemptSeq: 1, settled: true });
    expect(send).not.toHaveBeenCalled();
    expect(settleProposalSubmission).not.toHaveBeenCalled();
    expect(failProposalSubmissionWithoutAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ proposalId: PROPOSAL_ID, attemptSeq: 1 }));
  });

  it('🔴 明示的失敗（PERMANENT）は FAILED + SUBMIT_FAILED。再試行しない（send は 1 回）', async () => {
    const send = vi.fn(async () => {
      throw new ExternalSendError('PERMANENT', 'MessageRejected', 'rejected');
    });
    settleProposalSubmission.mockResolvedValue({ kind: 'SETTLED', state: 'SUBMIT_FAILED' });
    const { handler } = makeHandler({ emailSender: { send, callCount: () => 0, getQuota: async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW }) } });

    const outcome = await handler(payload(), 'j-1');

    expect(outcome).toEqual({ kind: 'FAILED', attemptSeq: 1, settlement: 'FAILED', failureKind: 'PERMANENT:MessageRejected' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(settleProposalSubmission.mock.calls[0]?.[1]).toMatchObject({ settlement: expect.objectContaining({ status: 'FAILED', failureKind: 'PERMANENT:MessageRejected' }) });
  });

  it('🔴 応答不明（UNKNOWN / 分類できない例外）は UNKNOWN + SUBMIT_FAILED（§10.6 の隔離。自動再送しない）', async () => {
    settleProposalSubmission.mockResolvedValue({ kind: 'SETTLED', state: 'SUBMIT_FAILED' });
    const timeout = makeHandler({
      emailSender: {
        send: vi.fn(async () => {
          throw new ExternalSendError('UNKNOWN', 'TimeoutError', 'timed out');
        }),
        callCount: () => 0,
        getQuota: async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW }),
      },
    });
    expect(await timeout.handler(payload(), 'j-1')).toMatchObject({ kind: 'FAILED', settlement: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError' });

    const unexpected = makeHandler({
      emailSender: {
        send: vi.fn(async () => {
          throw new TypeError('socket hang up recipient@example.test');
        }),
        callCount: () => 0,
        getQuota: async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW }),
      },
    });
    const outcome = await unexpected.handler(payload(), 'j-2');
    expect(outcome).toMatchObject({ kind: 'FAILED', settlement: 'UNKNOWN', failureKind: 'UNKNOWN:TypeError' });
    // 🔴 分類できない例外のメッセージ（宛先が混ざりうる）を確定の記録に載せない。
    const recorded = settleProposalSubmission.mock.calls.at(-1)?.[1] as { settlement: { failureDetail?: string } };
    expect(recorded.settlement.failureDetail).toBeUndefined();
  });

  it('🔴 CAS 後に SES が同期的に日次枠超過を返した競合は保留に戻さず SUBMIT_FAILED（§8.3-Q ⑤ / BR-22）', async () => {
    settleProposalSubmission.mockResolvedValue({ kind: 'SETTLED', state: 'SUBMIT_FAILED' });
    const { handler } = makeHandler({
      emailSender: {
        send: vi.fn(async () => {
          throw new ProviderQuotaExceededError();
        }),
        callCount: () => 0,
        getQuota: async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW }),
      },
    });

    expect(await handler(payload(), 'j-1')).toEqual({ kind: 'FAILED', attemptSeq: 1, settlement: 'FAILED', failureKind: 'PROVIDER_QUOTA' });
    expect(holdProposalSend).not.toHaveBeenCalled();
  });

  it('RESEND（attemptSeq 2）は origin を RESEND で予約し、requestedBy を確定の記録に渡す', async () => {
    const { handler } = makeHandler();

    await handler(payload({ attemptSeq: 2, requestedBy: USER_ID }), 'j-1');

    expect(reserveSendAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: { kind: 'RESEND', attemptSeq: 2, requestedBy: USER_ID } }),
    );
    expect(settleProposalSubmission.mock.calls[0]?.[1]).toMatchObject({ requestedBy: USER_ID });
    expect(readSendAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attemptSeq: 2 }));
  });

  it('⑥ で試行が既に確定していた / 提案が SUBMITTING でなかったときは SETTLE_ANOMALY を返し、throw も再送もしない', async () => {
    settleProposalSubmission.mockResolvedValue({ kind: 'PROPOSAL_NOT_SUBMITTING', state: 'SUBMITTED' });
    const { handler, send } = makeHandler();

    const outcome = await handler(payload(), 'j-1');

    expect(outcome).toMatchObject({ kind: 'SETTLE_ANOMALY', attemptSeq: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
