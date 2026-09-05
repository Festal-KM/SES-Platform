// apps/worker/src/jobs/webhook-process.ts
// `webhook.process`（docs/05 §8.5 / §9.4）。T-04-03 は `ses`（バウンス・苦情）だけを扱う。
//
// 🔴 冪等性は 2 段（docs/05 §9.4）:
//    ① `WebhookDelivery.processedAt` の **CAS** —— 重複配信で 2 回処理しない
//    ② `EmailEvent(sesMessageId, eventType, occurredAt)` の **`UNIQUE`** ——
//       ①をすり抜けた並行実行でも行は 1 つ
//    🔴 SNS は at-least-once であり、重複と**順序逆転**が起こる（docs/03 §3.2.5）。
//       順序逆転は「後から来た古いイベントで既存行を上書きしない」ことで無害化する
//       （`recordEmailEvent` は既存行があれば何もしない）。
//
// 🔴 処理の失敗は `processFailedAt` に記録し、`A-005` で拾う（docs/05 §8.5）。
//    受信そのものは既に 200 を返しているので、ここでの失敗は再送を引き起こさない。
import { parseNormalizedEmailEvent, SesEventParseError } from '@ses/connectors';
import {
  markWebhookDeliveryFailed,
  markWebhookDeliveryProcessed,
  readWebhookDelivery,
  recordEmailEvent,
} from '@ses/db';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const WEBHOOK_PROCESS_JOB = 'webhook.process';

export type WebhookProcessOutcome =
  | { readonly kind: 'PROCESSED'; readonly recorded: boolean }
  /** 既に他の実行が完了させている（重複配信の正常系）。 */
  | { readonly kind: 'ALREADY_PROCESSED' }
  /** 本タスクの射程外のプロバイダ（`guardduty` / `docusign` / `stripe`）。 */
  | { readonly kind: 'UNSUPPORTED_PROVIDER'; readonly provider: string }
  | { readonly kind: 'FAILED'; readonly failureReason: string };

export function parseWebhookProcessPayload(raw: unknown): { readonly deliveryId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(WEBHOOK_PROCESS_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return { deliveryId: requireUuid(WEBHOOK_PROCESS_JOB, 'deliveryId', record.deliveryId) };
}

export type WebhookProcessDeps = {
  readonly now: () => Date;
};

export type WebhookProcessHandler = (payload: unknown, jobId: string) => Promise<WebhookProcessOutcome>;

export function createWebhookProcessHandler(deps: WebhookProcessDeps): WebhookProcessHandler {
  return async (payload) => {
    const { deliveryId } = parseWebhookProcessPayload(payload);
    const delivery = await readWebhookDelivery(deliveryId);
    if (delivery === null) {
      throw new InvalidJobPayloadError(WEBHOOK_PROCESS_JOB, 'deliveryId に対応する行がありません');
    }
    if (delivery.processed) return { kind: 'ALREADY_PROCESSED' };

    if (delivery.provider !== 'ses') {
      // 🔴 未対応でも `processedAt` を立てない。立てると「処理したことにして捨てた」になる。
      //    各プロバイダを実装するタスクが分岐を足すまで、未処理として `A-005` に見える。
      return { kind: 'UNSUPPORTED_PROVIDER', provider: delivery.provider };
    }

    const now = deps.now();
    try {
      // 🔴 `WebhookDelivery.payload` には**正規化済み**の形しか入っていない（受信時に
      //    `normalizeSesEvent` を通してある。docs/05 §3.9「秘匿値は redact 後に保存」）。
      //    ここで生の SES 応答を解釈することは無く、宛先アドレスはそもそも DB に存在しない。
      const event = parseNormalizedEmailEvent(delivery.payload);
      const recorded = await recordEmailEvent({
        // 🔴 宛先からテナントを引き当てる経路はまだ無い（テナント別サプレッションを実装する
        //    SP-11 が `sesMessageId` → `EmailDispatch` の突合を足す）。それまでは null。
        //    🔴 推測で埋めない —— 誤ったテナントに他社のバウンスが計上される。
        tenantId: null,
        sesMessageId: event.sesMessageId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        payload: {
          recipientHashes: [...event.recipientHashes],
          diagnostics: event.diagnostics,
        },
      });

      // 🔴 CAS。`false` は他の実行が先に完了させたということであり、失敗ではない。
      const claimed = await markWebhookDeliveryProcessed(deliveryId, now);
      return claimed ? { kind: 'PROCESSED', recorded } : { kind: 'ALREADY_PROCESSED' };
    } catch (error) {
      const failureReason =
        error instanceof SesEventParseError ? 'PARSE_ERROR' : 'PROCESS_ERROR';
      await markWebhookDeliveryFailed(deliveryId, { failedAt: now, failureReason });
      // 🔴 解釈できない payload を再試行しても直らない（`attempts` を空撃ちしない）。
      if (error instanceof SesEventParseError) return { kind: 'FAILED', failureReason };
      throw error;
    }
  };
}
