// apps/web/lib/chat/rooms.ts
// ✅ 2026-10-16（#128 で紺野・宮田が合意）: 人単位の部屋（DM・グループ）を作る。
// `CLAUDE.md` §3.1 経路 3 / `docs/02` F-038 改訂 8 / `docs/05` §3.7.1・#51f・#51g。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **相手は「自分から見える利用者」だけ**（`users` の C8 DIRECTORY）。見えない人は 404 であり、
//      「居るが入れない」と書き分けない（`docs/05` §4.8。書き分けると別の取引先の人の存在を探れる）。
//   ② 🔴 **取引先は 1 部屋 1 社まで・取引先の人どうしの部屋は作らない。** 部屋の取引先は、メンバーの
//      所属から決める（利用者入力から受け取らない）。DB 側でもトリガ `chat_threads_members_party` が
//      同じ規則を検査する（二重防御）。
//   ③ 🔴 **同じ 2 人の DM は 1 つだけ**（`dm_key` の一意制約）。同時に開いても 2 つ目は作られず、
//      既存の部屋を返す。
//   ④ 🔴 **監査ログには「誰と誰が部屋を作ったか」だけ**を残す（本文・名前は残さない。#128）。
import { withTenant, writeAuditLog, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound, ValidationError } from '../api/errors';

/** 🔴 `docs/05` §16.1 の `*.create`。 */
export const CHAT_ROOM_AUDIT_ACTION_CREATE = 'thread.create';
export const CHAT_ROOM_AUDIT_TARGET_TYPE = 'ChatThread';

/** グループの人数の上限（作成者を含む）。 */
export const CHAT_GROUP_MAX_MEMBERS = 50;

export type ChatRoomDeps = {
  readonly now: () => Date;
  readonly meta: { readonly ipAddress: string | null };
};

export type ChatRoomResult = { readonly id: string; readonly created: boolean };

type RoomDb = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * 一意制約違反（Prisma の `P2002`）か。🔴 `@ses/db` は Prisma の型を export しないので、コードだけを見る。
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}

/** 同じ 2 人の DM を引くための鍵（小さい順に ':' で連結）。 */
export function dmKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * メンバーの所属から部屋の取引先を決める（純粋関数）。
 * - 全員ホスト → `null`（社内だけの部屋）
 * - ホスト + 取引先 1 社 → その取引先
 * - 🔴 取引先が 2 社以上 / ホストが 0 人 → `null` ではなく **例外**（作らない）
 */
export function roomPartnerOf(affiliations: readonly (string | null)[]): string | null {
  const partners = new Set(affiliations.filter((value): value is string => value !== null));
  if (partners.size > 1) throw new ValidationError(['userIds']);
  const hostCount = affiliations.filter((value) => value === null).length;
  if (partners.size === 1 && hostCount === 0) throw new ValidationError(['userIds']);
  return partners.size === 1 ? [...partners][0] ?? null : null;
}

/** 見える利用者だけを引き、1 人でも見えなければ 404（①）。 */
async function requireVisibleUsers(
  db: RoomDb,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const rows = (await db.user.findMany({
    where: { id: { in: [...userIds] }, disabledAt: null },
    select: { id: true, ownerPartnerCompanyId: true },
  })) as readonly { id: string; ownerPartnerCompanyId: string | null }[];
  if (rows.length !== userIds.length) requireFound(null);
  return new Map(rows.map((row) => [row.id, row.ownerPartnerCompanyId]));
}

async function createRoom(
  ctx: AuthenticatedTenantCtx,
  db: RoomDb,
  input: {
    readonly kind: 'DM' | 'GROUP';
    readonly memberUserIds: readonly string[];
    readonly partnerCompanyId: string | null;
    readonly title: string | null;
    readonly dmKey: string | null;
  },
  deps: ChatRoomDeps,
): Promise<string> {
  const now = deps.now();
  const thread = (await db.chatThread.create({
    data: {
      // 🔴 分離キーは認証コンテキストから（`CLAUDE.md` §3.1）。
      tenantId: ctx.tenantId,
      kind: input.kind,
      partnerCompanyId: input.partnerCompanyId,
      memberUserIds: [...input.memberUserIds],
      title: input.title,
      dmKey: input.dmKey,
      createdByUserId: ctx.userId,
    },
    select: { id: true },
  })) as { id: string };
  // 会社の段（`thread_participants`）。ホストは必ず、取引先との部屋なら取引先も。
  // 🔴 `createMany`（RETURNING しない）: 取引先の文脈ではホストの行（NULL）が SELECT の対象外なので、
  //    `create` の読み返しが RLS で拒否される。INSERT の可否は WITH CHECK（`app_thread_is_my_room`）が決める。
  await db.threadParticipant.createMany({
    data: [
      { tenantId: ctx.tenantId, threadId: thread.id, partnerCompanyId: null, joinedAt: now },
      ...(input.partnerCompanyId === null
        ? []
        : [{ tenantId: ctx.tenantId, threadId: thread.id, partnerCompanyId: input.partnerCompanyId, joinedAt: now }]),
    ],
  });
  // ④ 誰と誰か（user_id の並び）だけ。名前・本文は載せない。
  await writeAuditLog(db, {
    action: CHAT_ROOM_AUDIT_ACTION_CREATE,
    actorKind: 'USER',
    actorId: ctx.userId,
    targetType: CHAT_ROOM_AUDIT_TARGET_TYPE,
    targetId: thread.id,
    summary: { kind: input.kind, memberCount: input.memberUserIds.length, memberUserIds: [...input.memberUserIds].sort().join(',') },
    ipAddress: deps.meta.ipAddress,
    deviceKind: ctx.deviceKind,
  });
  return thread.id;
}

/** その人との DM を開く（無ければ作る）。`POST /api/threads/dm`（`docs/05` §6.5 #51f）。 */
export async function openDirectMessage(
  ctx: AuthenticatedTenantCtx,
  peerUserId: string,
  deps: ChatRoomDeps,
): Promise<ChatRoomResult> {
  if (peerUserId === ctx.userId) throw new ValidationError(['userId']);
  const dmKey = dmKeyOf(ctx.userId, peerUserId);
  try {
    return await withTenant(ctx, async (db) => {
      const existing = (await db.chatThread.findFirst({ where: { dmKey }, select: { id: true } })) as { id: string } | null;
      if (existing !== null) return { id: existing.id, created: false };
      const affiliations = await requireVisibleUsers(db, [ctx.userId, peerUserId]);
      const partnerCompanyId = roomPartnerOf([...affiliations.values()]);
      const id = await createRoom(
        ctx,
        db,
        { kind: 'DM', memberUserIds: [ctx.userId, peerUserId], partnerCompanyId, title: null, dmKey },
        deps,
      );
      return { id, created: true };
    });
  } catch (error) {
    // ③ 同時に開いた 2 つ目は一意制約で落ちる → 既存の部屋を返す。
    if (isUniqueViolation(error)) {
      return withTenant(ctx, async (db) => {
        const existing = (await db.chatThread.findFirst({ where: { dmKey }, select: { id: true } })) as { id: string } | null;
        return { id: requireFound(existing).id, created: false };
      });
    }
    throw error;
  }
}

/** グループを作る。`POST /api/threads/groups`（`docs/05` §6.5 #51g）。作成者は必ずメンバーに入る。 */
export async function createChatGroup(
  ctx: AuthenticatedTenantCtx,
  input: { readonly title: string; readonly userIds: readonly string[] },
  deps: ChatRoomDeps,
): Promise<ChatRoomResult> {
  const memberUserIds = [...new Set([ctx.userId, ...input.userIds])];
  if (memberUserIds.length < 2 || memberUserIds.length > CHAT_GROUP_MAX_MEMBERS) {
    throw new ValidationError(['userIds']);
  }
  return withTenant(ctx, async (db) => {
    const affiliations = await requireVisibleUsers(db, memberUserIds);
    const partnerCompanyId = roomPartnerOf(memberUserIds.map((id) => affiliations.get(id) ?? null));
    const id = await createRoom(
      ctx,
      db,
      { kind: 'GROUP', memberUserIds, partnerCompanyId, title: input.title, dmKey: null },
      deps,
    );
    return { id, created: true };
  });
}
