// apps/web/lib/webhooks/ses.test.ts
// 🔴 docs/05 §8.5 / §6.10: 受信は「検証 → `WebhookDelivery` に INSERT → 200 → enqueue」で固定される。
//
// ここで固定するのは 6 点である:
//   ① 🔴 **署名検証失敗だけが 401**。それ以外は成功・失敗にかかわらず 200
//      （4xx を再送しないプロバイダがあり、通知が永久に失われる）
//   ② 🔴 トピックが一致しないメッセージを受け付けない（署名は「Amazon が署名した」しか示さない）
//   ③ 🔴 **重複配信では enqueue しない**（`dedupeKey` の `UNIQUE`）
//   ④ 🔴 保存する payload に**生の宛先アドレスが 1 文字も入らない**（docs/05 §16.2）
//   ⑤ 解釈できない通知でも 200 を返し、未処理として記録する（`A-005` が拾う）
//   ⑥ 🔴 購読確認の `Token` / `SubscribeURL` を DB に保存しない
//
// 🔴 実在の SNS にも Amazon の証明書にも接続しない（自己生成鍵で署名したフィクスチャを使う）。
import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebhookProcessJob } from '@ses/connectors';

const recordWebhookDelivery = vi.fn();
const markWebhookDeliveryFailed = vi.fn();

vi.mock('@ses/db', () => ({ recordWebhookDelivery, markWebhookDeliveryFailed }));

const { snsStringToSign } = await import('./sns');
const { receiveSesWebhook } = await import('./ses');

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', '..', '..', 'tests', 'fixtures', 'ses');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const TOPIC_ARN = 'arn:aws:sns:ap-northeast-1:100000000001:ses-platform-test-events';
const NOW = new Date('2026-09-05T03:00:05.000Z');

/** フィクスチャを自己生成鍵で署名し直し、生ボディ（文字列）として返す。 */
function signedBody(name: string, overrides: Record<string, unknown> = {}): string {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>;
  const draft = { ...raw, ...overrides };
  const signer = createSign('RSA-SHA1');
  signer.update(snsStringToSign(draft as never), 'utf8');
  signer.end();
  return JSON.stringify({ ...draft, Signature: signer.sign(privateKey, 'base64') });
}

function deps(overrides: Partial<Parameters<typeof receiveSesWebhook>[1]> = {}) {
  return {
    topicArn: TOPIC_ARN,
    loadCertificate: vi.fn(async () => publicKeyPem),
    confirmSubscription: vi.fn(async () => undefined),
    queue: { enqueue: vi.fn(async (job: WebhookProcessJob) => void job) },
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  recordWebhookDelivery.mockReset();
  markWebhookDeliveryFailed.mockReset();
  recordWebhookDelivery.mockResolvedValue({
    deliveryId: '01930000-0000-7000-8000-000000000801',
    duplicate: false,
    processed: false,
  });
});

describe('🔴 署名検証（401 は例外中の例外。docs/05 §6.10）', () => {
  it('正しい署名は 200 で受理される（対照）', async () => {
    const d = deps();
    const outcome = await receiveSesWebhook(signedBody('bounce.notification.json'), d);
    expect(outcome).toEqual({ status: 200, kind: 'ACCEPTED' });
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('🔴 署名が不正なら 401 で、DB に 1 行も書かない', async () => {
    const body = JSON.parse(signedBody('bounce.notification.json')) as Record<string, unknown>;
    body.Signature = Buffer.from('invalid').toString('base64');
    const outcome = await receiveSesWebhook(JSON.stringify(body), deps());
    expect(outcome).toEqual({ status: 401 });
    expect(recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('🔴 別のトピックのメッセージは 401（署名は「Amazon が署名した」ことしか示さない）', async () => {
    const body = signedBody('bounce.notification.json', {
      TopicArn: 'arn:aws:sns:ap-northeast-1:999999999999:someone-elses-topic',
    });
    expect(await receiveSesWebhook(body, deps())).toEqual({ status: 401 });
    expect(recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('🔴 JSON として壊れていても 401（200 で受けて DB をゴミで埋めない）', async () => {
    expect(await receiveSesWebhook('not json', deps())).toEqual({ status: 401 });
  });
});

describe('🔴 保存する payload（docs/05 §3.9 / §16.2）', () => {
  it('🔴 生の宛先アドレスが 1 文字も入らない（ハッシュだけ）', async () => {
    await receiveSesWebhook(signedBody('bounce.notification.json'), deps());
    const saved = JSON.stringify(recordWebhookDelivery.mock.calls[0]?.[0]);
    expect(saved).not.toContain('partner@example.co.jp');
    expect(saved).not.toContain('diagnosticCode');
    expect(recordWebhookDelivery.mock.calls[0]?.[0].payload.recipientHashes).toHaveLength(1);
  });

  it('dedupeKey は ses:{messageId}:{eventType}:{timestamp}（docs/05 §8.5 の表）', async () => {
    await receiveSesWebhook(signedBody('bounce.notification.json'), deps());
    expect(recordWebhookDelivery.mock.calls[0]?.[0].dedupeKey).toBe(
      'ses:0100018f-0000-4000-8000-000000000001:Bounce:2026-09-05T03:00:00.000Z',
    );
  });

  it('苦情も同じ経路で正規化される', async () => {
    const at = deps({ now: () => new Date('2026-09-05T02:05:05.000Z') });
    const outcome = await receiveSesWebhook(signedBody('complaint.notification.json'), at);
    expect(outcome.status).toBe(200);
    expect(recordWebhookDelivery.mock.calls[0]?.[0].payload.eventType).toBe('Complaint');
  });
});

describe('🔴 重複配信（SNS は at-least-once。docs/03 §3.2.5）', () => {
  it('重複かつ**処理済み**なら enqueue しない（処理は 1 回だけ）', async () => {
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: '01930000-0000-7000-8000-000000000801',
      duplicate: true,
      processed: true,
    });
    const d = deps();
    expect(await receiveSesWebhook(signedBody('bounce.notification.json'), d)).toEqual({
      status: 200,
      kind: 'DUPLICATE',
    });
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 重複だが**未処理**なら再 enqueue する（初回の enqueue が落ちた場合の唯一の救い）', async () => {
    // 初回受信で INSERT には成功したが enqueue が一時障害で落ち、SNS が再送した状況。
    // ここで捨てると、そのイベントは**永久に処理されない**（CLAUDE.md §11.1 と同型）。
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: '01930000-0000-7000-8000-000000000801',
      duplicate: true,
      processed: false,
    });
    const d = deps();
    expect(await receiveSesWebhook(signedBody('bounce.notification.json'), d)).toEqual({
      status: 200,
      kind: 'DUPLICATE_REQUEUED',
    });
    expect(d.queue.enqueue).toHaveBeenCalledWith({
      deliveryId: '01930000-0000-7000-8000-000000000801',
    });
  });

  it('🔴 再 enqueue が二重処理にならない（同じ deliveryId であり、処理側が CAS で 1 回に収束する）', async () => {
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: '01930000-0000-7000-8000-000000000801',
      duplicate: true,
      processed: false,
    });
    const enqueue = vi.fn(async (job: WebhookProcessJob) => void job);
    const d = deps({ queue: { enqueue } });
    await receiveSesWebhook(signedBody('bounce.notification.json'), d);
    await receiveSesWebhook(signedBody('bounce.notification.json'), d);

    // 積まれるジョブは常に同じ `deliveryId` である。`webhook.process` は
    // `WebhookDelivery.processedAt` の CAS と `EmailEvent` の 3 列 UNIQUE で冪等であり
    // （`apps/worker/src/jobs/webhook-process.test.ts` が実証）、2 回積まれても処理は 1 回。
    expect(enqueue.mock.calls.map((call) => call[0].deliveryId)).toEqual([
      '01930000-0000-7000-8000-000000000801',
      '01930000-0000-7000-8000-000000000801',
    ]);
    // 🔴 新しい `WebhookDelivery` 行は増えない（`dedupeKey` の UNIQUE）。
    expect(recordWebhookDelivery.mock.calls[0]?.[0].dedupeKey).toBe(
      recordWebhookDelivery.mock.calls[1]?.[0].dedupeKey,
    );
  });
});

describe('🔴 解釈できない通知（docs/05 §8.5「4xx を返さない」）', () => {
  it('200 を返し、未処理として記録する（enqueue しない）', async () => {
    const body = signedBody('bounce.notification.json', { Message: '{"not":"an ses event"}' });
    const d = deps();
    expect(await receiveSesWebhook(body, d)).toEqual({ status: 200, kind: 'UNPARSABLE' });
    expect(d.queue.enqueue).not.toHaveBeenCalled();
    expect(markWebhookDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(markWebhookDeliveryFailed.mock.calls[0]?.[1].failureReason).toBe('PARSE_ERROR');
  });

  it('🔴 解釈できない本文を payload にそのまま保存しない', async () => {
    const body = signedBody('bounce.notification.json', {
      Message: '{"eventType":"Nope","destination":["leak@example.co.jp"]}',
    });
    await receiveSesWebhook(body, deps());
    expect(JSON.stringify(recordWebhookDelivery.mock.calls[0]?.[0])).not.toContain(
      'leak@example.co.jp',
    );
  });
});

describe('🔴 購読確認（docs/05 §6.10）', () => {
  const at = () => deps({ now: () => new Date('2026-09-05T01:00:10.000Z') });

  it('SubscribeURL を叩いて 200 を返す', async () => {
    const d = at();
    const outcome = await receiveSesWebhook(signedBody('subscription-confirmation.json'), d);
    expect(outcome).toEqual({ status: 200, kind: 'SUBSCRIPTION' });
    expect(d.confirmSubscription).toHaveBeenCalledTimes(1);
  });

  it('🔴 Token / SubscribeURL を DB に保存しない（購読を操作できる秘匿値）', async () => {
    await receiveSesWebhook(signedBody('subscription-confirmation.json'), at());
    const saved = JSON.stringify(recordWebhookDelivery.mock.calls[0]?.[0]);
    expect(saved).not.toContain('Token');
    expect(saved).not.toContain('SubscribeURL');
    expect(saved).not.toContain('ConfirmSubscription');
  });

  it('確認に失敗しても 200 を返し、失敗を記録する（SNS が再送する）', async () => {
    const d = at();
    d.confirmSubscription = vi.fn(async () => {
      throw new Error('network');
    });
    expect((await receiveSesWebhook(signedBody('subscription-confirmation.json'), d)).status).toBe(200);
    expect(markWebhookDeliveryFailed.mock.calls[0]?.[1].failureReason).toBe(
      'SUBSCRIPTION_CONFIRM_FAILED',
    );
  });

  it('確認済み（processed）の再送では SubscribeURL を叩き直さない', async () => {
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: '01930000-0000-7000-8000-000000000802',
      duplicate: true,
      processed: true,
    });
    const d = at();
    await receiveSesWebhook(signedBody('subscription-confirmation.json'), d);
    expect(d.confirmSubscription).not.toHaveBeenCalled();
  });

  it('🔴 初回の確認に失敗した後の再送では、もう一度確認する（購読が永久に確立しない事態を避ける）', async () => {
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: '01930000-0000-7000-8000-000000000802',
      duplicate: true,
      processed: false,
    });
    const d = at();
    expect((await receiveSesWebhook(signedBody('subscription-confirmation.json'), d)).status).toBe(200);
    expect(d.confirmSubscription).toHaveBeenCalledTimes(1);
  });
});
