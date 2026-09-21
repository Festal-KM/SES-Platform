// apps/web/app/api/(main)/audit-logs/export/route.ts
// `GET /api/audit-logs/export`（docs/05 §6.3 #10b / §6.4「CSV エクスポート」行 / `F-005` / `S-041` セクション 4）。T-12-18 ⑪。
//
// 🔴 認可は #10 と同じ `requireRole(['OWNER', 'ADMIN'])`（`VIEWER` はダウンロード不可 = `CLAUDE.md` §1.2。取引先ロールは到達しない）。
//    読み取り専用のため `requireExecutable` / `requireNotViewer` を掛けない（`CLOSING` でも可。`F-004 AC-8`）。
// 🔴 読み出しは #10 と同じ `listAuditLogs` を内部的に追う（`collectAuditLogsForExport`。境界・期間・カテゴリの判定が 1 実装）。
//    上限 `AUDIT_LOG_EXPORT_MAX_ROWS`（`packages/config`）を超える母集団は 400 `AUDIT_LOG_EXPORT_TOO_LARGE`（期間短縮を促す）。
// 🔴 CSV は `auditLogsToCsv`（6 列固定。行の詳細の列は無い。`encodeCsv` の無害化を共用）。本ファイルは行の詳細に相当する識別子を
//    持たない（`tests/static/audit-detail-single-path.test.ts` の CSV 検査）。
// 🔴 監査: 実行のたびに `audit_log.export`（`USER`。1 エクスポート 1 行）を `recordAuditLogExport`（`packages/db`。`writeAuditLog` を
//    テナントトランザクションの中で呼ぶ）で記録する。`withApiRoute` の `audit` オプションは使わない —— 400 で弾いた要求は
//    「エクスポートが行われていない」ため残さない（docs/05 §16.1）。記録できなければ CSV を返さない（例外 → 500）。
import { AUDIT_LOG_EXPORT_MAX_ROWS } from '@ses/config';
import { recordAuditLogExport } from '@ses/db';
import { AuditLogExportTooLargeError, ValidationError } from '../../../../../lib/api/errors';
import { requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { AUDIT_LOG_CSV_CONTENT_TYPE, auditLogsToCsv } from '../../../../../lib/audit-logs/csv';
import { collectAuditLogsForExport } from '../../../../../lib/audit-logs/export';
import { auditLogCsvFileName } from '../../../../../lib/audit-logs/export-href';
import { auditLogExportQuerySchema, isValidAuditLogPeriod } from '../../../../../lib/audit-logs/schemas';
import { readRequestMeta } from '../../../../../lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/audit-logs/export',
    guards: [requireRole(['OWNER', 'ADMIN'])],
    query: auditLogExportQuerySchema,
  },
  async ({ ctx, query }) => {
    if (!isValidAuditLogPeriod(query)) throw new ValidationError(['query.from', 'query.to']);
    const collected = await collectAuditLogsForExport(ctx, query, { maxRows: AUDIT_LOG_EXPORT_MAX_ROWS });
    if (collected.kind === 'TOO_LARGE') throw new AuditLogExportTooLargeError(collected.maxRows);

    const csv = auditLogsToCsv(collected.items);
    const meta = await readRequestMeta();
    // 🔴 記録が先、応答が後（記録できなければファイルは出ない）。Phase 1 は上限超過を 400 で弾くため `truncated` は常に false。
    await recordAuditLogExport(ctx, { rowCount: collected.items.length, truncated: false }, { ipAddress: meta.ipAddress });

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': AUDIT_LOG_CSV_CONTENT_TYPE,
        'content-disposition': `attachment; filename="${auditLogCsvFileName(query)}"`,
      },
    });
  },
);
