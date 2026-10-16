// apps/web/app/api/(main)/threads/[id]/export/route.ts
// ✅ 2026-10-16（チャットレーン）: `GET /api/threads/{id}/export` —— 会話を CSV で書き出す（#110 の 19）。
//
// 🔴 閲覧専用（`VIEWER` / `PARTNER_VIEWER`）は書き出せない（CLAUDE.md §10.1「ダウンロードは一切不可」）。
//    `CLOSING` でも書き出せる（解約時のデータの返却。`requireExecutable` を掛けない）。
// 🔴 監査ログに残す（`thread.export`。本文は載せず件数だけ）。ファイル名に社名・氏名を入れない。
import { t } from '@ses/i18n';
import { requireNotViewer } from '../../../../../../lib/api/guards';
import { withApiRoute } from '../../../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../../../lib/auth/session';
import { buildThreadCsv } from '../../../../../../lib/chat/export';
import { chatThreadParamsSchema } from '../../../../../../lib/chat/schemas';
import { readChatThreadForExport } from '../../../../../../lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRoute(
  {
    label: 'GET /api/threads/{id}/export',
    guards: [requireNotViewer()],
    params: chatThreadParamsSchema,
  },
  async ({ ctx, params }) => {
    const meta = await readRequestMeta();
    const messages = await readChatThreadForExport(ctx, params.id, {
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    const csv = buildThreadCsv(messages, {
      sentAt: t('chat.export.sentAt'),
      sender: t('chat.export.sender'),
      company: t('chat.export.company'),
      body: t('chat.export.body'),
      unknownName: t('chat.thread.unknownName'),
      deleted: t('chat.message.deleted'),
      purged: t('chat.message.purged'),
    });
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="chat-${params.id.slice(0, 8)}-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  },
);
