// apps/web/app/api/webhooks/guardduty/route.ts
// `POST /api/webhooks/guardduty`（docs/05 §6.10 / §8.5 / docs/03 §3.4）。T-05-05。**未認証**。
//
// 🔴 応答は **200 か 401 の 2 値だけ**である（docs/05 §6.10 の擬似コード）。
//    成功・失敗にかかわらず 200 を返し、例外は署名検証失敗の 401 のみ。
//    バリデーション失敗で 4xx を返さない（docs/05 §8.5 の 🔴）。
//
// 🔴 `(main)` ルートグループの外に置く（主平面の認証・ミドルウェアに相乗りさせない）。
//    送信元は Cookie もセッションも持たない。認可は HMAC 署名の検証だけである。
//
// 🔴 生ボディで検証する（`request.text()`）。JSON に parse してから再直列化すると
//    キー順・空白が変わり、署名が一致しなくなる。
import { receiveGuardDutyWebhook } from '../../../../lib/webhooks/guardduty';
import { requireScanApplyResultQueue } from '../../../../lib/webhooks/runtime';
import { ensureDbConfigured, guardDutyWebhookRuntime } from '../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  ensureDbConfigured();

  // 🔴 enqueue 先の解決を**副作用より前**に行う（未登録なら 500 → 送信側が再送する）。
  //    後ろに置くと、`WebhookDelivery` だけ作られて 2 回目以降が重複扱いになり、
  //    そのスキャン結果は永久に処理されない（`CLAUDE.md` §11.1 と同型の壊れ方）。
  const queue = requireScanApplyResultQueue();
  const { secrets, bucket } = guardDutyWebhookRuntime();

  const rawBody = await request.text();
  const outcome = await receiveGuardDutyWebhook(rawBody, request.headers, {
    secrets,
    bucket,
    queue,
    now: () => new Date(),
  });

  // 🔴 本文を返さない（受信側の内部状態を送信元に教えない）。
  return new Response(null, {
    status: outcome.status,
    headers: { 'cache-control': 'no-store' },
  });
}
