// apps/worker/src/jobs/scan-apply-result.test.ts
// 🔴 T-05-05: `scan.apply-result`（docs/05 §8.5 / §9.6）。
//    重複配信・順序逆転・射程外を「エラー」と「正常系」に正しく分ける。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readWebhookDelivery = vi.fn();
const markWebhookDeliveryProcessed = vi.fn();
const markWebhookDeliveryFailed = vi.fn();
const applyFileScanResult = vi.fn();
// 🔴 T-05-08: 隔離の周知（`F-011` 処理④）。`scan.apply-result` から必ず通ることを見る。
const readScanQuarantineNotice = vi.fn();
const reserveEmailDispatch = vi.fn();
const enqueueEmailDispatch = vi.fn();

vi.mock('@ses/db', () => ({
  readWebhookDelivery,
  markWebhookDeliveryProcessed,
  markWebhookDeliveryFailed,
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

const { createScanApplyResultHandler, parseScanApplyResultPayload } = await import(
  './scan-apply-result.js'
);
const { InvalidJobPayloadError } = await import('./payload.js');

const DELIVERY_ID = '01930000-0000-7000-8000-000000000901';
const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const OBJECT_KEY = `t/${TENANT_ID}/skill-sheets/01930000-0000-7000-8000-0000000000b1/1/01930000-0000-7000-8000-0000000000c1.xlsx`;
const NOW = new Date('2026-09-06T01:10:00.000Z');
const SKILL_SHEET_ID = '01930000-0000-7000-8000-0000000000d1';
const DISPATCH_ID = '01930000-0000-7000-8000-0000000000e1';
const PARTNER_ID = '01930000-0000-7000-8000-0000000000f1';

function payloadOf(status: string, rawStatus: string, objectKey = OBJECT_KEY) {
  return {
    bucketName: 'ses-platform-test',
    objectKey,
    objectVersionId: 'OZ9Zx0000000000000000000000000a1',
    status,
    rawStatus,
    occurredAt: '2026-09-06T01:00:00.000Z',
  };
}

const handler = createScanApplyResultHandler({ now: () => NOW, enqueueEmailDispatch });

beforeEach(() => {
  readWebhookDelivery.mockReset();
  markWebhookDeliveryProcessed.mockReset();
  markWebhookDeliveryFailed.mockReset();
  applyFileScanResult.mockReset();
  readScanQuarantineNotice.mockReset();
  reserveEmailDispatch.mockReset();
  enqueueEmailDispatch.mockReset();
  readWebhookDelivery.mockResolvedValue({
    deliveryId: DELIVERY_ID,
    provider: 'guardduty',
    payload: payloadOf('CLEAN', 'NO_THREATS_FOUND'),
    processed: false,
  });
  markWebhookDeliveryProcessed.mockResolvedValue(true);
  applyFileScanResult.mockResolvedValue({ target: 'APPLIED', previousStatus: 'SCANNING', recorded: true });
  // 既定は `CLEAN`（隔離ではない）。周知の経路は下の describe が個別に組み立てる。
  readScanQuarantineNotice.mockResolvedValue({
    target: { skillSheetId: SKILL_SHEET_ID, ownerPartnerCompanyId: null, scanStatus: 'CLEAN' },
    recipients: [],
  });
  reserveEmailDispatch.mockImplementation(async () => ({
    dispatchId: DISPATCH_ID,
    dedupeKey: 'k',
    created: true,
    status: 'QUEUED',
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.test',
    templateKey: 'SKILL_SHEET_QUARANTINE',
  }));
});

describe('payload の門番', () => {
  it('deliveryId が UUID でなければ例外', () => {
    expect(() => parseScanApplyResultPayload({ deliveryId: 'x' })).toThrow(InvalidJobPayloadError);
    expect(() => parseScanApplyResultPayload(null)).toThrow(InvalidJobPayloadError);
  });
});

describe('🔴 通常経路', () => {
  it('CLEAN を適用し、処理済みの CAS を立てる', async () => {
    const outcome = await handler({ deliveryId: DELIVERY_ID }, 'job-1');
    expect(outcome).toEqual({
      kind: 'PROCESSED',
      target: 'APPLIED',
      recorded: true,
      quarantineNotified: false,
    });
    expect(applyFileScanResult).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, partnerCompanyId: null }),
      expect.objectContaining({
        objectKey: OBJECT_KEY,
        status: 'CLEAN',
        rawStatus: 'NO_THREATS_FOUND',
        // 🔴 scan_updated_at に入るのはプロバイダの発生時刻（受信時刻ではない）。
        occurredAt: new Date('2026-09-06T01:00:00.000Z'),
        receivedAt: NOW,
      }),
    );
    expect(markWebhookDeliveryProcessed).toHaveBeenCalledWith(DELIVERY_ID, NOW);
  });

  it('🔴 テナント文脈はオブジェクトキーの t/{tenantId} から導く（payload の別項目を信じない）', async () => {
    await handler({ deliveryId: DELIVERY_ID }, 'job-1');
    const ctx = applyFileScanResult.mock.calls[0]?.[0] as { tenantId: string; partnerCompanyId: null };
    expect(ctx.tenantId).toBe(TENANT_ID);
    // 🔴 ジョブ文脈はホスト固定（docs/05 §9.2）。パートナー所有のファイルへは
    //    `app_apply_scan_status`（SECURITY DEFINER）経由でしか届かない。
    expect(ctx.partnerCompanyId).toBeNull();
  });
});

describe('🔴 重複配信・順序逆転（正常系。エラーにしない）', () => {
  it('既に処理済みの配信は何もしない', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'guardduty',
      payload: payloadOf('CLEAN', 'NO_THREATS_FOUND'),
      processed: true,
    });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'ALREADY_PROCESSED',
    });
    expect(applyFileScanResult).not.toHaveBeenCalled();
  });

  it('🔴 KEPT（既により重い判定が入っていた）は成功として扱う', async () => {
    applyFileScanResult.mockResolvedValue({
      target: 'KEPT',
      previousStatus: 'INFECTED',
      recorded: false,
    });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'PROCESSED',
      target: 'KEPT',
      recorded: false,
      quarantineNotified: false,
    });
    expect(markWebhookDeliveryFailed).not.toHaveBeenCalled();
  });

  it('CAS に負けた（他の実行が先に完了）ときは ALREADY_PROCESSED', async () => {
    markWebhookDeliveryProcessed.mockResolvedValue(false);
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'ALREADY_PROCESSED',
    });
  });
});

describe('🔴 T-05-08 隔離の周知（docs/02 F-011 処理④）', () => {
  function quarantined(ownerPartnerCompanyId: string | null, recipientClass: string) {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'guardduty',
      payload: payloadOf('INFECTED', 'THREATS_FOUND'),
      processed: false,
    });
    readScanQuarantineNotice.mockResolvedValue({
      target: { skillSheetId: SKILL_SHEET_ID, ownerPartnerCompanyId, scanStatus: 'INFECTED' },
      recipients: [{ userId: 'u1', email: 'to@example.test', recipientClass }],
    });
    reserveEmailDispatch.mockResolvedValue({
      dispatchId: DISPATCH_ID,
      dedupeKey: 'k',
      created: true,
      status: 'QUEUED',
      recipientClass,
      recipientEmail: 'to@example.test',
      templateKey: 'SKILL_SHEET_QUARANTINE',
    });
  }

  it('🔴 ホスト所有（分類 1）の隔離で email.dispatch を積む', async () => {
    quarantined(null, 'HOST_MEMBER');
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'PROCESSED',
      target: 'APPLIED',
      recorded: true,
      quarantineNotified: true,
    });
    expect(enqueueEmailDispatch).toHaveBeenCalledWith({
      dispatchId: DISPATCH_ID,
      tenantId: TENANT_ID,
      recipientClass: 'HOST_MEMBER',
    });
  });

  it('🔴 パートナー所有（分類 2）の隔離でも同じ経路で積む（周知が片側だけにならない）', async () => {
    quarantined(PARTNER_ID, 'PARTNER_MEMBER');
    await handler({ deliveryId: DELIVERY_ID }, 'job-1');
    expect(enqueueEmailDispatch).toHaveBeenCalledWith({
      dispatchId: DISPATCH_ID,
      tenantId: TENANT_ID,
      recipientClass: 'PARTNER_MEMBER',
    });
  });

  it('🔴 CLEAN では 1 通も積まない', async () => {
    await handler({ deliveryId: DELIVERY_ID }, 'job-1');
    expect(enqueueEmailDispatch).not.toHaveBeenCalled();
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
  });

  it('🔴 周知が失敗したら processedAt を立てない（届かないまま完了扱いにしない）', async () => {
    quarantined(null, 'HOST_MEMBER');
    enqueueEmailDispatch.mockRejectedValue(new Error('redis down'));
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).rejects.toThrow('redis down');
    expect(markWebhookDeliveryProcessed).not.toHaveBeenCalled();
  });

  it('🔴 判定は「ジョブが受け取った状態」ではなく「適用後の DB の状態」で行う（順序逆転）', async () => {
    // 後から軽い判定（CLEAN）が届いたが、DB 上は INFECTED のまま = 周知の対象である。
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'guardduty',
      payload: payloadOf('CLEAN', 'NO_THREATS_FOUND'),
      processed: false,
    });
    applyFileScanResult.mockResolvedValue({
      target: 'KEPT',
      previousStatus: 'INFECTED',
      recorded: false,
    });
    readScanQuarantineNotice.mockResolvedValue({
      target: { skillSheetId: SKILL_SHEET_ID, ownerPartnerCompanyId: null, scanStatus: 'INFECTED' },
      recipients: [{ userId: 'u1', email: 'to@example.test', recipientClass: 'HOST_MEMBER' }],
    });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'PROCESSED',
      target: 'KEPT',
      recorded: false,
      quarantineNotified: true,
    });
  });
});

describe('🔴 失敗の分類（再試行しても直らないものを throw しない）', () => {
  it('対象が見つからない場合は未処理のまま記録する（A-005 が拾う）', async () => {
    applyFileScanResult.mockResolvedValue({ target: 'NOT_FOUND', previousStatus: null, recorded: true });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'FAILED',
      failureReason: 'SCAN_TARGET_NOT_FOUND',
    });
    expect(markWebhookDeliveryFailed).toHaveBeenCalledWith(DELIVERY_ID, {
      failedAt: NOW,
      failureReason: 'SCAN_TARGET_NOT_FOUND',
    });
    // 🔴 `processedAt` を立てない（処理したことにして捨てない）。
    expect(markWebhookDeliveryProcessed).not.toHaveBeenCalled();
  });

  it('解釈できない payload は PARSE_ERROR（throw せず attempts を空撃ちしない）', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'guardduty',
      payload: { status: 'PROBABLY_OK' },
      processed: false,
    });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'FAILED',
      failureReason: 'PARSE_ERROR',
    });
    expect(applyFileScanResult).not.toHaveBeenCalled();
  });

  it('テナントプレフィックス外のキーは UNSCOPED_OBJECT_KEY（適用しない）', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'guardduty',
      payload: payloadOf('CLEAN', 'NO_THREATS_FOUND', 'public/leaflet.pdf'),
      processed: false,
    });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'FAILED',
      failureReason: 'UNSCOPED_OBJECT_KEY',
    });
    expect(applyFileScanResult).not.toHaveBeenCalled();
  });

  it('🔴 DB 障害（PROCESS_ERROR）は記録したうえで投げ直す（再試行の価値がある）', async () => {
    applyFileScanResult.mockRejectedValue(new Error('db down'));
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).rejects.toThrow('db down');
    expect(markWebhookDeliveryFailed).toHaveBeenCalledWith(DELIVERY_ID, {
      failedAt: NOW,
      failureReason: 'PROCESS_ERROR',
    });
  });

  it('🔴 他プロバイダの配信は processedAt を立てずに返す（処理したことにして捨てない）', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'ses',
      payload: {},
      processed: false,
    });
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).resolves.toEqual({
      kind: 'UNSUPPORTED_PROVIDER',
      provider: 'ses',
    });
    expect(markWebhookDeliveryProcessed).not.toHaveBeenCalled();
  });

  it('deliveryId に対応する行が無ければ例外（payload の門番）', async () => {
    readWebhookDelivery.mockResolvedValue(null);
    await expect(handler({ deliveryId: DELIVERY_ID }, 'job-1')).rejects.toThrow(InvalidJobPayloadError);
  });
});
