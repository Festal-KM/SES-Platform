// apps/web/app/api/(main)/data-exports/[id]/download-url/route.ts
// `GET /api/data-exports/{id}/download-url`（docs/05 §6.7 #78 / §14.2「返却データ … 3600 秒」/ `F-064 AC-5` / `AC-7` / `AC-8`）。T-10-09。
//
// 🔴 署名は `issueDownloadUrl`（docs/05 §14.2 が定める唯一の発行経路）の内側。監査（`data_export.download`）が commit された
//    後にしか署名しない。このルートに条件式は無い（`READY` / 期限 / 404 の判定はサービス層）。
// 🔴 `requireExecutable` を掛けない（#77 と同じ理由）。運営者は到達できない（`F-064 AC-7`）。
import { requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { dataExportParamsSchema } from '../../../../../../lib/data-exports/schemas';
import { DATA_EXPORT_ROLES, issueClosingReturnDownloadUrl } from '../../../../../../lib/data-exports/service';
import { objectStore } from '../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/data-exports/{id}/download-url',
    guards: [requireRole(DATA_EXPORT_ROLES)],
    params: dataExportParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const ticket = await issueClosingReturnDownloadUrl(ctx, params.id, {
      objectStore: objectStore(),
      now: () => new Date(),
      ipAddress: meta.ipAddress,
    });
    return Response.json(ticket);
  },
);
