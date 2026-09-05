// apps/web/app/api/(main)/members/[id]/role/route.ts
// docs/05 §6.7 #84 `PUT /api/members/{id}/role`（`F-002 AC-3` / `AC-4`）。T-04-09。
//
// 🔴 `/role` と `/revoke` を**別ファイルに分ける**（#13 の `/suspend` `/resume` と同じ理由）。
//    影響がまったく違う操作であり、1 本のハンドラのパラメータ切替にしない。
//    共通化するのはサービス層（`lib/members/service.ts`）であって HTTP 経路ではない。
// 🔴 監査は `withApiRoute` の `audit` オプションではなく**業務トランザクションの内側**で書く。
//    `F-002 AC-3` は「**変更前後の**ロール」を要求しており、変更前のロールは
//    ハンドラの前（行を読む前）には分からない（`lib/members/service.ts` のコメント）。
// 🔴 `requireVerifiedSendingDomain` は掛けない（メールを送らない操作である。`F-001 AC-5`）。
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { changeMemberRole } from '../../../../../../lib/members/service';
import { MEMBER_MANAGER_ROLES } from '../../../../../../lib/members/policy';
import {
  changeMemberRoleBodySchema,
  memberParamsSchema,
} from '../../../../../../lib/members/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/members/{id}/role',
    // 🔴 粗いロールゲート。対象まで含めた可否は `decideMemberRoleChange`（`F-002 AC-4`）。
    //    `requireNotViewer` は `requireRole` と重なるが二重に掛ける（許可ロールを将来広げたときに
    //    `VIEWER` が滑り込まないため。#14 と同じ）。
    guards: [requireRole(MEMBER_MANAGER_ROLES), requireExecutable(), requireNotViewer()],
    params: memberParamsSchema,
    body: changeMemberRoleBodySchema,
  },
  async ({ ctx, params, body }) => {
    // 🔴 同じロールへの変更でも 204（冪等）。監査ログに「変更前後が同じ」行を残さない。
    await changeMemberRole(
      ctx,
      { membershipId: params.id, role: body.role },
      await readRequestMeta(),
    );
    return new Response(null, { status: 204 });
  },
);
