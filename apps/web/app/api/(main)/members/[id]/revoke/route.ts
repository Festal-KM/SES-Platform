// apps/web/app/api/(main)/members/[id]/revoke/route.ts
// docs/05 §6.7 #85 `POST /api/members/{id}/revoke`（`F-002 AC-3` / `AC-4`）。T-04-09。
//
// 🔴 無効化は**データを 1 行も消さない**（`docs/04` §S-035「無効化 → データは削除されない」）。
//    `Membership.revokedAt` と `User.disabledAt` を立てるだけであり、そのアカウントが作った
//    エンジニア・提案・チャットはそのまま残る。
// 🔴 「復帰」の API を作らない。無効化からの復帰は招待の再発行（#14）である ——
//    復帰させる経路を足すと、無効化した相手のパスワードがそのまま生き返ることになる。
// 🔴 監査は業務トランザクションの内側で書く（`/role` と同じ。`lib/members/service.ts`）。
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { revokeMember } from '../../../../../../lib/members/service';
import { MEMBER_MANAGER_ROLES } from '../../../../../../lib/members/policy';
import { memberParamsSchema } from '../../../../../../lib/members/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/members/{id}/revoke',
    guards: [requireRole(MEMBER_MANAGER_ROLES), requireExecutable(), requireNotViewer()],
    params: memberParamsSchema,
    // 🔴 body を宣言しない（受け取る業務入力が無い）。理由の入力は求めない ——
    //    #13 の停止と同じく、記録の価値より「止められること」を優先する。
  },
  async ({ ctx, params }) => {
    // 🔴 すでに無効化済みでも 204（冪等）。二重操作を失敗にしない。
    await revokeMember(ctx, { membershipId: params.id, now: new Date() }, await readRequestMeta());
    return new Response(null, { status: 204 });
  },
);
