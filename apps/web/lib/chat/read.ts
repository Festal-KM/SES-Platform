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
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { requireFound, ValidationError } from '../api/errors';
import { buildCursorPage, takeForCursorPage, type CursorPage } from '../api/pagination';
import type { ChatMessageListQuery, ChatThreadListQuery } from './schemas';
import {
  chatThreadCursorWhere,
  decodeChatThreadCursor,
  encodeChatThreadCursor,
  type ChatThreadCursorWhere,
} from './thread-cursor';
import {
  chatMessageView,
  chatThreadDetailView,
  chatThreadListItem,
  type ChatMessageRow,
  type ChatMessageView,
  type ChatParticipantView,
  type ChatProjectRef,
  type ChatThreadDetailView,
  type ChatThreadListItem,
  type ChatThreadRow,
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
} as const;

export type SelectedChatThreadRow = ChatThreadRow & { readonly partnerCompanyId: string };
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
    where,
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
 * 1 スレッドの行（🔴 見えなければ `null`。呼び出し側が 404 に畳む）。
 *
 * 🔴 **投稿（`service.ts`）もこの 1 実装を通る。** 「投稿先として指定されたスレッドが見えるか」を
 *    別の `where` で書き直すと、読みと書きで母集団が食い違う経路が生まれる。
 */
export async function findChatThreadRow(
  db: Pick<TenantDb, 'chatThread'>,
  threadId: string,
): Promise<SelectedThreadRow | null> {
  // 🔴 `where` は「どのスレッドか」の業務上の指定だけ。参加会社の条件を書き足さない（C6 が決める）。
  const row = await db.chatThread.findFirst({ where: { id: threadId }, select: CHAT_THREAD_SELECT });
  return row === null ? null : (row as SelectedThreadRow);
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
  db: Pick<TenantDb, 'chatThread' | 'threadParticipant' | 'partnerCompany' | 'tenant' | 'project'>,
  threadId: string,
): Promise<ChatThreadDetailView | null> {
  const row = await findChatThreadRow(db, threadId);
  if (row === null) return null;
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
  db: Pick<TenantDb, 'user' | 'partnerCompany' | 'tenant'>,
  rows: readonly ChatMessageRow[],
): Promise<readonly ChatMessageView[]> {
  if (rows.length === 0) return [];
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
  db: Pick<TenantDb, 'chatThread' | 'message' | 'user' | 'partnerCompany' | 'tenant'>,
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
  },
): Promise<ChatScreenData> {
  return withTenant(ctx, async (db) => {
    const threads = await readThreadPage(ctx, db, input.threadsQuery);
    if (input.threadId === null) {
      return { threads, thread: null, messages: { items: [], nextCursor: null }, requestedThreadMissing: false };
    }
    const thread = await readThreadDetail(ctx, db, input.threadId);
    if (thread === null) {
      return { threads, thread: null, messages: { items: [], nextCursor: null }, requestedThreadMissing: true };
    }
    const messages = await readMessagePage(ctx, db, input.threadId, input.messagesQuery);
    return { threads, thread, messages, requestedThreadMissing: false };
  });
}

