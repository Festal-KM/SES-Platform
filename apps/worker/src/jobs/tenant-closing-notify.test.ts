// apps/worker/src/jobs/tenant-closing-notify.test.ts
// 🔴 `tenant.closing-notify`（docs/05 §9.7 / `F-064 AC-10`）の起票ロジックをモックの DB で固定する。
//
//   ① `CLOSING` 以外 / `closing_entered_at` 無しは何もしない（宛先も引かない）
//   ② 🔴 起票条件は「期限を過ぎ、かつ未処理」: 入った日に ENTERED、翌日は ALREADY_FILED、+23 日で D7
//   ③ 🔴 `FAILED` だけの段は再起票され、`dedupeKey` に暦日が入るので前日と別の鍵になる
//   ④ 宛先は `readTenantAdminRecipients`（分類 1 の OWNER / ADMIN）の値をそのまま運び、`QUEUED` の行だけ積む
//   ⑤ 🔴 JST の日境界で `closing_entered_at` を暦日に落とす
//   ⑥ payload / スケジュール宣言 / 母集団
//
// 🔴 メールを 1 通も送らない（deps に `EmailSender` の口が無い）。実 DB での結合は `tests/isolation/tenant-closing-notify.test.ts`。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readTenantClosingSchedule = vi.fn();
const readClosingNoticePhaseStatuses = vi.fn();
const readTenantAdminRecipients = vi.fn();
const reserveEmailDispatch = vi.fn();

vi.mock('@ses/db', () => ({
  readTenantClosingSchedule,
  readClosingNoticePhaseStatuses,
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

const {
  createTenantClosingNotifyHandler,
  parseTenantClosingNotifyPayload,
  TENANT_CLOSING_NOTIFY_JOB,
  TENANT_CLOSING_NOTIFY_POPULATION,
  TENANT_CLOSING_NOTIFY_SCHEDULE,
} = await import('./tenant-closing-notify.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const { SCHEDULED_JOBS } = await import('./index.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
// JST 2026-09-01 09:00 = UTC 00:00 → 暦日 2026-09-01（既定 30 日 → 削除予定日 2026-10-01 / D7 = 2026-09-24）
const CLOSING_ENTERED_AT = new Date('2026-09-01T00:00:00.000Z');
const OWNER = { userId: 'u-owner', email: 'owner@example.test', recipientClass: 'HOST_MEMBER' as const };
const ADMIN = { userId: 'u-admin', email: 'admin@example.test', recipientClass: 'HOST_MEMBER' as const };

/** JST の正午（UTC 03:00）を「その日」にする。 */
function jstNoon(dayKey: string): Date {
  return new Date(`${dayKey}T03:00:00.000Z`);
}

function makeHandler(now: Date, purgeGraceDays = 30) {
  const enqueued: unknown[] = [];
  const handler = createTenantClosingNotifyHandler({
    now: () => now,
    purgeGraceDays,
    enqueueEmailDispatch: async (job) => {
      enqueued.push(job);
    },
  });
  return { handler, enqueued };
}

let dispatchSeq = 0;

beforeEach(() => {
  readTenantClosingSchedule.mockReset();
  readClosingNoticePhaseStatuses.mockReset();
  readTenantAdminRecipients.mockReset();
  reserveEmailDispatch.mockReset();
  dispatchSeq = 0;
  readTenantClosingSchedule.mockResolvedValue({ name: '架空商事', lifecycleState: 'CLOSING', closingEnteredAt: CLOSING_ENTERED_AT });
  readClosingNoticePhaseStatuses.mockResolvedValue([]);
  readTenantAdminRecipients.mockResolvedValue([OWNER, ADMIN]);
  reserveEmailDispatch.mockImplementation(async (_ctx: unknown, input: { dedupeKey: string; recipientClass: string; recipientEmail: string; templateKey: string }) => {
    dispatchSeq += 1;
    return {
      dispatchId: `d-${dispatchSeq}`,
      dedupeKey: input.dedupeKey,
      created: true,
      status: 'QUEUED',
      recipientClass: input.recipientClass,
      recipientEmail: input.recipientEmail,
      templateKey: input.templateKey,
    };
  });
});

describe('① CLOSING 以外は何もしない', () => {
  it('ACTIVE のテナントは SKIPPED(NOT_CLOSING)。宛先を引かず、行も作らない', async () => {
    readTenantClosingSchedule.mockResolvedValue({ name: 'x', lifecycleState: 'ACTIVE', closingEnteredAt: null });
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-01'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-1')).resolves.toEqual({ kind: 'SKIPPED', reason: 'NOT_CLOSING' });
    expect(readTenantAdminRecipients).not.toHaveBeenCalled();
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
  });

  it('CLOSING でも closing_entered_at が無ければ SKIPPED(NO_CLOSING_ENTERED_AT)', async () => {
    readTenantClosingSchedule.mockResolvedValue({ name: 'x', lifecycleState: 'CLOSING', closingEnteredAt: null });
    const { handler } = makeHandler(jstNoon('2026-09-01'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-1')).resolves.toEqual({ kind: 'SKIPPED', reason: 'NO_CLOSING_ENTERED_AT' });
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
  });

  it('🔴 ctx.lifecycleState（固定値 ACTIVE）ではなく tenants の行で判定する', async () => {
    const { handler } = makeHandler(jstNoon('2026-09-01'));
    await handler({ tenantId: TENANT_ID }, 'j-1');
    expect(readTenantClosingSchedule).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
    expect(reserveEmailDispatch).toHaveBeenCalled();
  });
});

describe('② 🔴 期限を過ぎ、かつ未処理（日付一致にしない）', () => {
  it('入った日: ENTERED を管理者全員ぶん積み、D7 は NOT_DUE', async () => {
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-01'));
    const outcome = await handler({ tenantId: TENANT_ID }, 'j-1');
    expect(outcome).toEqual({
      kind: 'CHECKED',
      todayKey: '2026-09-01',
      purgeScheduledOn: '2026-10-01',
      phases: [
        { phase: 'ENTERED', dueOn: '2026-09-01', status: 'FILED', recipients: 2, queued: 2 },
        { phase: 'D7', dueOn: '2026-09-24', status: 'NOT_DUE', recipients: 0, queued: 0 },
      ],
    });
    expect(enqueued).toEqual([
      { dispatchId: 'd-1', tenantId: TENANT_ID, recipientClass: 'HOST_MEMBER' },
      { dispatchId: 'd-2', tenantId: TENANT_ID, recipientClass: 'HOST_MEMBER' },
    ]);
    // 🔴 D7 の未処理判定は期日が来るまで読まない（DB を無駄に叩かない）。
    expect(readClosingNoticePhaseStatuses).toHaveBeenCalledTimes(1);
    expect(readClosingNoticePhaseStatuses).toHaveBeenCalledWith(expect.anything(), 'ENTERED');
  });

  it('dedupeKey は TENANT_CLOSING_NOTICE:{tenantId}#{phase}#{yyyy-mm-dd}:{宛先}', async () => {
    const { handler } = makeHandler(jstNoon('2026-09-01'));
    await handler({ tenantId: TENANT_ID }, 'j-1');
    const keys = reserveEmailDispatch.mock.calls.map((call) => (call[1] as { dedupeKey: string }).dedupeKey);
    expect(keys).toEqual([
      `TENANT_CLOSING_NOTICE:${TENANT_ID}#ENTERED#2026-09-01:owner@example.test`,
      `TENANT_CLOSING_NOTICE:${TENANT_ID}#ENTERED#2026-09-01:admin@example.test`,
    ]);
    for (const call of reserveEmailDispatch.mock.calls) {
      expect((call[1] as { templateKey: string }).templateKey).toBe('TENANT_CLOSING_NOTICE');
    }
  });

  it('🔴 翌日: ENTERED は起票済み（QUEUED / SENT があれば積み増さない）。宛先も引かない', async () => {
    readClosingNoticePhaseStatuses.mockResolvedValue(['SENT', 'QUEUED']);
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-02'));
    const outcome = await handler({ tenantId: TENANT_ID }, 'j-2');
    expect(outcome).toMatchObject({
      kind: 'CHECKED',
      phases: [
        { phase: 'ENTERED', status: 'ALREADY_FILED', queued: 0 },
        { phase: 'D7', status: 'NOT_DUE' },
      ],
    });
    expect(readTenantAdminRecipients).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
  });

  it('🔴 ジョブが止まっていた日を翌日に取り返す: 9/3 に初めて走っても ENTERED を積む', async () => {
    const { handler } = makeHandler(jstNoon('2026-09-03'));
    const outcome = await handler({ tenantId: TENANT_ID }, 'j-3');
    expect(outcome).toMatchObject({ phases: [{ phase: 'ENTERED', status: 'FILED', queued: 2 }, { phase: 'D7', status: 'NOT_DUE' }] });
    const keys = reserveEmailDispatch.mock.calls.map((call) => (call[1] as { dedupeKey: string }).dedupeKey);
    expect(keys[0]).toContain('#ENTERED#2026-09-03:');
  });

  it('+23 日: ENTERED は起票済み、D7 を積む（段ごとに未処理判定）', async () => {
    readClosingNoticePhaseStatuses.mockImplementation(async (_ctx: unknown, phase: string) => (phase === 'ENTERED' ? ['SENT', 'SENT'] : []));
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-24'));
    const outcome = await handler({ tenantId: TENANT_ID }, 'j-4');
    expect(outcome).toMatchObject({
      phases: [
        { phase: 'ENTERED', status: 'ALREADY_FILED' },
        { phase: 'D7', dueOn: '2026-09-24', status: 'FILED', recipients: 2, queued: 2 },
      ],
    });
    expect(enqueued).toHaveLength(2);
    const keys = reserveEmailDispatch.mock.calls.map((call) => (call[1] as { dedupeKey: string }).dedupeKey);
    expect(keys.every((key) => key.includes('#D7#2026-09-24:'))).toBe(true);
  });

  it('保留中（HELD_PROVIDER_QUOTA）の段は起票済み扱い（保留中に毎日積み増さない）', async () => {
    readClosingNoticePhaseStatuses.mockResolvedValue(['HELD_PROVIDER_QUOTA']);
    const { handler } = makeHandler(jstNoon('2026-09-05'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-5')).resolves.toMatchObject({
      phases: [{ phase: 'ENTERED', status: 'ALREADY_FILED' }, { phase: 'D7', status: 'NOT_DUE' }],
    });
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
  });
});

describe('③ 🔴 FAILED は翌日に再起票される', () => {
  it('FAILED だけの段は未処理 → 翌日の暦日で別の dedupeKey になる', async () => {
    readClosingNoticePhaseStatuses.mockResolvedValue(['FAILED', 'FAILED']);
    const { handler } = makeHandler(jstNoon('2026-09-02'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-6')).resolves.toMatchObject({
      phases: [{ phase: 'ENTERED', status: 'FILED', queued: 2 }, { phase: 'D7', status: 'NOT_DUE' }],
    });
    const keys = reserveEmailDispatch.mock.calls.map((call) => (call[1] as { dedupeKey: string }).dedupeKey);
    expect(keys[0]).toBe(`TENANT_CLOSING_NOTICE:${TENANT_ID}#ENTERED#2026-09-02:owner@example.test`);
  });

  it('SUPPRESSED だけでも同じ（送らずに閉じた行は起票済みではない）', async () => {
    readClosingNoticePhaseStatuses.mockResolvedValue(['SUPPRESSED']);
    const { handler } = makeHandler(jstNoon('2026-09-02'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-7')).resolves.toMatchObject({ phases: [{ phase: 'ENTERED', status: 'FILED' }, { phase: 'D7', status: 'NOT_DUE' }] });
  });
});

describe('④ 宛先と enqueue', () => {
  it('宛先の分類は packages/db の値（分類 1）をそのまま運ぶ', async () => {
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-01'));
    await handler({ tenantId: TENANT_ID }, 'j-8');
    for (const call of reserveEmailDispatch.mock.calls) {
      expect((call[1] as { recipientClass: string }).recipientClass).toBe('HOST_MEMBER');
    }
    expect(enqueued.every((job) => (job as { recipientClass: string }).recipientClass === 'HOST_MEMBER')).toBe(true);
  });

  it('🔴 QUEUED 以外の既存行（dedupeKey が畳んだ）は積み直さない', async () => {
    reserveEmailDispatch
      .mockResolvedValueOnce({ dispatchId: 'd-x', created: false, status: 'SENT', recipientClass: 'HOST_MEMBER', recipientEmail: OWNER.email, templateKey: 'TENANT_CLOSING_NOTICE', dedupeKey: 'k1' })
      .mockResolvedValueOnce({ dispatchId: 'd-y', created: true, status: 'QUEUED', recipientClass: 'HOST_MEMBER', recipientEmail: ADMIN.email, templateKey: 'TENANT_CLOSING_NOTICE', dedupeKey: 'k2' });
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-01'));
    const outcome = await handler({ tenantId: TENANT_ID }, 'j-9');
    expect(outcome).toMatchObject({ phases: [{ phase: 'ENTERED', status: 'FILED', recipients: 2, queued: 1 }, { phase: 'D7', status: 'NOT_DUE' }] });
    expect(enqueued).toEqual([{ dispatchId: 'd-y', tenantId: TENANT_ID, recipientClass: 'HOST_MEMBER' }]);
  });

  it('宛先 0 人なら FILED(0 通)。行は作らず、削除可否は「予告無し」のまま（A-005 項目 15 に出る側）', async () => {
    readTenantAdminRecipients.mockResolvedValue([]);
    const { handler, enqueued } = makeHandler(jstNoon('2026-09-01'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-10')).resolves.toMatchObject({
      phases: [{ phase: 'ENTERED', status: 'FILED', recipients: 0, queued: 0 }, { phase: 'D7', status: 'NOT_DUE' }],
    });
    expect(enqueued).toEqual([]);
  });

  it('同じ日に両段の期限を過ぎていれば宛先を 1 回だけ引き、段ごとに 1 通ずつ積む', async () => {
    const { handler, enqueued } = makeHandler(jstNoon('2026-10-05'));
    const outcome = await handler({ tenantId: TENANT_ID }, 'j-11');
    expect(outcome).toMatchObject({ phases: [{ phase: 'ENTERED', status: 'FILED', queued: 2 }, { phase: 'D7', status: 'FILED', queued: 2 }] });
    expect(readTenantAdminRecipients).toHaveBeenCalledTimes(1);
    expect(enqueued).toHaveLength(4);
  });
});

describe('⑤ 🔴 JST の日境界', () => {
  it('closing_entered_at が UTC 16:00（JST 翌日 01:00）なら暦日は翌日で、入った当日の UTC ではまだ NOT_DUE', async () => {
    readTenantClosingSchedule.mockResolvedValue({ name: 'x', lifecycleState: 'CLOSING', closingEnteredAt: new Date('2026-09-01T16:00:00.000Z') });
    // now = UTC 2026-09-01 20:00 = JST 2026-09-02 05:00 → 今日 = 2026-09-02 = 入った暦日 → ENTERED は期限を過ぎている
    const { handler } = makeHandler(new Date('2026-09-01T20:00:00.000Z'));
    await expect(handler({ tenantId: TENANT_ID }, 'j-12')).resolves.toMatchObject({
      todayKey: '2026-09-02',
      purgeScheduledOn: '2026-10-02',
      phases: [{ phase: 'ENTERED', dueOn: '2026-09-02', status: 'FILED' }, { phase: 'D7', dueOn: '2026-09-25', status: 'NOT_DUE' }],
    });
  });

  it('猶予日数は deps（packages/config）から来る', async () => {
    const { handler } = makeHandler(jstNoon('2026-09-01'), 10);
    await expect(handler({ tenantId: TENANT_ID }, 'j-13')).resolves.toMatchObject({
      purgeScheduledOn: '2026-09-11',
      phases: [{ phase: 'ENTERED' }, { phase: 'D7', dueOn: '2026-09-04' }],
    });
  });
});

describe('⑥ payload / 宣言', () => {
  it('payload が不正なら DB に触れない', async () => {
    const { handler } = makeHandler(jstNoon('2026-09-01'));
    await expect(handler({ tenantId: 'not-a-uuid' }, 'j-14')).rejects.toThrow(InvalidJobPayloadError);
    await expect(handler(null, 'j-15')).rejects.toThrow(InvalidJobPayloadError);
    expect(readTenantClosingSchedule).not.toHaveBeenCalled();
    expect(parseTenantClosingNotifyPayload({ tenantId: TENANT_ID })).toEqual({ tenantId: TENANT_ID });
  });

  it('毎日 02:08 JST で宣言され、母集団は CLOSING（LIVE の既定では 1 社にも配られない）', () => {
    expect(TENANT_CLOSING_NOTIFY_SCHEDULE).toEqual({ cron: '8 2 * * *', timeZone: 'Asia/Tokyo' });
    expect(TENANT_CLOSING_NOTIFY_POPULATION).toBe('CLOSING');
    const declaration = SCHEDULED_JOBS.find((entry) => entry.name === TENANT_CLOSING_NOTIFY_JOB);
    expect(declaration).toMatchObject({ cron: '8 2 * * *', timeZone: 'Asia/Tokyo', population: 'CLOSING' });
  });

  it('他のスケジュールジョブは母集団を明示しない（既定 LIVE。T-10-09 の tenant.purge-scan だけが同じ CLOSING を明示する）', () => {
    for (const declaration of SCHEDULED_JOBS) {
      if (declaration.name === TENANT_CLOSING_NOTIFY_JOB || declaration.name === 'tenant.purge-scan') continue;
      expect(declaration.population, declaration.name).toBeUndefined();
    }
  });
});
