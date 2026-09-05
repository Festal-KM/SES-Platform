// apps/web/app/api/webhooks/ses/route.ts
// `POST /api/webhooks/ses`（docs/05 §6.10 / §8.5 / docs/03 §3.2.5）。T-04-03。**未認証**。
//
// 🔴 応答は **200 か 401 の 2 値だけ**である（docs/05 §6.10 の擬似コード）。
//    成功・失敗にかかわらず 200 を返し、例外は署名検証失敗の 401 のみ。
//    バリデーション失敗で 4xx を返さない —— 400 番台を成功扱いにして再送しないプロバイダがあり、
//    通知が永久に失われる（docs/03 §3.1.5b-4。プロバイダで受信の形を変えない）。
//
// 🔴 `(main)` ルートグループの外に置く（主平面の認証・ミドルウェアに相乗りさせない）。
//    SNS は Cookie もセッションも持たない。認可は署名検証とトピック照合だけである。
//
// 🔴 生ボディで検証する（`request.text()`）。JSON に parse してから再直列化すると
//    キー順・空白が変わり、署名が一致しなくなる。
import { receiveSesWebhook } from '../../../../lib/webhooks/ses';
import { requireWebhookProcessQueue } from '../../../../lib/webhooks/runtime';
import { ensureDbConfigured, sesWebhookRuntime } from '../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  ensureDbConfigured();

  // 🔴 enqueue 先の解決を**副作用より前**に行う（未登録なら 500 → SNS が再送する）。
  //    後ろに置くと、`WebhookDelivery` だけ作られて 2 回目以降が重複扱いになり、
  //    そのイベントは永久に処理されない（`CLAUDE.md` §11.1 と同型の壊れ方）。
  const queue = requireWebhookProcessQueue();
  const { topicArn, loadCertificate, confirmSubscription } = sesWebhookRuntime();

  const rawBody = await request.text();
  const outcome = await receiveSesWebhook(rawBody, {
    topicArn,
    loadCertificate,
    confirmSubscription,
    queue,
    now: () => new Date(),
  });

  // 🔴 本文を返さない（受信側の内部状態を送信元に教えない）。
  return new Response(null, {
    status: outcome.status,
    headers: { 'cache-control': 'no-store' },
  });
}
