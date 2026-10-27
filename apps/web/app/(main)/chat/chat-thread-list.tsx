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
// 5. ✅ 2026-10-22（紺野）: 赤い「要返信」の札をやめた。左の列の「保存済み」（`f=saved`）で保存した発言の一覧、
//    入力欄の「定型文を編集…」（`f=templates`）で自分の定型文の管理画面に、一覧の列が切り替わる。
//
// 🔴 母集団は読みの関数（`lib/chat/read.ts` / `people.ts`）が RLS で決めたものだけ。ここで足さない。
// 🔴 一覧の中で `hidden` を使わない（render テスト ③）。閲覧専用に押せない導線を置かない（②）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import {
  Avatar,
  Button,
  CHAT_THREAD_ROW_HEIGHT_CLASS,
  EmptyState,
  Input,
  Icon,
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
import type { ChatSavedList } from '../../../lib/chat/saved';
import { CHAT_TEMPLATE_BODY_MAX_LENGTH, CHAT_TEMPLATE_LABEL_MAX_LENGTH, CHAT_TEMPLATE_MAX_PER_USER } from '../../../lib/chat/schemas';
import { formatListTime } from '../../../lib/chat/day-separators';
import { ChatContactsView, ChatFavorites, type ChatFavorite } from './chat-people-section';
import { ChatDraftMark } from './chat-draft-mark';
import { ChatNewGroupForm } from './chat-new-group-form';
import { UNREAD_DOT_CLASSES, UNREAD_DOT_MAX } from './chat-unread-dot';
import { ChatOpenDmButton } from './chat-open-dm-button';
import { ChatRowShell } from './chat-row-shell';
import { ChatTemplateManager, type ChatTemplateItem } from './chat-template-manager';

const KIND_MESSAGE_KEYS = {
  PROJECT: 'chat.thread.kind.PROJECT',
  COMPANY: 'chat.thread.kind.COMPANY',
  DM: 'chat.thread.kind.DM',
  GROUP: 'chat.thread.kind.GROUP',
} as const satisfies Readonly<Record<ChatThreadKind, `chat.thread.kind.${ChatThreadKind}`>>;

/** 種類は形と文字で見分け、現在地・未読に色の強調を残す。 */
export const AVATAR_KIND_CLASSES: Readonly<Record<ChatThreadKind, string>> = {
  DM: 'bg-neutral-bg text-fg',
  GROUP: 'bg-neutral-bg text-fg',
  COMPANY: 'rounded-md bg-neutral-bg text-fg',
  PROJECT: 'rounded-md bg-neutral-bg text-fg',
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
  /** ✅ 2026-10-22: 保存した発言（`f=saved` のときだけ読む。それ以外は `null`）。 */
  readonly saved?: ChatSavedList | null;
  /** ✅ 2026-10-22: 自分の定型文（`f=templates` の管理画面）。 */
  readonly templates?: readonly ChatTemplateItem[];
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
function applyFilter(entries: readonly Entry[], filter: ChatListFilter, unread: (id: string) => number): Entry[] {
  switch (filter.kind) {
    case 'all':
    case 'contacts':
    case 'newgroup':
    case 'saved':
    case 'templates':
      return [...entries];
    case 'unread':
      return entries.filter((entry) => unread(idOf(entry)) > 0);
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
      // ✅ 2026-10-22（紺野「どの会話開いているかもわかるように！！」）: 開いている会話は青い面 + 青い縁で、灰色の一覧の中ではっきり分かるようにする。
      className={cn('flex rounded-md', open ? 'bg-brand-bg ring-1 ring-brand' : ROW_HOVER_CLASSES)}
      reveal={
        besideHref === null || openBesideLabel === undefined ? null : (
          <Link
            href={besideHref}
            aria-label={openBesideLabel}
            title={openBesideLabel}
            className={cn(SECONDARY_LINK_CLASSES, 'flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-xs')}
            data-testid={`chat-thread-open-beside-${view.id}`}
          >
            <Icon name="chat-open-beside" /><span className="sr-only">{openBesideLabel}</span>
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
        {/* ✅ 2026-10-22（紺野「未読はアイコン横に赤丸（数字入り）で強調」）: 未読の数はアバターの右上の赤丸。ミュート中は灰色。 */}
        <span className="relative shrink-0">
          <Avatar size="md" initials={view.initials} title={view.name} className={AVATAR_KIND_CLASSES[view.kind]} />
          {unread > 0 ? (
            <span
              className={cn(UNREAD_DOT_CLASSES, muted ? 'bg-fg-muted' : 'bg-danger')}
              data-testid={room ? `chat-room-unread-${view.id}` : `chat-thread-unread-${view.id}`}
            >
              {unread > UNREAD_DOT_MAX ? `${String(UNREAD_DOT_MAX)}+` : String(unread)}
            </span>
          ) : null}
        </span>
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
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
              {view.subtitlePrefix}
              {view.subtitlePrefix && snippet ? ' ・ ' : null}
              {snippet}
            </span>
            {view.counterpartyName === null ? null : (
              <span className="sr-only" data-testid={`chat-thread-counterparty-${view.id}`}>
                {view.counterpartyName}
              </span>
            )}
            <ChatDraftMark threadId={view.id} label={t('chat.thread.draft')} />
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
      // ✅ 2026-10-22: 数字・記号で始まるグループ名（「11月の要員調整」）は 1 文字目が「1」になるので「G」にする。
      initials: entry.room.kind === 'GROUP' && !/^[\p{L}]/u.test(name) ? 'G' : displayInitials(name),
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

/**
 * ✅ 2026-10-22（紺野）: 保存した発言の一覧（新しく保存した順）。押すとその会話を開く（一覧は保存済みのまま）。
 * 🔴 母集団は `lib/chat/saved.ts`（RLS = 本人の栞 かつ 今も読める発言）だけ。部屋の名前は一覧の母集団（RLS 済み）から引き、
 *    引けないときは「（名前を表示できません）」の語にする（ここで別の経路から名前を探さない）。
 */
function ChatSavedView({
  saved,
  entries,
  context,
}: {
  readonly saved: ChatSavedList | null;
  readonly entries: readonly Entry[];
  readonly context: RowContext;
}) {
  const names = new Map(entries.map((entry) => [idOf(entry), viewOf(entry).name] as const));
  const items = saved?.items ?? [];
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto" data-testid="chat-saved">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-cell font-bold text-fg" data-testid="chat-saved-title">
          {t('chat.saved.title')}
        </span>
        <Link href={chatHref({})} className={cn(SECONDARY_LINK_CLASSES, 'shrink-0 text-xs')} data-testid="chat-saved-clear">
          {t('chat.rail.backToAll')}
        </Link>
      </div>
      <p className="m-0 px-3 pb-2 text-xs text-fg-muted">{t('chat.saved.description')}</p>
      {items.length === 0 ? (
        <p className="m-0 p-4 text-body text-fg-muted" data-testid="chat-saved-empty">
          {t('chat.saved.empty')}
        </p>
      ) : (
        <ul className="m-0 list-none p-0" aria-label={t('chat.saved.title')}>
          {items.map((item) => (
            <li key={item.messageId} className={ROW_HOVER_CLASSES}>
              <Link
                href={chatHref({ ...withThreadSelected(context.paneState, item.threadId), ...context.listQuery })}
                aria-current={item.threadId === context.selectedThreadId ? 'page' : undefined}
                className="flex flex-col gap-1 px-3 py-2"
                data-testid={`chat-saved-item-${item.messageId}`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-cell font-normal text-fg">
                    <span className="sr-only">{t('chat.saved.open')}</span>
                    {names.get(item.threadId) ?? t('chat.thread.unknownName')}
                  </span>
                  <span className="shrink-0 text-xs text-fg-placeholder">{formatDateTimeJst(item.sentAt)}</span>
                </span>
                <span className="text-xs text-fg-muted">{item.snippet ?? t('chat.saved.removedBody')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {saved?.truncated === true ? (
        <p className="m-0 p-3 text-xs text-fg-muted" data-testid="chat-saved-truncated">
          {t('chat.saved.truncated')}
        </p>
      ) : null}
    </div>
  );
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
  saved = null,
  templates = [],
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
    unreadCounts: allUnread,
    mutedIds: allMuted,
    pinnedIds: new Set([...pinnedIds, ...(people?.pinnedIds ?? [])]),
    lastSnippets: { ...lastSnippets, ...(people?.lastSnippets ?? {}) },
    now,
  };
  const all = flatten(groups, rooms, sort);
  const shown = applyFilter(all, filter, (id) => allUnread[id] ?? 0);
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
      <form method="get" action={CHAT_PATH} className="flex shrink-0 items-center gap-2 px-3 py-2" data-testid="chat-threads-search">
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
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" size="sm" className="min-h-11 shrink-0 whitespace-nowrap md:min-h-8" data-testid="chat-threads-search-submit">
          {t('chat.threads.search.submit')}
        </Button>
        {canPost && people !== null ? (
          <Link
            href={chatHref({ filter: { kind: 'contacts' } })}
            className={cn(SECONDARY_LINK_CLASSES, 'min-h-11 shrink-0 whitespace-nowrap px-3 text-cell md:min-h-8')}
            data-testid="chat-new-conversation"
          >
            {t('chat.people.newConversationShort')}
          </Link>
        ) : null}
      </form>

      {filter.kind === 'templates' && canPost ? (
        // ✅ 2026-10-22（紺野「自分だけ」）: 自分の定型文の管理画面（一覧の列がまるごと切り替わる。「新しいグループ」と同じ作り）。
        <ChatTemplateManager
          templates={templates}
          backHref={chatHref({ ...paneState, q, sort })}
          limits={{ label: CHAT_TEMPLATE_LABEL_MAX_LENGTH, body: CHAT_TEMPLATE_BODY_MAX_LENGTH, count: CHAT_TEMPLATE_MAX_PER_USER }}
          labels={{
            back: t('chat.rail.backToAll'),
            title: t('chat.template.title'),
            description: t('chat.template.description'),
            countUnit: t('chat.template.countUnit'),
            empty: t('chat.template.empty'),
            newHeading: t('chat.template.newHeading'),
            editHeading: t('chat.template.editHeading'),
            label: t('chat.template.label'),
            labelPlaceholder: t('chat.template.labelPlaceholder'),
            body: t('chat.template.body'),
            bodyPlaceholder: t('chat.template.bodyPlaceholder'),
            note: t('chat.template.note'),
            create: t('chat.template.create'),
            update: t('chat.template.update'),
            cancel: t('chat.message.cancel'),
            edit: t('chat.template.edit'),
            remove: t('chat.template.delete'),
            deleteTitle: t('chat.template.deleteTitle'),
            deleteConfirm: t('chat.template.deleteConfirm'),
            deleteYes: t('chat.message.deleteConfirmYes'),
            needLabel: t('chat.template.needLabel'),
            needBody: t('chat.template.needBody'),
            limit: t('chat.template.limit'),
            failed: t('chat.template.failed'),
            savedToast: t('chat.toast.templateSaved'),
            deletedToast: t('chat.toast.templateDeleted'),
            toastLink: t('chat.toast.backToChat'),
          }}
        />
      ) : filter.kind === 'saved' ? (
        <ChatSavedView saved={saved} entries={all} context={context} />
      ) : filter.kind === 'newgroup' && people !== null && canPost ? (
        // ✅ 2026-10-22（紺野「グループ作るがダサい」）: 一覧の列がまるごと「新しいグループ」に切り替わる（連絡先と同じ「左に割り込む」形）。
        //    🔴 閲覧専用には出さない。候補は連絡先と同じ母集団（`lib/chat/people.ts` が RLS で決めたものだけ）。
        <ChatNewGroupForm
          companies={people.contacts.companies.map((company) => ({
            companyName: company.companyName ?? t('chat.thread.unknownName'),
            isHost: company.people.some((contact) => contact.isHost),
            people: company.people.map((contact) => ({
              userId: contact.userId,
              name: contact.name ?? t('chat.thread.unknownName'),
              status: contact.status ?? null,
            })),
          }))}
          labels={{
            title: t('chat.group.title'),
            back: t('chat.group.back'),
            name: t('chat.group.name'),
            namePlaceholder: t('chat.group.namePlaceholder'),
            search: t('chat.group.search'),
            selected: t('chat.group.selected'),
            selectedNone: t('chat.group.selectedNone'),
            self: t('chat.people.self'),
            remove: t('chat.group.remove'),
            partnerLimit: t('chat.group.partnerLimit'),
            noMatch: t('chat.group.noMatch'),
            external: t('chat.tag.external'),
            submit: t('chat.group.submit'),
            needName: t('chat.group.needName'),
            needMembers: t('chat.group.needMembers'),
            failed: t('chat.group.failed'),
            createdToast: t('chat.toast.groupCreated'),
            openGroup: t('chat.toast.openGroup'),
          }}
        />
      ) : (filter.kind === 'contacts' || filter.kind === 'newgroup') && people !== null ? (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          <ChatContactsView people={people}>
            {/* ✅ 2026-10-22: グループを作る入口は 1 行の導線（押すと「新しいグループ」画面へ）。🔴 閲覧専用には出さない。 */}
            {canPost && people.contacts.companies.length > 0 ? (
              <Link
                href={chatHref({ filter: { kind: 'newgroup' } })}
                className={cn('mx-2 mt-2 flex items-center gap-3 rounded-md px-2 py-2', ROW_HOVER_CLASSES)}
                data-testid="chat-new-group-toggle"
              >
                <Avatar size="md" initials="G" title={t('chat.group.heading')} className={AVATAR_KIND_CLASSES.GROUP} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-cell text-fg">{t('chat.group.heading')}</span>
                  <span className="truncate text-xs text-fg-muted">{t('chat.group.entry')}</span>
                </span>
                <span aria-hidden="true" className="text-fg-muted">
                  ›
                </span>
              </Link>
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
          {/* ✅ 2026-10-26（#166 の 7）: DM・グループを上限で読み切れなかったら、その旨を出す（黙って消さない）。 */}
          {people?.roomsTruncated === true && (filter.kind === 'dm' || filter.kind === 'group' || filter.kind === 'person') ? (
            <p className="m-0 px-3 py-2 text-xs text-fg-muted" data-testid="chat-rooms-truncated">
              {t('chat.people.roomsTruncated')}
            </p>
          ) : null}
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
