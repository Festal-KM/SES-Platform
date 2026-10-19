// packages/db/src/chat-dm-peer-read.ts
// ✅ 2026-10-19（#128）: DM の既読表示。`app_dm_peer_read`（migration 20261019010000）を呼ぶ**唯一のファイル**。
//
// 🔴 `chat_read_states` は C7 SELF（本人の行だけ）のまま。相手の位置は SECURITY DEFINER 関数が
//    「呼び出し元がメンバーの DM」でだけ 1 つの値で返す。グループ・会社グループ・スレッド・非メンバーは NULL。
// 🔴 引数は部屋の ID だけ。利用者 ID は受け取らない（呼び出し元は認証コンテキストの `app.actor_user_id`）。
// 🔴 多層防御: 関数を呼ぶ前に、呼び出し元の C6 / C10 ポリシーで**見える部屋に絞る**（`FROM chat_threads`）。
//    見えない ID は結果に出ないので、ここで NULL に畳む。
import { Prisma } from '@prisma/client';
import type { AuthenticatedTenantCtx } from './context.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * DM の相手が最後に読んだ発言の ID（部屋ごと。DM でない / 読めない / 相手がまだ読んでいないは `null`）。
 */
export async function readDmPeerReadMessageIds(
  ctx: AuthenticatedTenantCtx,
  threadIds: readonly string[],
): Promise<Readonly<Record<string, string | null>>> {
  const unique = [...new Set(threadIds)];
  if (unique.length === 0) return {};
  const rows = await runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    (tx) =>
      tx.$queryRaw<Array<{ readonly id: string; readonly peer: string | null }>>(Prisma.sql`
        SELECT t.id::text AS id, app_dm_peer_read(t.id)::text AS peer
          FROM chat_threads t
         WHERE t.id = ANY (${unique}::uuid[])`),
  );
  const byId = new Map(rows.map((row) => [row.id, row.peer]));
  return Object.fromEntries(unique.map((id) => [id, byId.get(id) ?? null]));
}
