// apps/web/app/api/(main)/threads/[id]/messages/search/route.ts
// ✅ 2026-10-29（チャットレーン・紺野の決定）: `GET /api/threads/{id}/messages/search?q=`（`docs/05` §6.5 #51s / `F-038` ⑰）。
// この会話の中だけを検索する（会話の見出しの検索の印から開く欄）。
//
// 🔴 境界（レビューの焦点）
//   - **読み取りなので `guards: []`**（#50 の `GET` と同じ）。見える／見えないは RLS が決め、読めない部屋は 404
//     （不存在・他社・他テナント・メンバーでない DM / グループで同じ応答。`lib/chat/search.ts` ①）。
//   - 部屋は URL の 1 つだけ。応答は `{ items }` だけで、件数を載せない（`lib/chat/search.ts` ④）。
//   - 監査ログは書かない（閲覧。`lib/chat/read.ts` ⑤）。
import { withApiRoute } from '../../../../../../../lib/api/withApiRoute';
import { chatMessageSearchQuerySchema, chatThreadParamsSchema } from '../../../../../../../lib/chat/schemas';
import { searchChatMessages } from '../../../../../../../lib/chat/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads/{id}/messages/search',
    guards: [],
    params: chatThreadParamsSchema,
    query: chatMessageSearchQuerySchema,
  },
  async ({ ctx, params, query }) => {
    const items = await searchChatMessages(ctx, params.id, query.q);
    return Response.json({ items });
  },
);
