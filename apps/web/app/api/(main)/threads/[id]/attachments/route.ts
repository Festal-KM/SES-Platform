// apps/web/app/api/(main)/threads/[id]/attachments/route.ts
// ✅ 2026-10-27: `GET /api/threads/{id}/attachments`（`docs/05` §6.5 #51r / `F-038` 改訂 12 ⑫）。部屋の「ファイル」の一覧。
//
// 🔴 読み取りは `guards: []`（見えるかは RLS が決める。`lib/chat/policy.ts` の 🔴）。見えない部屋は 404。
// 🔴 `CLEAN` のものだけ・新しい順・件数を返さない（`{ items, nextCursor }`）。URL・キー・ファイル名を返さない。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { listChatAttachments } from '../../../../../../lib/chat/attachments';
import { chatAttachmentListQuerySchema, chatThreadParamsSchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads/{id}/attachments',
    guards: [],
    params: chatThreadParamsSchema,
    query: chatAttachmentListQuerySchema,
  },
  async ({ ctx, params, query }) => {
    const page = await listChatAttachments(ctx, params.id, query);
    return Response.json({ items: page.items, nextCursor: page.nextCursor });
  },
);
