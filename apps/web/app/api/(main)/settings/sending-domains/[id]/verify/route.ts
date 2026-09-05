// apps/web/app/api/(main)/settings/sending-domains/[id]/verify/route.ts
// docs/05 §6.3 #72 `POST /api/settings/sending-domains/{id}/verify`（`F-001 AC-4` / `S-036`）。T-04-04。
//
// 🔴 **回数制限なし**（#72）。DNS の反映待ちは利用者が何度でも確かめてよい ——
//    確かめられないと「待っているのか壊れているのか」が分からない。
//    このリクエストは外部へメールを 1 通も送らず、`GetEmailIdentity`（読み取り）だけを起こす。
// 🔴 `sandbox` では `{ state: 'NOT_REQUIRED' }` を返す（`docs/03` §3.2.7-4）。
//    404 にしない —— 「機能が無い」ではなく「この環境では不要」だからである。
// 🔴 未検証を 4xx で返さない（`docs/04` `program-design` 申し送り 8。状態であってエラーではない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../lib/api/withApiRoute';
import { sendingDomainRuntime } from '../../../../../../../lib/db/bootstrap';
import { sendingDomainParamsSchema } from '../../../../../../../lib/settings/schemas';
import { requestSendingDomainVerification } from '../../../../../../../lib/settings/sending-domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/settings/sending-domains/{id}/verify',
    // 🔴 確認は `ADMIN` も行える（#71 / #72「`OWNER`（登録）/ `ADMIN`（確認）」）。
    guards: [requireRole(['OWNER', 'ADMIN']), requireExecutable(), requireNotViewer()],
    params: sendingDomainParamsSchema,
  },
  async ({ ctx, params }) =>
    Response.json(
      await requestSendingDomainVerification(ctx, { sendingDomainId: params.id }, sendingDomainRuntime()),
    ),
);
