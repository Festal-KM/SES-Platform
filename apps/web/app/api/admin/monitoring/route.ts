// apps/web/app/api/admin/monitoring/route.ts
// docs/05 §6.9 API-A8 `GET /api/admin/monitoring`（`F-059` / `A-005`）。認可: `PO`/`PP`（閲覧のみ）。T-11-04。
//
// 🔴 項目ごとに独立して返す（1 項目の材料が取れなくても他の項目は返る。各項目は `{ ok: true, … } | { ok: false, errorKind }`）。
// 🔴 応答は件数・状態・エラー種別・日時・不透明な ID だけ（`F-059 AC-3` / `BR-40`）。本文・氏名・スキルシート内容・
//    DKIM トークン・宛先・ジョブの payload はフィールドとして存在しない（`apps/web/lib/admin-monitoring/view.ts`）。
// 🔴 保留（項目 12 の `AI_COST_LIMIT_HELD` / 13 / 14 / 15）は障害ではなく、項目 1 / 3 / 5 のどれにも加算されない
//    （`F-059 AC-6` / `AC-7`。各材料の集計がそれぞれ `state='SUBMIT_FAILED'` / BullMQ の failed / `execution='DONE'` だけを数える）。
// 🔴 読み取りそのものが材料ごとに `AuditLog(admin.monitoring.view)` に残る（`withPlatformRead` がクエリの前に書く。`summary.item`
//    で材料を区別する）。
// 🔴 本ファイルは `GET` のみを export する（`BR-37`。運営者コンソールは read-only。再送 / retry / 再実行の API は無い。
//    `tests/static/admin-no-gate-retry.test.ts` ⑤）。
// 🔴 `process.env` を読まない。閾値・上限・Redis / 送信基盤の口は `monitoringRuntime()`（起動時 DI）から受ける。
import { buildMonitoringSnapshot, type MonitoringFailureSink } from '../../../../lib/admin-monitoring/snapshot';
import { errorResponse } from '../../../../lib/api/errors';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../lib/auth/platform-session';
import { monitoringRuntime } from '../../../../lib/db/bootstrap';
import { createMonitoringReaders } from './_lib/readers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 材料の読み取り失敗は応答に**種別だけ**を載せ、原因はサーバ側のログへ流す（握り潰さない。docs/05 §16.3「Sentry と併用」）。
 *    ログに載せるのは項目名・種別・例外の名前とメッセージだけ（トークン・本文が入る経路は無い）。
 */
const reportMonitoringFailure: MonitoringFailureSink = (kind, errorKind, error) => {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[admin.monitoring] ${kind} ${errorKind} ${detail}`);
};

export async function GET(): Promise<Response> {
  try {
    // 🔴 認証・認可が先（未認証の呼び出しに応答の形を教えない）。
    const ctx = await requirePlatformCtx();
    const meta = await readPlatformRequestMeta();
    const now = new Date();
    const readers = createMonitoringReaders(ctx, monitoringRuntime(), { ipAddress: meta.ipAddress, now });
    const snapshot = await buildMonitoringSnapshot(readers, now, reportMonitoringFailure);
    return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
