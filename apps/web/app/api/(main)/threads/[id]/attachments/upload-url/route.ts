// apps/web/app/api/(main)/threads/[id]/attachments/upload-url/route.ts
// ✅ 2026-10-27: `POST /api/threads/{id}/attachments/upload-url`（`docs/05` §6.5 #51p / `F-038` 改訂 12 ⑫）。
//
// 🔴 ガードは投稿（#51）と同じ 3 本: `requireRole(CHAT_POST_ROLES)`（閲覧専用は 403）+ `requireExecutable()`（停止中・解約中は 409）
//    + `requireNotViewer()`。~~取引先がいる部屋は 400~~（✅ 2026-10-27 #182: どの部屋でも添えられる。判定は `chatRoomAcceptsAttachments`）、見えない部屋は 404。
// 🔴 キーはサーバが組み、札（`uploadToken`）で #51 に渡す。ここでは行を作らず監査も書かない（送信 #51 が書く）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../lib/api/withApiRoute';
import { issueChatAttachmentUploadUrl } from '../../../../../../../lib/chat/attachments';
import { CHAT_POST_ROLES } from '../../../../../../../lib/chat/policy';
import { chatAttachmentUploadBodySchema, chatThreadParamsSchema } from '../../../../../../../lib/chat/schemas';
import { chatAttachmentTokens, objectStore, storageRuntime, tenantQuotaDefaults } from '../../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/threads/{id}/attachments/upload-url',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatThreadParamsSchema,
    body: chatAttachmentUploadBodySchema,
  },
  async ({ ctx, params, body }) => {
    const ticket = await issueChatAttachmentUploadUrl(ctx, params.id, body, {
      objectStore: objectStore(),
      tokens: chatAttachmentTokens(),
      uploadMaxBytes: storageRuntime().uploadMaxBytes,
      // 🔴 ストレージ上限の既定値（上書きを含めた解決は `issueChatAttachmentUploadUrl` の中）。
      quotaDefaults: tenantQuotaDefaults(),
      now: () => new Date(),
    });
    return Response.json(ticket, { status: 201 });
  },
);
