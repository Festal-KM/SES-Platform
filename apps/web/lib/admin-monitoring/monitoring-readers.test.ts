// apps/web/lib/admin-monitoring/monitoring-readers.test.ts
// （対象は `apps/web/app/api/admin/monitoring/_lib/readers.ts`。vitest の include が `apps/*/app/**` の `*.test.ts` を拾わないため lib 側に置く）
// 🔴 T-12-17 ⑦（SP-11 T-11-04 レビュー申し送り ③）: 項目 13（`MAIL_PROVIDER_QUOTA`）の材料は **DB（保留件数）と Redis
//    （送信基盤のカウンタ）の 2 つの出所**から読む。失敗の種別（`errorKind`）が出所ごとに分かれることを固定する:
//      - `readMailProviderHeld`（DB）の失敗 → `DB_READ_FAILED`（旧実装は `PROVIDER_READ_FAILED` =「Redis を読めませんでした」に
//        落ち、原因を誤案内していた）
//      - `readLocalSent24h`（Redis のカウンタ）の失敗 → `PROVIDER_READ_FAILED`
//      - `getQuota()` の失敗 → 項目は成立（`ok: true` / `available: false`）。どちらの種別でもない（既存の規律。変えていない）
//
// `@ses/db/platform` を差し替え、項目 13 の reader だけを `buildMonitoringSnapshot` に通す。
import { describe, expect, it, vi } from 'vitest';

const readMailProviderHeld = vi.fn();

vi.mock('@ses/db/platform', () => ({
  listGateStalls: vi.fn(),
  listOpenUsageMeasurementFindings: vi.fn(),
  listUnverifiedSendingDomains: vi.fn(),
  readGateFailRates: vi.fn(),
  readMailDispatchStuck: vi.fn(),
  readMailProviderHeld,
  readProviderMonthlySpend: vi.fn(),
  readPurgeJobFailures: vi.fn(),
  readPurgeNoticePending: vi.fn(),
  readScanFailures: vi.fn(),
  readSchedulerHeartbeat: vi.fn(),
  readSendHolds: vi.fn(),
  readSubmittingStalls: vi.fn(),
  readUnattendedSubmitFailures: vi.fn(),
}));

const { createMonitoringReaders } = await import('../../app/api/admin/monitoring/_lib/readers');
const { buildMonitoringSnapshot, MonitoringReadError } = await import('./snapshot');
const { MONITORING_KINDS } = await import('./view');

const NOW = new Date('2026-09-18T09:00:00.000Z');

function runtime(overrides: Partial<{ readQuota: () => Promise<never>; readLocalSent24h: () => Promise<number> }> = {}) {
  return {
    thresholds: {
      submittingStallMinutes: 30,
      gateStallMinutes: 30,
      mailDispatchStuckMinutes: 15,
      scanStallMinutes: 10,
      purgeGraceDays: 30,
      schedulerStaleHours: 24,
      gateFailRateWindowHours: 24,
      gateFailRateBaselineDays: 7,
    },
    providerSpend: { capUsd: 500, warnPercent: 80 },
    mailProvider: {
      envLimit: 200,
      warnRatio: 0.8,
      readQuota: async () => ({ max24h: 200, sentLast24h: 10, observedAt: NOW }),
      readLocalSent24h: async () => 10,
      observeNearing: async () => null,
      ...overrides,
    },
    failedJobs: { list: async () => ({ byQueue: [], total: 0, gateRun: [], gateRunTruncated: false }) },
  };
}

async function readItem13(rt: ReturnType<typeof runtime>) {
  const readers = createMonitoringReaders({} as never, rt as never, { ipAddress: null, now: NOW });
  const onFailure = vi.fn();
  // 項目 13 以外は成立の空材料で埋める（他項目の読み取りはここでは見ない）。
  const others = Object.fromEntries(
    MONITORING_KINDS.filter((kind) => kind !== 'MAIL_PROVIDER_QUOTA').map((kind) => [
      kind,
      { errorKind: 'DB_READ_FAILED', read: async () => ({}) },
    ]),
  );
  const snapshot = await buildMonitoringSnapshot(
    { ...others, MAIL_PROVIDER_QUOTA: readers.MAIL_PROVIDER_QUOTA } as never,
    NOW,
    onFailure,
  );
  return { item: snapshot.items.find((entry) => entry.kind === 'MAIL_PROVIDER_QUOTA'), onFailure, readers };
}

describe('項目 13 の errorKind は出所ごとに分かれる（T-12-17 ⑦）', () => {
  it('DB（readMailProviderHeld）の失敗 → DB_READ_FAILED（PROVIDER_READ_FAILED に落ちない）', async () => {
    const cause = new Error('ECONNREFUSED postgres');
    readMailProviderHeld.mockRejectedValueOnce(cause);

    const { item, onFailure, readers } = await readItem13(runtime());

    expect(item).toEqual({ kind: 'MAIL_PROVIDER_QUOTA', ok: false, errorKind: 'DB_READ_FAILED' });
    expect(onFailure).toHaveBeenCalledWith('MAIL_PROVIDER_QUOTA', 'DB_READ_FAILED', cause);
    // reader の既定は変えていない（Redis 側の失敗がここに落ちる）。
    expect(readers.MAIL_PROVIDER_QUOTA.errorKind).toBe('PROVIDER_READ_FAILED');
    readMailProviderHeld.mockRejectedValueOnce(cause);
    await expect(readers.MAIL_PROVIDER_QUOTA.read()).rejects.toBeInstanceOf(MonitoringReadError);
  });

  it('Redis のカウンタ（readLocalSent24h）の失敗 → PROVIDER_READ_FAILED', async () => {
    readMailProviderHeld.mockResolvedValueOnce({ heldCount: 0, oldestHeldAt: null });
    const cause = new Error('ECONNREFUSED redis');

    const { item, onFailure } = await readItem13(
      runtime({
        readLocalSent24h: async () => {
          throw cause;
        },
      }),
    );

    expect(item).toEqual({ kind: 'MAIL_PROVIDER_QUOTA', ok: false, errorKind: 'PROVIDER_READ_FAILED' });
    expect(onFailure).toHaveBeenCalledWith('MAIL_PROVIDER_QUOTA', 'PROVIDER_READ_FAILED', cause);
  });

  it('getQuota() の失敗は項目を落とさない（ok: true / available: false。既存の規律）', async () => {
    readMailProviderHeld.mockResolvedValueOnce({ heldCount: 2, oldestHeldAt: NOW });

    const { item, onFailure } = await readItem13(
      runtime({
        readQuota: async () => {
          throw new Error('GetAccount throttled');
        },
      }),
    );

    expect(item).toMatchObject({ kind: 'MAIL_PROVIDER_QUOTA', ok: true, heldCount: 2 });
    expect(item).toMatchObject({ providerReading: { available: false } });
    expect(onFailure).not.toHaveBeenCalled();
  });
});
