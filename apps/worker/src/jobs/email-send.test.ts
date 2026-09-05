// apps/worker/src/jobs/email-send.test.ts
// 🔴 `email.dispatch` / `account.mail` の共通本体（docs/05 §9.4 / §8.3 / §8.3-Q / §8.7）。
//
// ここで固定するのは「順序」と「throw するかどうか」である。DB の一意制約・原子性は
// `tests/isolation/email-dispatch.test.ts` が実データで実証する。
//
//   ① 🔴 重複起動（`QUEUED` 以外）は**外部を 1 回も呼ばない**（`attempts: 3` の再試行が 2 通目にならない）
//   ② 🔴 未検証ドメイン × 取引先宛は `HELD_DOMAIN_UNVERIFIED`。**共通ドメインへ落ちない**
//   ③ 🔴 日次上限は `SUPPRESSED(RATE_LIMIT)`、分次上限は `DEFERRED`（状態を変えない）
//   ④ 🔴 送信基盤の日次枠超過は `HELD_PROVIDER_QUOTA` で**正常終了**（throw しない = 再試行に乗らない）
//   ⑤ 🔴 一時的なエラーだけ throw する（恒久的・応答不明はその場で確定させる）
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSendInput } from '@ses/connectors';

const readEmailDailyCount = vi.fn();
const reserveEmailDailyQuota = vi.fn();
const holdEmailDispatch = vi.fn();
const suppressEmailDispatch = vi.fn();
const failEmailDispatch = vi.fn();
const markEmailDispatchSent = vi.fn();
const markEmailDispatchMocked = vi.fn();

vi.mock('@ses/db', () => ({
  readEmailDailyCount,
  reserveEmailDailyQuota,
  holdEmailDispatch,
  suppressEmailDispatch,
  failEmailDispatch,
  markEmailDispatchSent,
  markEmailDispatchMocked,
}));

const { ExternalSendError, InMemoryMinuteWindowCounter, ProviderQuotaExceededError } = await import(
  '@ses/connectors'
);
const { performEmailSend } = await import('./email-send.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-09-05T03:00:00.000Z');

const CTX = {
  tenantId: TENANT_ID,
  partnerCompanyId: null,
  userId: '',
  role: 'SALES',
  lifecycleState: 'ACTIVE',
  deviceKind: 'api',
  job: { queue: 'email.dispatch', jobId: 'j-1' },
} as never;

const VERIFIED = {
  domain: 'example.co.jp',
  mailFromDomain: 'mail.example.co.jp',
  verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
};

function dispatchRow(overrides: Record<string, unknown> = {}) {
  return {
    dispatchId: '01930000-0000-7000-8000-000000000901',
    status: 'QUEUED',
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.co.jp',
    templateKey: 'ACCOUNT_INVITATION',
    dedupeKey: 'ACCOUNT_INVITATION:target:abcdef0123456789',
    ...overrides,
  } as never;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(async (input: EmailSendInput) => {
    void input;
    return { externalId: 'ses-1' };
  });
  const deps = {
    emailSender: { send, callCount: () => send.mock.calls.length, getQuota: vi.fn() },
    emailImplementationKind: 'real' as const,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: 500,
    minuteLimit: 30,
    resolveSendingDomain: vi.fn(async () => VERIFIED),
    now: () => NOW,
    ...overrides,
  };
  return { deps: deps as never, send, minuteWindow: deps.minuteWindow };
}

beforeEach(() => {
  for (const fn of [
    readEmailDailyCount,
    reserveEmailDailyQuota,
    holdEmailDispatch,
    suppressEmailDispatch,
    failEmailDispatch,
    markEmailDispatchSent,
    markEmailDispatchMocked,
  ]) {
    fn.mockReset();
  }
  readEmailDailyCount.mockResolvedValue(0);
  reserveEmailDailyQuota.mockResolvedValue({ allowed: true, value: 1 });
  holdEmailDispatch.mockResolvedValue(true);
  suppressEmailDispatch.mockResolvedValue(true);
  failEmailDispatch.mockResolvedValue(true);
  markEmailDispatchSent.mockResolvedValue(true);
  markEmailDispatchMocked.mockResolvedValue(true);
});

describe('🔴 ① 重複起動（docs/05 §9.4「再試行しても 1 通」）', () => {
  it.each(['SENT', 'MOCKED', 'FAILED', 'SUPPRESSED', 'HELD_PROVIDER_QUOTA'])(
    '既に %s の行に対しては外部を 1 回も呼ばない',
    async (status) => {
      const { deps, send } = makeDeps();
      const outcome = await performEmailSend(deps, {
        ctx: CTX,
        dispatch: dispatchRow({ status }),
        params: {},
      });
      expect(outcome).toEqual({ kind: 'ALREADY_SETTLED', status });
      expect(send).not.toHaveBeenCalled();
      expect(reserveEmailDailyQuota).not.toHaveBeenCalled();
    },
  );
});

describe('🔴 ② 送信元ドメイン（BR-51 / docs/05 §8.3）', () => {
  it('未検証 × 取引先宛（分類 2）は HELD_DOMAIN_UNVERIFIED で、外部を呼ばない', async () => {
    const { deps, send } = makeDeps({ resolveSendingDomain: vi.fn(async () => null) });
    const outcome = await performEmailSend(deps, {
      ctx: CTX,
      dispatch: dispatchRow({ recipientClass: 'PARTNER_MEMBER' }),
      params: {},
    });
    expect(outcome).toEqual({ kind: 'HELD_DOMAIN_UNVERIFIED' });
    expect(send).not.toHaveBeenCalled();
    expect(holdEmailDispatch.mock.calls[0]?.[1].status).toBe('HELD_DOMAIN_UNVERIFIED');
  });

  it('🔴 保留に failureReason を書かない（失敗ではない）', async () => {
    const { deps } = makeDeps({ resolveSendingDomain: vi.fn(async () => null) });
    await performEmailSend(deps, {
      ctx: CTX,
      dispatch: dispatchRow({ recipientClass: 'PARTNER_MEMBER' }),
      params: {},
    });
    expect(holdEmailDispatch.mock.calls[0]?.[1]).not.toHaveProperty('failureReason');
    expect(failEmailDispatch).not.toHaveBeenCalled();
  });

  it('未検証でも分類 1（ホスト所属）は共通ドメインで送れる（F-001 AC-5）', async () => {
    const { deps, send } = makeDeps({ resolveSendingDomain: vi.fn(async () => null) });
    const outcome = await performEmailSend(deps, {
      ctx: CTX,
      dispatch: dispatchRow({ recipientClass: 'HOST_MEMBER' }),
      params: {},
    });
    expect(outcome.kind).toBe('SENT');
    expect(send.mock.calls[0]?.[0].fromDomain).toBeNull();
  });
});

describe('🔴 ③ レート上限（docs/05 §8.7 / F-027 AC-2）', () => {
  it('日次上限に達していたら SUPPRESSED(RATE_LIMIT) で外部を呼ばない', async () => {
    readEmailDailyCount.mockResolvedValue(500);
    const { deps, send } = makeDeps();
    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(outcome).toEqual({ kind: 'RATE_LIMITED', dailyLimit: 500 });
    expect(send).not.toHaveBeenCalled();
    expect(suppressEmailDispatch.mock.calls[0]?.[1].reason).toBe('RATE_LIMIT');
  });

  it('🔴 日次上限は「停止」であり保留（HELD_*）にしない（対処する相手が違う）', async () => {
    readEmailDailyCount.mockResolvedValue(500);
    const { deps } = makeDeps();
    await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(holdEmailDispatch).not.toHaveBeenCalled();
  });

  it('分次上限に達していたら DEFERRED（状態を変えない）', async () => {
    const { deps, send, minuteWindow } = makeDeps();
    for (let i = 0; i < 30; i += 1) {
      await minuteWindow.record(TENANT_ID, new Date(NOW.getTime() - 20_000));
    }
    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(outcome).toEqual({ kind: 'DEFERRED', retryAfterSec: 40 });
    expect(send).not.toHaveBeenCalled();
    expect(suppressEmailDispatch).not.toHaveBeenCalled();
    expect(holdEmailDispatch).not.toHaveBeenCalled();
    expect(failEmailDispatch).not.toHaveBeenCalled();
  });

  it('🔴 判定をすり抜けた並行実行は原子的な予約が止める（501 通目が外部へ出ない）', async () => {
    reserveEmailDailyQuota.mockResolvedValue({ allowed: false, value: 500 });
    const { deps, send } = makeDeps();
    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(outcome).toEqual({ kind: 'RATE_LIMITED', dailyLimit: 500 });
    expect(send).not.toHaveBeenCalled();
  });

  it('送信した分だけ分次ウィンドウが進む（DEFER / BLOCK では進まない）', async () => {
    const { deps, minuteWindow } = makeDeps();
    await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect((await minuteWindow.peek(TENANT_ID, NOW)).count).toBe(1);

    readEmailDailyCount.mockResolvedValue(500);
    await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect((await minuteWindow.peek(TENANT_ID, NOW)).count).toBe(1);
  });
});

describe('🔴 ④ 送信基盤のクォータ（docs/05 §8.3-Q ⑤）', () => {
  it('日次枠超過は HELD_PROVIDER_QUOTA で正常終了する（throw しない）', async () => {
    const send = vi.fn(async () => {
      throw new ProviderQuotaExceededError();
    });
    const { deps } = makeDeps({
      emailSender: { send, callCount: () => 0, getQuota: vi.fn() },
    });
    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(outcome).toEqual({ kind: 'HELD_PROVIDER_QUOTA' });
    expect(holdEmailDispatch.mock.calls[0]?.[1].status).toBe('HELD_PROVIDER_QUOTA');
    // 🔴 FAILED にしない / failureReason を書かない（A-005 の障害指標に混ぜない）。
    expect(failEmailDispatch).not.toHaveBeenCalled();
  });
});

describe('🔴 ⑤ 例外の分類（docs/05 §15.4）', () => {
  it('一時的なエラーは throw する（attempts: 3 に乗せる）', async () => {
    const send = vi.fn(async () => {
      throw new ExternalSendError('TRANSIENT', 'ThrottlingException', 'slow down');
    });
    const { deps } = makeDeps({ emailSender: { send, callCount: () => 0, getQuota: vi.fn() } });
    await expect(
      performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} }),
    ).rejects.toBeInstanceOf(ExternalSendError);
    expect(failEmailDispatch).not.toHaveBeenCalled();
  });

  it.each(['PERMANENT', 'UNKNOWN'] as const)(
    '🔴 %s は再試行せずその場で FAILED に確定させる',
    async (kind) => {
      const send = vi.fn(async () => {
        throw new ExternalSendError(kind, 'MessageRejected', 'rejected');
      });
      const { deps } = makeDeps({ emailSender: { send, callCount: () => 0, getQuota: vi.fn() } });
      const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
      expect(outcome).toEqual({
        kind: 'FAILED',
        failureReason: `${kind}:MessageRejected`,
        recorded: true,
      });
      expect(failEmailDispatch).toHaveBeenCalledTimes(1);
    },
  );
});

/**
 * 🔴 iteration 3 の修正点。**外部への到達を否定できない呼び出しの後は、確定の書き込みが
 *    失敗しても throw しない。** `UNKNOWN` は「届いている可能性がある」であり、
 *    再試行に乗せるともう 1 通送る（`CLAUDE.md` §3.4 / `BR-21`）。
 */
describe('🔴 UNKNOWN の確定書き込みが失敗しても再試行に乗せない', () => {
  function senderThrowing(error: unknown) {
    const send = vi.fn(async () => {
      throw error;
    });
    return { emailSender: { send, callCount: () => 0, getQuota: vi.fn() }, send };
  }

  it('🔴 UNKNOWN + failEmailDispatch 例外でも throw されない（= attempts: 3 に乗らない）', async () => {
    failEmailDispatch.mockRejectedValue(new Error('connection terminated'));
    const { emailSender, send } = senderThrowing(
      new ExternalSendError('UNKNOWN', 'ServiceUnavailableException', '5xx'),
    );
    const { deps } = makeDeps({ emailSender });

    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });

    expect(outcome).toEqual({
      kind: 'FAILED',
      failureReason: 'UNKNOWN:ServiceUnavailableException',
      recorded: false,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('PERMANENT + failEmailDispatch 例外でも同じ（一律で throw しない）', async () => {
    failEmailDispatch.mockRejectedValue(new Error('connection terminated'));
    const { emailSender } = senderThrowing(
      new ExternalSendError('PERMANENT', 'MessageRejected', 'rejected'),
    );
    const { deps } = makeDeps({ emailSender });

    await expect(
      performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} }),
    ).resolves.toMatchObject({ kind: 'FAILED', recorded: false });
  });

  it('🔴 CAS が 0 件（他の実行が先に確定させた）も recorded: false として報告する', async () => {
    failEmailDispatch.mockResolvedValue(false);
    const { emailSender } = senderThrowing(new ExternalSendError('UNKNOWN', 'TimeoutError', 'timeout'));
    const { deps } = makeDeps({ emailSender });

    expect(await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} })).toEqual({
      kind: 'FAILED',
      failureReason: 'UNKNOWN:TimeoutError',
      recorded: false,
    });
  });

  it('🔴 未受理が確定している経路（ProviderQuotaExceededError）は対象外 —— throw してよい', async () => {
    // 保留の書き込みが落ちれば再試行されるが、外部へは 1 通も出ていないので二重送信にならない。
    holdEmailDispatch.mockRejectedValue(new Error('connection terminated'));
    const { emailSender } = senderThrowing(new ProviderQuotaExceededError());
    const { deps } = makeDeps({ emailSender });

    await expect(
      performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} }),
    ).rejects.toThrow('connection terminated');
  });
});

/**
 * 🔴 iteration 2 の修正点。**外部への送信が済んだ後の失敗を BullMQ の再試行に乗せない。**
 *    乗せると行が `QUEUED` のままで再実行され、もう 1 通送る（`CLAUDE.md` §3.4 / `BR-21`）。
 */
describe('🔴 送信成功後の永続化失敗（二重送信の防止）', () => {
  it('🔴 記録の UPDATE が例外でも throw せず、SENT_UNRECORDED を返す', async () => {
    markEmailDispatchSent.mockRejectedValue(new Error('connection terminated'));
    const { deps, send } = makeDeps();

    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });

    expect(outcome).toEqual({
      kind: 'SENT_UNRECORDED',
      externalId: 'ses-1',
      failureReason: 'RECORD_ERROR',
    });
    // 🔴 このジョブ実行の中で外部へ出たのは 1 通だけである。
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('🔴 モック経路でも同じ（MOCKED の記録に失敗しても throw しない）', async () => {
    markEmailDispatchMocked.mockRejectedValue(new Error('connection terminated'));
    const { deps, send } = makeDeps({ emailImplementationKind: 'mock' });

    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });

    expect(outcome).toEqual({
      kind: 'SENT_UNRECORDED',
      externalId: null,
      failureReason: 'RECORD_ERROR',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('🔴 CAS が 0 件（送信中に他の実行が確定させた）でも成功として無視しない', async () => {
    markEmailDispatchSent.mockResolvedValue(false);
    const { deps } = makeDeps();

    expect(await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} })).toEqual({
      kind: 'SENT_UNRECORDED',
      externalId: 'ses-1',
      failureReason: 'CAS_LOST',
    });
  });

  it('🔴 失敗として記録し直さない（FAILED にすると人手の再送で 2 通目が出る）', async () => {
    markEmailDispatchSent.mockRejectedValue(new Error('connection terminated'));
    const { deps } = makeDeps();
    await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(failEmailDispatch).not.toHaveBeenCalled();
    expect(holdEmailDispatch).not.toHaveBeenCalled();
  });
});

describe('SENT / MOCKED の記録（docs/05 §13.2 / §9.7）', () => {
  it('real なら SENT（外部 ID を残す）', async () => {
    const { deps } = makeDeps();
    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(outcome).toEqual({ kind: 'SENT', externalId: 'ses-1' });
    expect(markEmailDispatchSent.mock.calls[0]?.[1].sesMessageId).toBe('ses-1');
    expect(markEmailDispatchMocked).not.toHaveBeenCalled();
  });

  it('mock（development / demo）なら MOCKED', async () => {
    const { deps } = makeDeps({ emailImplementationKind: 'mock' });
    const outcome = await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} });
    expect(outcome).toEqual({ kind: 'MOCKED' });
    expect(markEmailDispatchSent).not.toHaveBeenCalled();
  });

  it('🔴 sandbox は分類で分かれる（分類 1 = SENT / 分類 2 = MOCKED）', async () => {
    const { deps } = makeDeps({ emailImplementationKind: 'sandboxRecipientScoped' });
    expect(
      (await performEmailSend(deps, { ctx: CTX, dispatch: dispatchRow(), params: {} })).kind,
    ).toBe('SENT');
    expect(
      (
        await performEmailSend(deps, {
          ctx: CTX,
          dispatch: dispatchRow({ recipientClass: 'PARTNER_MEMBER' }),
          params: {},
        })
      ).kind,
    ).toBe('MOCKED');
  });
});
