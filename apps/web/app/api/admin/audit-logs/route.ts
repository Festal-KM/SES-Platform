// apps/web/app/api/admin/audit-logs/route.ts
// docs/05 §6.9 API-A7 `GET /api/admin/audit-logs`（`F-058` / `A-006`）。認可: `PO`/`PP`（閲覧のみ）。T-11-03。
//
// 🔴 `from` / `to` は必須（docs/03 申し送り 9 / §8.3-3）。Zod の必須項目にしているため未指定は 400。
//    期間の幅は `AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS`（`packages/config`）を超えれば
//    `AuditLogPeriodTooLongError`（400 + 期間短縮の理由キー）。**期間なしの全件検索の経路は無い。**
// 🔴 応答は `searchPlatformAuditLogs`（`@ses/db/platform`）の View のみ。DB の行を直接返さない
//    （docs/05 §5.5 第 2 層）。`summary` は `toPlatformAuditLog` でマスク済み・固定形であり、
//    個人名・メールアドレス・電話番号・本文はここに到達しない（`F-058 AC-1` / `AC-3`）。
// 🔴 `targetId` は載るが、**管理平面に `targetId` から本文・氏名・経歴を引く API は存在しない**
//    （`F-058 AC-2` / `BR-40`。`tests/static/admin-no-content-reach.test.ts` が固定する）。
// 🔴 検索の実行そのものが `AuditLog(admin.audit_log.search)` に残る（`F-058 AC-4`。`withPlatformRead` が
//    ハンドラ本体の前に書く）。`summary` は条件だけで、結果の内容は載せない。
// 🔴 本ファイルは `GET` のみを export する（`BR-37`。`tests/static/admin-tenants-read-only.test.ts`）。
// 🔴 CSV エクスポートは作らない（`docs/04` §A-006 にエクスポートの定義が無い）。エクスポート経路を
//    足す場合も**同じシリアライザ**を通す（別実装にしない）。
import { AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS } from '@ses/config';
import { searchPlatformAuditLogs } from '@ses/db/platform';
import {
  parseAdminAuditLogQuery,
  validateAuditLogPeriod,
} from '../../../../lib/admin-audit-logs/schemas';
import {
  AuditLogPeriodTooLongError,
  errorResponse,
  ValidationError,
} from '../../../../lib/api/errors';
import { searchParamsToObject } from '../../../../lib/api/withApiRoute';
import {
  readPlatformRequestMeta,
  requirePlatformCtx,
} from '../../../../lib/auth/platform-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    // 🔴 認証・認可が先（未認証の呼び出しに query スキーマの形を教えない）。
    const ctx = await requirePlatformCtx();

    const parsed = parseAdminAuditLogQuery(searchParamsToObject(new URL(request.url).searchParams));
    if (!parsed.ok) return errorResponse(new ValidationError(parsed.issues));

    const verdict = validateAuditLogPeriod(parsed.value, AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS);
    if (verdict === 'INVERTED') return errorResponse(new ValidationError(['query.from', 'query.to']));
    if (verdict === 'TOO_LONG') {
      return errorResponse(new AuditLogPeriodTooLongError(AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS));
    }

    const meta = await readPlatformRequestMeta();
    const page = await searchPlatformAuditLogs(
      ctx,
      {
        from: new Date(parsed.value.from),
        to: new Date(parsed.value.to),
        ...(parsed.value.targetTenantId === undefined ? {} : { tenantId: parsed.value.targetTenantId }),
        ...(parsed.value.action === undefined ? {} : { action: parsed.value.action }),
        ...(parsed.value.actorType === undefined ? {} : { actorType: parsed.value.actorType }),
        ...(parsed.value.deviceKind === undefined ? {} : { deviceKind: parsed.value.deviceKind }),
        ...(parsed.value.cursor === undefined ? {} : { cursor: parsed.value.cursor }),
        limit: parsed.value.limit,
      },
      { ipAddress: meta.ipAddress },
    );
    return Response.json(page, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
