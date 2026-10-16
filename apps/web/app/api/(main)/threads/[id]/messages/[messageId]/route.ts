// apps/web/app/api/(main)/threads/[id]/messages/[messageId]/route.ts
// ✅ 2026-10-16（チャットレーン）: 自分の発言の編集（`PATCH`）・削除（`DELETE`。論理削除）。
//
// 🔴 権限は投稿と同じ（閲覧専用・停止中のテナントは不可）。編集・削除できるのは**送った本人の、まだ消えていない
//    発言**だけで、それ以外は 404（`lib/chat/service.ts` の `requireOwnLiveMessage`）。監査ログに残す（本文は載せない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../../lib/auth/session';
import { CHAT_POST_ROLES } from '../../../../../../../lib/chat/policy';
import { chatMessageBodySchema, chatMessageParamsSchema } from '../../../../../../../lib/chat/schemas';
import { deleteChatMessage, editChatMessage } from '../../../../../../../lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/threads/{id}/messages/{messageId}',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatMessageParamsSchema,
    body: chatMessageBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const result = await editChatMessage(ctx, params.id, params.messageId, body, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return Response.json({ message: result.message });
  },
);

export const DELETE = withApiRoute(
  {
    label: 'DELETE /api/threads/{id}/messages/{messageId}',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatMessageParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const result = await deleteChatMessage(ctx, params.id, params.messageId, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    return Response.json({ message: result.message });
  },
);
