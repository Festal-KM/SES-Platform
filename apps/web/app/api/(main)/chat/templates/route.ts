// apps/web/app/api/(main)/chat/templates/route.ts
// ✅ 2026-10-22（チャットレーン・紺野「自分だけ」）: `POST /api/chat/templates` —— 自分の定型文を作る（`docs/05` §6.5 #51m）。
// 🔴 投稿できる人だけ（閲覧専用は 403）。停止中・解約手続き中のテナントでは書けない（`requireExecutable`）。
// 🔴 誰の定型文かは受け取らない（認証コンテキストの本人だけ）。50 件を超えると 409。監査は文字数だけ。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { CHAT_POST_ROLES } from '../../../../../lib/chat/policy';
import { chatTemplateBodySchema } from '../../../../../lib/chat/schemas';
import { createMyChatTemplate } from '../../../../../lib/chat/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/chat/templates',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    body: chatTemplateBodySchema,
  },
  async ({ ctx, body }) => {
    const meta = await readRequestMeta();
    const template = await createMyChatTemplate(ctx, body, { meta: { ipAddress: meta.ipAddress } });
    return Response.json({ template }, { status: 201 });
  },
);
