// apps/web/lib/chat/read.ts
// `S-031` チャットの読み取り（`docs/05` §6.5 #50 `GET /api/threads` / `GET /api/threads/{id}/messages`。
// `F-038` / `docs/04` §S-031 / `CLAUDE.md` §3.1 **越境経路 3**）。
//
// ============================================================================
// 🔴 ここが守るもの（レビューの焦点）
// ============================================================================
//   ① 🔴 **母集団はアプリが決めない。** `chat_threads` / `messages` は RLS の **C6 THREAD**
//      （`<T> = app_tenant_id() AND ( app_is_host() OR ( <O> = app_partner_id() AND EXISTS
//      (SELECT 1 FROM thread_participants p … p.left_at IS NULL) ) )`。
//      `packages/db/prisma/migrations/20260903050000_rls_policies/migration.sql`）、
//      `thread_participants` は **C5 PARTY** である。
//      🔴 **`where` に `tenantId` / `partnerCompanyId` / 参加会社の条件を 1 つも書き足さない。**
//      書き足すと「RLS が静かに緩んだ」ことに誰も気づけなくなる（二重に書いた条件がアプリ側で
//      結果を同じに見せてしまうため）。`where` に置くのは**業務上の絞り込み**（どのスレッドの
//      会話か = `threadId`）だけである。
//   ② 🔴 **他社の示唆を 1 つも返さない。** `total`（総件数）を返さない / 未読を持たない /
//      参加していないスレッドの存在・件数・相手の社名を返さない（`F-038 AC-1` / `docs/05` §4.8
//      「見えない ＝ 存在しない」）。**「0 件」と「見えない」を応答で区別できる形を作らない。**
//   ③ 🔴 **見えないスレッド ID は 404**（`requireFound`）。403 と書き分けない（§4.8）。
//      これは「存在するが権限が無い」を漏らさないためであり、不存在の ID と**同じ応答**になる。
//   ④ 🔴 **参照の解決は別クエリで行う**（`include` のリレーション必須化で Prisma が例外を投げるのを
//      避ける。`lib/proposals/list.ts` の `readProjectRefs` と同じ判断）。取引先に公開されていない
//      案件は `projects` の C4 が行を返さず、**名前が `null` になる**のが正しい挙動である。
//   ⑤ 🔴 **閲覧の監査ログを書かない。** `CLAUDE.md` §3.5 / `BR-27` の列挙に「チャットの閲覧」は無い
//      （記録を増やすことも設計判断であり、列挙に無いものを足さない）。**投稿は `service.ts` が
//      `message.create` を書く**（§3.5 の「作成・更新・削除」）。
//   ⑥ 🔴 **運営者はこの経路に到達しない。** 本モジュールは `withTenant`（`app_tenant` ロール）しか
//      使わず、`withPlatformRead` を 1 度も呼ばない（`CLAUDE.md` §10.5「チャットの本文に到達しない」）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（分離テストがサーバを立てずに同じ経路を実行できる。
//    `lib/proposals/list.ts` と同方針）。
import { freeWordFilter, readDmPeerReadMessageIds, withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound, ValidationError } from '../api/errors';
import { buildCursorPage, takeForCursorPage, type CursorPage } from '../api/pagination';
import type { ChatMessageListQuery, ChatThreadListQuery } from './schemas';
import {
  MESSAGE_SEARCH_LIMIT,
  MESSAGE_SEARCH_MIN_LENGTH,
  buildThreadTree,
  companyKeysOf,
  messageSnippet,
  type ChatThreadGroup,
  type ChatThreadSort,
} from './thread-tree';
import { FAST_REPLY_WINDOW_DAYS, fastReplyGroupKeys } from './reply-speed';
import { countUnread, readPositions, readThreadPrefs, type ChatThreadPrefs } from './read-state';
import { readPeople, readRoomDetail, type ChatPeopleData } from './people';
import {
  chatThreadCursorWhere,
  decodeChatThreadCursor,
  encodeChatThreadCursor,
  type ChatThreadCursorWhere,
} from './thread-cursor';
import {
  chatMessageView,
  COMPANY_ROOM_KINDS,
  chatThreadDetailView,
  chatThreadListItem,
  type ChatMessageRow,
  type ChatMessageView,
  type ChatParticipantView,
  type ChatProjectRef,
  type ChatThreadDetailView,
  type ChatThreadListItem,
  type ChatThreadRow,
  summarizeReactions,
} from './views';

/** `withTenant` が `fn` に渡すクライアント。 */
type TenantDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 🔴 `chat_threads` の `select`。**列を選んで写す**（行を spread しない）。
 *    `partnerCompanyId` は相手の社名を引くためだけに読み、応答には載せない（`views.ts` の 🔴）。
 */
const CHAT_THREAD_SELECT = {
  id: true,
  kind: true,
  projectId: true,
  partnerCompanyId: true,
  lastMessageAt: true,
} as const;

/** 🔴 `messages` の `select`。**`attachmentKey` / `attachmentScanStatus` / `reviewGateId` を読まない。** */
export const CHAT_MESSAGE_SELECT = {
  id: true,
  senderUserId: true,
  senderPartnerCompanyId: true,
  body: true,
  sentAt: true,
  editedAt: true,
  deletedAt: true,
} as const;

export type SelectedChatThreadRow = ChatThreadRow & { readonly partnerCompanyId: string };
/** ✅ 2026-10-19（#128）: 1 部屋を引いた行。DM・グループの社内の部屋は取引先を持たない（`null`）。 */
export type FoundChatThreadRow = ChatThreadRow & { readonly partnerCompanyId: string | null };
type SelectedThreadRow = SelectedChatThreadRow;

export type ChatThreadListView = CursorPage<ChatThreadListItem>;
export type ChatMessageListView = CursorPage<ChatMessageView>;

/**
 * 相手の社名を引く。
 *
 * - ホスト文脈 … スレッドの `partner_company_id` の社名（`partner_companies` の C5 でホストは全行を読む）。
 * - 取引先文脈 … 🔴 **ホスト企業（テナント）の商号**。見えているスレッドはすべて自社が当事者なので
 *   （C6 が `<O> = app_partner_id()` を要求する）、相手は常にホストである。
 *   **他パートナーの社名を引く経路はこの関数に存在しない。**
 */
async function resolveCounterpartyNames(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'partnerCompany' | 'tenant'>,
  partnerCompanyIds: readonly string[],
): Promise<(partnerCompanyId: string) => string | null> {
  if (ctx.partnerCompanyId !== null) {
    const tenant = await db.tenant.findFirst({ select: { name: true } });
    const name = tenant?.name ?? null;
    return () => name;
  }
  const unique = [...new Set(partnerCompanyIds)];
  if (unique.length === 0) return () => null;
  const companies = await db.partnerCompany.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const byId = new Map(companies.map((company) => [company.id, company.name]));
  return (partnerCompanyId) => byId.get(partnerCompanyId) ?? null;
}

/**
 * 取引先企業の社名を引く（🔴 **自分に見える行だけ**）。
 *
 * ⚠️ `resolveCounterpartyNames` とは**別物**である。あちらは「スレッドの相手は誰か」を所属で
 *    場合分けして答えるが、ここは「**この `partner_company_id` の社名**」をそのまま引く。
 *    🔴 混ぜると、取引先が**自分の発言の会社名として相手（ホスト）の商号**を見ることになる
 *    （`resolveCounterpartyNames` は取引先文脈では引数を無視してテナント名を返すため）。
 * 🔴 母集団は `partner_companies` の RLS（C5）が決める —— 取引先には自社 1 行しか見えない。
 */
async function resolvePartnerCompanyNames(
  db: Pick<TenantDb, 'partnerCompany'>,
  partnerCompanyIds: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(partnerCompanyIds.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const companies = await db.partnerCompany.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(companies.map((company) => [company.id, company.name]));
}

/** 案件名を引く（🔴 別クエリ。取引先に公開されていない案件は 0 件 = 名前が `null`）。 */
async function resolveProjectRefs(
  db: Pick<TenantDb, 'project'>,
  projectIds: readonly (string | null)[],
): Promise<ReadonlyMap<string, ChatProjectRef>> {
  const unique = [...new Set(projectIds.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const projects = await db.project.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(projects.map((project) => [project.id, { id: project.id, name: project.name }]));
}

/**
 * スレッド一覧の 1 ページ。
 *
 * 🔴 **境界の条件を `where` に 1 つも書かない**（母集団は RLS の C6 が決める。ファイル冒頭の ①）。
 *    ここで組み立てる `where` は**並び順の中の位置**（カーソル）だけであり、`tenant_id` /
 *    `partner_company_id` / 参加会社を 1 つも含まない（`thread-cursor.ts` の ⚠️）。
 * 🔴 Prisma の `cursor: { id }` を使わないのは `last_message_at` が `NULL` を取りうるためである
 *    （`thread-cursor.ts` の 🔴。行が 2 ページ目以降から静かに落ちる）。
 */
async function readThreadPage(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'chatThread' | 'partnerCompany' | 'tenant' | 'project'>,
  query: ChatThreadListQuery,
): Promise<ChatThreadListView> {
  // 🔴 境界検証（Zod の `refine`）を通った値だけが来るが、**ここでも形を確かめて 400 にする**
  //    —— 画面（サーバコンポーネント）は Route Handler を通らず、この関数が唯一の入口になる。
  const cursor = query.cursor === undefined ? null : decodeChatThreadCursor(query.cursor);
  if (query.cursor !== undefined && cursor === null) throw new ValidationError(['query.cursor']);
  const where: ChatThreadCursorWhere | Record<string, never> =
    cursor === null ? {} : chatThreadCursorWhere(cursor);

  const rows = (await db.chatThread.findMany({
    where: { ...where, kind: { in: [...COMPANY_ROOM_KINDS] } },
    select: CHAT_THREAD_SELECT,
    // 🔴 最終更新の新しい順。**メッセージが 1 件も無いスレッド（`NULL`）は最後**に置く
    //    （Postgres の `DESC` の既定は NULLS FIRST であり、放置されたスレッドが先頭に来てしまう）。
    //    同時刻のタイブレークは `id`（`uuid(7)` なので時系列）。
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: takeForCursorPage(query.limit),
  })) as readonly SelectedThreadRow[];

  const page = buildCursorPage(rows, query.limit, (row) => encodeChatThreadCursor(row));
  const counterpartyOf = await resolveCounterpartyNames(ctx, db, page.items.map((row) => row.partnerCompanyId));
  const projects = await resolveProjectRefs(db, page.items.map((row) => row.projectId));
  return {
    items: page.items.map((row) =>
      chatThreadListItem(row, {
        project: row.projectId === null ? null : projects.get(row.projectId) ?? null,
        counterpartyName: counterpartyOf(row.partnerCompanyId),
      }),
    ),
    nextCursor: page.nextCursor,
  };
}

/**
 * ✅ 2026-10-14（チャットレーン）: 画面の一覧を**会社ごとの木**にするために読む上限。
 * 🔴 木は会社ごとにまとめるので、ページ単位では組めない（同じ会社のスレッドがページをまたぐ）。
 *    上限を超えたら `truncated` を立て、画面は「古いスレッドは表示していません」と書く（黙って落とさない）。
 */
export const CHAT_THREAD_TREE_MAX = 1000;

/** 本文の検索で当たった発言 1 件。🔴 読めた発言だけ（RLS の C6）。本文は前後だけの抜粋。 */
export type ChatMessageHit = {
  readonly threadId: string;
  readonly messageId: string;
  readonly sentAt: string;
  /** スレッドの名前（案件名、無ければ相手の会社名）。 */
  readonly threadTitle: string | null;
  readonly snippet: string;
};

export type ChatThreadTreeData = {
  readonly groups: readonly ChatThreadGroup[];
  /** ✅ 2026-10-14: 本文の検索で当たった発言（`q` が 2 文字以上のときだけ。新しい順に最大 20 件）。 */
  readonly messageHits: readonly ChatMessageHit[];
  /** ✅ 2026-10-16: スレッドごとの未読の件数（自分以外の発言で既読位置より後ろ。0 は載せない）。 */
  readonly unreadCounts: Readonly<Record<string, number>>;
  /** ✅ 2026-10-16: 自分がピン留め・ミュートしているスレッド（C7。本人の設定だけ）。 */
  readonly pinnedIds: readonly string[];
  readonly mutedIds: readonly string[];
  /** 上限を超えたので、古いスレッドを読んでいない。 */
  readonly truncated: boolean;
  /** ✅ 2026-10-19: スレッドごとの最後の発言の冒頭（一覧の 2 段目）。 */
  readonly lastSnippets: Readonly<Record<string, string>>;
};

/**
 * ✅ 2026-10-14: スレッド一覧を会社ごとの木で読む（`lib/chat/thread-tree.ts`）。
 * 🔴 母集団は `readThreadPage` と同じ（`where` に境界を書かない。RLS の C6 が決める）。並びも同じ。
 */
async function readThreadTree(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'chatThread' | 'partnerCompany' | 'tenant' | 'project' | 'message' | 'chatReadState'>,
  options: { readonly sort: ChatThreadSort; readonly q: string | null; readonly unreadOnly?: boolean },
): Promise<{ readonly tree: ChatThreadTreeData; readonly companyKeyOf: (partnerCompanyId: string | null) => string | null }> {
  const rows = (await db.chatThread.findMany({
    where: { kind: { in: [...COMPANY_ROOM_KINDS] } },
    select: CHAT_THREAD_SELECT,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: CHAT_THREAD_TREE_MAX + 1,
  })) as readonly SelectedThreadRow[];
  const truncated = rows.length > CHAT_THREAD_TREE_MAX;
  const kept = truncated ? rows.slice(0, CHAT_THREAD_TREE_MAX) : rows;
  const counterpartyOf = await resolveCounterpartyNames(ctx, db, kept.map((row) => row.partnerCompanyId));
  const projects = await resolveProjectRefs(db, kept.map((row) => row.projectId));
  // ✅ 2026-10-14: 要返信と返信の速さ（`reply-speed.ts`）。🔴 発言の**時刻と送った側だけ**を読む（本文を読まない）。
  //    母集団は `messages` の RLS（C6）。`where` は「どのスレッドか」と期間だけで、境界を書き足さない。
  const threadIds = kept.map((row) => row.id);
  const host = ctx.partnerCompanyId === null;
  const lastMessages =
    threadIds.length === 0
      ? []
      : await db.message.findMany({
          where: { threadId: { in: threadIds } },
          distinct: ['threadId'],
          orderBy: [{ threadId: 'asc' }, { sentAt: 'desc' }, { id: 'desc' }],
          select: { threadId: true, senderPartnerCompanyId: true, body: true },
        });
  // ✅ 2026-10-19: 一覧の 2 段目（最後の発言の冒頭）。🔴 読めた発言だけ（C6）。削除・保持期限で本文が無いものは空。
  const lastSnippets: Record<string, string> = Object.fromEntries(
    lastMessages.map((message) => [message.threadId, messageSnippet(message.body ?? '', '', 60)]),
  );
  // ✅ 2026-10-22（紺野「要返信はいらない」）: 要返信（最後の発言が相手から）の計算をやめた。「保存済み」に置き換え。
  // 🔴 返信が早い取引先は**ホストにだけ**（取引先には他社との比較を出さない）。
  let fastReplyKeys: ReadonlySet<string> = new Set();
  if (host && threadIds.length > 0) {
    const since = new Date(Date.now() - FAST_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await db.message.findMany({
      where: { threadId: { in: threadIds }, sentAt: { gte: since } },
      select: { threadId: true, senderPartnerCompanyId: true, sentAt: true },
    });
    const groupOf = new Map(kept.map((row) => [row.id, row.partnerCompanyId]));
    fastReplyKeys = fastReplyGroupKeys(
      recent.map((message) => ({
        threadId: message.threadId,
        groupKey: groupOf.get(message.threadId) ?? message.threadId,
        fromPartner: message.senderPartnerCompanyId !== null,
        sentAt: message.sentAt,
      })),
    );
  }
  // ✅ 2026-10-16: 未読の件数（`read-state.ts`）。🔴 既読位置は C7（本人の行だけ）、数えるのは C6 越し。
  const unread = await countUnread(ctx, db, threadIds);
  const prefs = await readThreadPrefs(db, threadIds);
  const groups = buildThreadTree(
    kept.map((row) => ({
      groupKey: row.partnerCompanyId,
      item: chatThreadListItem(row, {
        project: row.projectId === null ? null : projects.get(row.projectId) ?? null,
        counterpartyName: counterpartyOf(row.partnerCompanyId),
      }),
    })),
    {
      sort: options.sort,
      q: options.q,
      fastReplyKeys,
      ...(options.unreadOnly === true ? { onlyThreadIds: new Set(unread.keys()) } : {}),
    },
  );
  // ✅ 2026-10-14: 本文の検索（紺野の決定）。🔴 母集団は `messages` の RLS（C6）だけ（`where` は検索語とスレッドだけ）。
  //    照合は `@ses/db` の `freeWordFilter`（検索の実装の唯一の出所。docs/05 TBD-8 / `search-sql-single-path.test.ts`）。
  //    削除済みの本文（`NULL`）は当たらない。短すぎる語（2 文字未満）では走査しない。
  const needle = options.q?.trim() ?? '';
  const allTitles = new Map(
    kept.map((row) => [row.id, projects.get(row.projectId ?? '')?.name ?? counterpartyOf(row.partnerCompanyId)] as const),
  );
  const messageHits: ChatMessageHit[] =
    needle.length < MESSAGE_SEARCH_MIN_LENGTH || threadIds.length === 0
      ? []
      : (
          await db.message.findMany({
            where: { threadId: { in: threadIds }, body: freeWordFilter(needle) },
            select: { id: true, threadId: true, body: true, sentAt: true },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: MESSAGE_SEARCH_LIMIT,
          })
        ).map((message) => ({
          threadId: message.threadId,
          messageId: message.id,
          sentAt: message.sentAt.toISOString(),
          threadTitle: allTitles.get(message.threadId) ?? null,
          snippet: messageSnippet(message.body ?? '', needle),
        }));
  // ✅ 2026-10-19（v2）: 取引先 → 会社のまとまりの鍵（DM・グループを「会社から」辿るため。🔴 取引先の ID は画面データに出さない）。
  const keyByPartner = companyKeysOf(kept.map((row) => ({ groupKey: row.partnerCompanyId, item: { id: row.id, kind: row.kind } as ChatThreadListItem })));
  const companyKeyOf = (partnerCompanyId: string | null) => (partnerCompanyId === null ? null : keyByPartner.get(partnerCompanyId) ?? null);
  const tree: ChatThreadTreeData = {
    groups,
    truncated,
    lastSnippets,
    messageHits,
    unreadCounts: Object.fromEntries(unread),
    pinnedIds: [...prefs.entries()].filter(([, value]) => value.pinned).map(([id]) => id),
    mutedIds: [...prefs.entries()].filter(([, value]) => value.muted).map(([id]) => id),
  };
  return { tree, companyKeyOf };
}

/**
 * 1 スレッドの行（🔴 見えなければ `null`。呼び出し側が 404 に畳む）。
 *
 * 🔴 **投稿（`service.ts`）もこの 1 実装を通る。** 「投稿先として指定されたスレッドが見えるか」を
 *    別の `where` で書き直すと、読みと書きで母集団が食い違う経路が生まれる。
 */
export async function findChatThreadRow(
  db: Pick<TenantDb, 'chatThread'>,
  threadId: string,
): Promise<FoundChatThreadRow | null> {
  // 🔴 `where` は「どのスレッドか」の業務上の指定だけ。参加会社・メンバーの条件を書き足さない
  //    （C6 / C10 MEMBER が決める）。✅ 2026-10-19（#128）: DM・グループも引く（投稿・既読・リアクションが同じ 1 実装を通る）。
  const row = await db.chatThread.findFirst({ where: { id: threadId }, select: CHAT_THREAD_SELECT });
  return row === null ? null : (row as FoundChatThreadRow);
}

/**
 * 参加会社（🔴 `thread_participants` の C5 が返した行だけ。**見えない行を補わない**）。
 *
 * ⚠️ 取引先の文脈ではホストの行（`partner_company_id IS NULL`）が C5 の述語
 *    （`partner_company_id = app_partner_id()`）に合致しないため**見えない**。これは仕様であり、
 *    「相手がホストである」ことは `counterpartyName` が別に伝える。
 */
async function readParticipants(
  db: Pick<TenantDb, 'threadParticipant' | 'partnerCompany' | 'tenant'>,
  threadId: string,
): Promise<readonly ChatParticipantView[]> {
  const rows = await db.threadParticipant.findMany({
    where: { threadId },
    select: { partnerCompanyId: true, joinedAt: true, leftAt: true },
    // ホスト（`NULL`）を先に出す（`nulls: 'first'` を明示する）。
    orderBy: [{ partnerCompanyId: { sort: 'asc', nulls: 'first' } }],
  });
  const tenant = await db.tenant.findFirst({ select: { name: true } });
  const byId = await resolvePartnerCompanyNames(db, rows.map((row) => row.partnerCompanyId));
  return rows.map((row) => ({
    companyName: row.partnerCompanyId === null ? tenant?.name ?? null : byId.get(row.partnerCompanyId) ?? null,
    isHost: row.partnerCompanyId === null,
    joinedAt: row.joinedAt.toISOString(),
    leftAt: row.leftAt?.toISOString() ?? null,
  }));
}

async function readThreadDetail(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'chatThread' | 'threadParticipant' | 'partnerCompany' | 'tenant' | 'project' | 'user' | 'chatUserStatus'>,
  threadId: string,
): Promise<ChatThreadDetailView | null> {
  const found = await findChatThreadRow(db, threadId);
  if (found === null) return null;
  // ✅ 2026-10-19（#128）: DM・グループは右の欄にメンバーを出す（参加会社ではなく人の段）。
  if (found.kind === 'DM' || found.kind === 'GROUP') return readRoomDetail(ctx, db, threadId);
  const row = found as SelectedThreadRow;
  const counterpartyOf = await resolveCounterpartyNames(ctx, db, [row.partnerCompanyId]);
  const projects = await resolveProjectRefs(db, [row.projectId]);
  const participants = await readParticipants(db, threadId);
  return chatThreadDetailView(row, {
    project: row.projectId === null ? null : projects.get(row.projectId) ?? null,
    counterpartyName: counterpartyOf(row.partnerCompanyId),
    participants,
  });
}

/** 送信者の表示名（`users` の C8 DIRECTORY。読めなければ `null`）。 */
async function resolveSenderNames(
  db: Pick<TenantDb, 'user'>,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

/**
 * 🔴 `messages` の行を `ChatMessageView` に写す**唯一の実装**（渡された順序を保つ）。
 *    一覧（#50）と投稿の応答（#51）が同じ関数を通る —— 2 実装にすると、片方だけが
 *    `own` の判定や `senderCompanyName` の解決を取り違える。
 */
export async function projectChatMessages(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'user' | 'partnerCompany' | 'tenant' | 'chatMessageReaction' | 'chatSavedMessage'>,
  rows: readonly ChatMessageRow[],
): Promise<readonly ChatMessageView[]> {
  if (rows.length === 0) return [];
  // ✅ 2026-10-16: リアクション。🔴 RLS が「発言が読める」ときだけ行を返す（migration 20261016010000）。
  const reactionRows = await db.chatMessageReaction.findMany({
    where: { messageId: { in: rows.map((row) => row.id) } },
    select: { messageId: true, userId: true, reaction: true },
  });
  const reactions = summarizeReactions(reactionRows, ctx.userId);
  // ✅ 2026-10-22: 自分が保存した発言（「保存 / 保存を外す」の出し分け）。🔴 本人の行だけが返る（RLS。migration 20261022010000）。
  const savedRows = await db.chatSavedMessage.findMany({
    where: { messageId: { in: rows.map((row) => row.id) } },
    select: { messageId: true },
  });
  const savedIds = new Set(savedRows.map((row) => row.messageId));
  const senderNames = await resolveSenderNames(db, rows.map((row) => row.senderUserId));
  // 🔴 **送信者の会社名は `partner_companies` から直接引く**（`resolveCounterpartyNames` を使わない。
  //    上の ⚠️ —— 取引先が自分の発言に相手の商号を見ることになる）。
  const partnerNames = await resolvePartnerCompanyNames(db, rows.map((row) => row.senderPartnerCompanyId));
  const tenant = await db.tenant.findFirst({ select: { name: true } });
  return rows.map((row) =>
    chatMessageView(row, {
      senderName: senderNames.get(row.senderUserId) ?? null,
      // ホストの発言はテナントの商号。取引先の発言はその会社の商号。
      senderCompanyName:
        row.senderPartnerCompanyId === null
          ? tenant?.name ?? null
          : partnerNames.get(row.senderPartnerCompanyId) ?? null,
      viewerPartnerCompanyId: ctx.partnerCompanyId,
      viewerUserId: ctx.userId,
      reactions: reactions.get(row.id) ?? [],
      saved: savedIds.has(row.id),
    }),
  );
}

/**
 * 会話の 1 ページ。
 *
 * 🔴 **新しい順に読み、古い順に並べ替えて返す**（`docs/04` §10.4 `S-031`「直近 50 件を初期表示し、
 *    上方向にページング」）。`nextCursor` は**さらに過去**を指す。並べ替えは表示の都合であり、
 *    カーソルの意味（「この行より古い方へ」）は変えない。
 */
async function readMessagePage(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'chatThread' | 'message' | 'user' | 'partnerCompany' | 'tenant' | 'chatMessageReaction' | 'chatSavedMessage'>,
  threadId: string,
  query: ChatMessageListQuery,
): Promise<ChatMessageListView> {
  const rows = (await db.message.findMany({
    // 🔴 「どのスレッドの会話か」だけ。`ownerPartnerCompanyId` の条件を書き足さない（C6 が決める）。
    where: { threadId },
    select: CHAT_MESSAGE_SELECT,
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: takeForCursorPage(query.limit),
    ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
  })) as readonly ChatMessageRow[];
  const page = buildCursorPage(rows, query.limit, (row) => row.id);
  const items = await projectChatMessages(ctx, db, [...page.items].reverse());
  return { items, nextCursor: page.nextCursor };
}

// ---------------------------------------------------------------------------
// 公開面（Route Handler と画面がここだけを呼ぶ）
// ---------------------------------------------------------------------------

/** `GET /api/threads`（#50）。 */
export async function listChatThreads(
  ctx: AuthenticatedTenantCtx,
  query: ChatThreadListQuery,
): Promise<ChatThreadListView> {
  return withTenant(ctx, (db) => readThreadPage(ctx, db, query));
}

/** `GET /api/threads/{id}/messages`（#50）。🔴 見えないスレッドは 404（`requireFound`）。 */
export async function listChatMessages(
  ctx: AuthenticatedTenantCtx,
  threadId: string,
  query: ChatMessageListQuery,
): Promise<ChatMessageListView> {
  return withTenant(ctx, async (db) => {
    // 🔴 スレッドが見えなければ会話を 0 件で返さず 404 にする ——「空の会話」と「見えない」を
    //    画面と API で区別させない（区別できると参加していないスレッドの存在が分かる）。
    requireFound(await findChatThreadRow(db, threadId));
    return readMessagePage(ctx, db, threadId, query);
  });
}

/** 画面（`S-031`）が 1 リクエストで必要とするもの。 */
export type ChatScreenData = {
  /** ページ単位の一覧。🔴 `input.tree` を渡したときは読まない（空のページ）。 */
  readonly threads: ChatThreadListView;
  /** 選択したスレッド（`?thread=` が無い / 見えないときは `null`）。 */
  readonly thread: ChatThreadDetailView | null;
  /** 選択したスレッドの会話（`thread === null` のときは空）。 */
  readonly messages: ChatMessageListView;
  /**
   * 🔴 `?thread=` が指定されたのに見えなかった（不存在 / 他社 / 他テナントを**区別しない**）。
   *    画面は一覧へ戻し、同一の文言を出す（`docs/04` §10.1 `S-031`「スレッドが削除済み → 一覧へ」）。
   */
  readonly requestedThreadMissing: boolean;
  /**
   * ✅ 2026-10-14（チャットレーン）: 右に並べて開いた会話（`?pane=`。左から順）。
   * 🔴 1 本ずつ**左端と同じ関数**（`readThreadDetail` / `readMessagePage`）で読む —— 境界の経路を増やさない。
   *    見えない ID は `thread: null`（不存在 / 他社 / 他テナントを区別しない。左端と同じ）。
   * 🔴 左端（`thread`）が見えないときは読まない（空配列）。
   */
  readonly panes: readonly ChatPaneData[];
  /**
   * ✅ 2026-10-14: 会社ごとの木（`input.tree` を渡したときだけ。渡さなければ `null`）。
   * 🔴 `threads`（ページ単位の一覧）と母集団は同じで、並べ方だけが違う。
   */
  readonly tree: ChatThreadTreeData | null;
  /**
   * ✅ 2026-10-16: 開いている会話（左端と右の列）の既読位置（開いた時点。「ここから未読」の線を引く）。
   * 🔴 RLS（C7）が本人の行だけを返す。行が無い / 1 件も読んでいないスレッドは `null`。
   */
  readonly lastReadMessageIds: Readonly<Record<string, string | null>>;
  /** ✅ 2026-10-16: 開いている会話のピン留め・ミュート（見出しの切り替えボタン用）。 */
  readonly threadPrefs: Readonly<Record<string, ChatThreadPrefs>>;
  /** ✅ 2026-10-19（#128）: DM・グループと連絡先（`input.tree` を渡したときだけ。渡さなければ `null`）。 */
  readonly people: ChatPeopleData | null;
  /**
   * ✅ 2026-10-19（#128）: 開いている **DM だけ**の、相手が最後に読んだ発言の ID（相手がまだ読んでいなければ `null`）。
   * 🔴 グループ・会社グループ・スレッドのキーは入れない（誰がどこまで読んだかを他人に見せない）。
   *    DB 側も `app_dm_peer_read` が DM 以外・非メンバーに NULL を返す（二重）。
   */
  readonly peerReadMessageIds: Readonly<Record<string, string | null>>;
};

/** 右に並べた会話 1 本ぶん。 */
export type ChatPaneData = {
  /** URL に載っていた ID（見えなかったときも閉じる導線のために持つ）。 */
  readonly requestedThreadId: string;
  readonly thread: ChatThreadDetailView | null;
  readonly messages: ChatMessageListView;
};

/**
 * `S-031` の 1 画面ぶんを**同じトランザクション（同じ RLS 文脈）**で読む。
 *
 * 🔴 画面は Route Handler を通らず（自己 fetch しない）、**API と同じ関数**を通る ——
 *    母集団・並び・型が画面と API でずれない（`S-019` / `S-017` と同じ作法）。
 */
export async function readChatScreen(
  ctx: AuthenticatedTenantCtx,
  input: {
    readonly threadId: string | null;
    readonly threadsQuery: ChatThreadListQuery;
    readonly messagesQuery: ChatMessageListQuery;
    /** 右に並べる会話（左から順。省略時は無し）。 */
    readonly paneIds?: readonly string[];
    /** ✅ 2026-10-14: 一覧を会社ごとの木でも読む（画面だけが使う。API #49 は従来のページ単位のまま）。 */
    readonly tree?: { readonly sort: ChatThreadSort; readonly q: string | null; readonly unreadOnly?: boolean };
  },
): Promise<ChatScreenData> {
  const screen = await readChatScreenInTenant(ctx, input);
  // 🔴 DM の判定は画面データの `kind` で行い、DB 側の関数も DM 以外に NULL を返す（二重）。
  const dmIds = [screen.thread, ...screen.panes.map((pane) => pane.thread)]
    .filter((thread): thread is ChatThreadDetailView => thread !== null && thread.kind === 'DM')
    .map((thread) => thread.id);
  if (dmIds.length === 0) return screen;
  return { ...screen, peerReadMessageIds: await readDmPeerReadMessageIds(ctx, dmIds) };
}

async function readChatScreenInTenant(
  ctx: AuthenticatedTenantCtx,
  input: Parameters<typeof readChatScreen>[1],
): Promise<ChatScreenData> {
  return withTenant(ctx, async (db) => {
    // ✅ 2026-10-14（レビュー指摘）: 木を読むときはページ単位の一覧を読まない（画面は木しか使わず、
    //    読んでも捨てるだけになる）。`threads` は空のページで返す。
    const treeRead = input.tree === undefined ? null : await readThreadTree(ctx, db, input.tree);
    const tree = treeRead?.tree ?? null;
    const people = treeRead === null ? null : await readPeople(ctx, db, treeRead.companyKeyOf);
    const threads: ChatThreadListView =
      tree === null ? await readThreadPage(ctx, db, input.threadsQuery) : { items: [], nextCursor: null };
    if (input.threadId === null) {
      return {
        threads,
        thread: null,
        messages: { items: [], nextCursor: null },
        requestedThreadMissing: false,
        panes: [],
        tree,
        lastReadMessageIds: {},
        threadPrefs: {},
        people,
        peerReadMessageIds: {},
      };
    }
    const thread = await readThreadDetail(ctx, db, input.threadId);
    if (thread === null) {
      return {
        threads,
        thread: null,
        messages: { items: [], nextCursor: null },
        requestedThreadMissing: true,
        panes: [],
        tree,
        lastReadMessageIds: {},
        threadPrefs: {},
        people,
        peerReadMessageIds: {},
      };
    }
    const messages = await readMessagePage(ctx, db, input.threadId, input.messagesQuery);
    const panes: ChatPaneData[] = [];
    // 🔴 直列に読む（同じトランザクション上で問い合わせを並行させない）。
    for (const paneId of input.paneIds ?? []) {
      const paneThread = await readThreadDetail(ctx, db, paneId);
      panes.push({
        requestedThreadId: paneId,
        thread: paneThread,
        messages:
          paneThread === null
            ? { items: [], nextCursor: null }
            : await readMessagePage(ctx, db, paneId, input.messagesQuery),
      });
    }
    const openIds = [thread.id, ...panes.filter((pane) => pane.thread !== null).map((pane) => pane.requestedThreadId)];
    const positions = await readPositions(db, openIds);
    const lastReadMessageIds = Object.fromEntries(openIds.map((id) => [id, positions.get(id)?.id ?? null]));
    const prefs = await readThreadPrefs(db, openIds);
    const threadPrefs = Object.fromEntries(openIds.map((id) => [id, prefs.get(id) ?? { pinned: false, muted: false }]));
    return { threads, thread, messages, requestedThreadMissing: false, panes, tree, lastReadMessageIds, threadPrefs, people, peerReadMessageIds: {} };
  });
}

