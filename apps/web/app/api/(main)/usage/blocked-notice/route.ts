// apps/web/app/api/(main)/usage/blocked-notice/route.ts
// docs/05 §6.7 #70 `GET /api/usage/blocked-notice`（`F-027 AC-1`）。T-10-03。
//
// 🔴 **全ロール**（パートナーはこちらのみ）。返すのは「停止の事実と理由」（`{ blocked, reasonKey }`）だけで、
//    残量・上限値・リセット時刻・停止に入った時刻を**型として持たない**（`BR-04` の第二境界 /
//    `F-027 AC-1`「パートナー所属ロールには停止の事実と理由のみ」）。
// 🔴 母集団は RLS が決める（migration 20260920000000: パートナー文脈は `AI_COST_USD` かつ `REACHED` の行だけ）。
// 🔴 `requireRole` を全ロール（`TENANT_ROLES`）で宣言する（「掛けるかどうかを考えていない」状態を作らない。
//    `guards: []` にしない）。`PARTNER_VIEWER`（Issue #34。T-16-12）が加わればコンパイルで気づく形にはならないため、
//    値集合そのものを渡す。
import { requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { BLOCKED_NOTICE_ROLES, readBlockedNotice } from '../../../../../lib/usage/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/usage/blocked-notice',
    guards: [requireRole(BLOCKED_NOTICE_ROLES)],
  },
  async ({ ctx }) => Response.json(await readBlockedNotice(ctx, new Date())),
);
