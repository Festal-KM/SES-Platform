// apps/worker/src/jobs/send-hold-release.test.ts
// 🔴 `send.hold-release`（毎 10 分。docs/05 §9.4 / §8.3-Q）の検証。
//
// 固定するのは 5 点である:
//   ① 🔴 **時刻で判定しない** —— 実行のたびに `decideProviderQuota` を再評価する
//   ② 🔴 `ALLOW` の **`headroom` 件だけ**、`heldAt` の古い順に復帰させる（残りは次回）
//   ③ 🔴 `Proposal` / `Contract` の `PROVIDER_QUOTA` 保留と**同じ枠を分け合う**（§8.3-Q ⑥）
//   ④ 招待・再設定は**トークン再発行**でしか復帰できない（平文トークンが残っていない）
//   ⑤ `HELD_DOMAIN_UNVERIFIED` はドメインが検証済みになるまで触らない
//   ⑥ ✅ T-09-06: `Proposal` の保留（`sendHoldReasonKey`）を同じ実行で復帰させ、`PROVIDER_QUOTA` はメールと
//      **同じ枠を古い順に**分け合う。`GATE_STALE` は走査に現れない（`listHeldProposalSends` の契約）
//
// 🔴 このジョブは外部 API を呼ばない（deps に `send` の口が無い）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listHeldEmailDispatches = vi.fn();
const requeueHeldEmailDispatch = vi.fn();
const resolveVerifiedSendingDomain = vi.fn();
// T-09-06: `Proposal` 側（`send-proposal-holds.ts` が呼ぶ `@ses/db`）。
const listHeldProposalSends = vi.fn();
const clearProposalSendHold = vi.fn();
const holdProposalSend = vi.fn();
const resolveProposalSendResumeOrigin = vi.fn();
const readEmailDailyCount = vi.fn();
const withTenant = vi.fn();

vi.mock('@ses/db', () => ({
  listHeldEmailDispatches,
  requeueHeldEmailDispatch,
  resolveVerifiedSendingDomain,
  listHeldProposalSends,
  clearProposalSendHold,
  holdProposalSend,
  resolveProposalSendResumeOrigin,
  readEmailDailyCount,
  withTenant,
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

const { InMemoryProviderSendCounter } = await import('@ses/connectors');
const { createSendHoldReleaseHandler, parseSendHoldReleasePayload, SEND_HOLD_RELEASE_SCHEDULE } =
  await import('./send-hold-release.js');
const { isProposalHoldResolved } = await import('./send-proposal-holds.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-05T03:00:00.000Z');

function held(overrides: Record<string, unknown> = {}) {
  return {
    dispatchId: '01930000-0000-7000-8000-000000000901',
    status: 'HELD_PROVIDER_QUOTA',
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.co.jp',
    templateKey: 'TENANT_CLOSING_NOTICE',
    dedupeKey: 'TENANT_CLOSING_NOTICE:t:abc',
    heldAt: NOW,
    ...overrides,
  };
}

function makeHandler(overrides: Record<string, unknown> = {}) {
  const enqueueEmailDispatch = vi.fn(
    async (job: { dispatchId: string; tenantId: string | null; recipientClass: string }) => void job,
  );
  const reissueAccountMail = vi.fn(async () => 'REISSUED' as const);
  const enqueueSendProposal = vi.fn(async (job: { proposalId: string; attemptSeq: number }) => {
    void job;
    return 'ENQUEUED' as const;
  });
  const providerSentCounter = new InMemoryProviderSendCounter();
  const deps = {
    emailSender: { getQuota: vi.fn(async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW })) },
    providerDailyQuota: 200,
    providerQuotaWarnRatio: 0.8,
    providerSentCounter,
    emailDailyLimit: 500,
    enqueueEmailDispatch,
    reissueAccountMail,
    enqueueSendProposal,
    now: () => NOW,
    ...overrides,
  };
  // 🔴 上書きされた seam を返す（内側の既定を返すと、上書きしたテストの assertion が空振りする）。
  return {
    handler: createSendHoldReleaseHandler(deps as never),
    enqueueEmailDispatch: deps.enqueueEmailDispatch,
    reissueAccountMail: deps.reissueAccountMail,
    enqueueSendProposal: deps.enqueueSendProposal,
    providerSentCounter: deps.providerSentCounter,
  };
}

/** 保留中の提案 1 件（`listHeldProposalSends` の戻り値の形）。 */
function heldProposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: '01930000-0000-7000-8000-000000000a01',
    reasonKey: 'PROVIDER_QUOTA',
    since: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  listHeldEmailDispatches.mockReset();
  requeueHeldEmailDispatch.mockReset();
  resolveVerifiedSendingDomain.mockReset();
  listHeldProposalSends.mockReset();
  clearProposalSendHold.mockReset();
  holdProposalSend.mockReset();
  resolveProposalSendResumeOrigin.mockReset();
  readEmailDailyCount.mockReset();
  withTenant.mockReset();
  requeueHeldEmailDispatch.mockResolvedValue(true);
  resolveVerifiedSendingDomain.mockResolvedValue(null);
  listHeldEmailDispatches.mockResolvedValue([]);
  listHeldProposalSends.mockResolvedValue([]);
  clearProposalSendHold.mockResolvedValue(true);
  holdProposalSend.mockResolvedValue({ kind: 'HELD', since: NOW });
  resolveProposalSendResumeOrigin.mockResolvedValue({ attemptSeq: 1, origin: { kind: 'INITIAL' } });
  readEmailDailyCount.mockResolvedValue(0);
  // `readTenantExecutable` が `tenants` を読む経路。既定は実行可（ACTIVE）。
  withTenant.mockImplementation(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({ tenant: { findFirst: async () => ({ lifecycleState: 'ACTIVE' }) } }),
  );
});

describe('宣言（docs/05 §9.4）', () => {
  it('🔴 毎 10 分である', () => {
    expect(SEND_HOLD_RELEASE_SCHEDULE).toEqual({ cron: '*/10 * * * *', timeZone: 'Asia/Tokyo' });
  });

  it('payload は tenantId を要求する', () => {
    expect(() => parseSendHoldReleasePayload({})).toThrow(InvalidJobPayloadError);
  });
});

describe('🔴 ① 時刻で判定しない（decideProviderQuota を再評価する）', () => {
  it('枠が埋まっている間は HELD_PROVIDER_QUOTA を 1 件も復帰させない', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW);
    listHeldEmailDispatches.mockResolvedValue([held()]);
    const { handler, enqueueEmailDispatch } = makeHandler({
      providerDailyQuota: 1,
      providerSentCounter,
    });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.headroom).toBe(0);
    expect(outcome.quotaReleased).toBe(0);
    expect(enqueueEmailDispatch).not.toHaveBeenCalled();
    expect(requeueHeldEmailDispatch).not.toHaveBeenCalled();
  });

  it('🔴 24 時間経過そのものではなく、カウンタが落ちたことで復帰する', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW);
    listHeldEmailDispatches.mockResolvedValue([held()]);
    // 24h + 1ms 後 = ZSET から落ちる時刻。`now` を進めるだけで判定が変わる。
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1);
    const { handler, enqueueEmailDispatch } = makeHandler({
      providerDailyQuota: 1,
      providerSentCounter,
      now: () => later,
    });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.headroom).toBe(1);
    expect(outcome.quotaReleased).toBe(1);
    expect(enqueueEmailDispatch).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 ② headroom 件だけ、古い順に復帰させる', () => {
  it('headroom を超える分は次回に持ち越す', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    // 上限 5 のうち 3 通消費済み ＝ headroom は 2。
    for (let i = 0; i < 3; i += 1) await providerSentCounter.record(NOW);
    listHeldEmailDispatches.mockResolvedValue([
      held({ dispatchId: 'd-1', heldAt: new Date(NOW.getTime() - 3000) }),
      held({ dispatchId: 'd-2', heldAt: new Date(NOW.getTime() - 2000) }),
      held({ dispatchId: 'd-3', heldAt: new Date(NOW.getTime() - 1000) }),
    ]);
    const { handler, enqueueEmailDispatch } = makeHandler({
      providerDailyQuota: 5,
      providerSentCounter,
    });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.headroom).toBe(2);
    expect(outcome.quotaReleased).toBe(2);
    // 🔴 古い順（listHeldEmailDispatches が heldAt 昇順で返す契約）。
    expect(enqueueEmailDispatch.mock.calls.map((call) => call[0].dispatchId)).toEqual(['d-1', 'd-2']);
  });

  it('CAS が 0 件（他の実行が処理済み）なら enqueue しない', async () => {
    requeueHeldEmailDispatch.mockResolvedValue(false);
    listHeldEmailDispatches.mockResolvedValue([held()]);
    const { handler, enqueueEmailDispatch } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.quotaReleased).toBe(0);
    expect(enqueueEmailDispatch).not.toHaveBeenCalled();
  });
});

describe('🔴 ③ send.*（Proposal）と同じ枠を分け合う（§8.3-Q ⑥。T-09-06）', () => {
  it('🔴 提案とメールを 1 本に混ぜて古い順に headroom 件だけ配る（提案が古ければ提案が先）', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    for (let i = 0; i < 3; i += 1) await providerSentCounter.record(NOW); // 上限 5 → headroom 2
    listHeldEmailDispatches.mockResolvedValue([
      held({ dispatchId: 'd-1', heldAt: new Date(NOW.getTime() - 2000) }),
      held({ dispatchId: 'd-2', heldAt: new Date(NOW.getTime() - 500) }),
    ]);
    listHeldProposalSends.mockResolvedValue([heldProposal({ since: new Date(NOW.getTime() - 3000) })]);
    const { handler, enqueueEmailDispatch, enqueueSendProposal } = makeHandler({
      providerDailyQuota: 5,
      providerSentCounter,
    });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.headroom).toBe(2);
    // 提案（-3000ms）→ d-1（-2000ms）の順で 2 件。d-2 は次回。
    expect(outcome.sendHoldsReleased).toBe(1);
    expect(outcome.quotaReleased).toBe(1);
    expect(enqueueSendProposal).toHaveBeenCalledTimes(1);
    expect(enqueueEmailDispatch.mock.calls.map((call) => call[0].dispatchId)).toEqual(['d-1']);
    // 🔴 復帰は保留列を NULL に戻す CAS を経て、同じ attemptSeq（人間が採番した値）で再 enqueue する。
    expect(clearProposalSendHold).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      expect.objectContaining({ proposalId: heldProposal().proposalId, reasonKey: 'PROVIDER_QUOTA' }),
    );
    expect(enqueueSendProposal.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      proposalId: heldProposal().proposalId,
      attemptSeq: 1,
      requestedBy: null,
      enqueuedAt: NOW.toISOString(),
    });
  });

  it('メールが古ければメールが先に枠を取り、提案は次回に持ち越す', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    for (let i = 0; i < 4; i += 1) await providerSentCounter.record(NOW); // 上限 5 → headroom 1
    listHeldEmailDispatches.mockResolvedValue([held({ dispatchId: 'd-1', heldAt: new Date(NOW.getTime() - 5000) })]);
    listHeldProposalSends.mockResolvedValue([heldProposal({ since: new Date(NOW.getTime() - 1000) })]);
    const { handler, enqueueSendProposal } = makeHandler({ providerDailyQuota: 5, providerSentCounter });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.quotaReleased).toBe(1);
    expect(outcome.sendHoldsReleased).toBe(0);
    expect(enqueueSendProposal).not.toHaveBeenCalled();
    expect(clearProposalSendHold).not.toHaveBeenCalled();
  });

  it('枠が 0 なら PROVIDER_QUOTA の提案には触らない（保留のまま次回へ）', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW);
    listHeldProposalSends.mockResolvedValue([heldProposal()]);
    const { handler, enqueueSendProposal } = makeHandler({ providerDailyQuota: 1, providerSentCounter });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.headroom).toBe(0);
    expect(outcome.sendHoldsReleased).toBe(0);
    expect(enqueueSendProposal).not.toHaveBeenCalled();
    expect(clearProposalSendHold).not.toHaveBeenCalled();
  });

  it('🔴 RESEND（attemptSeq >= 2）の復帰は人間の requestedBy を payload に載せる（ジョブは採番しない）', async () => {
    resolveProposalSendResumeOrigin.mockResolvedValue({
      attemptSeq: 2,
      origin: { kind: 'RESEND', attemptSeq: 2, requestedBy: '01930000-0000-7000-8000-0000000000u1' },
    });
    listHeldProposalSends.mockResolvedValue([heldProposal()]);
    const { handler, enqueueSendProposal } = makeHandler();

    await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(enqueueSendProposal.mock.calls[0]?.[0]).toMatchObject({
      attemptSeq: 2,
      requestedBy: '01930000-0000-7000-8000-0000000000u1',
    });
  });

  it('🔴 enqueue が failed 記録に阻まれたら保留を元に戻し、復帰件数に数えない', async () => {
    listHeldProposalSends.mockResolvedValue([heldProposal()]);
    const { handler } = makeHandler({ enqueueSendProposal: vi.fn(async () => 'BLOCKED_BY_FAILED_JOB' as const) });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.sendHoldsReleased).toBe(0);
    expect(outcome.sendHoldsBlocked).toBe(1);
    expect(holdProposalSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ proposalId: heldProposal().proposalId, reasonKey: 'PROVIDER_QUOTA' }),
    );
  });

  it('CAS が 0 件（他の実行が処理済み）なら再 enqueue しない', async () => {
    clearProposalSendHold.mockResolvedValue(false);
    listHeldProposalSends.mockResolvedValue([heldProposal()]);
    const { handler, enqueueSendProposal } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.sendHoldsReleased).toBe(0);
    expect(enqueueSendProposal).not.toHaveBeenCalled();
  });
});

describe('🔴 ⑥ 提案の PROVIDER_QUOTA 以外の保留（T-09-06。docs/05 §9.4 / §10.4）', () => {
  it('DOMAIN_UNVERIFIED はドメインが検証済みになったときだけ復帰し、枠を消費しない', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW); // 枠は 0
    listHeldProposalSends.mockResolvedValue([heldProposal({ reasonKey: 'DOMAIN_UNVERIFIED' })]);
    const unverified = makeHandler({ providerDailyQuota: 1, providerSentCounter });
    expect((await unverified.handler({ tenantId: TENANT_ID }, 'j-1')).sendHoldsReleased).toBe(0);
    expect(unverified.enqueueSendProposal).not.toHaveBeenCalled();

    resolveVerifiedSendingDomain.mockResolvedValue({ domain: 'example.co.jp', mailFromDomain: 'mail.example.co.jp', verifiedAt: NOW } as never);
    const verified = makeHandler({ providerDailyQuota: 1, providerSentCounter });
    const outcome = await verified.handler({ tenantId: TENANT_ID }, 'j-2');
    expect(outcome.headroom).toBe(0);
    expect(outcome.sendHoldsReleased).toBe(1);
    expect(verified.enqueueSendProposal).toHaveBeenCalledTimes(1);
  });

  it('RATE_LIMIT はテナントの日次上限に余地が戻ったときだけ復帰する', async () => {
    listHeldProposalSends.mockResolvedValue([heldProposal({ reasonKey: 'RATE_LIMIT' })]);
    readEmailDailyCount.mockResolvedValue(500);
    const full = makeHandler({ emailDailyLimit: 500 });
    expect((await full.handler({ tenantId: TENANT_ID }, 'j-1')).sendHoldsReleased).toBe(0);

    readEmailDailyCount.mockResolvedValue(0);
    const room = makeHandler({ emailDailyLimit: 500 });
    expect((await room.handler({ tenantId: TENANT_ID }, 'j-2')).sendHoldsReleased).toBe(1);
  });

  it('TENANT_SUSPENDED はテナントが実行可（SANDBOX / ACTIVE）に戻ったときだけ復帰する', async () => {
    listHeldProposalSends.mockResolvedValue([heldProposal({ reasonKey: 'TENANT_SUSPENDED' })]);
    withTenant.mockImplementation(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
      fn({ tenant: { findFirst: async () => ({ lifecycleState: 'SUSPENDED' }) } }),
    );
    const suspended = makeHandler();
    expect((await suspended.handler({ tenantId: TENANT_ID }, 'j-1')).sendHoldsReleased).toBe(0);

    withTenant.mockImplementation(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
      fn({ tenant: { findFirst: async () => ({ lifecycleState: 'SANDBOX' }) } }),
    );
    const active = makeHandler();
    expect((await active.handler({ tenantId: TENANT_ID }, 'j-2')).sendHoldsReleased).toBe(1);
  });

  it('🔴 契約書だけの理由（ESIGN_DISCONNECTED / AI_COST_LIMIT）が提案に立っていても黙って復帰させない', async () => {
    listHeldProposalSends.mockResolvedValue([
      heldProposal({ reasonKey: 'ESIGN_DISCONNECTED' }),
      heldProposal({ proposalId: '01930000-0000-7000-8000-000000000a02', reasonKey: 'AI_COST_LIMIT' }),
    ]);
    const { handler, enqueueSendProposal } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.proposalsScanned).toBe(2);
    expect(outcome.sendHoldsReleased).toBe(0);
    expect(enqueueSendProposal).not.toHaveBeenCalled();
  });

  it('🔴 GATE_STALE は解消判定が常に偽（自動復帰しない。docs/05 §10.5）', () => {
    expect(
      isProposalHoldResolved('GATE_STALE', { domainVerified: true, tenantExecutable: true, dailyQuotaHasRoom: true }),
    ).toBe(false);
  });
});

describe('🔴 ④ 招待・再設定はトークン再発行でしか復帰できない', () => {
  it.each(['ACCOUNT_INVITATION', 'ACCOUNT_PASSWORD_RESET'])(
    '%s は reissueAccountMail を通り、QUEUED へ戻さない',
    async (templateKey) => {
      listHeldEmailDispatches.mockResolvedValue([held({ templateKey })]);
      const { handler, reissueAccountMail, enqueueEmailDispatch } = makeHandler();

      const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

      expect(reissueAccountMail).toHaveBeenCalledTimes(1);
      // 🔴 平文トークンが残っていない行を `QUEUED` に戻すと、本文にリンクを入れられないまま送られる。
      expect(requeueHeldEmailDispatch).not.toHaveBeenCalled();
      expect(enqueueEmailDispatch).not.toHaveBeenCalled();
      expect(outcome.quotaReleased).toBe(1);
    },
  );

  it('期限切れ（EXPIRED）は復帰件数に数えない（枠を消費しない）', async () => {
    listHeldEmailDispatches.mockResolvedValue([held({ templateKey: 'ACCOUNT_INVITATION' })]);
    const { handler } = makeHandler({ reissueAccountMail: vi.fn(async () => 'EXPIRED' as const) });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.quotaReleased).toBe(0);
  });
});

describe('🔴 ⑤ HELD_DOMAIN_UNVERIFIED（docs/05 §8.3）', () => {
  it('ドメインが未検証のままなら触らない（保留のまま次回へ）', async () => {
    listHeldEmailDispatches.mockResolvedValue([
      held({ status: 'HELD_DOMAIN_UNVERIFIED', templateKey: 'ACCOUNT_INVITATION' }),
    ]);
    const { handler, reissueAccountMail } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.domainReleased).toBe(0);
    expect(reissueAccountMail).not.toHaveBeenCalled();
  });

  it('検証済みになっていればトークン再発行で復帰する', async () => {
    resolveVerifiedSendingDomain.mockResolvedValue({
      domain: 'example.co.jp',
      mailFromDomain: 'mail.example.co.jp',
      verifiedAt: NOW,
    } as never);
    listHeldEmailDispatches.mockResolvedValue([
      held({ status: 'HELD_DOMAIN_UNVERIFIED', templateKey: 'ACCOUNT_INVITATION' }),
    ]);
    const { handler, reissueAccountMail } = makeHandler();

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.domainReleased).toBe(1);
    expect(reissueAccountMail).toHaveBeenCalledTimes(1);
  });

  it('🔴 ドメイン起因の保留は送信基盤の枠に縛られない（枯渇していても復帰を試みる）', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW);
    resolveVerifiedSendingDomain.mockResolvedValue({
      domain: 'example.co.jp',
      mailFromDomain: 'mail.example.co.jp',
      verifiedAt: NOW,
    } as never);
    listHeldEmailDispatches.mockResolvedValue([
      held({ status: 'HELD_DOMAIN_UNVERIFIED', templateKey: 'ACCOUNT_INVITATION' }),
    ]);
    const { handler } = makeHandler({ providerDailyQuota: 1, providerSentCounter });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    // 🔴 復帰しても、再 enqueue されたジョブは §8.3-Q の判定を最初から通るので、
    //    枠が無ければそこで再び保留される（判定を免れる経路にならない）。
    expect(outcome.headroom).toBe(0);
    expect(outcome.domainReleased).toBe(1);
  });
});

describe('上限への接近（A-005 項目 13。到達とは別物）', () => {
  it('consumptionRate が warnRatio 以上なら warning = true（送信は止まっていない）', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    for (let i = 0; i < 8; i += 1) await providerSentCounter.record(NOW);
    const { handler } = makeHandler({ providerDailyQuota: 10, providerSentCounter });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(outcome.warning).toBe(true);
    expect(outcome.headroom).toBe(2);
  });
});
