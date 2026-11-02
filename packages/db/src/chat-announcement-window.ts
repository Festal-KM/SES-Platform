// packages/db/src/chat-announcement-window.ts
// ✅ 2026-11-01（グループに後から人を足す。レビュー NG-4）: `app_thread_announcement_outside_window`（migration 20261101100000）を
// 呼ぶ**唯一のファイル**。
//
// 🔴 今のアナウンスが、呼び出し元の読める範囲より前の発言を指していると、その行は呼び出し元から見えない（RESTRICTIVE）。
//    そのまま設定・外すと一意制約 / RLS の拒否になるので、アプリはこの真偽で先に 409 にする。
// 🔴 引数は部屋の ID だけ。利用者 ID は受け取らない（呼び出し元は認証コンテキストの `app.actor_user_id`）。返すのは真偽だけ。
import { Prisma } from '@prisma/client';
import type { AuthenticatedTenantCtx } from './context.js';
import { runInTenantTransaction } from './with-tenant.js';

/** 今のアナウンスが、自分の読める範囲より前の発言を指しているか（グループのメンバーで範囲を持つときだけ true になりうる）。 */
export async function isChatAnnouncementOutsideMyWindow(ctx: AuthenticatedTenantCtx, threadId: string): Promise<boolean> {
  const rows = await runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    (tx) =>
      tx.$queryRaw<Array<{ readonly outside: boolean }>>(Prisma.sql`
        SELECT app_thread_announcement_outside_window(${threadId}::uuid) AS outside`),
  );
  return rows[0]?.outside === true;
}
