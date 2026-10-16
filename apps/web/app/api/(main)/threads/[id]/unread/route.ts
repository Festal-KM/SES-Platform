// apps/web/app/api/(main)/threads/[id]/unread/route.ts
// ✅ 2026-10-16（チャットレーン）: `PUT /api/threads/{id}/unread` —— この発言から未読にする（`lib/chat/read-state.ts`）。
//
// 🔴 ロールで止めない（自分の表示の状態）。誰の行かは RLS（C7 SELF）が決める。見えなければ 404。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { markChatUnread } from '../../../../../../lib/chat/read-state';
import { chatThreadParamsSchema, chatUnreadBodySchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/threads/{id}/unread',
    guards: [],
    params: chatThreadParamsSchema,
    body: chatUnreadBodySchema,
  },
  async ({ ctx, params, body }) => Response.json(await markChatUnread(ctx, params.id, body.fromMessageId)),
);
