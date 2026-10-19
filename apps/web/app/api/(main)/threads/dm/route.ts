// ✅ 2026-10-16（#128）: その人との DM を開く（無ければ作る。`docs/05` §6.5 #51f）。
// 🔴 投稿できる人だけ（閲覧専用は部屋を作れない。`CLAUDE.md` §10.1）。停止中のテナントでは作れない（`requireExecutable`）。
// 🔴 相手が見えない・取引先どうし・別の取引先が混ざるときは作らない（`lib/chat/rooms.ts` の ①②）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../lib/auth/session';
import { CHAT_POST_ROLES } from '../../../../../lib/chat/policy';
import { openDirectMessage } from '../../../../../lib/chat/rooms';
import { chatDirectMessageBodySchema } from '../../../../../lib/chat/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiRoute(
  {
    label: 'POST /api/threads/dm',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    body: chatDirectMessageBodySchema,
  },
  async ({ ctx, body }) => {
    const meta = await readRequestMeta();
    const deps = { now: () => new Date(), meta: { ipAddress: meta.ipAddress } };
    const result = await openDirectMessage(ctx, body.userId, deps);
    return Response.json({ id: result.id }, { status: result.created ? 201 : 200 });
  },
);
