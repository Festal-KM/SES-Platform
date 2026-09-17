// apps/web/app/api/admin/usage/route.ts
// docs/05 §6.9 API-A6 `GET /api/admin/usage`（`F-057` / `F-063 AC-5` / `A-004`）。認可: `PO`/`PP`（閲覧のみ）。T-11-02。
//
// 🔴 応答は**件数と金額（USD）の両方 + 消費率 + 2 つの倍率**（docs/03 §7.6.3-2 / `CLAUDE.md` §2 課金「運営者には金額と件数の両方」）。
//    金額が現れるのは管理平面（API-A6 / API-A15）だけであり、主平面の `GET /api/usage` には 1 つも無い（`F-027 AC-6`。
//    `apps/web/lib/usage/view.types.test.ts` が固定）。**この応答の型を主平面へ写さない。**
// 🔴 環境全体の当月 AI 支出 / tier 上限（`environment`）はテナント行（`items`）と**別の集計・別の行**である
//    （T-11-08 の申し送り ①。環境枠の到達をテナントの上限到達と混同させない）。
// 🔴 抽出 `?filter=low|high`（`F-057 AC-1`「消化率が常に低い / 上限に張り付く」）。帯の判定は `@ses/db/platform`
//    （`classifyConsumptionBand`。閾値 = `QUOTA_LOW_CONSUMPTION_PERCENT` / `QUOTA_WARNING_THRESHOLD_PERCENT`）。
// 🔴 読み取りは `readPlatformUsage` が **1 回の `withPlatformRead`（`admin.usage.view`）** で行い、閲覧そのものが
//    `AuditLog` に残る（T-11-08 の申し送り ③「1 画面 1 行」）。
// 🔴 応答に利用者名・メール・エンジニア・案件・提案・本文・`ai_usage` の対象は無い（`BR-40`。結合テストが JSON の不在を固定）。
// 🔴 本ファイルは `GET` のみを export する（`BR-37`。書き込みは `PUT /api/admin/tenants/{id}/quota` だけ）。
// 🔴 `process.env` を読まない。上限・既定値・閾値は `adminUsageRuntime()`（起動時 DI）から受ける。
import { readPlatformUsage } from '@ses/db/platform';
import { parseAdminUsageQuery } from '../../../../lib/admin-usage/schemas';
import { toAdminUsageView } from '../../../../lib/admin-usage/view';
import { errorResponse, ValidationError } from '../../../../lib/api/errors';
import { searchParamsToObject } from '../../../../lib/api/withApiRoute';
import { readPlatformRequestMeta, requirePlatformCtx } from '../../../../lib/auth/platform-session';
import { adminUsageRuntime } from '../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    // 🔴 認証・認可が先（未認証の呼び出しに応答の形を教えない）。
    const ctx = await requirePlatformCtx();

    const parsed = parseAdminUsageQuery(searchParamsToObject(new URL(request.url).searchParams));
    if (!parsed.ok) return errorResponse(new ValidationError(parsed.issues));

    const meta = await readPlatformRequestMeta();
    const settings = adminUsageRuntime();
    const snapshot = await readPlatformUsage(ctx, {
      ipAddress: meta.ipAddress,
      now: new Date(),
      warnPercent: settings.warnPercent,
      defaults: settings.defaults,
      aiDailyCostLimitUsd: settings.aiDailyCostLimitUsd,
      aiMonthlyCostCapUsd: settings.aiMonthlyCostCapUsd,
      providerCapUsd: settings.providerCapUsd,
    });
    return Response.json(toAdminUsageView(snapshot, parsed.value.filter), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
