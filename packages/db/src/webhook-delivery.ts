// packages/db/src/webhook-delivery.ts
// 🔴 Webhook 受信の共通パイプライン（docs/05 §8.5 / §9.4 / §4.4.2）の DB 側。T-04-03。
//
// 🔴 受信の手順は**固定**である（docs/05 §8.5。プロバイダで変えない）:
//      ① 署名検証 → 失敗なら 401（正当な送信元でないので再送させてよい）
//      ② `dedupeKey` を組み立てて `WebhookDelivery` に INSERT
//         → 一意制約違反なら「処理済み」として 200 を返して終了（冪等）
//      ③ 🔴 **即座に 200 を返す**
//      ④ `webhook.process` を enqueue（処理はそこ）
//    🔴 バリデーション失敗で 4xx を返さない —— 400 番台を成功扱いにして**再送しない**
//    プロバイダがあり、通知が永久に失われる（docs/03 §3.1.5b-4）。
//
// 🔴 `webhook_deliveries` / `email_events` は **C0 SYSTEM_ONLY**（docs/05 §4.4）である。
//    テナントキーを持てない（宛先解決前に届く）ため、`withSystemScope()` からしか触れない。
//    `app.tenant_id` が空の接続でしか行が見えず、テナント文脈では 0 件になる。

import { Prisma } from '@prisma/client';
import type { EmailEventType, WebhookProvider } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { withSystemScope } from './with-tenant.js';

/**
 * 🔴 重複を**例外で検出しない**理由（実測で判明した罠）:
 *
 * PostgreSQL では一意制約違反が起きた時点で**そのトランザクションが中断状態**になり、
 * 以降のクエリはすべて `25P02 current transaction is aborted` で失敗する。
 * 「INSERT を try/catch し、`P2002` なら既存行を SELECT する」は、同一トランザクション内では
 * **必ず失敗する**（重複配信が正常系である本パイプラインでは、そこが常時通る経路になる）。
 * したがって `createMany({ skipDuplicates: true })`（= `ON CONFLICT DO NOTHING`）を使い、
 * **例外を起こさずに 0 件挿入として受け取る**。
 */

/**
 * JSON 列に書ける値。
 * 🔴 Prisma の `InputJsonValue` を呼び出し側（`apps/**`）の型に出さない ——
 *    出すと `@prisma/client` の型を app が参照することになり、`CLAUDE.md` §3.1 の
 *    「生 PrismaClient をアプリコードから import しない」を型の面から緩める。
 */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export type JsonObject = { readonly [key: string]: JsonValue | undefined };

function toPrismaJson(value: JsonObject): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export type WebhookDeliveryRecord = {
  readonly deliveryId: string;
  /** 🔴 `true` = 同じ `dedupeKey` の行が既にある（重複配信）。**異常ではない。** */
  readonly duplicate: boolean;
  /** 既に処理が完了しているか（`processedAt IS NOT NULL`）。 */
  readonly processed: boolean;
};

export type WebhookDeliveryInput = {
  readonly provider: WebhookProvider;
  readonly externalEventId: string | null;
  readonly dedupeKey: string;
  /** 🔴 秘匿値を redact した後の payload だけを渡す（docs/05 §3.9 の列コメント / §16.2）。 */
  readonly payload: JsonObject;
  readonly receivedAt: Date;
};

/**
 * 🔴 受信の記録（docs/05 §8.5 ②）。**同じ `dedupeKey` は 1 行**に収束する。
 *
 * 重複を例外にしない。SNS は at-least-once であり（docs/03 §3.2.5）、重複は**正常系**である。
 * 例外にすると再送のたびに 500 を返し、プロバイダ側の再送が止まらなくなる。
 */
export async function recordWebhookDelivery(
  input: WebhookDeliveryInput,
): Promise<WebhookDeliveryRecord> {
  const id = uuidV7(input.receivedAt);
  return withSystemScope(async (db) => {
    const inserted = await db.webhookDelivery.createMany({
      data: [
        {
          id,
          provider: input.provider,
          externalEventId: input.externalEventId,
          dedupeKey: input.dedupeKey,
          receivedAt: input.receivedAt,
          payload: toPrismaJson(input.payload),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { deliveryId: id, duplicate: false, processed: false };

    const existing = await db.webhookDelivery.findFirst({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true, processedAt: true },
    });
    if (existing === null) {
      // 0 件挿入かつ既存行も見えない ＝ 一意制約以外の理由で消えた。握り潰さない。
      throw new Error(`WebhookDelivery を記録できませんでした（provider=${input.provider}）。`);
    }
    return { deliveryId: existing.id, duplicate: true, processed: existing.processedAt !== null };
  });
}

export type WebhookDeliveryPayload = {
  readonly deliveryId: string;
  readonly provider: WebhookProvider;
  readonly payload: unknown;
  readonly processed: boolean;
};

/** 処理ジョブが `deliveryId` から本体を復元する（payload はジョブに載せない。docs/05 §9.4）。 */
export async function readWebhookDelivery(deliveryId: string): Promise<WebhookDeliveryPayload | null> {
  return withSystemScope(async (db) => {
    const row = await db.webhookDelivery.findFirst({
      where: { id: deliveryId },
      select: { id: true, provider: true, payload: true, processedAt: true },
    });
    if (row === null) return null;
    return {
      deliveryId: row.id,
      provider: row.provider as WebhookProvider,
      payload: row.payload,
      processed: row.processedAt !== null,
    };
  });
}

/**
 * 🔴 処理完了の CAS（docs/05 §9.4「`WebhookDelivery.dedupeKey` の `UNIQUE` + `processedAt` の CAS」）。
 *
 * `false` = 既に他の実行が完了させている。**再処理しない**（重複配信で 2 回処理すると
 * `EmailEvent` の重複や状態の二重遷移につながる）。
 */
export async function markWebhookDeliveryProcessed(
  deliveryId: string,
  processedAt: Date,
): Promise<boolean> {
  return withSystemScope(async (db) => {
    const updated = await db.webhookDelivery.updateMany({
      where: { id: deliveryId, processedAt: null },
      data: { processedAt, processFailedAt: null, failureReason: null },
    });
    return updated.count === 1;
  });
}

/**
 * 処理の失敗を記録する（docs/05 §8.5「処理の失敗は `processFailedAt` に記録し `A-005` で拾う」）。
 * 🔴 `processedAt` は立てない（未処理のまま残し、監視で拾えるようにする）。
 */
export async function markWebhookDeliveryFailed(
  deliveryId: string,
  input: { readonly failedAt: Date; readonly failureReason: string },
): Promise<void> {
  await withSystemScope(async (db) => {
    await db.webhookDelivery.updateMany({
      where: { id: deliveryId, processedAt: null },
      data: { processFailedAt: input.failedAt, failureReason: input.failureReason },
    });
  });
}

export type EmailEventInput = {
  /** 宛先が解決できていないことが普通なので nullable（docs/05 §3.9 の列コメント）。 */
  readonly tenantId: string | null;
  readonly sesMessageId: string;
  readonly eventType: EmailEventType;
  readonly occurredAt: Date;
  /** 🔴 宛先はハッシュ化済みであること（docs/05 §16.2）。生アドレスを渡さない。 */
  readonly payload: JsonObject;
};

/**
 * 🔴 バウンス・苦情の記録（docs/05 §3.9 / docs/03 §3.2.5）。
 *
 * `UNIQUE(sesMessageId, eventType, occurredAt)` により、**at-least-once の重複配信でも 1 行**。
 * 🔴 順序が逆転して古いイベントが後から届いても、既存行を上書きしない（`DO NOTHING` 相当）。
 *    上書きすると「新しい情報が古い情報で潰される」（docs/05 §8.5 の DocuSign と同じ問題）。
 *
 * @returns 新規に記録したら `true`、既に同じイベントがあったら `false`。
 */
export async function recordEmailEvent(input: EmailEventInput): Promise<boolean> {
  return withSystemScope(async (db) => {
    const inserted = await db.emailEvent.createMany({
      data: [
        {
          id: uuidV7(input.occurredAt),
          tenantId: input.tenantId,
          sesMessageId: input.sesMessageId,
          eventType: input.eventType,
          occurredAt: input.occurredAt,
          payload: toPrismaJson(input.payload),
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 1;
  });
}
