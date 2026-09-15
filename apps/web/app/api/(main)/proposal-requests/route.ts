// apps/web/app/api/(main)/proposal-requests/route.ts
// docs/05 §6.5 #31 `POST /api/proposal-requests` / #32 `GET /api/proposal-requests`（`F-018` / `S-016` / `S-017`）。
// T-08-06。
//
// 🔴 **#31 は越境経路 4 の「提案依頼」を発行する唯一の書き込み経路**であり、**`candidateRef` を受け取る
//    唯一の API** である（docs/05 §4.6。詳細エンドポイント `GET /api/candidates/{ref}` は作らない）。
//    参照子の逆引き・共有中の再確認・INSERT は `issueProposalRequest`（`lib/proposal-requests/service.ts`）が
//    共有スコープの中で行い、**`engineer_id` も依頼先も応答に載せない**（応答は `{ id }` だけ）。
// 🔴 **#31 の認可は 3 本**: `requireRole(OWNER/ADMIN/SALES)`（パートナーロールは 403）+
//    `requireExecutable`（`SUSPENDED` / `CLOSING` は 409。`F-004 AC-7` / `AC-8`。
//    `tests/static/execute-guard.test.ts` が全ての実行系ルートに要求する）+ `requireNotViewer`。
// 🔴 **#32 は `guards: []`（読み取り）**。`VIEWER` / `CLOSING` でも一覧は見える（`F-004 AC-6` / `AC-8`）。
//    応答の型は所属で分岐する（`HostProposalRequestView` / `PartnerProposalRequestView`。🔴 ホスト向けに
//    `declineReason` フィールドは存在しない。`F-018 AC-1`）。**取引先の応答が同じ URL で返るが、母集団は
//    `proposal_requests` の RLS（C5）が「依頼先 = 自社」に閉じる**。
// 🔴 **`withApiRoute` の `audit` オプションを使わない。** 発行の記録は共有スコープの業務トランザクション内
//    （`packages/db`）で書く —— `audit` はハンドラの前に別トランザクションで書くため、起きなかった発行
//    （404 / 409 / 422）まで残る。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../lib/auth/session';
import { candidateReference } from '../../../../lib/db/bootstrap';
import { PROPOSAL_REQUEST_ISSUER_ROLES } from '../../../../lib/proposal-requests/policy';
import {
  proposalRequestCreateBodySchema,
  proposalRequestListQuerySchema,
} from '../../../../lib/proposal-requests/schemas';
import {
  issueProposalRequest,
  listProposalRequests,
} from '../../../../lib/proposal-requests/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/proposal-requests',
    guards: [requireRole(PROPOSAL_REQUEST_ISSUER_ROLES), requireExecutable(), requireNotViewer()],
    body: proposalRequestCreateBodySchema,
  },
  async ({ ctx, body }) => {
    const meta = await readRequestMeta();
    const issued = await issueProposalRequest(ctx, body, {
      // 🔴 鍵そのものではなく、起動時に鍵を閉じ込めた関数を渡す（`bootstrap.ts`）。
      candidateRef: candidateReference(),
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return Response.json(issued, { status: 201 });
  },
);

export const GET = withApiRoute(
  {
    label: 'GET /api/proposal-requests',
    guards: [],
    query: proposalRequestListQuerySchema,
  },
  async ({ ctx, query }) => {
    const view = await listProposalRequests(ctx, query);
    // 🔴 契約は `{ items, nextCursor }`（docs/05 §6.5 #32）。`audience` は載せない（呼び出し側は所属を知っている）。
    return Response.json({ items: view.items, nextCursor: view.nextCursor });
  },
);
