// apps/worker/src/jobs/scan-poll.test.ts
// 🔴 T-05-05: `scan.poll`（docs/05 §8.5 の保険 / §9.6）。
//    「判定が付いていないものを推測で確定させない」ことと、
//    「閾値が `SCAN_STALL_ALERT_MINUTES` の設定値からしか来ない」ことを固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MalwareScanner } from '@ses/connectors';

const listStalledScanTargets = vi.fn();
const applyFileScanResult = vi.fn();
// 🔴 T-05-08: 隔離の周知（`F-011` 処理④）。**保険の経路でも周知が落ちない**ことを見る。
const readScanQuarantineNotice = vi.fn();
const reserveEmailDispatch = vi.fn();
const enqueueEmailDispatch = vi.fn();

vi.mock('@ses/db', () => ({
  listStalledScanTargets,
  applyFileScanResult,
  readScanQuarantineNotice,
  reserveEmailDispatch,
  emailDispatchDedupeKey: (input: {
    templateKey: string;
    targetId: string;
    recipientEmail: string;
  }) => `${input.templateKey}:${input.targetId}:${input.recipientEmail}`,
  systemTenantCtx: (tenantId: string, job: { queue: string; jobId: string }) => ({
    tenantId,
    partnerCompanyId: null,
    userId: '',
    role: 'ADMIN',
    lifecycleState: 'ACTIVE',
    job,
  }),
}));

const { createScanPollHandler, parseScanPollPayload, SCAN_POLL_LIMIT, SCAN_POLL_SCHEDULE } =
  await import('./scan-poll.js');
const { SCHEDULED_JOBS } = await import('./index.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const KEY_A = `t/${TENANT_ID}/skill-sheets/01930000-0000-7000-8000-0000000000b1/1/01930000-0000-7000-8000-0000000000c1.xlsx`;
const KEY_B = `t/${TENANT_ID}/skill-sheets/01930000-0000-7000-8000-0000000000b2/1/01930000-0000-7000-8000-0000000000c2.pdf`;
const NOW = new Date('2026-09-06T01:30:00.000Z');
const DISPATCH_ID = '01930000-0000-7000-8000-0000000000e1';
const PARTNER_ID = '01930000-0000-7000-8000-0000000000f1';

type GetResult = MalwareScanner['getResult'];

function scanner(getResult: GetResult): MalwareScanner {
  return { enqueue: async () => undefined, getResult, callCount: () => 0 };
}

beforeEach(() => {
  listStalledScanTargets.mockReset();
  applyFileScanResult.mockReset();
  readScanQuarantineNotice.mockReset();
  reserveEmailDispatch.mockReset();
  enqueueEmailDispatch.mockReset();
  listStalledScanTargets.mockResolvedValue([]);
  applyFileScanResult.mockResolvedValue({ target: 'APPLIED', previousStatus: 'SCANNING', recorded: true });
  // 既定は隔離ではない（`CLEAN`）。周知の経路は専用の describe が組み立てる。
  readScanQuarantineNotice.mockResolvedValue({
    target: { skillSheetId: 's1', ownerPartnerCompanyId: null, scanStatus: 'CLEAN' },
    recipients: [],
  });
  reserveEmailDispatch.mockResolvedValue({
    dispatchId: DISPATCH_ID,
    dedupeKey: 'k',
    created: true,
    status: 'QUEUED',
    recipientClass: 'PARTNER_MEMBER',
    recipientEmail: 'to@example.test',
    templateKey: 'SKILL_SHEET_QUARANTINE',
  });
});

describe('payload の門番とスケジュール', () => {
  it('tenantId が UUID でなければ例外', () => {
    expect(() => parseScanPollPayload({ tenantId: 'x' })).toThrow(InvalidJobPayloadError);
  });

  it('🔴 毎 5 分（docs/05 §9.6）', () => {
    expect(SCAN_POLL_SCHEDULE).toEqual({ cron: '*/5 * * * *', timeZone: 'Asia/Tokyo' });
  });

  it('🔴 SCHEDULED_JOBS に登録されている（登録漏れ = 滞留に誰も気づけない）', () => {
    const declaration = SCHEDULED_JOBS.find((job) => job.name === 'scan.poll');
    expect(declaration).toBeDefined();
    expect(declaration?.cron).toBe(SCAN_POLL_SCHEDULE.cron);
  });
});

describe('🔴 滞留の閾値（SCAN_STALL_ALERT_MINUTES。目標値に依存しない）', () => {
  it('now - stallAlertMinutes を境界として渡す', async () => {
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => null),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(listStalledScanTargets).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      { before: new Date('2026-09-06T01:20:00.000Z'), limit: SCAN_POLL_LIMIT },
    );
  });

  it('設定値を変えると境界だけが動く（コードに分数を埋め込んでいない）', async () => {
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => null),
      stallAlertMinutes: 3,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(listStalledScanTargets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ before: new Date('2026-09-06T01:27:00.000Z') }),
    );
  });
});

describe('🔴 判定が付いていないものを推測で確定させない', () => {
  it('getResult が null なら何も適用しない（unresolved として数える）', async () => {
    listStalledScanTargets.mockResolvedValue([{ skillSheetId: 's1', objectKey: KEY_A }]);
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => null),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await expect(handler({ tenantId: TENANT_ID }, 'job-1')).resolves.toEqual({
      scanned: 1,
      resolved: 0,
      unresolved: 1,
      quarantineNotified: 0,
    });
    expect(applyFileScanResult).not.toHaveBeenCalled();
  });
});

describe('🔴 照会で判定が取れたら「同じ経路」で適用する（2 実装にしない）', () => {
  it('applyFileScanResult に版と生値をそのまま渡す', async () => {
    listStalledScanTargets.mockResolvedValue([{ skillSheetId: 's1', objectKey: KEY_A }]);
    const getResult = vi.fn<GetResult>(async () => ({
      status: 'INFECTED',
      rawStatus: 'THREATS_FOUND',
      objectVersionId: 'v-9',
    }));
    const handler = createScanPollHandler({
      malwareScanner: scanner(getResult),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await expect(handler({ tenantId: TENANT_ID }, 'job-1')).resolves.toEqual({
      scanned: 1,
      resolved: 1,
      unresolved: 0,
      quarantineNotified: 0,
    });
    // 🔴 版を指定せず最新版を照会する（`skill_sheets` は版 ID を列として持たない）。
    expect(getResult).toHaveBeenCalledWith(KEY_A, null);
    expect(applyFileScanResult).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      {
        objectKey: KEY_A,
        objectVersionId: 'v-9',
        status: 'INFECTED',
        rawStatus: 'THREATS_FOUND',
        occurredAt: NOW,
        receivedAt: NOW,
      },
    );
  });

  it('🔴 KEPT（Webhook が先に適用済み）も resolved として数える（失敗ではない）', async () => {
    listStalledScanTargets.mockResolvedValue([{ skillSheetId: 's1', objectKey: KEY_A }]);
    applyFileScanResult.mockResolvedValue({
      target: 'KEPT',
      previousStatus: 'INFECTED',
      recorded: false,
    });
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => ({
        status: 'CLEAN',
        rawStatus: 'NO_THREATS_FOUND',
        objectVersionId: 'v',
      })),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await expect(handler({ tenantId: TENANT_ID }, 'job-1')).resolves.toEqual({
      scanned: 1,
      resolved: 1,
      unresolved: 0,
      quarantineNotified: 0,
    });
  });

  it('照会中に対象が消えた（NOT_FOUND）は unresolved に数える', async () => {
    listStalledScanTargets.mockResolvedValue([{ skillSheetId: 's1', objectKey: KEY_A }]);
    applyFileScanResult.mockResolvedValue({ target: 'NOT_FOUND', previousStatus: null, recorded: false });
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => ({
        status: 'CLEAN',
        rawStatus: 'NO_THREATS_FOUND',
        objectVersionId: 'v',
      })),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await expect(handler({ tenantId: TENANT_ID }, 'job-1')).resolves.toEqual({
      scanned: 1,
      resolved: 0,
      unresolved: 1,
      quarantineNotified: 0,
    });
  });

  it('複数件を古い順のまま処理する', async () => {
    listStalledScanTargets.mockResolvedValue([
      { skillSheetId: 's1', objectKey: KEY_A },
      { skillSheetId: 's2', objectKey: KEY_B },
    ]);
    const getResult = vi
      .fn<GetResult>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'CLEAN', rawStatus: 'NO_THREATS_FOUND', objectVersionId: 'v' });
    const handler = createScanPollHandler({
      malwareScanner: scanner(getResult),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await expect(handler({ tenantId: TENANT_ID }, 'job-1')).resolves.toEqual({
      scanned: 2,
      resolved: 1,
      unresolved: 1,
      quarantineNotified: 0,
    });
    expect(getResult.mock.calls.map((call) => call[0])).toEqual([KEY_A, KEY_B]);
  });
});

describe('🔴 T-05-08 隔離の周知は「保険の経路」でも成立する（docs/02 F-011 処理④）', () => {
  it('🔴 Webhook が届かず scan.poll が隔離を確定させたときも email.dispatch を積む', async () => {
    listStalledScanTargets.mockResolvedValue([{ skillSheetId: 's1', objectKey: KEY_A }]);
    readScanQuarantineNotice.mockResolvedValue({
      target: { skillSheetId: 's1', ownerPartnerCompanyId: PARTNER_ID, scanStatus: 'INFECTED' },
      recipients: [{ userId: 'u1', email: 'to@example.test', recipientClass: 'PARTNER_MEMBER' }],
    });
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => ({
        status: 'INFECTED',
        rawStatus: 'THREATS_FOUND',
        objectVersionId: 'v',
      })),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await expect(handler({ tenantId: TENANT_ID }, 'job-1')).resolves.toEqual({
      scanned: 1,
      resolved: 1,
      unresolved: 1 - 1,
      quarantineNotified: 1,
    });
    expect(enqueueEmailDispatch).toHaveBeenCalledWith({
      dispatchId: DISPATCH_ID,
      tenantId: TENANT_ID,
      recipientClass: 'PARTNER_MEMBER',
    });
  });

  it('🔴 対象が消えていた（NOT_FOUND）ときは周知しない', async () => {
    listStalledScanTargets.mockResolvedValue([{ skillSheetId: 's1', objectKey: KEY_A }]);
    applyFileScanResult.mockResolvedValue({ target: 'NOT_FOUND', previousStatus: null, recorded: false });
    const handler = createScanPollHandler({
      malwareScanner: scanner(async () => ({
        status: 'INFECTED',
        rawStatus: 'THREATS_FOUND',
        objectVersionId: 'v',
      })),
      stallAlertMinutes: 10,
      now: () => NOW,
      enqueueEmailDispatch,
    });
    await handler({ tenantId: TENANT_ID }, 'job-1');
    expect(readScanQuarantineNotice).not.toHaveBeenCalled();
    expect(enqueueEmailDispatch).not.toHaveBeenCalled();
  });
});
