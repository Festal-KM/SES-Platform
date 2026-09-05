// apps/worker/src/jobs/webhook-process.test.ts
// 🔴 docs/05 §8.5 / §9.4: 重複配信・順序逆転に耐えること。
//
//   ① 🔴 `processedAt` の CAS が `false` を返したら**再処理しない**（重複配信で 2 回処理しない）
//   ② 🔴 順序が逆転して古いイベントが後から届いても、既存行を上書きしない
//   ③ 未対応プロバイダを「処理済み」にしない（黙って捨てない）
//   ④ 解釈できない payload を再試行しない（`attempts` を空撃ちしない）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readWebhookDelivery = vi.fn();
const markWebhookDeliveryProcessed = vi.fn();
const markWebhookDeliveryFailed = vi.fn();
const recordEmailEvent = vi.fn();

vi.mock('@ses/db', () => ({
  readWebhookDelivery,
  markWebhookDeliveryProcessed,
  markWebhookDeliveryFailed,
  recordEmailEvent,
}));

const { createWebhookProcessHandler, parseWebhookProcessPayload } = await import('./webhook-process.js');
const { InvalidJobPayloadError } = await import('./payload.js');

const DELIVERY_ID = '01930000-0000-7000-8000-000000000801';
const NOW = new Date('2026-09-05T03:00:10.000Z');

const NORMALIZED = {
  sesMessageId: '0100018f-0000-4000-8000-000000000001',
  eventType: 'Bounce',
  occurredAt: '2026-09-05T03:00:00.000Z',
  recipientHashes: ['a'.repeat(64)],
  diagnostics: { bounceType: 'Permanent', bounceSubType: 'General' },
};

const handler = createWebhookProcessHandler({ now: () => NOW });

beforeEach(() => {
  for (const fn of [
    readWebhookDelivery,
    markWebhookDeliveryProcessed,
    markWebhookDeliveryFailed,
    recordEmailEvent,
  ]) {
    fn.mockReset();
  }
  readWebhookDelivery.mockResolvedValue({
    deliveryId: DELIVERY_ID,
    provider: 'ses',
    payload: NORMALIZED,
    processed: false,
  });
  markWebhookDeliveryProcessed.mockResolvedValue(true);
  recordEmailEvent.mockResolvedValue(true);
});

describe('parseWebhookProcessPayload', () => {
  it.each([null, {}, { deliveryId: 'nope' }])('不正な payload を既定値で補完せず例外にする', (raw) => {
    expect(() => parseWebhookProcessPayload(raw)).toThrow(InvalidJobPayloadError);
  });
});

describe('🔴 ses のバウンス・苦情を EmailEvent に正規化して保存する', () => {
  it('保存して processedAt を立てる', async () => {
    const outcome = await handler({ deliveryId: DELIVERY_ID }, 'j-1');
    expect(outcome).toEqual({ kind: 'PROCESSED', recorded: true });
    expect(recordEmailEvent.mock.calls[0]?.[0]).toMatchObject({
      sesMessageId: NORMALIZED.sesMessageId,
      eventType: 'Bounce',
      tenantId: null,
    });
    expect(markWebhookDeliveryProcessed).toHaveBeenCalledWith(DELIVERY_ID, NOW);
  });

  it('🔴 保存する payload に宛先ハッシュしか入らない（生アドレスは元から存在しない）', async () => {
    await handler({ deliveryId: DELIVERY_ID }, 'j-1');
    expect(recordEmailEvent.mock.calls[0]?.[0].payload).toEqual({
      recipientHashes: NORMALIZED.recipientHashes,
      diagnostics: NORMALIZED.diagnostics,
    });
  });

  it('🔴 テナントを推測で埋めない（誤ったテナントに他社のバウンスを計上しない）', async () => {
    await handler({ deliveryId: DELIVERY_ID }, 'j-1');
    expect(recordEmailEvent.mock.calls[0]?.[0].tenantId).toBeNull();
  });
});

describe('🔴 重複配信（SNS は at-least-once）', () => {
  it('既に処理済みなら EmailEvent を書かない', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'ses',
      payload: NORMALIZED,
      processed: true,
    });
    expect(await handler({ deliveryId: DELIVERY_ID }, 'j-1')).toEqual({ kind: 'ALREADY_PROCESSED' });
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it('🔴 CAS が 0 件（他の実行が先に完了）なら ALREADY_PROCESSED として終わる', async () => {
    markWebhookDeliveryProcessed.mockResolvedValue(false);
    expect(await handler({ deliveryId: DELIVERY_ID }, 'j-1')).toEqual({ kind: 'ALREADY_PROCESSED' });
  });

  it('🔴 同じイベントの 2 度目の記録（UNIQUE 衝突）でも失敗にしない', async () => {
    recordEmailEvent.mockResolvedValue(false);
    expect(await handler({ deliveryId: DELIVERY_ID }, 'j-1')).toEqual({
      kind: 'PROCESSED',
      recorded: false,
    });
    expect(markWebhookDeliveryFailed).not.toHaveBeenCalled();
  });
});

describe('🔴 順序逆転（docs/05 §8.5）', () => {
  it('後から届いた古いイベントも独立した行として扱い、新しい行を上書きしない', async () => {
    await handler({ deliveryId: DELIVERY_ID }, 'j-1');

    const older = { ...NORMALIZED, occurredAt: '2026-09-05T02:00:00.000Z' };
    readWebhookDelivery.mockResolvedValue({
      deliveryId: '01930000-0000-7000-8000-000000000802',
      provider: 'ses',
      payload: older,
      processed: false,
    });
    await handler({ deliveryId: '01930000-0000-7000-8000-000000000802' }, 'j-2');

    // 🔴 どちらも `recordEmailEvent` に「そのイベントの occurredAt のまま」渡る。
    //    上書き（update）を行う経路がそもそも無いことが、順序逆転に対する担保である。
    expect(recordEmailEvent.mock.calls.map((call) => call[0].occurredAt.toISOString())).toEqual([
      '2026-09-05T03:00:00.000Z',
      '2026-09-05T02:00:00.000Z',
    ]);
  });
});

describe('例外・未対応', () => {
  it('🔴 未対応プロバイダを「処理済み」にしない（黙って捨てない）', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'stripe',
      payload: {},
      processed: false,
    });
    expect(await handler({ deliveryId: DELIVERY_ID }, 'j-1')).toEqual({
      kind: 'UNSUPPORTED_PROVIDER',
      provider: 'stripe',
    });
    expect(markWebhookDeliveryProcessed).not.toHaveBeenCalled();
  });

  it('🔴 解釈できない payload は再試行せず失敗を記録する', async () => {
    readWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      provider: 'ses',
      payload: { broken: true },
      processed: false,
    });
    expect(await handler({ deliveryId: DELIVERY_ID }, 'j-1')).toEqual({
      kind: 'FAILED',
      failureReason: 'PARSE_ERROR',
    });
    expect(markWebhookDeliveryFailed.mock.calls[0]?.[1].failureReason).toBe('PARSE_ERROR');
    expect(markWebhookDeliveryProcessed).not.toHaveBeenCalled();
  });

  it('行が無ければ payload の不整合として失敗させる（黙って成功しない）', async () => {
    readWebhookDelivery.mockResolvedValue(null);
    await expect(handler({ deliveryId: DELIVERY_ID }, 'j-1')).rejects.toThrow(InvalidJobPayloadError);
  });
});
