// apps/web/app/api/(main)/threads/[id]/projects/route.ts
// ✅ 2026-10-23（チャットレーン・紺野）: `GET /api/threads/{id}/projects`（`docs/05` §6.5 #51n）。
// 入力欄の「/」→「案件を貼る」の小窓に出す、この部屋に貼れる案件の候補（案件名で絞り込む）。
//
// 🔴 境界（レビューの焦点）
//   - 部屋が見えなければ 404（不存在・他社・他テナントを区別しない。`findChatThreadRow`）。
//   - 候補の母集団は送る人の RLS（`projects` の C4）。部屋に取引先がいれば、さらにその取引先に公開中の案件だけ。
//     🔴 **最終の判定は投稿（#51）の `requirePastableProject`**。ここは候補を出すだけで、ここに出ない ID を
//        直接送っても投稿は 400 になる。
//   - 応答は `{ items: [{ id, name, status }] }` だけ（件数・単価・エンド企業名・公開先を載せない）。
//   - 投稿できる人の操作なので、投稿と同じロールのガード（`VIEWER` は 403）。閲覧系なので `requireExecutable` は掛けない。
import { requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readPastableProjectCandidates } from '../../../../../../lib/chat/project-candidates';
import { CHAT_POST_ROLES } from '../../../../../../lib/chat/policy';
import { chatProjectCandidateQuerySchema, chatThreadParamsSchema } from '../../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads/{id}/projects',
    guards: [requireRole([...CHAT_POST_ROLES]), requireNotViewer()],
    params: chatThreadParamsSchema,
    query: chatProjectCandidateQuerySchema,
  },
  async ({ ctx, params, query }) => {
    const items = await readPastableProjectCandidates(ctx, params.id, query.q);
    return Response.json({ items });
  },
);
