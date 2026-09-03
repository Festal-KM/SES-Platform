// apps/web/app/api/(main)/audit-logs/route.ts
// `GET /api/audit-logs`（docs/05 §6.3 #10 / `F-005` / `S-041`）。T-03-05（SP-03）。
//
// 🔴 期間は Zod の必須項目にしているため、未指定は Zod 検証で 400 になる
//    （`apps/web/lib/audit-logs/schemas.ts` 冒頭コメント）。`from > to` は
//    `.refine()` を使わず、ここで明示的に検証する。
// 🔴 `OWNER` / `ADMIN` のみ（docs/05 §6.3 #10「認可」）。読み取り専用のため
//    `requireExecutable` / `requireNotViewer` を掛けない（`CLOSING` でも閲覧はできる。
//    `F-004 AC-8`）。`VIEWER` は `requireRole` の時点で弾かれる。
// 🔴 「監査ログの閲覧」自体は `BR-27` の記録対象に含まれない（docs/05 §16.1）。
//    自己参照の無限ループを避けるため、本ルートは `audit` オプションを使わない。
import { requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { ValidationError } from '../../../../lib/api/errors';
import { listAuditLogs } from '../../../../lib/audit-logs/service';
import { auditLogQuerySchema, isValidAuditLogPeriod } from '../../../../lib/audit-logs/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/audit-logs',
    guards: [requireRole(['OWNER', 'ADMIN'])],
    query: auditLogQuerySchema,
  },
  async ({ ctx, query }) => {
    if (!isValidAuditLogPeriod(query)) throw new ValidationError(['query.from', 'query.to']);
    const page = await listAuditLogs(ctx, query);
    return Response.json(page);
  },
);
