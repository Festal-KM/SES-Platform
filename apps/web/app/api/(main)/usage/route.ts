// apps/web/app/api/(main)/usage/route.ts
// docs/05 §6.7 #69 `GET /api/usage`（`F-026` / `F-027` / `S-038`）。T-10-03。
//
// 🔴 **ホストロールのみ**（#69「ホストロールのみ」/ `F-027 AC-1`）。残量・上限値・リセット時刻は
//    テナントの契約情報であり、パートナー所属ロール（`PARTNER_ADMIN` / `PARTNER_SALES`）には返さない。
//    ガードは `requireRole`（ルート）と `requireHost`（`readUsageView`）の二重。パートナーが直接呼ぶと 403。
// 🔴 応答 `UsageView` に金額（USD）の項目は無い（`F-027 AC-6`。`lib/usage/view.ts`）。
// 🔴 閲覧のみのルートであり `requireExecutable` を掛けない（`CLOSING` でも残量は見られる）。
import { requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readUsageView } from '../../../../lib/usage/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/usage',
    guards: [requireRole(['OWNER', 'ADMIN', 'SALES', 'VIEWER'])],
  },
  async ({ ctx }) => Response.json(await readUsageView(ctx, new Date())),
);
