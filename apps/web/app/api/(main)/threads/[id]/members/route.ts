// apps/web/app/api/(main)/threads/[id]/members/route.ts
// ✅ 2026-11-01（紺野の決定）: グループに人を足す（`docs/05` §6.5 #51h の `POST`。外す `DELETE` は別の段）。
// 🔴 投稿できる人だけ（閲覧専用は足せない。`CLAUDE.md` §10.1）。停止中のテナントでは足せない（`requireExecutable`）。
// 🔴 部屋が見えなければ 404。グループでない・部屋の取引先と合わない・上限を超える・日付が不正は 400（`lib/chat/rooms.ts` ⑤）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { CHAT_POST_ROLES } from '../../../../../../lib/chat/policy';
import { addChatGroupMembers } from '../../../../../../lib/chat/rooms';
import { chatGroupMembersBodySchema, chatThreadParamsSchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/threads/{id}/members',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatThreadParamsSchema,
    body: chatGroupMembersBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const result = await addChatGroupMembers(ctx, params.id, body, { now: () => new Date(), meta: { ipAddress: meta.ipAddress } });
    return Response.json(result);
  },
);
