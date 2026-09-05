// apps/web/lib/webhooks/ses.ts
// 🔴 `POST /api/webhooks/ses` の本体（docs/05 §8.5 / §6.10 / docs/03 §3.2.5）。T-04-03。
//
// ============================================================================
// 🔴 受信の手順は固定である（docs/05 §8.5）。順序を変えない
// ============================================================================
//   ① 署名検証（SNS）→ 失敗なら **401**（正当な送信元でないので再送させてよい）
//   ② `dedupeKey` を組み立てて `WebhookDelivery` に INSERT
//      → 一意制約違反なら「処理済み」として **200** を返して終了（冪等）
//   ③ 🔴 **即座に 200 を返す**
//   ④ `webhook.process` を enqueue（処理はそこ）
//
// 🔴 **バリデーション失敗で 4xx を返さない**（docs/03 §3.1.5b-4）。400 番台を成功扱いにして
//    再送しないプロバイダがあり、通知が永久に失われる。例外は署名検証失敗の 401 だけである。
//
// 🔴 **保存する payload は正規化済み**である（docs/05 §3.9「秘匿値は redact 後に保存」/ §16.2）。
//    生の SES イベントには宛先アドレスが入っており、そのまま保存すると運営者の監査ログ横断検索
//    （`A-006`）や Sentry からエンドユーザーの PII に到達できてしまう（`CLAUDE.md` §10.5）。
//    宛先はここでハッシュにしてから DB へ渡す。
//
// 🔴 **トピックの固定**（`SES_EVENT_TOPIC_ARN`）: 署名検証は「Amazon が署名したこと」しか
//    証明しない。トピックは誰でも作れるため、受け入れるトピックを設定で固定しなければ、
//    第三者が自分のトピックへ本エンドポイントを購読させて任意のイベントを流し込める。

import {
  normalizeSesEvent,
  serializeNormalizedEmailEvent,
  SesEventParseError,
  sesWebhookDedupeKey,
  type WebhookProcessQueue,
} from '@ses/connectors';
import { markWebhookDeliveryFailed, recordWebhookDelivery } from '@ses/db';
import {
  parseSnsMessage,
  SnsSignatureError,
  verifySnsMessage,
  type SigningCertificateLoader,
  type SnsMessage,
} from './sns';

/**
 * ルートが返す HTTP の結果（🔴 200 か 401 の 2 値しかない）。
 *
 * - `ACCEPTED`: 新規受信 → enqueue した
 * - `DUPLICATE_REQUEUED`: 🔴 **重複配信だが未処理**（前回 enqueue まで到達していない）→ **再 enqueue した**
 * - `DUPLICATE`: 重複配信かつ処理済み → 何もしない
 * - `UNPARSABLE`: 解釈できなかった（未処理として記録。`A-005` が拾う）
 * - `SUBSCRIPTION`: 購読確認 / 解除確認
 */
export type SesWebhookOutcome =
  | {
      readonly status: 200;
      readonly kind: 'ACCEPTED' | 'DUPLICATE_REQUEUED' | 'DUPLICATE' | 'UNPARSABLE' | 'SUBSCRIPTION';
    }
  | { readonly status: 401 };

export type SesWebhookDeps = {
  /** 🔴 受け入れる SNS トピック（`SES_EVENT_TOPIC_ARN`）。 */
  readonly topicArn: string;
  readonly loadCertificate: SigningCertificateLoader;
  /**
   * 🔴 購読確認（`SubscriptionConfirmation`）の `SubscribeURL` を叩く（docs/05 §6.10）。
   *    トピックを固定しているので自動確認してよい。固定が無ければ自動確認は脆弱性になる。
   */
  readonly confirmSubscription: (subscribeUrl: string) => Promise<void>;
  readonly queue: WebhookProcessQueue;
  readonly now: () => Date;
};

/**
 * 🔴 受信の全体（署名検証 → 記録 → enqueue）。
 *
 * 🔴 **「解釈できない」で例外にしない**（200 + 未処理として記録し、`A-005` が拾う）。
 *    一方で **DB や enqueue の失敗はそのまま投げる** —— 記録できていない以上、200 を返して
 *    「受け取った」ことにしてはならない。500 を返せば SNS が再送するので通知は失われない。
 *    この 2 つを混ぜないことが要点である。
 */
export async function receiveSesWebhook(rawBody: string, deps: SesWebhookDeps): Promise<SesWebhookOutcome> {
  let message: SnsMessage;
  try {
    message = parseSnsMessage(rawBody);
    // 🔴 トピックの照合は署名検証の前に置く（他人のトピックの証明書を取りに行かない）。
    if (message.TopicArn !== deps.topicArn) throw new SnsSignatureError('TopicArn が一致しません');
    await verifySnsMessage(message, { loadCertificate: deps.loadCertificate, now: deps.now });
  } catch (error) {
    if (error instanceof SnsSignatureError) return { status: 401 };
    throw error;
  }

  if (message.Type === 'SubscriptionConfirmation' || message.Type === 'UnsubscribeConfirmation') {
    return handleSubscription(message, deps);
  }
  return handleNotification(message, deps);
}

/**
 * 購読確認。
 * 🔴 `WebhookDelivery.payload` に `Token` / `SubscribeURL` を**保存しない**（どちらも
 *    購読を操作できる秘匿値であり、`packages/config` の denylist の `token` と同じ扱い）。
 */
async function handleSubscription(message: SnsMessage, deps: SesWebhookDeps): Promise<SesWebhookOutcome> {
  const receivedAt = deps.now();
  const record = await recordWebhookDelivery({
    provider: 'ses',
    externalEventId: message.MessageId,
    dedupeKey: `ses:subscription:${message.MessageId}`,
    payload: { type: message.Type, topicArn: message.TopicArn, snsMessageId: message.MessageId },
    receivedAt,
  });

  // 🔴 判断材料は `duplicate` ではなく `processed`（通知側と同じ理由）。初回の確認が
  //    ネットワーク障害で落ちた場合、SNS は購読確認を再送する —— そのとき「重複だから」で
  //    捨てると、購読が永久に確立しない。`ConfirmSubscription` は冪等である。
  if (message.Type === 'SubscriptionConfirmation' && message.SubscribeURL !== undefined && !record.processed) {
    try {
      await deps.confirmSubscription(message.SubscribeURL);
    } catch {
      // 🔴 確認に失敗しても 200 を返す（SNS が再送する）。失敗の事実だけ残す。
      await markWebhookDeliveryFailed(record.deliveryId, {
        failedAt: receivedAt,
        failureReason: 'SUBSCRIPTION_CONFIRM_FAILED',
      });
    }
  }
  return { status: 200, kind: 'SUBSCRIPTION' };
}

async function handleNotification(message: SnsMessage, deps: SesWebhookDeps): Promise<SesWebhookOutcome> {
  const receivedAt = deps.now();

  let inner: unknown;
  try {
    inner = JSON.parse(message.Message);
  } catch {
    inner = null;
  }

  let event;
  try {
    event = normalizeSesEvent(inner);
  } catch (error) {
    if (!(error instanceof SesEventParseError)) throw error;
    // 🔴 解釈できなくても 200 を返し、**未処理として記録する**（`A-005` が拾う）。
    //    payload には SNS の識別子だけを残す（生の本文には宛先が含まれうる）。
    const record = await recordWebhookDelivery({
      provider: 'ses',
      externalEventId: message.MessageId,
      dedupeKey: `ses:unparsable:${message.MessageId}`,
      payload: { snsMessageId: message.MessageId, topicArn: message.TopicArn, unparsable: true },
      receivedAt,
    });
    if (!record.duplicate) {
      await markWebhookDeliveryFailed(record.deliveryId, {
        failedAt: receivedAt,
        failureReason: 'PARSE_ERROR',
      });
    }
    return { status: 200, kind: 'UNPARSABLE' };
  }

  const record = await recordWebhookDelivery({
    provider: 'ses',
    externalEventId: event.sesMessageId,
    // 🔴 `ses:{messageId}:{eventType}:{timestamp}`（docs/05 §8.5 の表）。
    //    SNS の再送は同じ 3 要素になるので 1 行に収束し、別のバウンスは別の行になる。
    dedupeKey: sesWebhookDedupeKey(event),
    payload: serializeNormalizedEmailEvent(event),
    receivedAt,
  });

  // 🔴 「重複配信だから何もしない」にしない（iteration 2 の修正）。
  //    初回受信で INSERT に成功した直後に enqueue が一時障害で落ちると 500 になり、SNS が再送する。
  //    そのとき `duplicate` だけを見て捨てると、**そのイベントは永久に処理されない**
  //    （`CLAUDE.md` §11.1 と同型の壊れ方）。判断材料は `processedAt` の有無である。
  //    🔴 二重 enqueue は無害である —— `webhook.process` は `processedAt` の CAS と
  //    `EmailEvent` の 3 列 `UNIQUE` で冪等だからである（docs/05 §9.4）。
  if (record.duplicate && record.processed) return { status: 200, kind: 'DUPLICATE' };

  await deps.queue.enqueue({ deliveryId: record.deliveryId });
  return { status: 200, kind: record.duplicate ? 'DUPLICATE_REQUEUED' : 'ACCEPTED' };
}
