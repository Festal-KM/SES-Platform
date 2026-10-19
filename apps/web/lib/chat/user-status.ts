// apps/web/lib/chat/user-status.ts
// ✅ 2026-10-19（#128 §7.1 ① で合意）: チャットのひとこと状態（`chat_user_statuses`。docs/05 §3.7.1 / §6.5 #51j）。
//
// 🔴 ここが守るもの
//   ① 🔴 **誰の状態が読めるかは RLS が決める**（読み = users の C8 DIRECTORY に連動）。`where` に境界を書き足さない ——
//      取引先の文脈では、別の取引先の人の状態は 1 行も返らない。
//   ② 🔴 **書くのは本人の行だけ**。`userId` は認証コンテキストから取る（リクエスト入力から受けない。CLAUDE.md §3.1）。
//      RLS（C7 SELF の式）も本人の行しか INSERT / UPDATE / DELETE させない（二重）。
//   ③ 空にしたら行を消す（「状態なし」を空文字の行で持たない）。
//   ④ 🔴 設定・消去のたびに監査ログを 1 行、**同じトランザクションの中で**書く（`chat_status.update` / `chat_status.clear`）。
//      ほかの人に見える自由文を変える操作だから。🔴 **本文は載せず文字数だけ**（`service.ts` の `message.update` と同じ）。
import { withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';

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

export const CHAT_STATUS_AUDIT_ACTION_UPDATE = 'chat_status.update';
export const CHAT_STATUS_AUDIT_ACTION_CLEAR = 'chat_status.clear';
/** 対象は自分の利用者（`auth/credentials.ts` の `'User'` と同じ表記）。 */
export const CHAT_STATUS_AUDIT_TARGET_TYPE = 'User';

export type ChatUserStatusDeps = { readonly meta: { readonly ipAddress: string | null } };

/** 一意制約違反（Prisma の `P2002`）か。`rooms.ts` と同じ見方（`@ses/db` は Prisma の型を export しない）。 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}

async function writeMyStatus(ctx: AuthenticatedTenantCtx, text: string, deps: ChatUserStatusDeps): Promise<{ readonly text: string }> {
  return withTenant(ctx, async (db) => {
    let saved: string;
    if (text === '') {
      await db.chatUserStatus.deleteMany({ where: { userId: ctx.userId } });
      saved = '';
    } else {
      const row = await db.chatUserStatus.upsert({
        where: { tenantId_userId: { tenantId: ctx.tenantId, userId: ctx.userId } },
        create: { tenantId: ctx.tenantId, userId: ctx.userId, text },
        update: { text },
        select: { text: true },
      });
      saved = row.text;
    }
    await writeAuditLog(db, {
      action: text === '' ? CHAT_STATUS_AUDIT_ACTION_CLEAR : CHAT_STATUS_AUDIT_ACTION_UPDATE,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_STATUS_AUDIT_TARGET_TYPE,
      targetId: ctx.userId,
      summary: { textLength: text.length },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    return { text: saved };
  });
}

/** 自分の状態を設定する（`PUT /api/chat/status`）。空なら消す。 */
export async function setMyChatUserStatus(
  ctx: AuthenticatedTenantCtx,
  text: string,
  deps: ChatUserStatusDeps,
): Promise<{ readonly text: string }> {
  try {
    return await writeMyStatus(ctx, text, deps);
  } catch (error) {
    // 2 つのタブで同時に初回の保存をすると、片方の INSERT が一意制約で落ちる（トランザクションは巻き戻る）。
    // 行はもうあるので、新しいトランザクションでもう一度書けば update になる。
    if (isUniqueViolation(error)) return writeMyStatus(ctx, text, deps);
    throw error;
  }
}
