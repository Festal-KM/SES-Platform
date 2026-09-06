// packages/connectors/src/scan/jobs.ts
// `scan.apply-result` / `scan.poll` の名前と payload（docs/05 §9.6）。T-05-05。
//
// 🔴 `webhooks/process.ts`（`webhook.process`）と**同じ形**である: payload に載るのは
//    `deliveryId` だけであり、生ボディも正規化結果も載せない（docs/05 §9.4 の理由がそのまま
//    当てはまる —— Redis に外部応答が残らず、「DB の行が正」という前提が保たれる）。
//
// 🔴 なぜ `guardduty` の受信が `webhook.process` ではなく `scan.apply-result` を積むのか:
//    docs/05 §9.6 が **`scan.apply-result`（payload `{ deliveryId }`）** をスキャン結果の
//    処理ジョブとして定義しているためである（§8.5 の「処理ジョブを enqueue」の実体が
//    プロバイダごとに違う）。1 本のキューに畳むと、`FileScanResult` の適用と
//    `EmailEvent` の記録が同じ再試行・同じ滞留指標の中に混ざる。

/** `POST /api/webhooks/guardduty` を受けた後に積むジョブ（docs/05 §9.6）。 */
export const SCAN_APPLY_RESULT_JOB = 'scan.apply-result';

/** 滞留の保険（毎 5 分。docs/05 §8.5 / §9.6）。 */
export const SCAN_POLL_JOB = 'scan.poll';

export type ScanApplyResultJob = {
  readonly deliveryId: string;
};

/** enqueue の実装（BullMQ / 保留キュー）が満たす契約。 */
export type ScanApplyResultQueue = {
  enqueue(job: ScanApplyResultJob): Promise<void>;
};
