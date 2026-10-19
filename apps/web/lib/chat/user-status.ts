// apps/web/lib/chat/user-status.ts
// ✅ 2026-10-19（#128 §7.1 ① で合意）: チャットのひとこと状態（`chat_user_statuses`。docs/05 §3.7.1 / §6.5 #51j）。
//
// 🔴 ここが守るもの
//   ① 🔴 **誰の状態が読めるかは RLS が決める**（読み = users の C8 DIRECTORY に連動）。`where` に境界を書き足さない ——
//      取引先の文脈では、別の取引先の人の状態は 1 行も返らない。
//   ② 🔴 **書くのは本人の行だけ**。`userId` は認証コンテキストから取る（リクエスト入力から受けない。CLAUDE.md §3.1）。
//      RLS（C7 SELF の式）も本人の行しか INSERT / UPDATE / DELETE させない（二重）。
//   ③ 空にしたら行を消す（「状態なし」を空文字の行で持たない）。
//   ④ 監査ログに書かない（自分の表示の設定。ピン留め・ミュート〔#51d〕と同じ扱い）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 見えている人の状態を引く（ID → 状態）。🔴 見えない人・状態の無い人は載らない。 */
export async function readChatUserStatuses(
  db: Pick<TenantDb, 'chatUserStatus'>,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.chatUserStatus.findMany({
    where: { userId: { in: unique } },
    select: { userId: true, text: true },
  });
  return new Map(rows.filter((row) => row.text !== '').map((row) => [row.userId, row.text]));
}

/** 自分の状態（入口の初期値）。無ければ空文字。 */
export async function readMyChatUserStatus(ctx: AuthenticatedTenantCtx): Promise<string> {
  return withTenant(ctx, async (db) => (await readChatUserStatuses(db, [ctx.userId])).get(ctx.userId) ?? '');
}

/** 自分の状態を設定する（`PUT /api/chat/status`）。空なら消す。 */
export async function setMyChatUserStatus(
  ctx: AuthenticatedTenantCtx,
  text: string,
): Promise<{ readonly text: string }> {
  return withTenant(ctx, async (db) => {
    if (text === '') {
      await db.chatUserStatus.deleteMany({ where: { userId: ctx.userId } });
      return { text: '' };
    }
    const row = await db.chatUserStatus.upsert({
      where: { tenantId_userId: { tenantId: ctx.tenantId, userId: ctx.userId } },
      create: { tenantId: ctx.tenantId, userId: ctx.userId, text },
      update: { text },
      select: { text: true },
    });
    return { text: row.text };
  });
}
