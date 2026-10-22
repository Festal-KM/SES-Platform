// apps/web/app/api/(main)/chat/templates/[templateId]/route.ts
// ✅ 2026-10-22（チャットレーン・紺野「自分だけ」）: `PATCH` / `DELETE /api/chat/templates/{templateId}` —— 自分の定型文を直す / 消す
// （`docs/05` §6.5 #51m）。
// 🔴 自分の定型文でなければ 404（他人の行は RLS で見えない。存在も区別しない）。閲覧専用は 403。監査は文字数だけ。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { CHAT_POST_ROLES } from '../../../../../../lib/chat/policy';
import { chatTemplateBodySchema, chatTemplateParamsSchema } from '../../../../../../lib/chat/schemas';
import { deleteMyChatTemplate, updateMyChatTemplate } from '../../../../../../lib/chat/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = withApiRoute(
  {
    label: 'PATCH /api/chat/templates/{templateId}',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatTemplateParamsSchema,
    body: chatTemplateBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const template = await updateMyChatTemplate(ctx, params.templateId, body, { meta: { ipAddress: meta.ipAddress } });
    return Response.json({ template });
  },
);

export const DELETE = withApiRoute(
  {
    label: 'DELETE /api/chat/templates/{templateId}',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatTemplateParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    return Response.json(await deleteMyChatTemplate(ctx, params.templateId, { meta: { ipAddress: meta.ipAddress } }));
  },
);
