// apps/web/app/api/(main)/data-exports/route.ts
// `POST /api/data-exports`（docs/05 §6.7 #77 / `F-064 AC-5`）。T-10-09。
//
// 🔴 認可: `OWNER` / `ADMIN`（`DATA_EXPORT_ROLES`）。**`requireExecutable` を掛けない** —— 返却は `CLOSING`（実行系が止まる状態）
//    でこそ実行できなければならない（`F-004 AC-8` / `F-064 AC-5`。`tests/static/execute-guard.test.ts` の免除リストに理由つきで載せた）。
//    逆に `CLOSING` 以外では `packages/db` が 422（`DATA_EXPORT_NOT_ALLOWED`）にする。
// 🔴 運営者は到達できない（主平面の `requireTenantCtx`。`F-064 AC-7`）。
// 🔴 監査（`data_export.create`）は `packages/db` が依頼行と同じトランザクションで書く（`withApiRoute` の `audit` ではない）。
import { requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../lib/auth/session';
import { dataExportCreateBodySchema } from '../../../../lib/data-exports/schemas';
import { DATA_EXPORT_ROLES, requestClosingReturn } from '../../../../lib/data-exports/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/data-exports',
    guards: [requireRole(DATA_EXPORT_ROLES)],
    body: dataExportCreateBodySchema,
  },
  async ({ ctx }) => {
    const meta = await readRequestMeta();
    const created = await requestClosingReturn(ctx, { now: () => new Date(), ipAddress: meta.ipAddress });
    return Response.json(created, { status: 202 });
  },
);
