// apps/web/lib/webhooks/runtime.test.ts
// 🔴 `CLAUDE.md` §11.1: 「未登録なら黙って捨てる」を作らない。
//    `webhook.process` の enqueue 先が無い状態で `WebhookDelivery` を INSERT すると、
//    2 回目以降は重複判定で 200 を返し続け、そのイベントは**永久に処理されない**。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  configureWebhookProcessQueue,
  PendingWebhookProcessQueue,
  requireWebhookProcessQueue,
  resetWebhookProcessQueue,
  WebhookProcessQueueUnavailableError,
} from './runtime';

beforeEach(() => {
  resetWebhookProcessQueue();
});

describe('webhook.process の enqueue 先（起動時 DI）', () => {
  it('🔴 未登録のまま取り出そうとすると例外（黙って捨てない）', () => {
    expect(() => requireWebhookProcessQueue()).toThrow(WebhookProcessQueueUnavailableError);
  });

  it('登録すれば取り出せる', async () => {
    const queue = new PendingWebhookProcessQueue();
    configureWebhookProcessQueue(queue);
    await requireWebhookProcessQueue().enqueue({ deliveryId: 'd-1' });
    expect(queue.callCount()).toBe(1);
    expect(queue.jobIds()).toEqual(['d-1']);
  });

  it('🔴 保留キューは「処理済み」にしない（積んだ事実だけを持つ）', async () => {
    const queue = new PendingWebhookProcessQueue();
    await queue.enqueue({ deliveryId: 'd-1' });
    await queue.enqueue({ deliveryId: 'd-2' });
    expect(queue.jobIds()).toEqual(['d-1', 'd-2']);
  });
});
