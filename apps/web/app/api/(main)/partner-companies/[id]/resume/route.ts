// apps/web/app/api/(main)/partner-companies/[id]/resume/route.ts
// docs/05 §6.4 #13 `POST /api/partner-companies/{id}/resume`（`F-007 AC-2`）。T-04-07。
//
// 🔴 `/suspend` と別ファイルである（理由は `../suspend/route.ts` 冒頭のコメント）。
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
    label: 'POST /api/partner-companies/{id}/resume',
    guards: [requireRole(['OWNER', 'ADMIN']), requireExecutable(), requireNotViewer()],
    params: partnerCompanyParamsSchema,
    body: partnerCompanySuspensionBodySchema,
    audit: {
      action: PARTNER_COMPANY_AUDIT_ACTIONS.update,
      resolve: ({ params, body }) => ({
        targetType: 'PartnerCompany',
        targetId: params.id,
        summary: { operation: 'RESUME', ...(body.reason === undefined ? {} : { reason: body.reason }) },
      }),
    },
  },
  async ({ ctx, params }) => {
    await setPartnerCompanySuspension(ctx, { id: params.id, operation: 'RESUME', now: new Date() });
    return new Response(null, { status: 204 });
  },
);
