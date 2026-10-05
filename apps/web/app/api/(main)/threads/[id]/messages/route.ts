// apps/web/app/api/(main)/threads/[id]/messages/route.ts
// `GET` / `POST /api/threads/{id}/messages`（`docs/05` §6.5 **#50 / #51** / `F-038` / `S-031` /
// `CLAUDE.md` §3.1 **越境経路 3**）。
//
// ============================================================================
// 🔴 境界（レビューの焦点）
// ============================================================================
//   - **読み取り（`GET`）は `guards: []`。** 見える／見えないは `thread_participants` の行の有無
//     （RLS の C6）が決める。ロールで止めると「境界で止まったのか権限で止まったのか」が応答から
//     読めなくなる（`lib/chat/policy.ts` の 🔴）。
//   - 🔴 **見えないスレッド ID は 404**（`requireFound`。`docs/05` §4.8「見えない ＝ 存在しない」）。
//     不存在の ID・他社のスレッド・他テナントのスレッドで**同じ応答**になる。
//   - **投稿（`POST`）は 3 本のガード**: `requireRole(CHAT_POST_ROLES)`（`VIEWER` は 403。
//     `docs/04` §S-031「`VIEWER` は投稿・添付ができない」）+ `requireExecutable()`
//     （`SUSPENDED` / `CLOSING` と**取引先企業の停止**で投稿させない。`F-004 AC-7` / `AC-8`）+
//     `requireNotViewer()`（二重の網）。
//   - 🔴 **`audit` オプションを使わない** —— 記録は `sendChatMessage` の業務トランザクション内で
//     書く（404 では残さない。`service.ts` の ⑤）。
//   - 🔴 **添付の口が無い**（`chatMessageBodySchema` は `{ body }` だけ）。理由は `schemas.ts` の 🔴。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { listChatMessages } from '../../../../../../lib/chat/read';
import { CHAT_POST_ROLES } from '../../../../../../lib/chat/policy';
import {
  chatMessageBodySchema,
  chatMessageListQuerySchema,
  chatThreadParamsSchema,
} from '../../../../../../lib/chat/schemas';
import { sendChatMessage } from '../../../../../../lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads/{id}/messages',
    guards: [],
    params: chatThreadParamsSchema,
    query: chatMessageListQuerySchema,
  },
  async ({ ctx, params, query }) => {
    const view = await listChatMessages(ctx, params.id, query);
    // 🔴 `{ items, nextCursor }` だけ。件数（`total`）を載せない（§4.8）。
    return Response.json({ items: view.items, nextCursor: view.nextCursor });
  },
);

export const POST = withApiRoute(
  {
    label: 'POST /api/threads/{id}/messages',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    params: chatThreadParamsSchema,
    body: chatMessageBodySchema,
  },
  async ({ ctx, params, body }) => {
    const meta = await readRequestMeta();
    const result = await sendChatMessage(ctx, params.id, body, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    // 🔴 `docs/05` §6.5 #51 の `{ id }` の上位互換。画面が吹き出しを 1 つ足すために、
    //    **投稿した 1 件の写しだけ**を返す（会話全体を返さない = 再取得で 1 ページ目に戻らない）。
    return Response.json({ id: result.message.id, message: result.message }, { status: 201 });
  },
);
