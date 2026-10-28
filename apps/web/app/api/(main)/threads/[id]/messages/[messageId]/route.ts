// apps/web/app/api/(main)/threads/[id]/messages/[messageId]/route.ts
// ✅ 2026-10-16（チャットレーン）: 自分の発言の編集（`PATCH`）・削除（`DELETE`。論理削除）。
//
// 🔴 権限は投稿と同じ（閲覧専用・停止中のテナントは不可）。編集・削除できるのは**送った本人の、まだ消えていない
//    発言**だけで、それ以外は 404（`lib/chat/service.ts` の `requireOwnLiveMessage`）。監査ログに残す（本文は載せない）。
// ✅ 2026-10-27（紺野の決定 A）: 削除する発言に添付があれば、添付も消して計上を戻す（`deleteChatMessage`）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../../lib/auth/session';
import { CHAT_POST_ROLES } from '../../../../../../../lib/chat/policy';
import { chatMessageBodySchema, chatMessageParamsSchema } from '../../../../../../../lib/chat/schemas';
import { deleteChatMessage, editChatMessage } from '../../../../../../../lib/chat/service';
import { objectStore } from '../../../../../../../lib/db/bootstrap';

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
      // ✅ 2026-10-27（決定 A）: 添付があるときだけ実体を消す。🔴 ストレージは使うときに初めて解決する（添付の無い削除で設定を読まない）。
      objectStore: { delete: (key) => objectStore().delete(key) },
    });
    return Response.json({ message: result.message });
  },
);
