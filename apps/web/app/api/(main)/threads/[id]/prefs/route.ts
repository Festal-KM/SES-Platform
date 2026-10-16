// apps/web/app/api/(main)/threads/[id]/prefs/route.ts
// ✅ 2026-10-16（チャットレーン）: `PUT /api/threads/{id}/prefs` —— ピン留め・ミュート（`lib/chat/read-state.ts`）。
//
// 🔴 ロールで止めない（自分の表示の設定。閲覧専用も使える）。誰の行かは RLS（C7 SELF）が決める。見えなければ 404。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { setChatThreadPrefs } from '../../../../../../lib/chat/read-state';
import { chatThreadParamsSchema, chatThreadPrefsBodySchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/threads/{id}/prefs',
    guards: [],
    params: chatThreadParamsSchema,
    body: chatThreadPrefsBodySchema,
  },
  async ({ ctx, params, body }) => Response.json(await setChatThreadPrefs(ctx, params.id, body)),
);
