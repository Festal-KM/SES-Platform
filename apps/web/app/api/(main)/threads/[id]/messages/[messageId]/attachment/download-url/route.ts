// apps/web/app/api/(main)/threads/[id]/messages/[messageId]/attachment/download-url/route.ts
// ✅ 2026-10-27: `POST /api/threads/{id}/messages/{messageId}/attachment/download-url`（`docs/05` §6.5 #51q / `F-038` 改訂 12 ⑫）。
//
// 🔴 共有 URL は `issueDownloadUrl`（唯一の発行経路）だけが出す: `CLEAN` でなければ 409、記録（`chat_attachment.download`）の
//    commit の後にだけ署名する。見えない部屋・見えない発言・添付の無い発言は 404（存在を教えない）。
// 🔴 閲覧専用（`VIEWER`）はダウンロードできない（`CLAUDE.md` §10.1）。`requireExecutable` は掛けない（解約手続き中でも
//    社内の取り出しは止めない。スキルシートの #20 と同じ判断）。
// 🔴 `audit` オプションを使わない（404 / 409 でも記録が残るため）。
import { requireNotViewer, requireRole } from '../../../../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../../../../lib/auth/session';
import { issueChatAttachmentDownloadUrl } from '../../../../../../../../../lib/chat/attachments';
import { CHAT_POST_ROLES } from '../../../../../../../../../lib/chat/policy';
import { chatAttachmentDownloadBodySchema, chatMessageParamsSchema } from '../../../../../../../../../lib/chat/schemas';
import { objectStore } from '../../../../../../../../../lib/db/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/threads/{id}/messages/{messageId}/attachment/download-url',
    guards: [requireRole([...CHAT_POST_ROLES]), requireNotViewer()],
    params: chatMessageParamsSchema,
    body: chatAttachmentDownloadBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const ticket = await issueChatAttachmentDownloadUrl(ctx, params.id, params.messageId, body.disposition, {
      objectStore: objectStore(),
      ipAddress: meta.ipAddress,
      now: () => new Date(),
    });
    return Response.json(ticket);
  },
);
