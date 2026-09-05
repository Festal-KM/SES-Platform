// packages/connectors/src/webhooks/process.ts
// `webhook.process` の payload（docs/05 §9.4 / §8.5）。T-04-03。
//
// 🔴 受信は「検証 → `WebhookDelivery` に INSERT → 200 → enqueue」で固定される（docs/05 §8.5）。
//    したがって payload に載るのは **`deliveryId` だけ**である。生ボディを payload に載せると
//    ①Redis に redact 前の外部応答が残り ②「DB の行が正」という前提が壊れ、
//    重複配信の判定（`dedupeKey` の `UNIQUE` + `processedAt` の CAS）が意味を失う。

/** `POST /api/webhooks/{provider}` を受けた後に積むジョブ（docs/05 §9.4）。 */
export type WebhookProcessJob = {
  readonly deliveryId: string;
};

/** enqueue の実装（BullMQ / 保留キュー）が満たす契約。 */
export type WebhookProcessQueue = {
  enqueue(job: WebhookProcessJob): Promise<void>;
};
