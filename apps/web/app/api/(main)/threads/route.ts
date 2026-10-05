// apps/web/app/api/(main)/threads/route.ts
// `GET /api/threads`（`docs/05` §6.5 **#50** / `F-038` / `S-031` / `CLAUDE.md` §3.1 **越境経路 3**）。
//
// 🔴 **認可は `guards: []`**（読み取り専用）。「どのスレッドが見えるか」はロールではなく
//    `thread_participants` の行の有無（RLS の **C6 THREAD**）が決める（`lib/chat/policy.ts` の 🔴）。
//    `VIEWER` も `CLOSING` のテナントも一覧は見える（`F-004 AC-6` / `AC-8`）。
// 🔴 **`AuditLog` を書かない**（`audit` オプションも使わない）。`CLAUDE.md` §3.5 / `BR-27` の
//    列挙に「チャットの閲覧」は無く、**記録を増やすことも設計判断である**。
// 🔴 応答は `{ items, nextCursor }` だけ（`docs/05` §6.5 #50 の `{ items }` + §6.1 のカーソル）。
//    🔴 **`total` を載せない** —— 総件数は「見えていないスレッドが在るか」の手がかりになる
//    （`F-038 AC-1` / §4.8）。
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { listChatThreads } from '../../../../lib/chat/read';
import { chatThreadListQuerySchema } from '../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads',
    guards: [],
    query: chatThreadListQuerySchema,
  },
  async ({ ctx, query }) => {
    const view = await listChatThreads(ctx, query);
    return Response.json({ items: view.items, nextCursor: view.nextCursor });
  },
);
