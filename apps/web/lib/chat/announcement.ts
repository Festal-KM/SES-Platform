// apps/web/lib/chat/announcement.ts
// ✅ 2026-10-26（チャットレーン・紺野の決定 2026-10-22）: 部屋のアナウンス（LINE のアナウンス。docs/05 §3.7.1 / §6.5 #51o）。
// 部屋の上部に大事な発言を 1 件固定して出す。1 部屋 1 件・新しく設定すると置き換わる・外せる。部屋のメンバーなら誰でも（閲覧専用は不可）。
//
// 🔴 ここが守るもの
//   ① 🔴 **部屋が見えなければ 404**（不存在・他社・他テナント・メンバーでない DM / グループを区別しない。`read.ts` の ③）。
//   ② 🔴 **アナウンスにできるのは「この部屋の、消えていない発言」だけ**。別の部屋の発言 ID・見えない発言・削除済みの発言は 404。
//      DB の RLS（migration 20261026010000 の WITH CHECK）も同じ条件で拒む（二重）。
//   ③ 🔴 テナント・取引先・設定した人は認証コンテキストから取る（リクエスト入力から受けない。CLAUDE.md §3.1）。
//   ④ 🔴 設定・外すたびに監査ログを 1 行、**同じトランザクションの中で**書く（`chat_announcement.set` / `chat_announcement.clear`）。
//      ほかの人に見える変更だから。🔴 **本文は載せず、部屋 ID（targetId）と発言 ID だけ**（`user-status.ts` の作法）。
//   ⑤ 外すときは「どの発言のアナウンスを外すか」を受け取り、今のアナウンスがその発言のときだけ外す
//      （開いている間に別の人が置き換えたアナウンスを、古い画面から消してしまわないため）。
import { withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound } from '../api/errors';
import { readThreadAnnouncements } from './announcement-read';
import { findChatThreadRow } from './read';
import { CHAT_THREAD_AUDIT_TARGET_TYPE } from './service';
import type { ChatAnnouncementView } from './views';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

export const CHAT_ANNOUNCEMENT_AUDIT_ACTION_SET = 'chat_announcement.set';
export const CHAT_ANNOUNCEMENT_AUDIT_ACTION_CLEAR = 'chat_announcement.clear';

export type ChatAnnouncementDeps = {
  readonly now: () => Date;
  readonly meta: { readonly ipAddress: string | null };
};

/** API の応答（アナウンスが無ければ `null`）。 */
export type ChatAnnouncementResult = { readonly announcement: ChatAnnouncementView | null };

/** 一意制約違反（Prisma の `P2002`）か。`user-status.ts` と同じ見方。 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}

async function currentAnnouncement(db: TenantDb, threadId: string): Promise<ChatAnnouncementView | null> {
  return (await readThreadAnnouncements(db, [threadId])).get(threadId) ?? null;
}

/** 部屋のアナウンスを読む（`GET /api/threads/{id}/announcement`）。🔴 部屋が見えなければ 404。 */
export async function readChatAnnouncement(ctx: AuthenticatedTenantCtx, threadId: string): Promise<ChatAnnouncementResult> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    return { announcement: await currentAnnouncement(db, threadId) };
  });
}

async function writeAnnouncement(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  deps: ChatAnnouncementDeps,
): Promise<ChatAnnouncementResult> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    // 🔴 ② この部屋の、消えていない、自分から読める発言だけ（`where` の threadId は「どの部屋の発言か」の指定。境界は RLS）。
    requireFound(
      await db.message.findFirst({
        where: {
          id: messageId,
          threadId,
          deletedAt: null,
          purgedAt: null,
          // ✅ 2026-10-27（チャットのファイル）: 🔴 検査が CLEAN でない添付の発言はアナウンスにできない（他の人には見えない発言を
          //    部屋の上部に固定させない。送った本人からでも 404 = 読めない発言と同じ扱い）。
          OR: [{ attachmentKey: null }, { attachmentScanStatus: 'CLEAN' }],
        },
        select: { id: true },
      }),
    );
    const existing = await db.chatThreadAnnouncement.findFirst({ where: { threadId }, select: { messageId: true } });
    // 同じ発言がもうアナウンスなら何もしない（冪等。監査ログも増やさない）。
    if (existing?.messageId === messageId) return { announcement: await currentAnnouncement(db, threadId) };
    const setAt = deps.now();
    await db.chatThreadAnnouncement.upsert({
      where: { tenantId_threadId: { tenantId: ctx.tenantId, threadId } },
      create: { tenantId: ctx.tenantId, threadId, messageId, setByUserId: ctx.userId, setAt },
      update: { messageId, setByUserId: ctx.userId, setAt },
    });
    await writeAuditLog(db, {
      action: CHAT_ANNOUNCEMENT_AUDIT_ACTION_SET,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: CHAT_THREAD_AUDIT_TARGET_TYPE,
      targetId: threadId,
      // 🔴 本文は載せない（発言 ID だけ）。置き換えたときは前の発言 ID も残す。
      summary: existing === null ? { messageId } : { messageId, replacedMessageId: existing.messageId },
      ipAddress: deps.meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
    return { announcement: await currentAnnouncement(db, threadId) };
  });
}

/** この発言を部屋のアナウンスにする（`PUT /api/threads/{id}/announcement`）。あれば置き換える。 */
export async function setChatAnnouncement(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  deps: ChatAnnouncementDeps,
): Promise<ChatAnnouncementResult> {
  try {
    return await writeAnnouncement(ctx, threadId, messageId, deps);
  } catch (error) {
    // 2 人が同時に、まだアナウンスの無い部屋で設定すると、片方の INSERT が一意制約で落ちる（トランザクションは巻き戻る）。
    // 行はもうあるので、新しいトランザクションでもう一度書けば置き換えになる（500 にしない）。
    if (isUniqueViolation(error)) return writeAnnouncement(ctx, threadId, messageId, deps);
    throw error;
  }
}

/**
 * この発言のアナウンスを外す（`DELETE /api/threads/{id}/announcement`）。
 * 🔴 ⑤ 今のアナウンスが別の発言なら何もしない（応答で今のアナウンスを返し、画面をそれに揃える）。
 */
export async function clearChatAnnouncement(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  messageId: string,
  deps: ChatAnnouncementDeps,
): Promise<ChatAnnouncementResult> {
  return withTenant(ctx, async (db) => {
    requireFound(await findChatThreadRow(db, threadId));
    // `messageId` は「どのアナウンスを外すか」の指定であり、境界ではない（読めない部屋の行は DELETE ポリシーが消させない）。
    const deleted = await db.chatThreadAnnouncement.deleteMany({ where: { threadId, messageId } });
    if (deleted.count > 0) {
      await writeAuditLog(db, {
        action: CHAT_ANNOUNCEMENT_AUDIT_ACTION_CLEAR,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: CHAT_THREAD_AUDIT_TARGET_TYPE,
        targetId: threadId,
        summary: { messageId },
        ipAddress: deps.meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });
    }
    return { announcement: await currentAnnouncement(db, threadId) };
  });
}
