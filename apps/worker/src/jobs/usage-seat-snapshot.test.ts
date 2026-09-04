// apps/worker/src/jobs/usage-seat-snapshot.test.ts
// `usage.seat-snapshot`（docs/05 §9.8 / `F-026`）のジョブ側の検証。T-03-10。
//
// 🔴 DB を要する部分（原子性・冪等性）は `tests/isolation/usage-counters.test.ts` が実証する。
//    ここで固定するのは**ジョブの配線**である:
//      ① payload の門番が既定値で補完しない（別テナントを計測しない）
//      ② `countPartnerSeats` が**引数で渡される**（決め打ちされていない。docs/05 TBD-19）
//      ③ ctx が `systemTenantCtx`（ホスト文脈・ジョブ識別つき）で組み立てられる
//      ④ スケジュールが毎日 01:00 JST である
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshotSeatCount = vi.fn();

vi.mock('@ses/db', () => ({
  snapshotSeatCount,
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
  createUsageSeatSnapshotHandler,
  InvalidJobPayloadError,
  parseUsageSeatSnapshotPayload,
  USAGE_SEAT_SNAPSHOT_JOB,
  USAGE_SEAT_SNAPSHOT_SCHEDULE,
} = await import('./usage-seat-snapshot.js');
const { SCHEDULED_JOBS } = await import('./index.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';

beforeEach(() => {
  snapshotSeatCount.mockReset();
  snapshotSeatCount.mockResolvedValue({
    periodKind: 'DAY',
    periodKey: '2026-09-04',
    metric: 'SEAT_COUNT',
    value: '3',
    reservedValue: '0',
    seatCount: 3,
  });
});

describe('parseUsageSeatSnapshotPayload', () => {
  it('tenantId を含む payload を通す', () => {
    expect(parseUsageSeatSnapshotPayload({ tenantId: TENANT_ID })).toEqual({ tenantId: TENANT_ID });
  });

  it.each([null, undefined, 'string', 42, {}, { tenantId: '' }, { tenantId: 'not-a-uuid' }])(
    '🔴 不正な payload %s を既定値で補完せず例外にする',
    (raw) => {
      expect(() => parseUsageSeatSnapshotPayload(raw)).toThrow(InvalidJobPayloadError);
    },
  );
});

describe('createUsageSeatSnapshotHandler', () => {
  it('🔴 countPartnerSeats を引数のまま `snapshotSeatCount` へ渡す（決め打ちしない）', async () => {
    const now = new Date('2026-09-04T16:00:00.000Z');
    const handler = createUsageSeatSnapshotHandler({
      countPartnerSeats: true,
      now: () => now,
    });
    await handler({ tenantId: TENANT_ID }, 'usage.seat-snapshot:2026-09-05');

    expect(snapshotSeatCount).toHaveBeenCalledTimes(1);
    expect(snapshotSeatCount.mock.calls[0]?.[1]).toEqual({
      countPartnerSeats: true,
      observedAt: now,
    });
  });

  it('countPartnerSeats=false もそのまま渡る', async () => {
    const handler = createUsageSeatSnapshotHandler({
      countPartnerSeats: false,
      now: () => new Date('2026-09-04T16:00:00.000Z'),
    });
    await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(snapshotSeatCount.mock.calls[0]?.[1]?.countPartnerSeats).toBe(false);
  });

  it('🔴 ctx はホスト文脈（partnerCompanyId=null）で、ジョブ識別を持つ', async () => {
    const handler = createUsageSeatSnapshotHandler({
      countPartnerSeats: false,
      now: () => new Date('2026-09-04T16:00:00.000Z'),
    });
    await handler({ tenantId: TENANT_ID }, 'job-42');

    const ctx = snapshotSeatCount.mock.calls[0]?.[0];
    expect(ctx).toMatchObject({
      tenantId: TENANT_ID,
      partnerCompanyId: null,
      job: { queue: USAGE_SEAT_SNAPSHOT_JOB, jobId: 'job-42' },
    });
  });

  it('🔴 payload が不正なら DB に触れない', async () => {
    const handler = createUsageSeatSnapshotHandler({
      countPartnerSeats: false,
      now: () => new Date(),
    });
    await expect(handler({}, 'job-1')).rejects.toThrow(InvalidJobPayloadError);
    expect(snapshotSeatCount).not.toHaveBeenCalled();
  });
});

describe('スケジュール宣言（docs/05 §9.8 / §9.1）', () => {
  it('🔴 毎日 01:00 JST である', () => {
    expect(USAGE_SEAT_SNAPSHOT_SCHEDULE).toEqual({ cron: '0 1 * * *', timeZone: 'Asia/Tokyo' });
  });

  it('🔴 SCHEDULED_JOBS に登録されている（登録漏れ = 一度も走らない）', () => {
    const declaration = SCHEDULED_JOBS.find((job) => job.name === USAGE_SEAT_SNAPSHOT_JOB);
    expect(declaration).toBeDefined();
    expect(declaration?.cron).toBe(USAGE_SEAT_SNAPSHOT_SCHEDULE.cron);
    expect(declaration?.timeZone).toBe('Asia/Tokyo');
  });

  it('宣言からハンドラを合成できる', async () => {
    const declaration = SCHEDULED_JOBS.find((job) => job.name === USAGE_SEAT_SNAPSHOT_JOB);
    const handler = declaration?.createHandler({
      countPartnerSeats: false,
      now: () => new Date('2026-09-04T16:00:00.000Z'),
    });
    await handler?.({ tenantId: TENANT_ID }, 'job-1');
    expect(snapshotSeatCount).toHaveBeenCalledTimes(1);
  });
});
