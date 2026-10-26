// apps/web/app/api/(main)/threads/[id]/announcement/route.ts
// ✅ 2026-10-26（チャットレーン・紺野の決定 2026-10-22）: 部屋のアナウンス（`docs/05` §6.5 #51n）。
//   `GET`    —— 今のアナウンスを読む（新着の取得と同じ間隔で画面が読み直す）
//   `PUT`    —— この発言をアナウンスにする（あれば置き換える）
//   `DELETE` —— この発言のアナウンスを外す（今のアナウンスが別の発言なら何もしない）
//
// 🔴 読みはロールで止めない（どの部屋が見えるかは RLS が決める。`lib/chat/policy.ts` の 🔴）。部屋が見えなければ 404。
// 🔴 設定・外すは投稿と同じ権限（閲覧専用・停止中のテナントは不可）。body は `{ messageId }` だけ（`.strict()`）。
// 🔴 設定・外すは監査ログに残す（本文なし・部屋 ID と発言 ID だけ。`lib/chat/announcement.ts` ④）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { clearChatAnnouncement, readChatAnnouncement, setChatAnnouncement } from '../../../../../../lib/chat/announcement';
import { CHAT_POST_ROLES } from '../../../../../../lib/chat/policy';
import { chatAnnouncementBodySchema, chatThreadParamsSchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads/{id}/announcement',
    guards: [],
    params: chatThreadParamsSchema,
  },
  async ({ ctx, params }) => Response.json(await readChatAnnouncement(ctx, params.id)),
);

export const PUT = withApiRoute(
  {
    label: 'PUT /api/threads/{id}/announcement',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatThreadParamsSchema,
    body: chatAnnouncementBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await setChatAnnouncement(ctx, params.id, body.messageId, { now: () => new Date(), meta: { ipAddress: meta.ipAddress } }),
    );
  },
);

export const DELETE = withApiRoute(
  {
    label: 'DELETE /api/threads/{id}/announcement',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatThreadParamsSchema,
    body: chatAnnouncementBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    return Response.json(
      await clearChatAnnouncement(ctx, params.id, body.messageId, { now: () => new Date(), meta: { ipAddress: meta.ipAddress } }),
    );
  },
);
