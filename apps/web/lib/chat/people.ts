// apps/web/lib/chat/people.ts
// ✅ 2026-10-19（#128 で合意 / #129 の DB の上）: 人単位の部屋（DM・グループ）と連絡先を読む。
// `docs/02` F-038 改訂 8 / `docs/04` S-031 改訂 39 / `docs/05` §3.7.1。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **母集団は RLS が決める。** DM・グループは `chat_threads` の C10 MEMBER（自分がメンバーの部屋だけ）、
//      人は `users` の C8 DIRECTORY（取引先からは自社〔ホスト〕と自社の人だけ）。`where` に境界を書き足さない。
//   ② 🔴 **取引先の人の連絡先には、自社（ホスト）の人だけを出す**（#128。取引先の人どうしの DM は作らない
//      ので、出しても押せない導線になる）。C8 が見せる「同じ取引先の同僚」は、ここで連絡先から外す。
//   ③ 🔴 **他の取引先の社名・人を引く経路が無い**（C8 / C5 が他社の行を返さない）。
//   ④ 名前が読めない人は `null`（既定値で埋めない。`views.ts` と同じ作法）。
import type { AuthenticatedTenantCtx } from '@ses/db';
import { withTenant } from '@ses/db';
import { countUnread, readThreadPrefs } from './read-state';
import { t } from '@ses/i18n';
import { lastMessageSnippet } from './thread-tree';
import { readChatUserStatuses } from './user-status';
import type { ChatMemberView, ChatRoomListItem, ChatThreadDetailView } from './views';

type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/** 連絡先の 1 人。 */
export type ChatContact = {
  readonly userId: string;
  readonly name: string | null;
  readonly companyName: string | null;
  readonly isHost: boolean;
  /** ✅ 2026-10-19: ひとこと状態（`chat_user_statuses`。RLS で読めた人の、空でないものだけ）。 */
  readonly status?: string | null;
};

/** 連絡先（開閉式の欄）。 */
export type ChatContacts = {
  /** 最近やり取りした人（DM の相手。新しい順に最大 `CHAT_RECENT_CONTACTS` 人）。 */
  readonly recent: readonly ChatContact[];
  /** 会社ごとの人（自社が先、取引先は社名順。人は名前順）。 */
  readonly companies: readonly { readonly companyName: string | null; readonly isHost: boolean; readonly people: readonly ChatContact[] }[];
};

export type ChatPeopleData = {
  /** 自分が入っている DM・グループ（新しい順）。 */
  readonly rooms: readonly ChatRoomListItem[];
  readonly contacts: ChatContacts;
  /** 部屋ごとの未読の件数（0 は載せない）。 */
  readonly unreadCounts: Readonly<Record<string, number>>;
  readonly pinnedIds: readonly string[];
  readonly mutedIds: readonly string[];
  /** ✅ 2026-10-19: 部屋ごとの最後の発言の冒頭（一覧の 2 段目）。🔴 読めた発言だけ。 */
  readonly lastSnippets: Readonly<Record<string, string>>;
  /**
   * ✅ 2026-10-26（#166 の 7）: 上限（`CHAT_ROOMS_MAX` / `CHAT_CONTACTS_MAX`）で読み切れなかった部屋・人があるか。
   * 黙って消さず、画面が「表示しきれない分がある」と出すため。🔴 件数は返さない。
   */
  readonly roomsTruncated?: boolean;
  readonly contactsTruncated?: boolean;
};

export const CHAT_RECENT_CONTACTS = 5;
/** 連絡先に読む人数の上限（1 テナントの利用者は数十〜数百人）。 */
export const CHAT_CONTACTS_MAX = 500;
/** 一覧に読む DM・グループの上限。 */
export const CHAT_ROOMS_MAX = 300;

const ROOM_SELECT = { id: true, kind: true, title: true, memberUserIds: true, lastMessageAt: true, partnerCompanyId: true } as const;
type RoomRow = {
  readonly id: string;
  /** 🔴 読み出しの中でだけ使う（会社のまとまりの鍵を引く）。画面データに載せない。 */
  readonly partnerCompanyId: string | null;
  readonly kind: string;
  readonly title: string | null;
  readonly memberUserIds: readonly string[];
  readonly lastMessageAt: Date | null;
};

type UserRow = { readonly id: string; readonly displayName: string; readonly ownerPartnerCompanyId: string | null };

/** 見える人（C8）を ID から引く。読めない人は載らない。 */
async function readUsers(db: Pick<TenantDb, 'user'>, ids: readonly string[]): Promise<ReadonlyMap<string, UserRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = (await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, displayName: true, ownerPartnerCompanyId: true },
  })) as readonly UserRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** 会社名（ホストはテナントの商号、取引先は C5 で見える社名）。 */
async function companyNamesOf(
  db: Pick<TenantDb, 'partnerCompany' | 'tenant'>,
  partnerIds: readonly (string | null)[],
): Promise<(partnerId: string | null) => string | null> {
  const tenant = await db.tenant.findFirst({ select: { name: true } });
  const unique = [...new Set(partnerIds.filter((id): id is string => id !== null))];
  const companies =
    unique.length === 0
      ? []
      : await db.partnerCompany.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  const byId = new Map(companies.map((company) => [company.id, company.name]));
  return (partnerId) => (partnerId === null ? tenant?.name ?? null : byId.get(partnerId) ?? null);
}

/** 部屋の表示名: グループはその名前、DM は相手の名前（読めなければ `null`）。 */
function roomName(row: RoomRow, viewerId: string, users: ReadonlyMap<string, UserRow>): string | null {
  if (row.kind === 'GROUP') return row.title;
  const peer = row.memberUserIds.find((id) => id !== viewerId);
  return peer === undefined ? null : users.get(peer)?.displayName ?? null;
}

/** DM・グループと連絡先を読む（画面の一覧の欄）。🔴 呼び出し側の `withTenant` の中で呼ぶ。 */
export async function readPeople(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'chatThread' | 'user' | 'partnerCompany' | 'tenant' | 'message' | 'chatReadState' | 'chatUserStatus'>,
  /** ✅ 2026-10-19（v2）: 取引先 → 会社のまとまりの鍵（`read.ts`）。省略時は会社から辿れない。 */
  companyKeyOf: (partnerCompanyId: string | null) => string | null = () => null,
): Promise<ChatPeopleData> {
  // ① 母集団は C10 MEMBER（自分がメンバーの部屋だけ）。`where` は種類だけ。
  const fetchedRooms = (await db.chatThread.findMany({
    where: { kind: { in: ['DM', 'GROUP'] } },
    select: ROOM_SELECT,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: CHAT_ROOMS_MAX + 1,
  })) as readonly RoomRow[];
  // ✅ 2026-10-26（#166 の 7）: 上限を超えた分は「表示しきれない」と画面に出す（黙って消さない）。
  const roomsTruncated = fetchedRooms.length > CHAT_ROOMS_MAX;
  const latestRooms = fetchedRooms.slice(0, CHAT_ROOMS_MAX);
  // ✅ 2026-10-26（#166 の 7）: ピン留めした部屋は、古くて上限の外にあっても必ず出す。
  //    🔴 ピン留めの行は本人の行だけ（C7）、部屋は C10 MEMBER（今もメンバーの部屋だけ）が決める。
  const latestIds = new Set(latestRooms.map((row) => row.id));
  const pinnedOutside = (await db.chatReadState.findMany({ where: { pinned: true }, select: { threadId: true } }))
    .map((row) => row.threadId)
    .filter((id) => !latestIds.has(id));
  const pinnedRooms =
    pinnedOutside.length === 0
      ? []
      : ((await db.chatThread.findMany({
          where: { id: { in: pinnedOutside }, kind: { in: ['DM', 'GROUP'] } },
          select: ROOM_SELECT,
        })) as readonly RoomRow[]);
  const rows = [...latestRooms, ...pinnedRooms];
  // ① 母集団は C8 DIRECTORY。
  // ✅ 2026-10-19（#137 レビュー）: 取引先の文脈では最初から自社（ホスト）の人だけを読む（同僚が多いとホストの人が
  //    上限の外に押し出される）。🔴 これは表示の絞り込みで、境界は C8 のまま（② の フィルタも残す）。
  const fetchedPeople = (await db.user.findMany({
    where: { disabledAt: null, id: { not: ctx.userId }, ...(ctx.partnerCompanyId === null ? {} : { ownerPartnerCompanyId: null }) },
    select: { id: true, displayName: true, ownerPartnerCompanyId: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    take: CHAT_CONTACTS_MAX + 1,
  })) as readonly UserRow[];
  const contactsTruncated = fetchedPeople.length > CHAT_CONTACTS_MAX;
  const people = fetchedPeople.slice(0, CHAT_CONTACTS_MAX);
  const users = await readUsers(db, [...rows.flatMap((row) => row.memberUserIds), ...people.map((person) => person.id)]);
  const nameOfCompany = await companyNamesOf(db, people.map((person) => person.ownerPartnerCompanyId));

  // ② 取引先の人の連絡先は自社（ホスト）の人だけ。
  const isHostViewer = ctx.partnerCompanyId === null;
  const contactable = people.filter((person) => isHostViewer || person.ownerPartnerCompanyId === null);
  // ✅ 2026-10-19: 連絡先に出す人のひとこと状態（RLS 任せ。見えない人の状態は返らない）。
  const statuses = await readChatUserStatuses(db, contactable.map((person) => person.id));
  const toContact = (person: UserRow): ChatContact => ({
    userId: person.id,
    name: person.displayName,
    companyName: nameOfCompany(person.ownerPartnerCompanyId),
    isHost: person.ownerPartnerCompanyId === null,
    status: statuses.get(person.id) ?? null,
  });

  const byCompany = new Map<string, UserRow[]>();
  for (const person of contactable) {
    const key = person.ownerPartnerCompanyId ?? '';
    byCompany.set(key, [...(byCompany.get(key) ?? []), person]);
  }
  const companies = [...byCompany.entries()]
    .map(([key, members]) => ({
      companyName: nameOfCompany(key === '' ? null : key),
      isHost: key === '',
      people: members.map(toContact),
    }))
    .sort((a, b) => (a.isHost === b.isHost ? (a.companyName ?? '').localeCompare(b.companyName ?? '', 'ja') : a.isHost ? -1 : 1));

  const contactableIds = new Set(contactable.map((person) => person.id));
  const recentIds: string[] = [];
  for (const row of rows) {
    if (row.kind !== 'DM') continue;
    const peer = row.memberUserIds.find((id) => id !== ctx.userId);
    if (peer !== undefined && contactableIds.has(peer) && !recentIds.includes(peer)) recentIds.push(peer);
    if (recentIds.length >= CHAT_RECENT_CONTACTS) break;
  }
  const recent = recentIds
    .map((id) => contactable.find((person) => person.id === id))
    .filter((person): person is UserRow => person !== undefined)
    .map(toContact);

  const roomIds = rows.map((row) => row.id);
  const lastMessages =
    roomIds.length === 0
      ? []
      : await db.message.findMany({
          where: { threadId: { in: roomIds } },
          distinct: ['threadId'],
          orderBy: [{ threadId: 'asc' }, { sentAt: 'desc' }, { id: 'desc' }],
          select: { threadId: true, body: true, attachedProjectId: true },
        });
  const unread = await countUnread(ctx, db, roomIds);
  const prefs = await readThreadPrefs(db, roomIds);
  return {
    rooms: rows.map((row) => ({
      id: row.id,
      kind: row.kind === 'GROUP' ? 'GROUP' : 'DM',
      name: roomName(row, ctx.userId, users),
      memberCount: row.memberUserIds.length,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      memberUserIds: [...row.memberUserIds],
      external: row.partnerCompanyId !== null,
      companyKey: companyKeyOf(row.partnerCompanyId),
    })),
    contacts: { recent, companies },
    unreadCounts: Object.fromEntries(unread),
    pinnedIds: [...prefs.entries()].filter(([, value]) => value.pinned).map(([id]) => id),
    mutedIds: [...prefs.entries()].filter(([, value]) => value.muted).map(([id]) => id),
    lastSnippets: Object.fromEntries(lastMessages.map((message) => [message.threadId, lastMessageSnippet(message, t('chat.snippet.projectShared'))])),
    roomsTruncated,
    contactsTruncated,
  };
}

/**
 * DM・グループ 1 部屋の詳細（右の欄にメンバーを出す）。🔴 見えなければ `null`（呼び出し側が 404 / 一覧へ）。
 * 🔴 会社の段（参加会社）は出さない —— 人の段の部屋で読み手に要るのは「誰が読めるか」である。
 */
export async function readRoomDetail(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'chatThread' | 'user' | 'partnerCompany' | 'tenant' | 'chatUserStatus'>,
  threadId: string,
): Promise<ChatThreadDetailView | null> {
  const row = (await db.chatThread.findFirst({
    where: { id: threadId, kind: { in: ['DM', 'GROUP'] } },
    select: ROOM_SELECT,
  })) as RoomRow | null;
  if (row === null) return null;
  const users = await readUsers(db, row.memberUserIds);
  const statuses = await readChatUserStatuses(db, row.memberUserIds);
  const nameOfCompany = await companyNamesOf(
    db,
    row.memberUserIds.map((id) => users.get(id)?.ownerPartnerCompanyId ?? null),
  );
  const members: ChatMemberView[] = row.memberUserIds.map((id) => {
    const user = users.get(id);
    return {
      userId: id,
      name: user?.displayName ?? null,
      companyName: user === undefined ? null : nameOfCompany(user.ownerPartnerCompanyId),
      isHost: user === undefined ? false : user.ownerPartnerCompanyId === null,
      self: id === ctx.userId,
      status: statuses.get(id) ?? null,
    };
  });
  return {
    id: row.id,
    kind: row.kind === 'GROUP' ? 'GROUP' : 'DM',
    project: null,
    counterpartyName: roomName(row, ctx.userId, users),
    participants: [],
    members,
  };
}
