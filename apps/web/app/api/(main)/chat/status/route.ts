// ✅ 2026-10-19（#128 §7.1 ①）: `PUT /api/chat/status` —— 自分のひとこと状態を設定する（空文字で消す。`docs/05` §6.5 #51j）。
// 🔴 投稿できる人だけ（閲覧専用は書けない。`CLAUDE.md` §10.1）。停止中・解約手続き中のテナントでは書けない（`requireExecutable`）。
// 🔴 誰の状態かは受け取らない（認証コンテキストの本人だけ。RLS も本人の行しか書かせない）。
import { requireExecutable, requireNotViewer, requireRole } from '../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../lib/api/withApiRoute';
import { CHAT_POST_ROLES } from '../../../../../lib/chat/policy';
import { chatUserStatusBodySchema } from '../../../../../lib/chat/schemas';
import { setMyChatUserStatus } from '../../../../../lib/chat/user-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApiRoute(
  {
    label: 'PUT /api/chat/status',
    guards: [requireRole([...CHAT_POST_ROLES]), requireExecutable(), requireNotViewer()],
    body: chatUserStatusBodySchema,
  },
  async ({ ctx, body }) => Response.json(await setMyChatUserStatus(ctx, body.text)),
);
