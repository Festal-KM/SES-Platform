// apps/web/app/api/(main)/partner-companies/[id]/suspend/route.ts
// docs/05 §6.4 #13 `POST /api/partner-companies/{id}/suspend`（`F-007 AC-2`）。T-04-07。
//
// 🔴 停止は**データを消さない**（`F-007 AC-2`「既存データは削除されない」）。`suspended_at` を
//    立てるだけであり、配下アカウントの実行系（提案作成・送信・チャット投稿）を止めるのは
//    `requireExecutable`（`lib/api/guards.ts`）である。
// 🔴 `/resume` と**別ファイルに分ける**（1 本のハンドラで `?op=` を受けない）。停止と再開は
//    影響がまったく違う操作であり、パラメータ 1 つの取り違えで逆が起きてはならない。
//    共通化するのは `setPartnerCompanySuspension`（サービス層）であって HTTP 経路ではない。
// 🔴 ガードの宣言は**この 2 ファイルにそれぞれ書く**。ファクトリ関数に包んでしまうと、
//    `tests/static/execute-guard.test.ts` の AST 走査から `requireExecutable` が見えなくなる。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import {
  PARTNER_COMPANY_AUDIT_ACTIONS,
  setPartnerCompanySuspension,
} from '../../../../../../lib/partner-companies/service';
import {
  partnerCompanyParamsSchema,
  partnerCompanySuspensionBodySchema,
} from '../../../../../../lib/partner-companies/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/partner-companies/{id}/suspend',
    guards: [requireRole(['OWNER', 'ADMIN']), requireExecutable(), requireNotViewer()],
    params: partnerCompanyParamsSchema,
    body: partnerCompanySuspensionBodySchema,
    // 🔴 `F-007 AC-3`「…停止・再開が監査ログに残る」。action は `*.update` に揃える
    //    （独自 action は `S-041` の操作種別フィルタから漏れる。service.ts のコメント参照）。
    audit: {
      action: PARTNER_COMPANY_AUDIT_ACTIONS.update,
      resolve: ({ params, body }) => ({
        targetType: 'PartnerCompany',
        targetId: params.id,
        // 🔴 停止理由は利用者が書いた自由文である。PII を含みうるが、`AuditLog` は
        //    テナント境界の内側にあり、読めるのは自テナントの `OWNER` / `ADMIN` だけである
        //    （運営者向けの横断検索ではマスキングされる。`CLAUDE.md` §10.4-6）。
        summary: { operation: 'SUSPEND', ...(body.reason === undefined ? {} : { reason: body.reason }) },
      }),
    },
  },
  async ({ ctx, params }) => {
    // 🔴 すでに停止中でも 204（冪等）。二重操作を失敗にしない（service.ts のコメント参照）。
    await setPartnerCompanySuspension(ctx, { id: params.id, operation: 'SUSPEND', now: new Date() });
    return new Response(null, { status: 204 });
  },
);
