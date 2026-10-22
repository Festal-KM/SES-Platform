// apps/web/app/(main)/chat/chat-thread-list.tsx
// `S-031` の会話の一覧（左の絞り込みの列の右）。
//
// ============================================================================
// ✅ 2026-10-19（v2・紺野「くっそ醜い」「ビジュアルで変えて」「会社から＞ 人から＞」）
// ============================================================================
// 1. **1 行 = 1 会話。字下げしない。** 種類はアバターの**形と色**で分ける —— 人（DM）= 丸、グループ = 丸・緑、
//    取引先の会社 = 角丸、案件スレッド = 角丸・橙の「#」。取引先が相手なら「外部」、案件なら「案件」の小さな札。
//    案件スレッドの 2 段目は「相手の会社 ・ 最後の発言」（親の会社が分かる）。
// 2. 行の形は 1 つ: 1 段目 = 名前 + 時刻、2 段目 = 最後の発言の冒頭 + 未読の数。高さは固定（60px）。
// 3. 絞り込みは左の列（`chat-rail.tsx`）の `f=`。会社 → その会社の会話（会社チャット・スレッド・その会社の人との DM・グループ）、
//    人 → その人との会話（DM・その人が入っているグループ）、連絡先 → 人の一覧。
// 4. 「右に並べる」は行にマウスを当てたときだけ（`chat-row-shell.tsx`）。
//
// 🔴 母集団は読みの関数（`lib/chat/read.ts` / `people.ts`）が RLS で決めたものだけ。ここで足さない。
// 🔴 一覧の中で `hidden` を使わない（render テスト ③）。閲覧専用に押せない導線を置かない（②）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import {
  Avatar,
  Badge,
  Button,
  CHAT_THREAD_ROW_HEIGHT_CLASS,
  EmptyState,
  Input,
  PRIMARY_LINK_CLASSES,
  ROW_HOVER_CLASSES,
  SECONDARY_LINK_CLASSES,
  cn,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import { canAddPane, openThreadIds, withPaneAdded, withThreadSelected, type ChatPaneState } from '../../../lib/chat/panes';
import {
  CHAT_FILTER_PARAM,
  CHAT_PANE_PARAM,
  CHAT_PATH,
  CHAT_Q_PARAM,
  CHAT_THREAD_PARAM,
  chatFilterValue,
  chatHref,
  type ChatListFilter,
} from '../../../lib/chat/screen-query';
import { CHAT_THREAD_SORT_DEFAULT, type ChatThreadGroup, type ChatThreadSort } from '../../../lib/chat/thread-tree';
import type { ChatRoomListItem, ChatThreadListItem, ChatThreadKind } from '../../../lib/chat/views';
import type { ChatPeopleData } from '../../../lib/chat/people';
import type { ChatMessageHit } from '../../../lib/chat/read';
import { formatListTime } from '../../../lib/chat/day-separators';
import { ChatContactsView, ChatFavorites, type ChatFavorite } from './chat-people-section';
import { ChatDraftMark } from './chat-draft-mark';
import { ChatNewGroupForm } from './chat-new-group-form';
import { ChatOpenDmButton } from './chat-open-dm-button';
import { ChatRowShell } from './chat-row-shell';

const KIND_MESSAGE_KEYS = {
  PROJECT: 'chat.thread.kind.PROJECT',
  COMPANY: 'chat.thread.kind.COMPANY',
  DM: 'chat.thread.kind.DM',
  GROUP: 'chat.thread.kind.GROUP',
} as const satisfies Readonly<Record<ChatThreadKind, `chat.thread.kind.${ChatThreadKind}`>>;

/**
 * 🔴 種類ごとのアバターの形と色。お気に入り・左の列も同じ。
 * ✅ 2026-10-20（紺野「色もなんか一緒」）: 薄い地（`*-bg`）だと一覧の灰色に溶けるので、**塗りつぶし**にした。
 *    人 = 青の丸 / グループ = 緑の丸 / 取引先の会社 = 墨色の角丸（🔴 サイドバーの紺はサイドバー専用。`ui-shadow-and-size.test.ts`）/ 案件 = 橙の角丸に「#」。
 *    使う色は既存のトークンだけ（新しい色を足さない）。
 */
export const AVATAR_KIND_CLASSES: Readonly<Record<ChatThreadKind, string>> = {
  DM: 'bg-brand text-brand-fg',
  GROUP: 'bg-success text-bg',
  COMPANY: 'rounded-md bg-fg text-bg',
  PROJECT: 'rounded-md bg-warning text-bg',
};

const TAG_CLASSES = 'shrink-0 rounded-xs px-1 text-xs';

export type ChatThreadListProps = {
  /** 会社ごとのまとまり（`lib/chat/thread-tree.ts`）。一覧では平らに並べる。 */
  readonly groups: readonly ChatThreadGroup[];
  readonly selectedThreadId: string | null;
  readonly nextCursor: string | null;
  readonly paneThreadIds?: readonly string[];
  readonly openBesideLabel?: string;
  readonly q?: string | null;
  readonly sort?: ChatThreadSort;
  readonly truncated?: boolean;
  readonly awaitingReplyIds?: readonly string[];
  readonly messageHits?: readonly ChatMessageHit[];
  readonly pinnedIds?: readonly string[];
  readonly mutedIds?: readonly string[];
  readonly unreadCounts?: Readonly<Record<string, number>>;
  /** 旧「未読のみ」（`unread=1`）。v2 では左の列の「未読」（`f=unread`）と同じ扱い。 */
  readonly unreadOnly?: boolean;
  readonly people?: ChatPeopleData | null;
  readonly canPost?: boolean;
  readonly lastSnippets?: Readonly<Record<string, string>>;
  readonly now?: Date;
  /** ✅ 2026-10-19（v2）: 左の列の絞り込み。 */
  readonly filter?: ChatListFilter;
};

const ROW_CLASSES = `flex min-w-0 flex-1 items-center gap-3 px-3 ${CHAT_THREAD_ROW_HEIGHT_CLASS}`;

type Entry =
  | { readonly type: 'thread'; readonly item: ChatThreadListItem; readonly group: ChatThreadGroup }
  | { readonly type: 'room'; readonly room: ChatRoomListItem };

const atOf = (entry: Entry) => (entry.type === 'thread' ? entry.item.lastMessageAt : entry.room.lastMessageAt);
const idOf = (entry: Entry) => (entry.type === 'thread' ? entry.item.id : entry.room.id);

/** 全部の会話を平らに並べる（新しい順・発言の無いものは最後・同時刻は元の順）。 */
function flatten(groups: readonly ChatThreadGroup[], rooms: readonly ChatRoomListItem[], sort: ChatThreadSort): Entry[] {
  const entries: Entry[] = [
    ...rooms.map((room): Entry => ({ type: 'room', room })),
    ...groups.flatMap((group) =>
      [...(group.chat === null ? [] : [group.chat]), ...group.threads].map((item): Entry => ({ type: 'thread', item, group })),
    ),
  ];
  if (sort !== 'recent') return entries;
  return entries
    .map((entry, order) => ({ entry, order }))
    .sort((x, y) => {
      const a = atOf(x.entry);
      const b = atOf(y.entry);
      if (a === b) return x.order - y.order;
      if (a === null) return 1;
      if (b === null) return -1;
      return a < b ? 1 : -1;
    })
    .map(({ entry }) => entry);
}

/** 左の列の絞り込みを当てる。 */
function applyFilter(entries: readonly Entry[], filter: ChatListFilter, unread: (id: string) => number, awaiting: ReadonlySet<string>): Entry[] {
  switch (filter.kind) {
    case 'all':
    case 'contacts':
      return [...entries];
    case 'unread':
      return entries.filter((entry) => unread(idOf(entry)) > 0);
    case 'awaiting':
      return entries.filter((entry) => awaiting.has(idOf(entry)));
    case 'dm':
      return entries.filter((entry) => entry.type === 'room' && entry.room.kind === 'DM');
    case 'group':
      return entries.filter((entry) => entry.type === 'room' && entry.room.kind === 'GROUP');
    case 'company':
      return entries.filter((entry) =>
        entry.type === 'thread' ? entry.group.key === filter.key : entry.room.companyKey === filter.key,
      );
    case 'person':
      return entries.filter((entry) => entry.type === 'room' && entry.room.memberUserIds.includes(filter.userId));
  }
}

type RowContext = {
  readonly paneState: ChatPaneState;
  readonly openIds: readonly string[];
  readonly selectedThreadId: string | null;
  readonly openBesideLabel: string | undefined;
  readonly listQuery: { readonly q: string | null; readonly sort: ChatThreadSort; readonly filter: ChatListFilter };
  readonly awaitingReplyIds: ReadonlySet<string>;
  readonly unreadCounts: Readonly<Record<string, number>>;
  readonly mutedIds: ReadonlySet<string>;
  /** ✅ 2026-10-20: スワイプで出すピン留めの今の状態。 */
  readonly pinnedIds: ReadonlySet<string>;
  readonly lastSnippets: Readonly<Record<string, string>>;
  readonly now: Date;
};

type RowView = {
  readonly id: string;
  readonly kind: ChatThreadKind;
  readonly name: string;
  readonly initials: string;
  readonly subtitlePrefix: string | null;
  readonly external: boolean;
  readonly fastReply: boolean;
  /** 会社の部屋の相手の会社名（読み上げ用）。 */
  readonly counterpartyName: string | null;
  /** 最後の発言の時刻（ISO）。発言なしは `null`。 */
  readonly at: string | null;
};

function Row({ view, context }: { readonly view: RowView; readonly context: RowContext }) {
  const { paneState, openIds, selectedThreadId, openBesideLabel, listQuery } = context;
  const room = view.kind === 'DM' || view.kind === 'GROUP';
  const unread = context.unreadCounts[view.id] ?? 0;
  const muted = context.mutedIds.has(view.id);
  const awaiting = context.awaitingReplyIds.has(view.id);
  const open = openIds.includes(view.id);
  const selected = view.id === selectedThreadId;
  const strong = unread > 0 && !muted;
  const snippet = context.lastSnippets[view.id] ?? '';
  const besideHref =
    openBesideLabel !== undefined && !open && canAddPane(paneState)
      ? chatHref({ ...withPaneAdded(paneState, view.id), ...listQuery })
      : null;
  return (
    <ChatRowShell
      id={view.id}
      room={room}
      swipe={{
        pinned: context.pinnedIds.has(view.id),
        muted,
        labels: { pin: t('chat.thread.pin'), unpin: t('chat.thread.unpin'), mute: t('chat.thread.mute'), unmute: t('chat.thread.unmute') },
      }}
      selected={selected}
      kind={view.kind}
      className={cn('flex rounded-md', open ? 'bg-brand-bg' : ROW_HOVER_CLASSES)}
      reveal={
        besideHref === null || openBesideLabel === undefined ? null : (
          <Link
            href={besideHref}
            className={cn(SECONDARY_LINK_CLASSES, 'flex shrink-0 items-center whitespace-nowrap px-2 text-xs')}
            data-testid={`chat-thread-open-beside-${view.id}`}
          >
            {openBesideLabel}
          </Link>
        )
      }
    >
      <Link
        href={chatHref({ ...withThreadSelected(paneState, view.id), ...listQuery })}
        aria-current={selected ? 'page' : undefined}
        className={ROW_CLASSES}
        data-testid={room ? `chat-room-link-${view.id}` : `chat-thread-link-${view.id}`}
      >
        <Avatar size="md" initials={view.initials} title={view.name} className={AVATAR_KIND_CLASSES[view.kind]} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className={cn('min-w-0 truncate text-row text-fg', strong ? 'font-bold' : 'font-normal')}>
              <span className="sr-only">{t('chat.threads.column.target')}</span>
              {view.name}
            </span>
            {view.external ? <span className={cn(TAG_CLASSES, 'bg-info-bg text-info')}>{t('chat.tag.external')}</span> : null}
            {/* ✅ 2026-10-14: 返信が早い取引先（上位 10%）。🔴 ホストにだけ真になる（`read.ts`）。良いところだけを出す。 */}
            {view.fastReply ? (
              <span className={cn(TAG_CLASSES, 'bg-success-bg text-success')} data-testid={`chat-thread-fast-${view.id}`}>
                {t('chat.tree.fastReply')}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-xs text-fg-placeholder">
              <span className="sr-only">{t('chat.threads.column.lastMessage')}</span>
              {view.at === null ? t('chat.thread.noMessages') : formatListTime(view.at, context.now)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            {awaiting ? (
              <span className="shrink-0 text-xs text-danger" data-testid={`chat-thread-awaiting-${view.id}`}>
                {t('chat.thread.awaitingReply')}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
              {view.subtitlePrefix === null ? null : `${view.subtitlePrefix} ・ `}
              {snippet === '' ? (view.subtitlePrefix === null ? ' ' : '') : snippet}
            </span>
            {view.counterpartyName === null ? null : (
              <span className="sr-only" data-testid={`chat-thread-counterparty-${view.id}`}>
                {view.counterpartyName}
              </span>
            )}
            <ChatDraftMark threadId={view.id} label={t('chat.thread.draft')} />
            {unread > 0 ? (
              <Badge
                variant={muted ? 'neutral' : 'brand'}
                data-testid={room ? `chat-room-unread-${view.id}` : `chat-thread-unread-${view.id}`}
              >
                {String(unread)}
              </Badge>
            ) : null}
          </span>
        </span>
      </Link>
    </ChatRowShell>
  );
}

function viewOf(entry: Entry): RowView {
  if (entry.type === 'room') {
    const name = entry.room.name ?? t('chat.thread.unknownName');
    return {
      id: entry.room.id,
      kind: entry.room.kind,
      name: entry.room.kind === 'GROUP' ? `${name}（${String(entry.room.memberCount)}${t('chat.people.memberUnit')}）` : name,
      initials: displayInitials(name),
      subtitlePrefix: null,
      external: entry.room.external,
      fastReply: false,
      counterpartyName: null,
      at: entry.room.lastMessageAt,
    };
  }
  const { item, group } = entry;
  // 🔴 返信が早い印は、その会社の会話の代表の 1 行（会社チャット、無ければ最初のスレッド）にだけ付ける。
  const representative = (group.chat ?? group.threads[0])?.id === item.id;
  const counterparty = item.counterpartyName ?? t('chat.thread.unknownName');
  if (item.kind === 'COMPANY') {
    return {
      id: item.id,
      kind: 'COMPANY',
      name: counterparty,
      initials: displayInitials(counterparty.replace(/^株式会社/, '') || counterparty),
      subtitlePrefix: null,
      // ✅ 2026-10-20: 会社・案件の行は相手が必ず取引先なので「外部」の札を付けない（形で分かる。札は DM・グループだけ）。
      external: false,
      fastReply: group.fastReply && representative,
      counterpartyName: counterparty,
      at: item.lastMessageAt,
    };
  }
  // 🔴 案件名が読めないときは種別の語（`null` を「案件が無い」と書き分けない。`views.ts` の 🔴）。
  const name = item.project === null ? t(KIND_MESSAGE_KEYS[item.kind]) : item.project.name;
  return {
    id: item.id,
    kind: item.kind,
    name,
    initials: '#',
    subtitlePrefix: counterparty,
    external: false,
    fastReply: group.fastReply && representative,
    counterpartyName: counterparty,
    at: item.lastMessageAt,
  };
}

/** 左の列で選んだ会社・人の見出し（「すべてに戻る」と、人なら DM を開く）。 */
function ScopeHeader({
  filter,
  groups,
  people,
  canPost,
}: {
  readonly filter: ChatListFilter;
  readonly groups: readonly ChatThreadGroup[];
  readonly people: ChatPeopleData | null;
  readonly canPost: boolean;
}) {
  if (filter.kind !== 'company' && filter.kind !== 'person') return null;
  let title: string;
  let action: React.ReactNode = null;
  if (filter.kind === 'company') {
    title = groups.find((group) => group.key === filter.key)?.counterpartyName ?? t('chat.thread.unknownName');
  } else {
    const contact = people?.contacts.companies.flatMap((company) => company.people).find((person) => person.userId === filter.userId);
    title = contact?.name ?? t('chat.thread.unknownName');
    if (canPost && contact !== undefined) {
      action = (
        <ChatOpenDmButton userId={contact.userId} label={`${title} ${t('chat.people.openDm')}`} failedLabel={t('chat.people.openDmFailed')}>
          {t('chat.people.openDm')}
        </ChatOpenDmButton>
      );
    }
  }
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1" data-testid="chat-scope">
      <span className="min-w-0 flex-1 truncate text-cell font-bold text-fg" data-testid="chat-scope-title">
        {title}
      </span>
      {action}
      <Link href={chatHref({})} className={cn(SECONDARY_LINK_CLASSES, 'shrink-0 text-xs')} data-testid="chat-scope-clear">
        {t('chat.rail.backToAll')}
      </Link>
    </div>
  );
}

export function ChatThreadList({
  groups,
  selectedThreadId,
  nextCursor,
  paneThreadIds = [],
  openBesideLabel,
  q = null,
  sort = CHAT_THREAD_SORT_DEFAULT,
  truncated = false,
  awaitingReplyIds = [],
  messageHits = [],
  unreadCounts = {},
  unreadOnly = false,
  pinnedIds = [],
  mutedIds = [],
  people = null,
  canPost = false,
  lastSnippets = {},
  now = new Date(),
  filter: filterProp,
}: ChatThreadListProps) {
  const filter: ChatListFilter = filterProp ?? (unreadOnly ? { kind: 'unread' } : { kind: 'all' });
  const paneState: ChatPaneState = { thread: selectedThreadId, panes: paneThreadIds };
  const rooms = people?.rooms ?? [];
  const allUnread = { ...unreadCounts, ...(people?.unreadCounts ?? {}) };
  const allMuted = new Set([...mutedIds, ...(people?.mutedIds ?? [])]);
  const context: RowContext = {
    paneState,
    openIds: openThreadIds(paneState),
    selectedThreadId,
    openBesideLabel,
    listQuery: { q, sort, filter },
    awaitingReplyIds: new Set(awaitingReplyIds),
    unreadCounts: allUnread,
    mutedIds: allMuted,
    pinnedIds: new Set([...pinnedIds, ...(people?.pinnedIds ?? [])]),
    lastSnippets: { ...lastSnippets, ...(people?.lastSnippets ?? {}) },
    now,
  };
  const all = flatten(groups, rooms, sort);
  const shown = applyFilter(all, filter, (id) => allUnread[id] ?? 0, context.awaitingReplyIds);
  const searching = (q !== null && q !== '') || filter.kind !== 'all';

  const pinned = new Set([...pinnedIds, ...(people?.pinnedIds ?? [])]);
  const favorites: ChatFavorite[] = all
    .filter((entry) => pinned.has(idOf(entry)))
    .map((entry) => {
      const view = viewOf(entry);
      return { id: view.id, name: view.name, avatarClass: AVATAR_KIND_CLASSES[view.kind], initials: view.initials };
    });

  if (all.length === 0 && !searching && people === null) {
    return (
      <div className="p-4" data-testid="chat-threads">
        <EmptyState description={t('chat.threads.empty')} testIdPrefix="chat-threads-empty-" />
      </div>
    );
  }
  const filterValue = chatFilterValue(filter);
  return (
    <div className="flex min-h-0 flex-col" data-testid="chat-threads">
      {/* 🔴 `method="get"` —— 条件が URL になり、再読込・戻るで同じ一覧に戻る。開いている会話と絞り込みは引き継ぐ。 */}
      <form method="get" action={CHAT_PATH} className="flex items-center gap-2 p-3" data-testid="chat-threads-search">
        {paneState.thread === null ? null : <input type="hidden" name={CHAT_THREAD_PARAM} value={paneState.thread} />}
        {paneState.thread === null
          ? null
          : paneState.panes.map((pane) => <input key={pane} type="hidden" name={CHAT_PANE_PARAM} value={pane} />)}
        {filterValue === null ? null : <input type="hidden" name={CHAT_FILTER_PARAM} value={filterValue} />}
        <label className="sr-only" htmlFor="chat-threads-q">
          {t('chat.threads.search.label')}
        </label>
        <Input
          id="chat-threads-q"
          type="search"
          name={CHAT_Q_PARAM}
          defaultValue={q ?? ''}
          placeholder={t('chat.threads.search.placeholder')}
          data-testid="chat-threads-q"
        />
        <Button type="submit" variant="secondary" size="sm" data-testid="chat-threads-search-submit">
          {t('chat.threads.search.submit')}
        </Button>
        {canPost && people !== null ? (
          <Link
            href={chatHref({ filter: { kind: 'contacts' } })}
            className={cn(PRIMARY_LINK_CLASSES, 'h-8 px-3 text-cell')}
            data-testid="chat-new-conversation"
          >
            {t('chat.people.newConversationShort')}
          </Link>
        ) : null}
      </form>

      {filter.kind === 'contacts' && people !== null ? (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          <ChatContactsView people={people}>
            {/* ✅ 2026-10-19（#128）: グループを作る（名前 + 連絡先から選ぶ）。🔴 閲覧専用には出さない。候補は連絡先と同じ母集団。 */}
            {canPost && people.contacts.companies.length > 0 ? (
              // ✅ 2026-10-20: 人を探しに来た画面なので、グループを作る欄は畳んでおく（押すと開く）。
              <details className="px-2 pt-2" data-testid="chat-new-group-toggle">
                <summary className="cursor-pointer rounded-md border border-border bg-bg px-3 py-2 text-cell text-fg">
                  {t('chat.group.heading')}
                </summary>
              <ChatNewGroupForm
                people={people.contacts.companies.flatMap((company) =>
                  company.people.map((contact) => ({
                    userId: contact.userId,
                    name: contact.name ?? t('chat.thread.unknownName'),
                    companyName: contact.companyName,
                  })),
                )}
                labels={{
                  heading: t('chat.group.heading'),
                  name: t('chat.group.name'),
                  namePlaceholder: t('chat.group.namePlaceholder'),
                  members: t('chat.group.members'),
                  submit: t('chat.group.submit'),
                  needName: t('chat.group.needName'),
                  needMembers: t('chat.group.needMembers'),
                  failed: t('chat.group.failed'),
                  createdToast: t('chat.toast.groupCreated'),
                  openGroup: t('chat.toast.openGroup'),
                }}
              />
              </details>
            ) : null}
          </ChatContactsView>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {filter.kind === 'all' ? (
            <ChatFavorites favorites={favorites} unreadCounts={allUnread} mutedIds={allMuted} selectedThreadId={selectedThreadId} />
          ) : null}
          <ScopeHeader filter={filter} groups={groups} people={people} canPost={canPost} />
          {shown.length === 0 && messageHits.length === 0 ? (
            searching ? (
              <div className="flex flex-col gap-2 p-4" data-testid="chat-threads-search-empty">
                <p className="m-0 text-body text-fg-muted">
                  {filter.kind === 'person' ? t('chat.rail.personEmpty') : t('chat.threads.search.empty')}
                </p>
                <Link href={chatHref({ ...paneState, sort })} className={SECONDARY_LINK_CLASSES} data-testid="chat-threads-search-clear">
                  {t('chat.threads.search.clear')}
                </Link>
              </div>
            ) : (
              <p className="m-0 p-4 text-xs text-fg-muted" data-testid="chat-rooms-empty">
                {t('chat.people.roomsEmpty')}
              </p>
            )
          ) : (
            <ul className="m-0 flex list-none flex-col p-1" aria-label={t('chat.threads.label')}>
              {shown.map((entry) => (
                <Row key={idOf(entry)} view={viewOf(entry)} context={context} />
              ))}
            </ul>
          )}
          {/* ✅ 2026-10-14: 本文の検索で当たった発言（読めた発言だけ。前後の抜粋）。押すとその会話を開く。 */}
          {messageHits.length === 0 ? null : (
            <section data-testid="chat-threads-message-hits">
              <h3 className="m-0 px-3 pt-3 pb-1 text-cell font-normal text-fg-muted">{t('chat.threads.search.messageHits')}</h3>
              <ul className="m-0 list-none p-0">
                {messageHits.map((hit) => (
                  <li key={hit.messageId} className={ROW_HOVER_CLASSES}>
                    <Link
                      href={chatHref({ ...withThreadSelected(context.paneState, hit.threadId), ...context.listQuery })}
                      className="flex flex-col gap-1 px-3 py-2"
                      data-testid={`chat-threads-message-hit-${hit.messageId}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-cell font-normal text-fg">
                          {hit.threadTitle ?? t('chat.thread.unknownName')}
                        </span>
                        <span className="shrink-0 text-xs text-fg-placeholder">{formatDateTimeJst(hit.sentAt)}</span>
                      </span>
                      <span className="text-xs text-fg-muted">{hit.snippet}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {truncated ? (
            <p className="m-0 p-3 text-xs text-fg-muted" data-testid="chat-threads-truncated">
              {t('chat.tree.truncated')}
            </p>
          ) : null}
          {nextCursor === null ? null : (
            <Link href={chatHref({ ...paneState, threadsCursor: nextCursor })} className={`${SECONDARY_LINK_CLASSES} p-3`} data-testid="chat-threads-more">
              {t('chat.threads.more')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
