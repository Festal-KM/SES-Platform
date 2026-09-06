// apps/web/lib/webhooks/runtime.ts
// Webhook 受信に要る外部依存の**起動時 DI**（docs/05 §13.1 / `CLAUDE.md` §11.1）。T-04-03。
//
// 🔴 「未登録なら黙って捨てる」を作らない。`webhook.process` の enqueue 先が無い状態で
//    `WebhookDelivery` を INSERT すると、**2 回目以降は重複判定で 200 を返し続け、
//    そのイベントは永久に処理されない**。だから enqueue 先の解決は**副作用の前**に行い、
//    未登録なら例外にする（`account.mail` の `requireAccountMailQueue` と同じ規律）。

import type {
  ScanApplyResultJob,
  ScanApplyResultQueue,
  WebhookProcessJob,
  WebhookProcessQueue,
} from '@ses/connectors';

/** 🔴 enqueue 先が未登録のまま受信しようとした（起動時 DI の失敗）。 */
export class WebhookProcessQueueUnavailableError extends Error {
  constructor() {
    super(
      'webhook.process キューが登録されていません（起動時 DI の失敗）。' +
        '処理されないまま受信を成立させることはできません（CLAUDE.md §11.1 / docs/05 §8.5）。',
    );
    this.name = 'WebhookProcessQueueUnavailableError';
  }
}

let queue: WebhookProcessQueue | null = null;

/** 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。リクエストごとに差し替えない。 */
export function configureWebhookProcessQueue(implementation: WebhookProcessQueue): void {
  queue = implementation;
}

/** 🔴 テスト用の後始末。本番経路からは呼ばない。 */
export function resetWebhookProcessQueue(): void {
  queue = null;
}

/** 🔴 **副作用（`WebhookDelivery` の INSERT）より前に**呼ぶ。 */
export function requireWebhookProcessQueue(): WebhookProcessQueue {
  if (queue === null) throw new WebhookProcessQueueUnavailableError();
  return queue;
}

/**
 * `development` / `demo`（= メールコネクタがモック）で使う保留キュー。
 *
 * 🔴 これは「処理した」ふりをするものではない。`WebhookDelivery.processedAt` は NULL のまま残り、
 *    `A-005`（未処理の Webhook）で見える。**黙って消えない**ことが要点である。
 * 🔴 `production` でこれが選ばれることはない（`bootstrap.ts` が選択の根拠を
 *    `resolveConnectorSelection` に置いており、`production` の email は必ず `real`）。
 *    BullMQ の実キューの配線は SP-07 が `QUEUE_DEFINITIONS` を読んで行う。
 */
export class PendingWebhookProcessQueue implements WebhookProcessQueue {
  private readonly jobs: WebhookProcessJob[] = [];

  async enqueue(job: WebhookProcessJob): Promise<void> {
    this.jobs.push(job);
  }

  /** 積まれた件数（docs/05 §13.2 の `callCount()` と同じ用途）。 */
  callCount(): number {
    return this.jobs.length;
  }

  jobIds(): readonly string[] {
    return this.jobs.map((job) => job.deliveryId);
  }
}

// ---------------------------------------------------------------------------
// `scan.apply-result`（T-05-05。docs/05 §9.6）
// ---------------------------------------------------------------------------
// 🔴 `webhook.process` と**別のキュー**にする（docs/05 §9.6 が別ジョブとして定義している）。
//    1 本に畳むと、スキャン結果の適用とバウンスの記録が同じ再試行・同じ滞留指標に混ざる。

/** 🔴 enqueue 先が未登録のまま受信しようとした（起動時 DI の失敗）。 */
export class ScanApplyResultQueueUnavailableError extends Error {
  constructor() {
    super(
      'scan.apply-result キューが登録されていません（起動時 DI の失敗）。' +
        '処理されないまま受信を成立させることはできません（CLAUDE.md §11.1 / docs/05 §8.5）。',
    );
    this.name = 'ScanApplyResultQueueUnavailableError';
  }
}

let scanQueue: ScanApplyResultQueue | null = null;

/** 🔴 起動時に 1 回だけ呼ぶ（`lib/db/bootstrap.ts`）。 */
export function configureScanApplyResultQueue(implementation: ScanApplyResultQueue): void {
  scanQueue = implementation;
}

/** 🔴 テスト用の後始末。本番経路からは呼ばない。 */
export function resetScanApplyResultQueue(): void {
  scanQueue = null;
}

/** 🔴 **副作用（`WebhookDelivery` の INSERT）より前に**呼ぶ。 */
export function requireScanApplyResultQueue(): ScanApplyResultQueue {
  if (scanQueue === null) throw new ScanApplyResultQueueUnavailableError();
  return scanQueue;
}

/**
 * `development` / `demo` で使う保留キュー（`PendingWebhookProcessQueue` と同じ性質）。
 *
 * 🔴 これは「処理した」ふりをするものではない。`WebhookDelivery.processedAt` は NULL のまま残り、
 *    `A-005`（未処理の Webhook）で見える。**黙って消えない**ことが要点である。
 */
export class PendingScanApplyResultQueue implements ScanApplyResultQueue {
  private readonly jobs: ScanApplyResultJob[] = [];

  async enqueue(job: ScanApplyResultJob): Promise<void> {
    this.jobs.push(job);
  }

  callCount(): number {
    return this.jobs.length;
  }

  jobIds(): readonly string[] {
    return this.jobs.map((job) => job.deliveryId);
  }
}

/**
 * 🔴 SNS の署名証明書を取得する（本番の実装）。
 *
 * URL の検査（https + `sns.{region}.amazonaws.com` + `.pem`）は `assertSigningCertUrl` が
 * 済ませている。ここは取得だけを行い、**リダイレクトを追わない**
 * （追うと検査済みのホストの外へ出られてしまう）。
 */
export async function fetchSigningCertificate(url: URL): Promise<string> {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`署名証明書を取得できませんでした（HTTP ${response.status}）。`);
  return response.text();
}

/** 🔴 購読確認 URL のホスト。`SubscribeURL` も Amazon のホストに限る。 */
const SUBSCRIBE_URL_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

/**
 * 🔴 購読確認（`SubscriptionConfirmation`）。**トピックの照合を済ませた後にだけ呼ぶ。**
 *    ホストも再検査する（`SubscribeURL` は署名対象に含まれるが、防御を 1 枚に頼らない）。
 */
export async function confirmSnsSubscription(subscribeUrl: string): Promise<void> {
  const url = new URL(subscribeUrl);
  if (url.protocol !== 'https:' || !SUBSCRIBE_URL_HOST.test(url.hostname)) {
    throw new Error('SubscribeURL のホストが Amazon SNS ではありません。');
  }
  const response = await fetch(url, { redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`購読確認に失敗しました（HTTP ${response.status}）。`);
}
