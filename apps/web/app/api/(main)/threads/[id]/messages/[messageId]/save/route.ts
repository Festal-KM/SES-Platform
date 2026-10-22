// apps/web/app/api/(main)/threads/[id]/messages/[messageId]/save/route.ts
// ✅ 2026-10-22（チャットレーン・紺野）: `PUT` / `DELETE /api/threads/{id}/messages/{messageId}/save` —— 発言を保存する / 保存を外す
// （`docs/05` §6.5 #51l。本人だけの栞）。
//
// 🔴 権限は投稿と同じ（閲覧専用・停止中のテナントは不可）。発言が見えなければ 404（`lib/chat/saved.ts` ②）。
// 🔴 誰の栞かは受け取らない（認証コンテキストの本人だけ。RLS も本人の行しか書かせない）。監査ログに書かない（`saved.ts` ④）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../../lib/api/withApiRoute';
import { CHAT_POST_ROLES } from '../../../../../../../../lib/chat/policy';
import { saveChatMessage, unsaveChatMessage } from '../../../../../../../../lib/chat/saved';
import { chatMessageParamsSchema } from '../../../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/threads/{id}/messages/{messageId}/save',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatMessageParamsSchema,
  },
  async ({ ctx, params }) => Response.json(await saveChatMessage(ctx, params.id, params.messageId)),
);

export const DELETE = withApiRoute(
  {
    label: 'DELETE /api/threads/{id}/messages/{messageId}/save',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatMessageParamsSchema,
  },
  async ({ ctx, params }) => Response.json(await unsaveChatMessage(ctx, params.id, params.messageId)),
);
