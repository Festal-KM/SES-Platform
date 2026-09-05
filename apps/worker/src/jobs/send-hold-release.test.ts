// apps/worker/src/jobs/send-hold-release.test.ts
// 🔴 `send.hold-release`（毎 10 分。docs/05 §9.4 / §8.3-Q）の検証。
//
// 固定するのは 5 点である:
//   ① 🔴 **時刻で判定しない** —— 実行のたびに `decideProviderQuota` を再評価する
//   ② 🔴 `ALLOW` の **`headroom` 件だけ**、`heldAt` の古い順に復帰させる（残りは次回）
//   ③ 🔴 `Proposal` / `Contract` の `PROVIDER_QUOTA` 保留と**同じ枠を分け合う**（§8.3-Q ⑥）
//   ④ 招待・再設定は**トークン再発行**でしか復帰できない（平文トークンが残っていない）
//   ⑤ `HELD_DOMAIN_UNVERIFIED` はドメインが検証済みになるまで触らない
//
// 🔴 このジョブは外部 API を呼ばない（deps に `send` の口が無い）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listHeldEmailDispatches = vi.fn();
const requeueHeldEmailDispatch = vi.fn();
const resolveVerifiedSendingDomain = vi.fn();

vi.mock('@ses/db', () => ({
  listHeldEmailDispatches,
  requeueHeldEmailDispatch,
  resolveVerifiedSendingDomain,
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
  const releaseSendHolds = vi.fn(async () => 0);
  const providerSentCounter = new InMemoryProviderSendCounter();
  const deps = {
    emailSender: { getQuota: vi.fn(async () => ({ max24h: 200, sentLast24h: 0, observedAt: NOW })) },
    providerDailyQuota: 200,
    providerQuotaWarnRatio: 0.8,
    providerSentCounter,
    enqueueEmailDispatch,
    reissueAccountMail,
    releaseSendHolds,
    now: () => NOW,
    ...overrides,
  };
  // 🔴 上書きされた seam を返す（内側の既定を返すと、上書きしたテストの assertion が空振りする）。
  return {
    handler: createSendHoldReleaseHandler(deps as never),
    enqueueEmailDispatch: deps.enqueueEmailDispatch,
    reissueAccountMail: deps.reissueAccountMail,
    releaseSendHolds: deps.releaseSendHolds,
    providerSentCounter: deps.providerSentCounter,
  };
}

beforeEach(() => {
  listHeldEmailDispatches.mockReset();
  requeueHeldEmailDispatch.mockReset();
  resolveVerifiedSendingDomain.mockReset();
  requeueHeldEmailDispatch.mockResolvedValue(true);
  resolveVerifiedSendingDomain.mockResolvedValue(null);
  listHeldEmailDispatches.mockResolvedValue([]);
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

describe('🔴 ③ send.*（Proposal / Contract）と同じ枠を分け合う（§8.3-Q ⑥）', () => {
  it('send.* が使った分だけメール側の取り分が減る', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    for (let i = 0; i < 3; i += 1) await providerSentCounter.record(NOW);
    listHeldEmailDispatches.mockResolvedValue([held({ dispatchId: 'd-1' }), held({ dispatchId: 'd-2' })]);
    const { handler, enqueueEmailDispatch, releaseSendHolds } = makeHandler({
      providerDailyQuota: 5,
      providerSentCounter,
      releaseSendHolds: vi.fn(async () => 1),
    });

    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(releaseSendHolds).toHaveBeenCalledWith({ headroom: 2 });
    expect(outcome.sendHoldsReleased).toBe(1);
    expect(outcome.quotaReleased).toBe(1);
    expect(enqueueEmailDispatch).toHaveBeenCalledTimes(1);
  });

  it('枠が 0 なら send.* 側にも配らない', async () => {
    const providerSentCounter = new InMemoryProviderSendCounter();
    await providerSentCounter.record(NOW);
    const { handler, releaseSendHolds } = makeHandler({
      providerDailyQuota: 1,
      providerSentCounter,
    });

    await handler({ tenantId: TENANT_ID }, 'j-1');

    expect(releaseSendHolds).not.toHaveBeenCalled();
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
