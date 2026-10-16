// apps/web/app/api/(main)/threads/[id]/messages/[messageId]/reactions/route.ts
// ✅ 2026-10-16（チャットレーン）: `POST /api/threads/{id}/messages/{messageId}/reactions` —— リアクションを付ける / 外す。
//
// 🔴 権限は投稿と同じ（閲覧専用・停止中のテナントは付けられない）。発言が見えなければ 404。
//    応答は件数と「自分が付けたか」だけ（誰が付けたかを返さない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../../lib/api/withApiRoute';
import { CHAT_POST_ROLES } from '../../../../../../../../lib/chat/policy';
import { chatReactionBodySchema, chatReactionParamsSchema } from '../../../../../../../../lib/chat/schemas';
import { toggleChatReaction } from '../../../../../../../../lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/threads/{id}/messages/{messageId}/reactions',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatReactionParamsSchema,
    body: chatReactionBodySchema,
  },
  async ({ ctx, params, body }) =>
    Response.json({ reactions: await toggleChatReaction(ctx, params.id, params.messageId, body.reaction) }),
);
