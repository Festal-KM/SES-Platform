// apps/web/app/api/(main)/threads/[id]/read/route.ts
// ✅ 2026-10-16（チャットレーン）: `PUT /api/threads/{id}/read` —— ここまで読んだ（`lib/chat/read-state.ts`）。
//
// 🔴 ロールで止めない（閲覧専用も自分の既読位置は書ける。業務データではなく自分の表示の状態）。
//    誰の行かは RLS（C7 SELF）が決め、利用者 ID は認証コンテキストから取る。
// 🔴 既読は戻す方向に動かさない。スレッド・発言が見えなければ 404。監査ログに書かない。
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { markChatRead } from '../../../../../../lib/chat/read-state';
import { chatReadBodySchema, chatThreadParamsSchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/threads/{id}/read',
    guards: [],
    params: chatThreadParamsSchema,
    body: chatReadBodySchema,
  },
  async ({ ctx, params, body }) => Response.json(await markChatRead(ctx, params.id, body.upToMessageId)),
);
